# Time sync API

A time sync keeps a live copy of the user's time entries in another system, both ways: Ajour sends the entries the user saves, edits, deletes and runs, and takes the entries logged there, such as a timer started in another tool. Only entries on projects your project source manages take part. A time sync is not a commit: the timesheet tool still gets a week only through Commit and Submit week. This page is the reference for plugin API version 4.

Declare `"timeSync": {}` beside `"projectSource": {}` in the manifest's [capabilities](/developers/manifest#capabilities). Ajour refuses `timeSync` without `projectSource`. Export `validateConnection`, `syncProjects` and `syncTimeEntries`.

Nothing in the shape names a product. Your plugin is the only place that knows which system it talks to.

## The Time entries switch

The capability's switch is **Time entries**, and it starts off: on a new install, and after an update that adds the capability. Nothing leaves Ajour until the user turns it on.

Turning it on calls `validateConnection` for each of your plugin's connections, with `timeSync` in `context.capabilities`. Throw there when the connection can't sync time entries, such as when its token can only read, with a sentence the user can act on. Ajour keeps the switch off and shows the connection's name with your sentence, such as "Planner: Time entries need a token that can write. This one can only read." While the switch is on, saving a connection calls `validateConnection` with `timeSync` too.

## syncTimeEntries

```ts
export async function syncTimeEntries(
  connection: PluginConnection,
  request: TimeSyncRequest,
): Promise<TimeSyncResult>;
```

Each call is one round for one connection. Apply `request.changes` in order, then list your entries from `request.from` to `request.to`, and answer both. Ajour runs a round only while the switch is on, under the usual 30-second operation timeout and the broker's request limits.

### The request

- **`from` and `to`.** The window to list, as local dates, `YYYY-MM-DD`, both included.
- **`timeZone`.** The user's IANA time zone, such as `America/Toronto`. The window's dates and each entry's `localDate` are days in it.
- **`changes`.** At most 20, in the order to apply them. One per entry.

A change is an `upsert`, with the entry's `values`, or a `delete`. It has:

- **`syncKey`.** Ajour's key for the entry. It stays the same for the entry's whole life, also when a running entry is saved, so your system sees a stop, not a delete and a new entry. Send it as your client reference.
- **`remoteId`.** Your entry's id, when Ajour knows it. A create whose answer was lost comes again without one: find your entry by its client reference and update it, so a retry never makes a duplicate.
- **`agreed`.** The values both sides last agreed on, when there are some. Use them to keep what Ajour doesn't own, such as a real start time, while the day doesn't change.

### Entry values

- **`localDate`.** The entry's day.
- **`minutes`.** Whole minutes. Both sides compare in minutes, so seconds never make a change.
- **`running`** and **`countingSince`.** A running entry has `countingSince`, the instant its count would have started from zero, so your system's elapsed time matches Ajour's. A saved entry has none. A running entry's `minutes` is its count when Ajour sent it: Ajour sends it again only when `countingSince` moves by a minute or more, or another value changes, never because time passed. Stop sends the same `syncKey` with `running: false`.
- **`projectRemoteId`.** The project's `remoteId` in your project source snapshot.
- **`taskName`.** The task's name as a commit would send it.
- **`taskRemoteId`.** The task's `remoteId` in your snapshot, when the task came from it.

Ajour never sends a note.

### The answer

Answer one result per change, by its `syncKey`:

- **`synced`**, with `entry`, the entry as you stored it. A delete has no entry.
- **`refused`**, with `message`, when your system won't take the change, such as an entry over 24 hours. Ajour shows the message and sends the entry again only once it changes.
- **`failed`**, with `message`, when it may work later. Ajour sends it again next round.

Then list `entries`, every entry of the user in the window after the changes, at most 2,000. Each has your `remoteId`, `clientRef` when Ajour created it, its values as above, and `updatedAt`, when your system last changed it, as an ISO date-time. When both sides changed an entry between two rounds, the later change wins.

Ajour checks every answer before it uses any of it. It refuses one that leaves a change without a result, answers a change twice, or gives a synced upsert no entry, naming the field.

## Types

```ts
interface TimeSyncRequest {
  /** YYYY-MM-DD, in `timeZone`. */
  from: string;
  to: string;
  /** IANA, such as America/Toronto. */
  timeZone: string;
  /** At most 20, in order. */
  changes: TimeSyncChange[];
}

type TimeSyncChange =
  | {
      kind: "upsert";
      syncKey: string;
      remoteId?: string;
      values: TimeSyncEntryValues;
      agreed?: TimeSyncEntryValues;
    }
  | {
      kind: "delete";
      syncKey: string;
      remoteId?: string;
      agreed?: TimeSyncEntryValues;
    };

interface TimeSyncEntryValues {
  /** YYYY-MM-DD. */
  localDate: string;
  /** Whole minutes. */
  minutes: number;
  running: boolean;
  /** Only when running: when the count would have started from zero. */
  countingSince?: string;
  projectRemoteId: string;
  /** 1 to 240 characters. */
  taskName: string;
  taskRemoteId?: string;
}

interface TimeSyncResult {
  results: TimeSyncChangeResult[];
  /** At most 2,000. */
  entries: TimeSyncRemoteEntry[];
}

type TimeSyncChangeResult =
  | { syncKey: string; status: "synced"; entry?: TimeSyncRemoteEntry }
  | { syncKey: string; status: "refused"; message: string }
  | { syncKey: string; status: "failed"; message: string };

interface TimeSyncRemoteEntry extends TimeSyncEntryValues {
  remoteId: string;
  /** The syncKey Ajour sent when it created the entry. */
  clientRef?: string;
  /** When your system last changed it. */
  updatedAt: string;
}
```

`@ajour/plugin-sdk` 0.2.0 has these types, generated from Ajour's schemas. The example plugin Ajour's own tests load, `packages/example`, answers rounds from an in-memory remote.

## Errors

Throw an `Error` when the whole round fails, such as when your system doesn't answer, with a message the user can act on. Ajour applies nothing from that round. A message that echoes a secret connection value is redacted to `[secret]` before Ajour shows it. A refusal or failure of one change is a result, not an error.

## Connection fields

A time sync writes, so the connection's token needs to write time entries. Say so in the token field's `helpText`, and refuse a token that can only read in `validateConnection` while `timeSync` is in `context.capabilities`.

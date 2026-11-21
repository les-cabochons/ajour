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
): Promise<TimeSyncAnswer>;
```

Each call is one round for one connection. Apply `request.changes` in order, then list your entries from `request.from` to `request.to`, and answer both. Ajour runs a round only while the switch is on, under the usual 30-second operation timeout and the broker's request limits.

Ajour runs a round about 2 seconds after the user changes an entry, and asks every 5 seconds while its window is on screen, every 60 seconds while it is hidden. Without a cursor, Ajour lists at most once a minute, as before. See [Check rounds](#check-rounds) to check every 5 seconds for free.

### The request

- **`from` and `to`.** The window to list, as local dates, `YYYY-MM-DD`, both included.
- **`timeZone`.** The user's IANA time zone, such as `America/Toronto`. The window's dates and each entry's `localDate` are days in it.
- **`changes`.** At most 20, in the order to apply them. One per entry. It can be empty: before a round that changes entries your system has, Ajour sends one with no changes and takes its listing first, so a later change on your side isn't overwritten.
- **`cursor`.** The cursor of your last answer, in a check round only. See [Check rounds](#check-rounds).

A change is an `upsert`, with the entry's `values`, or a `delete`. It has:

- **`syncKey`.** Ajour's key for the entry. It stays the same for the entry's whole life, also when a running entry is saved, so your system sees a stop, not a delete and a new entry. Send it as your client reference.
- **`remoteId`.** Your entry's id, when Ajour knows it. A create whose answer was lost comes again without one: find your entry by its client reference and update it, so a retry never makes a duplicate. When the user deletes that entry in Ajour before the retry, a delete comes without one: find the entry by its client reference in the window and delete it. When there is none, answer `synced`.
- **`agreed`.** The values both sides last agreed on, when there are some. Use them to keep what Ajour doesn't own, such as a real start time, while the day doesn't change.

A week the user submitted stays as they committed it, and Ajour puts it back when your system changes it. When your listing shows an edit to one of its entries, the next round sends an upsert with Ajour's values, and `agreed` holds your entry's values as you listed them, so you see what goes back, such as a day someone moved. When your listing misses one of its entries, the next round sends an upsert to create it again. It has no `remoteId`, or the old one for an entry Ajour first took from your system: create the entry, with the client reference. An entry logged in your system in a submitted week waits in Ajour's Sync review until the user reopens the week.

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

Then list `entries`, every entry of the user in the window after the changes, at most 2,000. Each has your `remoteId`, `clientRef` when an Ajour created it, whichever one, its values as above, and `updatedAt`, when your system last changed it, as an ISO date-time. When both sides changed an entry between two rounds, the later change wins.

A user may connect several Ajours to your system, such as one on each of their computers. Each sends its own sync keys, so an Ajour takes an entry whose `clientRef` is another Ajour's as one logged in your system, and every Ajour shows the same entries.

List the user's running entry with `running: true` and `countingSince`. One this Ajour didn't send, from your system or another Ajour, becomes the user's running entry in Ajour, and Ajour saves its own at that `countingSince`. Keep one running entry per person: when a timer starts, in your system or from an upsert Ajour sends, stop the one running before at that instant. Ajour then reads the stop of its own running entry, and keeps the minutes you list.

Ajour checks every answer before it uses any of it. It refuses one that leaves a change without a result, answers a change twice, or gives a synced upsert no entry, naming the field.

### Check rounds

When your system keeps a change marker, a version that moves on every write to the user's time entries there, from any tool, a check can skip the listing:

1. Add `cursor` to the full answer: whatever lets you tell later whether the marker moved, such as its ETag. Read the marker after you apply the changes and before you list, so a write that lands during the listing moves it again.
2. Ajour keeps the cursor in its window's memory, never in its saved state or its log, so it may hold a read link. When nothing changed in Ajour since your last full answer, its next round is a check: the same window, `cursor`, and no changes.
3. When the marker is where the cursor says, answer `{ unchanged: true, cursor }`, with the cursor for the next check, without calling your system's API. Otherwise list and answer in full, with the new cursor.

Ajour refuses an unchanged answer to a request without a cursor or with changes, and an Ajour without check rounds never sends a cursor. Any change in Ajour, a failed round or a saved connection makes the next round full. A full round with changes still carries your cursor, so you can reuse what it holds, such as a read link; a full round without changes carries none. List anyway when you can't read the marker, and now and then, such as once an hour, so a missed write can't hide for long.

A check you answer unchanged writes no line to the user's local log file, and neither does a request of yours answered 304, such as a `HEAD` to the marker with `If-None-Match`. So a check every few seconds costs the user no log space. A check that fails, or takes 2 seconds or more, is written as any round is.

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
  /** Your last answer's cursor, in a check round only. */
  cursor?: string;
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

type TimeSyncAnswer = TimeSyncResult | TimeSyncUnchangedResult;

interface TimeSyncResult {
  results: TimeSyncChangeResult[];
  /** At most 2,000. */
  entries: TimeSyncRemoteEntry[];
  /** Up to 2,000 characters, opaque to Ajour. */
  cursor?: string;
}

/** Only to a request with a cursor and no changes. */
interface TimeSyncUnchangedResult {
  unchanged: true;
  cursor: string;
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

`@ajour/plugin-sdk` 0.3.0 has these types, generated from Ajour's schemas. The example plugin Ajour's own tests load, `packages/example`, answers rounds from an in-memory remote with a change marker.

## Errors

Throw an `Error` when the whole round fails, such as when your system doesn't answer, with a message the user can act on. Ajour applies nothing from that round. A message that echoes a secret connection value is redacted to `[secret]` before Ajour shows it. A refusal or failure of one change is a result, not an error.

## Connection fields

A time sync writes, so the connection's token needs to write time entries. Say so in the token field's `helpText`, and refuse a token that can only read in `validateConnection` while `timeSync` is in `context.capabilities`.

# Project source API

A project source brings the user's projects into Ajour from the system that holds the truth about them: their official name and code, the client, the tasks planned there, which are assigned to the user, and the budget with what it has consumed. The capability is read-only. Ajour never writes to a project source, and time keeps going to the timesheet tool as before. This page is the reference for plugin API version 4.

Declare `"projectSource": {}` in the manifest's [capabilities](/developers/manifest#capabilities), and export `validateConnection` and `syncProjects`.

Nothing in the shape names a product. Your plugin supplies the source's label and URLs, and Ajour shows them wherever it names the source.

## syncProjects

```ts
export async function syncProjects(
  connection: PluginConnection,
  request: { cursor?: string; trigger?: "manual" | "auto" },
): Promise<
  { snapshot: ProjectSourceSnapshot; cursor?: string } | { unchanged: true }
>;
```

Return the snapshot and the cursor to send next time, or `{ unchanged: true }` when nothing changed since the cursor you received.

Ajour calls `syncProjects` every 15 minutes while the connection's Managed projects switch is on, when the user adds the connection, when they press Sync now on it or on a managed project's page, and when they open a managed project's page, at most once every 5 minutes per connection. A call that fails keeps the last snapshot Ajour applied, and the connection shows the error and when it last synced.

`trigger` says what started the sync: `manual` when the user asked for it, `auto` for the 15-minute sync. A plugin that answers from a cache of the source should read the source on a manual sync, so what the user just changed there shows. Older Ajour versions send no trigger.

The cursor is yours. Ajour never reads it: it keeps the last one per connection and sends it back on the next sync, and sends none on the first sync, after a snapshot that came without one, after the user saves the connection again, after your plugin's version changes, and when Ajour needs the whole snapshot again. An ETag works well: send it as `If-None-Match`, and answer `{ unchanged: true }` on a 304. Never answer `{ unchanged: true }` to a request without a cursor: Ajour refuses it, since it has nothing to compare with.

### What the snapshot carries

- **The source.** `source.label` is what Ajour calls it, 1 to 80 characters. `source.url` is its home.
- **`asOf`.** When the source's figures are from, as an ISO date-time. A source usually learns its hours from a report that lags the user's entries, so Ajour uses `asOf` to tell lag from a conflict.
- **`me`.** Whether the source can give the user's own hours. When `hoursAvailable` is false, `hoursNote` is your sentence on why, such as "Link your account in Planner to compare your hours.", and Ajour shows it instead of comparing nothing. When the tasks' `myHours` cover a period, such as the current month, `hoursSince` is its first day, `YYYY-MM-DD`: Ajour compares only the user's entries from that day. Without it, Ajour compares all of them.
- **Projects.** Every project of the user, assigned tasks or not, at most 200. `remoteId` is stable across renames. `code` is what Ajour links an existing local project by, without asking. `complete` archives the project in Ajour. `url` is where "Open in <source>" goes, as an absolute https address. `client`, `startsOn` and `endsOn` are optional; dates are `YYYY-MM-DD`.
- **Tasks.** Every task of the project, the ones not assigned to the user included, at most 10,000 across the snapshot. `group` is how the source groups them, such as a phase. `assigned` says whether the source assigns the task to the user, and `myHours` their hours on it when the source knows them.
- **Budget.** The source writes every figure, as of `asOf`. `unit` is `hours` or `money`. `remaining` may be negative; `status` says whether that is `over`. When the budget covers a period, `since` is the first day `consumed` covers, `YYYY-MM-DD`: Ajour counts the user's entries from that day only. Without it, Ajour counts all of them. Ajour shows the figures of an hours budget only; for a money budget it shows `status` alone.

Ajour checks every snapshot before it applies any of it, and refuses one that leaves out a required field, repeats a remote id, or goes over the bounds, naming the field.

### What Ajour does with it

- A project Ajour already follows matches by `remoteId`. Otherwise a local project with the same `code`, ignoring case, becomes the managed one without a question, and keeps its time entries. A project that only matches a local project's name waits for the user in Sync review, who links it or adds it as new. Any other project is added.
- Every sync takes the project's `name`, `code`, `client`, dates and budget, and each task's `name`, `billable` and `estimateHours`. The user's display name, color, icon, favorites, pins and plugin properties stay.
- A task matches by `remoteId`, then by name among the project's tasks the source doesn't know yet.
- `complete: true` archives the project, and `complete: false` restores it if Ajour archived it for that. A `closed` task is archived the same way. A project or task left out of the snapshot is archived, never deleted, and comes back when it returns. The user can't restore what the source archived, so your snapshot decides when it comes back.
- A project shared with a team is never linked to a source: a project with its code or name is added beside it.
- The project's budget card shows your figures with `asOf`, adds **Not counted yet**, the user's time you can't have yet (entries not committed, or committed after `asOf`), and estimates what remains from the two. When `me.hoursAvailable` is true, it compares each task's `myHours` with what the user committed on it before `asOf`, and says when they differ. A task's row shows its `estimateHours` and `myHours`.

## Types

```ts
interface ProjectSourceSnapshot {
  source: { label: string; url?: string };
  /** When the source's hours are from. */
  asOf: string;
  me?: {
    hoursAvailable: boolean;
    hoursNote?: string;
    /** The first day `myHours` cover, YYYY-MM-DD. */
    hoursSince?: string;
  };
  /** At most 200. */
  projects: ProjectSourceProject[];
}

interface ProjectSourceProject {
  /** Up to 100 characters, stable across renames. */
  remoteId: string;
  /** 1 to 240 characters. */
  name: string;
  /** 1 to 120 characters. Ajour links a local project by it. */
  code: string;
  /** An absolute https address. */
  url?: string;
  client?: string;
  complete: boolean;
  startsOn?: string;
  endsOn?: string;
  budget?: ProjectSourceBudget;
  /** At most 10,000 across the snapshot. */
  tasks: ProjectSourceTask[];
}

interface ProjectSourceTask {
  remoteId: string;
  name: string;
  /** Such as a phase. */
  group?: string;
  closed: boolean;
  billable?: boolean;
  estimateHours?: number;
  assigned: boolean;
  myHours?: number;
}

interface ProjectSourceBudget {
  unit: "hours" | "money";
  total?: number;
  consumed: number;
  /** May be negative. */
  remaining?: number;
  status?: "ok" | "warning" | "over" | "unknown";
  /** The first day `consumed` covers, YYYY-MM-DD. */
  since?: string;
}
```

## Errors

Throw an `Error` with a message the user can act on, such as "The token was revoked or expired. Create a new one in Planner and paste it here." Ajour shows the message on the connection and keeps the last snapshot. A message that echoes a secret connection value is redacted to `[secret]` before Ajour shows it.

## Connection fields

A project source usually needs the service's address and a personal token, marked `secret`. Ask for a read-only token where the service offers one, and say so in the field's `helpText`. When `validateConnection` can tell the token has more rights than needed, return a warning in its result so the connection page shows it.

See [Secret fields](/developers/manifest#secret-fields).

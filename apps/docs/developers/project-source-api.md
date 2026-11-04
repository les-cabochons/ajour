# Project source API

A project source brings the user's projects into Ajour from the system that holds the truth about them: their official name and code, the client, the tasks planned there, which are assigned to the user, and the budget with what it has consumed. The capability is read-only. Ajour never writes to a project source, and time keeps going to the timesheet tool as before. This page is the reference for plugin API version 4.

Declare `"projectSource": {}` in the manifest's [capabilities](/developers/manifest#capabilities), and export `validateConnection` and `syncProjects`.

Nothing in the shape names a product. Your plugin supplies the source's label and URLs, and Ajour shows them wherever it names the source: "From Planner" on a managed project, "Open in Planner" in its properties card.

## syncProjects

```ts
export async function syncProjects(
  connection: PluginConnection,
  request: { cursor?: string },
): Promise<
  { snapshot: ProjectSourceSnapshot; cursor?: string } | { unchanged: true }
>;
```

Ajour calls it on the connection's interval while **Managed projects** is on, and when the user presses **Refresh**. Return the snapshot and the cursor to send next time, or `{ unchanged: true }` when nothing changed since the cursor you received.

The cursor is yours. Ajour never reads it: it keeps the last one per connection and sends it back on the next sync, and sends none on the first sync, after a snapshot that came without one, and after the user saves the connection again. An ETag works well: send it as `If-None-Match`, and answer `{ unchanged: true }` on a 304. Never answer `{ unchanged: true }` to a request without a cursor: Ajour refuses it, since it has nothing to compare with.

### What the snapshot carries

- **The source.** `source.label` is what Ajour calls it, 1 to 80 characters. `source.url` is its home.
- **`asOf`.** When the source's figures are from, as an ISO date-time. A source usually learns its hours from a report that lags the user's entries, so Ajour uses `asOf` to tell lag from a conflict.
- **`me`.** Whether the source can give the user's own hours. When `hoursAvailable` is false, `hoursNote` is your sentence on why, such as "Link your account in Planner to compare your hours.", and Ajour shows it instead of comparing nothing.
- **Projects.** Every project of the user, assigned tasks or not, at most 200. `remoteId` is stable across renames. `code` is what Ajour links an existing local project by, without asking. `complete` archives the project in Ajour. `url` is where "Open in <source>" goes, as an absolute https address. `client`, `startsOn` and `endsOn` are optional; dates are `YYYY-MM-DD`.
- **Tasks.** Every task of the project, the ones not assigned to the user included, at most 10,000 across the snapshot. `group` is how the source groups them, such as a phase. `assigned` says whether the source assigns the task to the user, and `myHours` their hours on it when the source knows them.
- **Budget.** The source writes every figure, as of `asOf`. `unit` is `hours` or `money`. `remaining` may be negative; `status` says whether that is `over`.

Ajour checks every snapshot before it applies any of it, and refuses one that leaves out a required field, repeats a remote id, or goes over the bounds, naming the field.

## Types

```ts
interface ProjectSourceSnapshot {
  source: { label: string; url?: string };
  /** When the source's hours are from. */
  asOf: string;
  me?: { hoursAvailable: boolean; hoursNote?: string };
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
}
```

## Errors

Throw an `Error` with a message the user can act on, such as "The token was revoked or expired. Create a new one in Planner and paste it here." Ajour shows the message on the connection and keeps the last snapshot. A message that echoes a secret connection value is redacted to `[secret]` before Ajour shows it.

## Connection fields

A project source usually needs the service's address and a personal token, marked `secret`. Ask for a read-only token where the service offers one, and say so in the field's `helpText`. When `validateConnection` can tell the token has more rights than needed, return a warning in its result so the connection page shows it.

See [Secret fields](/developers/manifest#secret-fields).

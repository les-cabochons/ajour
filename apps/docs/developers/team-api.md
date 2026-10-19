# Team API

A team plugin keeps the shared projects of a team in step between its members' workspaces, through a backend the plugin talks to. Ajour sends the fields that changed since the last sync and receives the team's changes since a cursor. Only project and task fields cross: never time entries, notes or tracked time. This page is the reference for plugin API version 3 and team capability version 1.

Declare `"team": { "apiVersion": 1 }` in the manifest's [capabilities](/developers/manifest#capabilities), and export `validateConnection`, `createTeam` and `syncTeamProjects`.

## createTeam

```ts
export async function createTeam(
  config: Record<string, string | number | boolean>,
  request: { name: string },
): Promise<{ values: Record<string, string | number | boolean> }>;
```

Ajour calls it from the connection form, before the connection is saved. `config` holds the form's values as they stand, such as the deployment URL. `name` is 1 to 120 characters. Return the connection values that join the new team, such as its ID and secret, and Ajour fills them into the form. Your plugin names its own fields. Make the secret on the user's machine where you can, so the backend only ever sees its hash.

Ajour tells teams apart by your plugin's non-secret connection fields, other than the [reserved ones](/developers/manifest#reserved-fields). A new secret keeps the team, but a new value in any of those fields names another team: the connection's shared projects turn local and sharing starts over. Mark the team's secret `secret: true`, and keep other non-secret fields to what names the team, such as the deployment URL and team ID.

## syncTeamProjects

```ts
export async function syncTeamProjects(
  connection: PluginConnection,
  request: TeamSyncRequest,
): Promise<TeamSyncResult>;
```

Ajour calls it on the connection's interval while **Projects** is on, when the user presses **Sync**, and after a share. One sync can be several rounds.

### What the backend must do

- **Changes first.** Apply `changes` in the order they come, then read the team's records changed after `cursor`, in one transaction. The last writer to a field wins.
- **Partial changes.** A field a change leaves out keeps its value. A change without `remoteId` is a new record and carries every field.
- **Retries are safe.** Treat a new record's `localId` as an idempotency key. A new record whose local ID was seen before gets the same `remoteId` again and creates nothing. Ajour sends a round again after a lost answer.
- **IDs for new records.** Return an entry in `assigned` for every new project and task in `changes`, and only for those.
- **Changed tasks only.** In `projects`, return each project changed after the cursor with its fields, and only the tasks changed after it. Without a cursor, return everything. Tasks are never deleted, so a missing task is unchanged.
- **Paging.** Return at most 25 projects and 2,000 tasks in a page. Set `hasMore` when more remain, and Ajour asks again from the new `cursor`.
- **No moves, no deletes.** A task stays in its project, and records are archived, never removed.
- **Ownership checks.** Refuse a change that names another team's record or moves a task to another project.

Ajour checks every result before it applies any of it. It refuses a result that leaves out an ID, names a record twice, gives one ID to two records or moves a task, and then sends the round again at the next sync.

### Values Ajour refuses

Icons and colors reach CSS, so Ajour accepts only what it produces itself:

- **Color.** A six-digit hex value, such as `#4f46e5`.
- **Uploaded icon.** A complete base64 PNG data URL. No URL to an image, and no SVG.

Names are 1 to 240 characters and codes 1 to 120. A plugin error that echoes a secret connection value is redacted to `[secret]` before Ajour shows it.

## Types

```ts
interface TeamSyncRequest {
  /** The highest position the client has seen. Absent on the first sync. */
  cursor?: string;
  /** At most 25 projects and 2,000 tasks. */
  changes: TeamProjectChange[];
}

interface TeamProjectChange {
  /** Up to 200 characters. */
  localId: string;
  /** Absent for a project new to the team. Up to 100 characters. */
  remoteId?: string;
  name?: string;
  displayName?: string;
  /** null clears it. */
  code?: string | null;
  color?: string;
  icon?: TeamProjectIcon;
  status?: "active" | "archived";
  tasks: TeamTaskChange[];
}

interface TeamTaskChange {
  localId: string;
  remoteId?: string;
  name?: string;
  status?: "active" | "archived";
  billable?: boolean;
  /** Whole milliseconds, above 0. null clears it. */
  budgetMs?: number | null;
}

type TeamProjectIcon =
  | { kind: "preset"; name: string }
  | {
      kind: "upload";
      /** A base64 PNG data URL, up to 16,384 characters. */
      src: string;
      maskSrc?: string;
      colorMode?: "tinted" | "native";
    };

interface TeamSyncResult {
  /** Up to 2,000 characters. */
  cursor: string;
  /** At most 25 projects and 2,000 tasks. */
  projects: TeamProject[];
  assigned: { localId: string; remoteId: string }[];
  hasMore?: boolean;
}

interface TeamProject {
  remoteId: string;
  name: string;
  displayName: string;
  code: string | null;
  color: string;
  icon: TeamProjectIcon;
  status: "active" | "archived";
  tasks: {
    remoteId: string;
    name: string;
    status: "active" | "archived";
    billable: boolean;
    budgetMs: number | null;
  }[];
}
```

The schemas live in `packages/shared/team-sync.ts` in the Ajour repository.

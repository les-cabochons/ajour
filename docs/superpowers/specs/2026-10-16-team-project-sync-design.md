# Team project sync

- Status: Approved design, spec waiting for review
- Date: 2026-10-16
- Builds on: `2026-10-15-plugin-project-properties-design.md`, the per-capability switches of #177, and [ADR 0005](../../../agents/adr/0005-shared-projects-last-writer-wins.md)

## Why

A team that tracks time against the same client engagements keeps one list of projects and tasks by hand today: someone renames a project, and four other people rename it too, or not. Ajour is local-first, and stays so: a sync must be explicit, opt-in and privacy-scoped. The team capability lets a plugin keep the projects and tasks of a team in step, through a backend the team is given credentials for, while time entries never leave the machine.

The first plugin is Convex-backed and maintained in a separate, private repository. Ajour contains only the capability, the host protocol, the sync rules and the settings UI, so that any backend can implement it.

## What the user sees

- A **team** plugin adds a **Projects** switch next to Backlog items and Pull requests when the plugin declares more than one switchable capability. The plugin's page lists its connections like a connector's, with last sync, last error, auto sync and interval.
- A **connection** is one team. The form has the deployment URL, then either **Create a team**, which returns a team ID and secret to pass to colleagues, or **Join a team**, which takes them. A workspace can connect to several teams.
- Saving a connection opens a one-time **picker**. It lists the team's projects with any local project of the same name pre-checked as **Link**, and the remaining local projects unchecked as **Share**. Team projects that match nothing arrive on their own. The user can skip the picker and share later.
- On a project's page, **Share with team** turns a local project into a shared project. When the team already has a project of that name, Ajour links the two and merges tasks by name, as the Excel import does. Linking never asks which tasks to merge: same name, same task. The properties card shows **Shared with <team>** and an **Unshare** action. The Projects list shows a small shared mark.
- A failed sync sets the connection's last error on the plugin's page, like a connector's. A failed **Sync now** also shows an error toast. Projects carry no error state of their own.
- A shared project's full name, display name, code, status, color, icon, task names, task status, billable flag and budget follow the team. Pinned slots, plugin properties, the order of projects and tasks, and the budget adjustment stay personal.
- A project a colleague shares appears at the next sync, active, at the end of the project list, with no acceptance step.
- Archiving a shared project or task archives it for the whole team at the next sync; restoring it restores it everywhere. There is no way to remove a project from the team.
- Unsharing makes the project local on this machine only. Removing a connection makes all its shared projects local, and keeps tasks and time entries as they are.
- Auto sync is on from the moment a connection is saved, every 15 minutes by default, with a **Sync now** button. There is no review queue: syncing writes straight to the workspace.
- Time entries, tracked totals, notes and budget consumption never sync, not even in aggregate. The budget figure itself does.

## Manifest

A new capability, `team`. It is switchable: with a connector or a code host in the same plugin, each gets its own switch. `switchableCapabilitySchema` becomes `connector | codeHost | team`, labelled Backlog items, Pull requests and Projects. A plugin with `team` runs code, so it needs an entrypoint and connection fields.

```json
"capabilities": {
  "team": { "apiVersion": 1 }
}
```

Connection fields declare the deployment URL and the team credentials with the existing `connectionFields`, marked `capability: "team"` when the plugin also serves other capabilities. Team creation is a plugin operation, not a field.

## Host protocol

The schemas live in `packages/shared/team-sync.ts`. Three operations, each run in a fresh worker like every plugin operation:

- `createTeam(connectionValues, { name })` → `{ values }`. `values` are the connection field values that join the new team, such as its ID and secret, and the form fills them in. The plugin names its own fields.
- `validateConnection(values, capabilities)` already exists and checks that the team accepts the credentials.
- `syncTeamProjects(connectionValues, { cursor, changes })` → `{ cursor, projects, assigned, hasMore }`.
  - `changes` carries the shared projects changed since the last sync. A project or task without a remote ID is new and carries every team-owned field. One with a remote ID carries only the fields changed since the last sync, so a field a teammate changed meanwhile keeps their value. A change to a project may carry only task changes. `null` clears the code or a budget.
  - `projects` carries the team projects changed since `cursor`, each with all its tasks and remote IDs.
  - `assigned` maps the local IDs of new projects and tasks to the remote IDs the team gave them.
  - The backend applies `changes` before computing `projects`, so the last writer wins inside one round.
  - With `hasMore`, Ajour syncs again from the new cursor with no changes until the team has nothing left.
  - The picker is a sync with no `cursor` and no `changes`: it returns the whole team, page by page, and nothing is applied until the user confirms.

Team-owned project fields are the full name, display name, code, color, icon and status. Team-owned task fields are the name, status, billable flag and budget, a duration in milliseconds as stored. An uploaded icon travels as its 32 pixel image data; an icon that points to a URL is refused, so a teammate cannot make Ajour fetch from a remote address. Fields outside this list are stripped at the boundary, so no time data can leave through the payload.

A page holds at most 25 projects of at most 500 tasks each, which keeps it under the worker's 8 MB result limit. Ajour pushes more than 25 changed projects over several rounds.

## Storage

- `LocalProject` gets `team?: { connectionId: string; remoteId: string; changedAt?: number }`. `LocalProjectTask` gets `team?: { remoteId: string; changedAt?: number }`. A new shared project or task has `remoteId: ""` until the team assigns one.
- `changedAt` is set by the project transitions whenever a team-owned field changes, and cleared when the sync pushes it. The store keeps only the last action's undo, so "the Undo window is open" for a record means the store's pending undo touches it. `planTeamSync` receives the IDs of those records from `local-store.ts` and skips them; no timer is involved, and the next sync carries the change once the toast has closed.
- Local state gets `teamSyncCursors: Record<connectionId, string>`. It lives with the projects so that the merge is pure and the cursor cannot drift from the projects it describes.
- Unsharing and connection removal drop `team` from the records. Nothing else changes.
- `normalizeProject` drops a `team` whose shape is wrong, which turns the project local.

## Sync rules

A pure module, `apps/web/src/domain/projects/team-sync.ts`, owns:

- `planTeamSync(state, connectionId, now)`: the `changes` to push and the cursor, honouring the Undo window.
- `applyTeamSync(state, connectionId, result, factories)`: assigns remote IDs, merges the team's changes per field (the team's value replaces the local one for every team-owned field, except a field with a local change not pushed yet, such as one still in its Undo window: it keeps the local value, and the next push makes it the later write), creates projects and tasks the workspace lacks with new local IDs, archives and restores, and stores the cursor. Local IDs never change, so time entries keep their references.
- `shareProject(state, project, teamProjects)`: links by name or marks the project as new, and merges tasks by name.
- `unshareProject` and `disconnectTeam`.

The rules are in [ADR 0005](../../../agents/adr/0005-shared-projects-last-writer-wins.md): last writer wins per field, archive without review, nothing deleted.

## Code

- `packages/shared/team-sync.ts`: the capability schema, the change, project and result schemas, and the page bounds. `packages/shared/connectors.ts`: the `team` capability in the manifest, `pluginHasTeam`, the third switchable capability and its label, and the `createTeam` result. `packages/shared/plugin-catalog.ts`: `team` as a catalog capability.
- `apps/api/src/plugin-host.ts`: the three operations, gated by the plugin's switch and the capability deny-list like the others.
- `apps/api/src/server.ts`: `POST /api/connectors/:id/team/create` and `POST /api/connectors/:id/team/sync`. The route validates and forwards; it never touches projects.
- `apps/web/src/lib/team-sync.ts`: the application service that plans, calls the API, applies, and persists through `local-store.ts`; the scheduler entry that runs it on the connection's interval, next to the backlog and pull request auto syncs.
- `apps/web/src/features/settings`: the connection form's Create and Join modes, and the picker.
- `apps/web/src/features/projects`: Share with team, Shared with, Unshare, and the shared mark.
- `apps/web/src/domain/local-state-undo.ts`: a sync is not undoable; it records nothing.

Without the local API, as in the web build, the capability is absent and every project is local.

## Plugin

The Convex plugin is maintained separately and installed from a packaged archive through the existing local-file installer. It ships the Convex client as a bundled dependency and uses the HTTP client only: one query and one mutation per sync. Live updates would need a long-lived worker, which is a host change for later. The deployment is run by the plugin's maintainer; teams receive credentials.

## Docs

- Developers › Manifest: the `team` capability and the three operations.
- Projects: shared projects, Share with team, Unshare, what follows the team and what stays personal.
- Plugins: the team plugin's page, Create a team, Join a team, the picker.

## Testing

- `team-sync.test.ts`: plan honours the Undo window; apply assigns IDs, merges per field, creates, archives, restores, links by name, and leaves personal fields alone; unshare and disconnect keep tasks and references.
- `local-state.test.ts`: `team` and `teamSyncCursors` survive a round trip, and a malformed `team` turns the project local.
- `plugin-host.test.ts`: the operations respect the switch and the deny-list.
- `connectors.test.ts`: the manifest accepts `team` and the sync schemas bound their payloads.

## Out of scope

- Live updates and a long-lived worker.
- Per-user sign-in and "changed by" attribution.
- Sharing a project with more than one team.
- Deleting a project from a team.
- Any time data, including budget consumption, leaving the machine.
- Catalog listing of the plugin.

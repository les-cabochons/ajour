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
- A shared project's name, code, status, color, icon, task names, task status, billable flag and budget follow the team. Pinned slots, plugin properties, the order of projects and tasks, and the budget adjustment stay personal.
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

Three operations, each run in a fresh worker like every plugin operation:

- `createTeam(connectionValues)` → `{ teamId, secret }`. The form fills the credential fields with the result.
- `validateConnection(values, capabilities)` already exists and checks that the team accepts the credentials.
- `syncTeamProjects({ connectionValues, cursor, changes })` → `{ cursor, projects, assigned }`.
  - `changes` carries the shared projects changed since the last sync: for a project, its remote ID when it has one, its team-owned fields, and its changed tasks with the same shape. A new project or task has no remote ID.
  - `projects` carries the team projects changed since `cursor`, with their tasks and remote IDs.
  - `assigned` maps the local IDs of new projects and tasks to the remote IDs the team gave them.
  - The backend applies `changes` before computing `projects`, so the last writer wins inside one round.
  - The picker is a sync with no `cursor` and no `changes`: it returns the whole team, and nothing is applied until the user confirms.

Payloads stay bounded like every worker result. A project's budget is a duration in milliseconds, as stored.

## Storage

- `LocalProject` gets `team?: { connectionId: string; remoteId?: string; synced?: TeamProjectFields }`. `LocalProjectTask` gets `team?: { remoteId?: string; synced?: TeamTaskFields }`. A new shared project or task has neither until the team assigns a remote ID.
- `synced` is the last-synced copy of the record's team-owned fields. A field whose value differs from its `synced` copy is a local change. The copy is persisted with the record, so a restart loses nothing, and no timestamps are kept. The project transitions do not change: any edit to a team-owned field is a local change by definition.
- The store keeps only the last action's undo, so "the Undo window is open" for a record means the store's pending undo touches it. `planTeamSync` receives the IDs of those records from `local-store.ts` and skips them; no timer is involved, and the next sync carries the change once the toast has closed.
- After a round succeeds, each pushed field's `synced` copy becomes the value that was pushed, not the record's current value. An edit made while the round was in flight therefore stays a local change for the next round.
- Local state gets `teamSyncCursors: Record<connectionId, string>`. It lives with the projects so that the merge is pure and the cursor cannot drift from the projects it describes.
- Unsharing and connection removal drop `team` from the records. Nothing else changes.
- `normalizeProject` drops a `team` whose shape is wrong, which turns the project local.

## Sync rules

A pure module, `apps/web/src/domain/projects/team-sync.ts`, owns:

- `planTeamSync(state, connectionId, pendingUndoRecordIds)`: the `changes` to push and the cursor. A new record sends every team-owned field; a shared one sends the fields that differ from `synced`. Records in `pendingUndoRecordIds` are skipped.
- `applyTeamSync(state, connectionId, pushed, result, factories)`: assigns remote IDs and sets `synced` to the pushed values, then merges the team's records per field. For a field with no local change, the team's value replaces both the local value and `synced`. For a field with a local change, such as one still in its Undo window, the local value stays and `synced` takes the team's value, so the next push sends it as the later write. It also creates projects and tasks the workspace lacks with new local IDs, archives and restores, and stores the cursor. Local IDs never change, so time entries keep their references.
- `shareProject(state, project, teamProjects)`: links by name or marks the project as new, and merges tasks by name.
- `unshareProject` and `disconnectTeam`.

The rules are in [ADR 0005](../../../agents/adr/0005-shared-projects-last-writer-wins.md): last writer wins per field, archive without review, nothing deleted.

## Code

- `packages/shared/connectors.ts`: the `team` capability, `pluginHasTeam`, the third switchable capability and its label, and the sync request and result schemas.
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

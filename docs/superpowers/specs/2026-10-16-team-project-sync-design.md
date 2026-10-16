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
- Saving a connection runs a first sync, then opens a one-time **picker**. It lists the team projects held because a local project has their name, each pre-set to **Link**, and the remaining local projects unchecked as **Share**. Team projects that match nothing have already arrived. The user can skip the picker; held projects wait, and the remaining local projects can be shared later.
- On a project's page, **Share with team** turns a local project into a shared project. When the team already has a project of that name, Ajour links the two and merges tasks by name, as the Excel import does. Linking never asks which tasks to merge: same name, same task. The properties card shows **Shared with <team>** and an **Unshare** action. The Projects list shows a small shared mark.
- A failed sync sets the connection's last error on the plugin's page, like a connector's. A failed **Sync now** also shows an error toast. Projects carry no error state of their own.
- A shared project's full name, display name, code, status, color, icon, task names, task status, billable flag and budget follow the team. Pinned slots, plugin properties, the order of projects and tasks, and the budget adjustment stay personal.
- A project a colleague shares appears at the next sync, active, at the end of the project list, with no acceptance step.
- The one exception is a team project whose name one of the user's local projects has. It is held, and Ajour asks: "Sam shared Beta. Link it to your Beta, or add it separately?" **Link** makes the local project the shared one, so its time entries stay where they are, and its other tasks go to the team. **Add separately** adds the team project as a project of its own. While it waits, later syncs keep it current. Sharing a local project of that name offers the same Link instead.
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
  - `projects` carries the team projects changed since `cursor`, each with its team-owned fields and the tasks changed since `cursor`. Without a cursor it carries every task. Tasks are never deleted, so a task that is absent is unchanged, and a project with many changed tasks spans several pages.
  - `assigned` maps the local IDs of new projects and tasks to the remote IDs the team gave them. The team treats the local ID of a new record as an idempotency key: a new record whose local ID it assigned before gets the same remote ID again and creates nothing. A round that failed after the team applied it, such as on a timeout or a lost response, is then safe to send again.
  - The backend applies `changes` before computing `projects`, so the last writer wins inside one round.
  - With `hasMore`, Ajour syncs again from the new cursor with no changes until the team has nothing left.
  - The first sync of a connection has no `cursor` and no `changes`: it returns the whole team, page by page, and is applied like any other, holding same-name projects for the picker.

Team-owned project fields are the full name, display name, code, color, icon and status. Team-owned task fields are the name, status, billable flag and budget, a duration in milliseconds as stored. Fields outside this list are stripped at the boundary, so no time data can leave through the payload.

Icons and colors reach CSS, so the contract accepts only what Ajour itself produces. An uploaded icon travels as its 32 pixel image, a complete base64 PNG data URL; anything else is refused, including a URL or a data URL followed by a quote, so a teammate cannot make Ajour fetch from a remote address. A color is a six-digit hex value, as the color field gives. A local project whose color is in another format sends Ajour's default color when shared.

A request or a page holds at most 25 projects and 2,000 tasks in total. With the field bounds, a worst-case page serializes to under half the worker's 8 MiB result limit, which a test checks. Ajour pushes more changes over several rounds, and a project of any size can be shared.

## Storage

- `LocalProject` gets `team?: LocalProjectTeamLink`: `{ connectionId }` for a project new to the team, or `{ connectionId, remoteId, synced }` once the team assigned an ID. `LocalProjectTask` gets `team?: { remoteId, synced }`. A task of a shared project without it is new to the team.
- `synced` is the last-synced copy of the record's team-owned fields. A field whose value differs from its `synced` copy is a local change. The copy is persisted with the record, so a restart loses nothing, and no timestamps are kept. The project transitions do not change: any edit to a team-owned field is a local change by definition.
- The store keeps only the last action's undo, so "the Undo window is open" for a record means the store's pending undo touches it. Undo records hold whole projects, tasks included, so `getUndoProjectIds` in `local-state-undo.ts` gives the projects to skip, and `planTeamSync` skips them; no timer is involved, and the next sync carries the change once the toast has closed.
- After a round succeeds, each pushed field's `synced` copy becomes the value that was pushed, not the record's current value. An edit made while the round was in flight therefore stays a local change for the next round.
- Local state gets `teamConnections: Record<connectionId, { cursor?, unsharedRemoteIds, unsharedLocalIds, heldArrivals }>`. It lives with the projects so that the merge is pure and the cursor cannot drift from the projects it describes.
- Unsharing drops `team` from the project and its tasks, and adds the project's remote ID to `unsharedRemoteIds`, so the team's later changes to it do not bring it back as a second project. Removing the connection drops `team` from all its projects and forgets the connection. Nothing else changes.
- `normalizeProject` drops a `team` whose shape is wrong, which turns the project local.

## Sync rules

A pure module, `apps/web/src/domain/projects/team-sync.ts`, owns:

- `planTeamSync(state, connectionId, skipProjectIds)`: one round of `changes` and the cursor, within the page bounds, with `hasMoreChanges` when the bounds left some for the next round. A new record sends every team-owned field; a shared one sends the fields that differ from `synced`. Projects in `skipProjectIds` wait. A record the contract refuses as it is, such as a 300 character name, is reported in `unsendable` and the rest still go. A color or icon the contract refuses goes as Ajour's default.
- `applyTeamSync(state, connectionId, pushed, result, factories)`: assigns remote IDs and sets `synced` to the pushed values, then merges the team's records per field. For a field with no local change, the team's value replaces both the local value and `synced`. For a field with a local change, such as one still in its Undo window, the local value stays and `synced` takes the team's value, so the next push sends it as the later write. It also creates projects and tasks the workspace lacks with new local IDs, archives and restores, and stores the cursor. A task added here and on the team under the same name before either synced becomes one task. A team project the user unshared here is ignored. Local IDs never change, so time entries keep their references.
- A new team project whose name a local project already has is held in the connection's `heldArrivals`, and the local project stays local: it is never shared without the user asking. `applyTeamSync` reports newly held ones in `heldArrivals`, and later rounds update a held project's fields and merge its tasks by remote ID. Holding is the only review in team sync, because adding it right away would leave the user with two projects that only a merge of time entries could join.
- Before applying, `applyTeamSync` checks the result against what the round sent and what the workspace knows. Every new project and task sent must get an ID, and only those; an ID may not name a project or task that another record, here or held, already has; and a task may not move to another project. A result that fails changes nothing, the cursor stays, and the round can be sent again, since new records keep their local IDs.
- An answer only reaches the link it was sent for. A project unshared, or linked to another team project, while the round was on its way keeps its new link. A project unshared before the team gave it an ID is kept in `unsharedLocalIds`; when its ID arrives, the ID joins `unsharedRemoteIds`. Sharing it again cancels that, and the team answers the same local ID with the project the first share made.
- `resolveHeldArrival(state, connectionId, remoteId, choice, factories)`: the user's answer. `link` runs `linkProject` with the local project the user picked, usually the one with the name. `addSeparately` adds the team project as its own shared project. Either takes it off the list. The answer shows no Undo; Unshare reverses a link on this machine.
- `shareProject` refuses a name a held arrival has, with `sameNameHeld` and its remote ID, so the UI can offer Link instead.
- `shareProject(state, connectionId, projectId)`: marks a local project new to the team, so the next sync sends it with all its tasks. It refuses when the workspace already has a shared project of that name for the team, so the team does not get two.
- `linkProject(state, connectionId, projectId, teamProject, factories)`: what Link does, in the picker or for one held arrival. The local project takes the team project's identity and values. Tasks match by name; a team task without a match is added, and a local task without one goes to the team with the next sync.
- `unshareProject` and `disconnectTeam`.

Stored links are read back by `domain/projects/team-link.ts`, which `normalizeProject` uses, so project normalization does not depend on the sync rules.

The rules are in [ADR 0005](../../../agents/adr/0005-shared-projects-last-writer-wins.md): last writer wins per field, archive without review, nothing deleted.

## Code

- `packages/shared/team-sync.ts`: the capability schema, the change, project and result schemas, and the page bounds. `packages/shared/connectors.ts`: the `team` capability in the manifest, `pluginHasTeam`, the third switchable capability and its label, and the `createTeam` result. `packages/shared/plugin-catalog.ts`: `team` as a catalog capability.
- `apps/api/src/plugin-host.ts` and `plugin-worker.mjs`: `createTeam(config, request)` and `syncTeamProjects(connection, request)`, gated by the plugin's switch and the capability deny-list like the others. `capabilityOfMethod` maps both to `team`, so turning Projects off cancels a running round.
- `apps/api/src/server.ts`: `POST /api/teams/:pluginId/create`, with the connection form's values and the team name, and `POST /api/teams/:pluginId/connections/:connectionId/sync`, with one round. Both refuse a plugin without a team (404) or with the plugin or its Projects switch off (409), and validate the body and the plugin's result against the contract. A sync records the connection's last sync or its last error. The routes never touch projects.
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

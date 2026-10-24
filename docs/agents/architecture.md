# Architecture

Ajour is a local-first time-tracking workspace built as a pnpm monorepo. Keep architectural changes aligned with the privacy boundary in `docs/local-first-architecture.md`.

## Runtime Surfaces

- `apps/web`: React 19 + Vite renderer. This is the main product UI for timers, time entries, backlog, projects, settings, and local import review.
- `apps/desktop`: Electron shell that wraps the web renderer and provides desktop packaging/runtime bootstrap. Right-click menus are the system's: the renderer sends an action set as plain items over `ajour:show-context-menu` and gets back the picked id, and main shows the edit menu on text fields (`electron/context-menu.cjs`).
  - Links and navigation from the window follow one policy, in `electron/navigation.cjs` (decided in #331):
    - The app is matched by protocol and host, not origin. Node gives `app://` and `file://` URLs the same `"null"` origin, so an origin check let any non-web URL replace the app in the window.
    - Only `http:`, `https:` and `mailto:` links open in the system browser or mail app.
    - Every other scheme is blocked, including `file:`, `vscode:` and `msteams:`. Such links no longer open, and a malformed URL is blocked, never thrown.
    - `window.open` to the app's own address does nothing.
- `apps/api`: Optional local API for plugin configuration, backlog sync, plugin workers, and local import flows.
- `packages/shared`: Cross-runtime domain types, validation schemas, normalization, aggregation, rule evaluation, and plugin contracts.
- `packages/plugin-sdk`: `@ajour/plugin-sdk`, the SDK plugin authors build plugin API 4 plugins with, published separately from the app. It imports nothing from the app or other packages at runtime; its contract types are generated from `packages/shared`.
- `packages/wide-events`: the wide-event model every runtime emits through: the envelope, the catalog of event names with a privacy class on every field, the emitter, W3C trace context, the error scrubber and the sinks. It runs in the browser and in Node. See `docs/logging-strategy.md`.
- MCP: the local API serves an MCP endpoint at `/mcp/ajour` for agents such as Claude Code and Codex. It is off by default, and each agent client has its own token (ADR 0004). The API forwards every data tool to the renderer over `/api/mcp/bridge`, and `features/agents/agent-tool-runner.ts` runs it through the object action sets with Undo. Sessions, questions and the activity list live in API memory (`apps/api/src/agent-sessions.ts`).

## Agent runner

The agent runner starts a coding agent CLI for a plugin agent task, such as "Enter in Workday". It lives in the local API (`apps/api/src/agent-runner/`). One run at a time: a second `POST /api/agent-runs` answers 409. Each CLI has an adapter in `apps/api/src/agent-runner/adapters/` (Claude Code, Codex and OpenCode). A run gets its own MCP agent client and agent session. The client's token travels only in the `AJOUR_MCP_TOKEN` environment variable, never in a file or an argument, and Ajour ends the session and revokes the client when the CLI exits. Stop, a stall and quitting end the CLI process only; ending every process a run started, and nothing else, is #341. Playwright MCP is bundled as an exact-pinned dependency of `apps/api` and run through the app's own Node (`playwright-mcp.ts`), never through `npx`. Plugins declare tasks with `agentTask` in `plugin.json`. A task is a prompt file and settings, and no plugin code runs. A plugin's tasks share their settings by ID: the local API stores one set of values per plugin and saves them through `POST /api/agents/plugins/:pluginId/settings`. The renderer shows Settings > Agents (`features/settings/settings-agents-page.tsx`), the task settings on the plugin's page (`features/settings/agent-task-settings.tsx`) and the Commit page's `AgentTaskButtons`, one set per placement (`commit-week`, `submit-week`), both reading `lib/agent-runner.ts`. Spec: `docs/specs/2026-10-15-ajour-agent-runner-design.md`. Plugins can add text properties to projects (`projectProperties`); overrides live on `LocalProject.pluginProperties` in local state, and `get_week_changes` sends them resolved, with `projectFullName`.

## Product Boundary

The default workflow is local-first:

- timers, time entries, projects, tasks, backlog items, settings, and workspace metadata stay local
- automatic activity capture is not part of the supported baseline workflow
- any future sync or external sink must be explicit, opt-in, and privacy-scoped
- never upload tracking data, private notes, raw URLs, query strings, hashes, meeting subjects, organizers, locations, or full window titles by default
- MCP is an explicit external sink: turning it on and creating a client send local data to that client's model provider (ADR 0004).

## Data Flow

The web app owns the daily workflow:

- `apps/web/src/domain`: pure web-domain contracts, calculations, normalization, and selectors
- `apps/web/src/lib`: persistence, runtime adapters, hooks, and cross-feature application services
- `apps/web/src/features`: workflow orchestration and feature UI
- `apps/web/src/components`: reusable app surfaces and UI primitives

Features read and write local state through `apps/web/src/lib/local-store.ts`, with hooks in `apps/web/src/lib/local-hooks.ts`. Persisted state contracts and pure selectors live in `apps/web/src/domain/local-state.ts`.

For state-changing workflows, keep deterministic transition rules in a focused domain module. Return the updated records and an explicit operation result, then let `local-store.ts` persist that state. Inject ID and clock functions when a transition creates records or timestamps.

Current deep domain modules demonstrate this boundary:

- `domain/backlog/work-item-transitions.ts` owns manual work-item creation, hierarchy-aware mapping changes, ordering, deletion, and estimate-conflict decisions.
- `domain/backlog/backlog-item-lifecycle.ts` owns backlog item status: moves between workflow states (a done state closes the item, leaving one reopens it), settle, unsettle, archive, restore, which open subitems a close or settle takes along, snooze, the Returned mark, and the sidebar's item order.
- `domain/backlog/workflow-states.ts` owns the workflow: the default states, the Done flag and the rule that one done state always remains, ordering, how source states map onto workflow states per source project (with the connection's mapping as the fallback), automatic mapping of new source states, and the write rules that plan what a move writes to the source.
- `domain/backlog/priority.ts` owns the priority levels: Urgent, High, Medium, Low and No priority. Backlog plugins map their source priority values to levels (`urgent`, `high`, `medium`, `low`) on sync and back on a settle write, so Ajour stores only levels.
- `domain/pull-requests/pull-request-lifecycle.ts` owns provider-neutral pull request reconciliation, local settle and snooze choices, Returned, enabled-connection visibility and closed-item retention. Sync facts exclude bodies and diffs.
- `domain/backlog/work-item-sync.ts` owns backlog import, merge, disappearance, reactivation, and estimate-sync transitions.
- `domain/backlog/description-timelog.ts` owns what a description's timelog does to its item's project and task, on save and when the user asks; `domain/backlog/description-frontmatter.ts` reads the block. The store applies the timelog in every work item command that writes a description.
- `domain/projects/project-transitions.ts` owns project and task creation, legacy hydration, ordering, edits, and archive state.
- `domain/projects/team-sync.ts` owns shared projects: which team-owned fields a round sends against each record's last-synced copy, how a result merges per field while keeping local changes, held same-name arrivals, and sharing, linking, unsharing and disconnecting. `domain/projects/team-link.ts` reads stored team links back. See ADR 0006.
- `domain/time/timesheet-entry.ts` owns manual entry creation, edits, deletion with its tombstone, ordering, marking as committed, the migration of stored submission fields, and the corresponding work-item estimate adjustments.
- `domain/time/locked-weeks.ts` owns submitted weeks: the one rule `isDateLocked`, Submit week and Reopen week, and `assertNoLockedWeekWrite`, which `writeState` in `lib/local-store.ts` runs before every write, so no command, Undo or agent tool changes a submitted week. A refused write throws `LockedWeekError`. Every state write saves a new `revision` inside the state JSON, in one atomic write, then copies it to the hint key `ajour.local-state.revision`. A window's revision is always the one inside the state it read or wrote. Before each write, Submit, Reopen and Undo included, `writeState` reads only the hint. When the hint is missing or differs, it reloads the state, and refuses the write with `LockedWeekError` or `StaleWindowError` if the revision inside changed. A hint that cannot be written is removed, so other windows reload instead of trusting it. A stale window never erases a lock, and a refused Undo stays available for a retry. Desktop recovery saves through the same check: when storage changed while it ran, it runs once more on the fresh state. Known limit: Two browser tabs of the web build that write within the same moment can still overwrite each other: the check reads the hint, then writes, and the browser gives no lock between tabs. The desktop app has one window, so it is not affected.
- `domain/time/timesheet-import.ts` owns import normalization, conflict detection, draft review, project/task recovery, and single or batch commit.
- `domain/time/timer-transitions.ts` owns timer hydration, start/edit/cancel/save/continue behavior, elapsed-time calculation, and replacement of continued entries. A running entry always starts on today, and a counted time correction restarts its count from the corrected value.
- `domain/time/timeline-transitions.ts` owns imported browser review preservation, timeline materialization, dismissal, idempotent commits, and rule creation.
- `domain/time/calendar-suggestions.ts` owns calendar suggestions (ADR 0005): turning fetched calendar events into suggestions per local day, the Settings filters, decisions per occurrence (added while its entry exists, or dismissed, kept 90 days), event rules per recurring meeting (remembered project and task, or hidden), adding several suggestions as entries in one change, and removing a connection's calendar data. `lib/calendar-suggestions.ts` fetches each enabled calendar connection's range into an in-memory cache and refreshes it on its interval while the window is visible.
- `domain/local-state-undo.ts` records which records an action changed (projects, time entries, timers, import drafts, work items, workflow states, source state mappings, calendar decisions and event rules) and restores them for Undo. It refuses a restore when any of those records changed again since. After a time entry action, a work item changed again since gets the inverse logged time instead of its old values. `local-store.ts` keeps only the last action's undo, in memory, behind a token, and `features/feedback/undo-toast.ts` shows its toast. Sync review dismissals live in the local API, so `AppApiStorage` keeps the last one in memory the same way.

These modules are the Interface between workflow orchestration and persistence. Keep their behavior deterministic and free of browser APIs. A domain module should be deep enough that removing it would force meaningful rules back into several callers; avoid shallow one-function wrappers that only rename an operation.

Feature and runtime seams follow the same principle:

- `features/backlog/backlog-task-editor.ts` is the canonical editor model for the backlog item form in the side panel and the narrow dialog. It owns field seeding, parsing, validation, change detection, the new item or changed-field patch that Save writes, and the subitem total and synced value resets.
- `lib/table-drag.ts` owns the shared pointer-reordering lifecycle and geometry. Features supply identity, rendered row references, visual state, and the persistence command that commits an order.

Do not duplicate semantic editor rules between responsive renderers. Do not register feature-local pointer move/up/cancel listeners for table reordering; extend the shared interaction Interface when behavior must change across reorder surfaces.

Shared package logic should handle reusable domain behavior:

- timeline aggregation and bucket logic
- activity normalization
- rules engine behavior
- plugin validation schemas and shared types
- date/time utilities that must stay consistent across runtimes

The local API is a boundary for plugin-driven work. Plugin behavior should produce import candidates or explicit updates that the local app can review and store.

## Plugins

ADR 0007 and ADR 0010 replace this runtime. Until they ship, this section describes the current one.

Backlog, code host, calendar and team are capabilities of installable
plugins. A plugin declares one or more in its manifest, and its connections
serve all of them. A connection field may name the capability it configures, so the connection
form hides it while that capability is off. `validateConnection` receives the
capabilities that are on as its second argument and checks only their access.
A calendar is read-only: `listCalendarEvents` returns event facts for a date
range through `POST /api/calendars/:pluginId/connections/:connectionId/:operation`,
and Ajour never stores the events (ADR 0005). The route's request event,
`calendar.fetch`, holds ids, range, count and outcome, never a title.
Secret values live in the vault (#388, decided in #233), never in the state
file:

- **The port** is `SecretVault` in `apps/api/src/secret-vault.ts`. The desktop
  app passes a `FileSecretVault` through `startAppApiServer`'s `vault` option:
  `app-api-vault.json` beside the state file, written atomically and only by
  the API in main, its entries encrypted by Electron's async `safeStorage`
  (`apps/desktop/electron/secret-cipher.cjs`). An entry holds the plugin, the
  connection (null for agent task settings), the field (null for a sealed
  whole config), the ciphertext, and when it was set and last used, plus an
  optional expiry. The state file keeps `secrets: { fields }` on a connection,
  and `agentRunner.pluginSecrets` per plugin.
- **Checks:** the vault proves encryption with a round trip at its first use,
  after `ready`. A check value it keeps tells a vault encrypted under a lost
  key: then every entry is unreadable at once. An entry that fails alone is
  marked alone. A failed decryption isn't tried again before the next launch,
  and an unreadable entry is kept until it is replaced or removed.
- **When it can't:** without encryption, or without a vault, as in the
  standalone API and the vite dev server, a save that sets a secret is refused
  with a 400 (`vault_unavailable`). A connection whose secret can't be read,
  or still waits in plain text, is paused: its operations answer 409
  (`secret_unavailable`). A connection without secrets always runs. The
  overview reports `vault` and each connection's `secretFields` and `paused`.
- **The move:** state version 8 (`apps/api/src/vault-migration.ts`) moves each
  plain-text secret, of every plugin, active or not, and of agent task
  settings: encrypt, write, read back, and only then drop it from the state
  file. A failure keeps the plain text and holds the file at version 7, so the
  next launch tries again. The values of a plugin whose package is missing are
  sealed whole, as one entry, and split when the plugin comes back. The
  storage runs the same move at runtime, for an update that marks a field
  secret. There is no downgrade.
- **Use:** `AppApiStorage.connectionForOperation` decrypts a connection's
  secrets only to build an API 3 worker's connection, and records the use.
  Until the cut-over (#403) the plugin still sees them in plain text.
- **Deletion:** removing a connection or uninstalling a plugin deletes its
  entries; deactivating keeps them.
- **App names:** development builds take the app name "Ajour Dev" before
  `ready`, so on macOS their key is a keychain item of its own. Release
  builds never change their name. The data folder stays pinned either way, so
  a development build pointed at the release's folder on macOS can't read the
  release's secrets: give it its own with `AJOUR_USER_DATA_PATH`.

A plugin may echo a secret connection value in an error. Every route that runs
a plugin operation turns the error into a message with the connection's
credentials from `apps/api/src/connection-credentials.ts`, the one module that
reads and writes secret values: each secret value of the connection becomes
`[secret]`, then the message is cut to 1,000 characters. A stored config key
the manifest no longer declares counts as secret, except Ajour's own fields,
and a value with spaces at its ends counts trimmed as well, because the host
trims the message. All matches are found in the original message, so secrets
that overlap go whole, and a `[secret]` already there stays as it is. The
worker host cuts a long error before redaction, an uncaught asynchronous
throw included, and marks the cut with "…", so the start of a secret that the
cut split becomes `[secret]` too. No response, stored last error or log
carries a plugin's raw error. Redaction follows the secret fields of the
package the call ran: the plugin host hands each route the manifest it
admitted the call with. An update that lands while a request waits counts, so
one that marks a field secret tightens redaction, and one that drops
`secret: true` loosens it, as it does for every later call. A request builds
one redaction per connection and reuses it for every text, so each secret's
table is built once. Each text has a work budget, counting one step per
secret it is checked against and the characters read, and is dropped as soon
as it passes it. The request has a total budget that counts every text's
work, a dropped text's included. Once that is spent, every later text that
could hold a secret is dropped at once. A text shorter than every secret and
not cut needs only one comparison to redact, but if it is longer than 1,000
characters it is still cut, which reads up to 1,000 characters per secret and
counts like any other work, and once the request is spent it is dropped
instead of cut. So a request costs at most its budget, plus a constant per
text. A dropped text, whether its own length or
the connection's secrets made it too costly, is replaced whole by "Hidden
because it couldn't be checked for secrets.", and such a summary is dropped.
Text the plugin writes itself in a successful result is redacted the same
way: a field's sync message, and the connection summary. A save redacts the
summary before storing it, against the submitted, previous and normalized
configs, because normalization may drop a value the plugin swapped out. It
drops an entry whose key holds a secret, and a summary of more than 50
entries. The overview redacts the stored summary and last error again each
time it returns them, against the values the state file keeps: it decrypts
no secret, so the move into the vault redacted both with each secret it
took out. Content the plugin copies from its source tool, such as
titles, descriptions and comments, passes as it is. When the plugin is no
longer installed, nothing says which stored values are secret, so it shows
"Hidden because this plugin is no longer installed." instead, and no summary.
The rules in this section apply to every such plugin, which must remain
physically and logically separate from the application. A plugin owns its external-system
authentication, transport, field discovery, and remote read/write behavior. It
must ship a manifest, a runnable entrypoint, its assets, and all required
runtime dependencies without importing Ajour repository source or other
application internals.

Plugin loading depends on the application build:

- Development builds may point directly to a plugin directory so plugin
  authors can iterate without packaging an archive. The active directory can
  be selected on Settings → Debug or supplied through
  `AJOUR_DEV_PLUGIN_DIRS`; changing it restarts only the parent-owned
  internal plugin host. Production builds never expose or honor this setting.
- Production builds must not load loose plugin directories. They install one
  packaged `.ajour-connector` archive selected from the local filesystem,
  validate it, and copy it into an application-managed plugin directory.
- Archive installation is a desktop capability exposed through the restricted
  Electron preload/IPC bridge. The parent process owns the native single-file
  chooser and reads the selected archive; the renderer does not submit paths or
  archive bytes. The loopback HTTP API must not expose a plugin installation
  route because installed plugins execute with the user's local permissions.
- Both modes use the same manifest and versioned host protocol. Development
  plugins must not receive capabilities that packaged production plugins do not
  have.
- Production plugin archives are distributed separately from the app and
  are not silently installed from bundled repository packages. Uninstall is a
  desktop capability on the same restricted IPC boundary as installation. It
  stops active workers for that plugin, removes the managed package and its
  saved connections, credentials, staged imports, and backlog source statuses, and
  preserves already imported application-owned backlog items. Development
  directory plugins can be deactivated but never deleted by the app.

The host must not import plugin code into the API or Electron main execution
context. Each plugin operation runs in a new Node worker thread and exchanges
validated structured messages with the host. The worker is stateless and is
terminated after the operation completes. The parent tracks every active
worker and calls `worker.terminate()` on timeout, cancellation, or application
shutdown. Worker capacity is reserved before asynchronous discovery, package
discovery is serialized against installation and removal, and worker result and
error payloads are bounded. Because workers are threads rather than child
processes, they cannot outlive the parent application or remain as orphan
plugin processes.

Both the plugin host and the data-shape host run every operation through one
runtime port, `apps/api/src/plugin-runtime.ts`: start, settle and terminate,
for a plugin id and its package directory. The worker lifetime keeps
admission, quota, timeout, cancellation, wide events and result validation
around it. The worker-thread runtime is the one the app uses; tests may run
plugins in process with a fake. The arguments each plugin export receives
come from one method table, `apps/api/src/plugin-methods.ts`, derived from the
shared operation contracts.

`/api` is the window's private channel. Whoever starts the local API
generates a per-launch window token and keeps it in memory: Electron main, the
vite dev server behind `just start`, or the standalone API, which reads
`AJOUR_APP_API_WINDOW_TOKEN`. Main adds it to the window session's requests to
`/api` through `webRequest`
(`apps/desktop/electron/window-api-token.cjs`), and in the browser vite's dev
proxy adds it to the page's same-origin requests, so page JavaScript never
sees it. Every `/api` route but `/api/health` refuses a request without it
with a bare 401 (`apps/api/src/window-token.ts`) and a request without an
allowed Origin with a 403, and a request without a Host header is refused.
The window's requests carry an Origin: the desktop window's are cross-origin,
and the dev proxy adds one to a same-origin GET. `/api/health` answers anyone,
so main can tell whether another Ajour holds the port. There is no token for
scripting `/api`: scripts and agents use `/mcp` with an agent client, and the
agent runner never passes the window token to a CLI (ADR 0004).

The guarantee differs by runtime. In the desktop app, `/api` answers only the
window: main injects the token on the default session, which the window must
stay the only user of, and page JavaScript never sees it. Under `just start`,
the vite dev proxy keeps out web pages (it adds the token only when
`Sec-Fetch-Site` is `same-origin`, and the origin allowlist applies) but not
local programs, which can reach the proxy as a page would. That is acceptable
for development. Malware running as the user stays out of scope.

Development plugin loading and browser-origin authorization are separate
permissions. The local API accepts browser requests only from exact configured
origins, in addition to the window token; enabling loose development
directories must never broaden that allowlist. Plugin manifests and entrypoints must remain regular files within
their canonical plugin directory without traversing symbolic-link ancestors.

Worker threads isolate plugin JavaScript state, failures, event loops, and
dependencies, but they are not a security sandbox. Installed plugin code still
runs with the current user's filesystem and network permissions.

Plugin activation is local API state. Deactivating an installed plugin keeps
its package, saved connections, staged imports, and already imported backlog
items intact, but blocks manual sync and excludes its connections from the web
auto-sync scheduler. Reactivation restores those sync paths without requiring
the plugin to be configured again.

A plugin that declares more than one of backlog, code host, calendar and
team also gets one switch per capability, stored as a per-plugin deny-list next to the
plugin's own activation. Turning a capability off blocks only its routes and
scheduler work and cancels only its running operations; the plugin switch still
gates all of them.
An update that adds a capability starts it off, so updating changes nothing
until the user turns it on. That default is saved before the package change
ends, while plugin operations still wait, so nothing runs the new capability
first. Turning a capability off or on waits for the
check inside the plugin host's operation gate, which runs after an operation
registers, so an operation started meanwhile either sees the new state or is
cancelled.

Each capability has its own automatic sync on the connection's interval. Auto
sync imports backlog items straight to the backlog instead of staging them for
review; the reserved `pullRequestAutoSync` field syncs pull requests. A
connection saved before that field existed keeps following auto sync, which is
what auto sync meant for its pull requests.

The plugin system also has one persisted master activation gate. Turning it off
stops plugin workers, cancels active project-data-shape operations, hides
data-shape capabilities from consumers, and makes every installed plugin
inactive. It does not rewrite individual activation choices, so turning the
system on restores the user's previous per-plugin configuration. Catalog
browsing, managed downloads, manual archive installation, and Debug-directory
configuration remain available while execution is disabled.

The desktop main process owns the Ajour plugin-index boundary. It fetches and
strictly validates catalog definitions, release metadata, and optional artwork;
caches catalog files and images below Electron user data; and gives the renderer
only normalized metadata and local data URLs. Conditional requests check for
catalog and image updates at launch and on a configurable interval (15 minutes
by default, with launch-only refresh available). A built-in snapshot of the
index keeps the catalog usable on first launch when the remote index is
unreachable; the validated remote catalog replaces it when available. Catalog plugin downloads
reuse the validated managed-package installer and are inactive until the user
explicitly activates them. The existing local-file installer retains its
current behavior.

## Project Data Shape Plugins

Project import/export separates canonical data, data shape, and file format:

```text
Ajour projects and tasks -> selected data shape -> Excel, CSV, or JSON
```

Ajour always provides a built-in default shape. Project import/export must
continue to work when the plugin host is unavailable or no data-shape plugins
are installed. Optional plugins declare a versioned `projectDataShape`
capability with format-neutral datasets and typed columns. They map canonical
projects to datasets for export and datasets back to canonical import
candidates. They do not receive the local store and cannot persist projects.

The web app owns file selection, downloads, and format adapters. Excel is the
current adapter; future CSV and JSON adapters must consume the same dataset
contract. The API validates manifests, requests, datasets, and results, and runs
each shape operation in an ephemeral worker. Deterministic project merge rules
and persistence remain in the web domain and local store.

Provider-specific shape plugins are maintained outside Ajour. The Workday
implementation lives in `les-cabochons/ajp-workday`, imports no Ajour source,
and targets this versioned host protocol. Ajour does not compile or bundle it.

The desktop runtime must acquire Electron's single-instance lock before
starting the local API or any plugin operation. A second launch should focus
the existing window and exit so concurrent application versions do not share
the API port, state file, or installed-plugin directory.

Release builds flip the Electron fuses decided in #231, through `electronFuses`
in `apps/desktop/electron-builder.config.cjs`. `NODE_OPTIONS`, `--inspect` and
the file protocol's extra privileges are off, and the app loads only from
`app.asar`, whose integrity is checked. The release workflows read the fuses
back with `apps/desktop/scripts/check-fuses.cjs` and fail when one differs. Two
exceptions remain:

- Run as Node stays on: the agent CLI starts Playwright MCP with Ajour's own
  binary and `ELECTRON_RUN_AS_NODE=1` (`agent-runner/playwright-mcp.ts`), so
  anyone who can start the binary can still run Node code as Ajour. #415
  tracks moving Playwright MCP to HTTP so release builds can turn it off.
- Integrity covers `app.asar` only, that is main and preload. The renderer
  (`dist-desktop`) and the local API (`internal-app-runtime`) load from extra
  resources, which the asar-only fuse doesn't restrict and integrity doesn't
  check. They are loose files in the per-user install folder, so a process
  that can write there can change code that main imports. Same-user malware is
  out of scope, and run as Node being on already gives such a process equal
  power.

## Routing

Routes are declared in `apps/web/src/router.tsx` with TanStack Router.

Primary surfaces:

- `/time/$date`
- `/backlog`
- `/pull-requests` and `/pull-requests/$itemId`, visible while a code host plugin is enabled
- `/projects`
- `/projects/$projectId`
- `/settings/*`

Keep new top-level routes rare. Prefer extending the existing feature areas unless the workflow clearly needs a separate navigation destination.

## State And Persistence

Use the existing local store model before adding another persistence layer. Store durable user data as explicit domain records with stable IDs and timestamps. Keep transient UI state in React state unless it needs to survive reloads.

When adding fields to persisted state:

- update the persisted contract in `apps/web/src/domain/local-state.ts`
- add migration/default behavior for missing historical values
- update tests around serialization or derived behavior when risk is non-trivial

Desktop bootstrap is recovery input, not an authoritative replica. Apply it once,
merge projects by stable ID so local references remain valid, normalize the merged
state before writing it, and preserve the full in-memory result if browser storage
cannot be written.

## Logging

Follow `docs/logging-strategy.md`: one wide event per unit of work per runtime, through the runtime's emitter from `packages/wide-events`, not scattered debug strings. Events never hold content (ADR 0011).

Every command of the local store emits one event, named in the store's typed command table (`STORE_COMMANDS` in `lib/local-store.ts`).

Events go nowhere by default; `AJOUR_WIDE_EVENTS=console` prints them for a developer. Any sink that sends them elsewhere must be explicit, opt-in and filtered by each field's privacy class.

## Dependency Direction

- Apps can depend on `@ajour/shared` and on `packages/wide-events`, whose root files the local API imports by relative path and the web app through `@ajour/wide-events`. `apps/web/src/domain` never imports the emitter: the store, lib and feature seams emit.
- `packages/shared` and `packages/wide-events` must not depend on app packages.
- `apps/web/src/domain` must stay pure and must not import React, `features`, or `lib`.
- `apps/web/src/lib` may depend on `domain`, but must not depend on `features`.
- `apps/web/src/features` may depend on `domain`, `lib`, and `components`.
- UI components live under `apps/web/src/components`.
- Feature-specific UI and helpers live under `apps/web/src/features/<feature>`.
- Put pure cross-feature web behavior in `domain`; reserve `lib` for runtime-aware helpers, persistence, adapters, and application services.
- Keep plugin transport and authentication in runtime adapters; pass validated candidates and updates into pure domain transitions.

## Verification

Use `just` as the command surface:

```sh
just test
just typecheck
just build
```

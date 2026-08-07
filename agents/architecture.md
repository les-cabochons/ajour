# Architecture

TimeTracker is a local-first time-tracking workspace built as a pnpm monorepo. Keep architectural changes aligned with the privacy boundary in `docs/local-first-architecture.md`.

## Runtime Surfaces

- `apps/web`: React 19 + Vite renderer. This is the main product UI for timers, time entries, backlog, projects, settings, and local import review.
- `apps/desktop`: Electron shell that wraps the web renderer and provides desktop packaging/runtime bootstrap.
- `apps/api`: Optional local API for connector configuration, connector sync, plugin workers, and local import flows.
- `packages/shared`: Cross-runtime domain types, validation schemas, normalization, aggregation, rule evaluation, and connector contracts.

## Product Boundary

The default workflow is local-first:

- timers, time entries, projects, tasks, backlog items, settings, and workspace metadata stay local
- automatic activity capture is not part of the supported baseline workflow
- any future sync or external sink must be explicit, opt-in, and privacy-scoped
- never upload tracking data, private notes, raw URLs, query strings, hashes, meeting subjects, organizers, locations, or full window titles by default

## Data Flow

The web app owns the daily workflow:

- `apps/web/src/domain`: pure web-domain contracts, calculations, normalization, and selectors
- `apps/web/src/lib`: persistence, runtime adapters, hooks, and cross-feature application services
- `apps/web/src/features`: workflow orchestration and feature UI
- `apps/web/src/components`: reusable app surfaces and UI primitives

Features read and write local state through `apps/web/src/lib/local-store.ts`, with hooks in `apps/web/src/lib/local-hooks.ts`. Persisted state contracts and pure selectors live in `apps/web/src/domain/local-state.ts`.

For state-changing workflows, keep deterministic transition rules in a focused domain module. Return the updated records and an explicit operation result, then let `local-store.ts` persist that state. Inject ID and clock functions when a transition creates records or timestamps.

Current deep domain modules demonstrate this boundary:

- `domain/backlog/work-item-transitions.ts` owns manual work-item lifecycle, hierarchy-aware mapping changes, ordering, archiving, deletion, and estimate-conflict decisions.
- `domain/backlog/work-item-connector.ts` owns connector import, merge, disappearance, reactivation, and estimate-sync transitions.
- `domain/projects/project-transitions.ts` owns project and task creation, legacy hydration, ordering, edits, and archive state.
- `domain/time/timesheet-entry.ts` owns manual entry creation, edits, deletion, ordering, submission state, and the corresponding work-item estimate adjustments.
- `domain/time/timesheet-import.ts` owns import normalization, conflict detection, draft review, project/task recovery, and single or batch commit.
- `domain/time/timer-transitions.ts` owns timer hydration, start/edit/cancel/save/restart behavior, elapsed-time calculation, and replacement of restarted entries.
- `domain/time/timeline-transitions.ts` owns imported browser review preservation, timeline materialization, dismissal, idempotent commits, and rule creation.

These modules are the Interface between workflow orchestration and persistence. Keep their behavior deterministic and free of browser APIs. A domain module should be deep enough that removing it would force meaningful rules back into several callers; avoid shallow one-function wrappers that only rename an operation.

Feature and runtime seams follow the same principle:

- `features/backlog/backlog-task-editor.ts` is the canonical editor model for desktop and mobile backlog experiences. It owns field seeding, parsing, validation, normalized drafts and patches, hierarchy exclusions, and time-entry note fallback.
- `lib/table-drag.ts` owns the shared pointer-reordering lifecycle and geometry. Features supply identity, rendered row references, visual state, and the persistence command that commits an order.

Do not duplicate semantic editor rules between responsive renderers. Do not register feature-local pointer move/up/cancel listeners for table reordering; extend the shared interaction Interface when behavior must change across reorder surfaces.

Shared package logic should handle reusable domain behavior:

- timeline aggregation and bucket logic
- activity normalization
- rules engine behavior
- connector validation schemas and shared types
- date/time utilities that must stay consistent across runtimes

The local API is a boundary for connector-driven work. Connector behavior should produce import candidates or explicit updates that the local app can review and store.

## Connector Plugins

Connectors are installable plugins and must remain physically and logically
separate from the application. A plugin owns its external-system
authentication, transport, field discovery, and remote read/write behavior. It
must ship a manifest, a runnable entrypoint, its assets, and all required
runtime dependencies without importing TimeTracker repository source or other
application internals.

Plugin loading depends on the application build:

- Development builds may point directly to a plugin directory so connector
  authors can iterate without packaging an archive. The active directory can
  be selected on Settings → Debug or supplied through
  `TIMETRACKER_DEV_PLUGIN_DIRS`; changing it restarts only the parent-owned
  internal plugin host. Production builds never expose or honor this setting.
- Production builds must not load loose plugin directories. They install one
  packaged `.harday-connector` archive selected from the local filesystem,
  validate it, and copy it into an application-managed plugin directory.
- Archive installation is a desktop capability exposed through the restricted
  Electron preload/IPC bridge. The parent process owns the native single-file
  chooser and reads the selected archive; the renderer does not submit paths or
  archive bytes. The loopback HTTP API must not expose a plugin installation
  route because installed plugins execute with the user's local permissions.
- Both modes use the same manifest and versioned host protocol. Development
  plugins must not receive capabilities that packaged production plugins do not
  have.
- Production connector archives are distributed separately from the app and
  are not silently installed from bundled repository packages. Uninstall is a
  desktop capability on the same restricted IPC boundary as installation. It
  stops active workers for that plugin, removes the managed package and its
  saved connections, credentials, staged imports, and connector statuses, and
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
connector processes.

Development plugin loading and browser-origin authorization are separate
permissions. The local API accepts browser requests only from exact configured
origins; enabling loose development directories must never broaden that
allowlist. Plugin manifests and entrypoints must remain regular files within
their canonical plugin directory without traversing symbolic-link ancestors.

Worker threads isolate plugin JavaScript state, failures, event loops, and
dependencies, but they are not a security sandbox. Installed plugin code still
runs with the current user's filesystem and network permissions.

Plugin activation is local API state. Deactivating an installed connector keeps
its package, saved connections, staged imports, and already imported backlog
items intact, but blocks manual sync and excludes its connections from the web
auto-sync scheduler. Reactivation restores those sync paths without requiring
the connector to be configured again.

The plugin system also has one persisted master activation gate. Turning it off
stops connector workers, cancels active project-data-shape operations, hides
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
unreachable; the validated remote catalog replaces it when available. Catalog connector downloads
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

## Routing

Routes are declared in `apps/web/src/router.tsx` with TanStack Router.

Primary surfaces:

- `/time/$date`
- `/backlog`
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

Follow `docs/logging-strategy.md`: one structured wide event per meaningful operation, not scattered debug strings.

Default to local-only diagnostics. Any remote event path must be explicitly privacy-reviewed and aggregate-safe.

## Dependency Direction

- Apps can depend on `@timetracker/shared`.
- `packages/shared` must not depend on app packages.
- `apps/web/src/domain` must stay pure and must not import React, `features`, or `lib`.
- `apps/web/src/lib` may depend on `domain`, but must not depend on `features`.
- `apps/web/src/features` may depend on `domain`, `lib`, and `components`.
- UI components live under `apps/web/src/components`.
- Feature-specific UI and helpers live under `apps/web/src/features/<feature>`.
- Put pure cross-feature web behavior in `domain`; reserve `lib` for runtime-aware helpers, persistence, adapters, and application services.
- Keep connector transport and authentication in runtime adapters; pass validated candidates and updates into pure domain transitions.

## Verification

Use `just` as the command surface:

```sh
just test
just typecheck
just build
```

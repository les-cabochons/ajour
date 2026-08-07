# Code Standards

## General

- Use TypeScript for application and shared package code.
- Prefer existing local patterns over introducing new libraries or abstractions.
- Keep changes close to the feature or runtime that owns the behavior.
- Move code into `packages/shared` only when multiple runtimes need the same domain behavior.
- Add comments only when they explain non-obvious domain or runtime constraints.

## TypeScript

- Prefer explicit domain types over loose records.
- Use discriminated unions for state that has clear variants.
- Avoid `any`; use `unknown` at boundaries and validate before use.
- Keep parsing and normalization at IO boundaries.
- Use `zod` schemas where shared validation already exists or where external input enters the system.

## React

- Keep route wiring in `apps/web/src/router.tsx`.
- Keep feature pages and feature helpers under `apps/web/src/features/<feature>`.
- Keep pure web-domain contracts, calculations, normalization, and selectors under `apps/web/src/domain`.
- Keep reusable UI primitives under `apps/web/src/components/ui`.
- Keep app-specific repeated surfaces under `apps/web/src/components` when they are not generic shadcn/Base UI primitives. Current examples are `AppPanel`, `MessagePanel`, and `SurfaceCallout` in `apps/web/src/components/app-surface.tsx`.
- Feature pages should orchestrate workflow state and compose UI modules. Move repeated or plugin-driven rendering into feature-local UI modules such as `apps/web/src/features/settings/connector-settings-ui.tsx`.
- Responsive renderers for the same workflow must share one semantic model. Backlog desktop and mobile editing use `features/backlog/backlog-task-editor.ts`; keep only rendering and transient presentation state in each component.
- Keep persistence, runtime adapters, hooks, and cross-feature application services under `apps/web/src/lib`.
- Do not import feature modules from `apps/web/src/domain` or `apps/web/src/lib`.
- Memoize derived option lists or expensive calculations when they depend on stable inputs.
- Avoid pushing durable domain behavior into component-only state.

## UI Library Usage

- Import design-system controls from `apps/web/src/components/ui` instead of direct third-party packages in feature code.
- Do not use raw checkbox inputs for app UI. Use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx` so Base UI behavior, focus styling, checked state, and indeterminate state stay consistent.
- Use `Switch` from `apps/web/src/components/ui/switch.tsx` for immediate on/off settings such as plugin activation. Give every switch an action-oriented accessible label.
- Do not use `settings-panel` or `message-panel` classes directly in feature code. Use `AppPanel` and `MessagePanel` from `apps/web/src/components/app-surface.tsx`.
- Keep direct Base UI imports inside `apps/web/src/components/ui` wrappers unless a new wrapper is being created.
- Prefer existing app-level wrappers over copying Tailwind/CSS class groups across pages.
- Reordering surfaces must use `lib/table-drag.ts` for pointer sessions, movement thresholds, geometry, document drag state, row shifts, and overlay positioning.

## Local State

- Treat persisted local data as a compatibility contract.
- Define persisted local-state records and pure selectors in `apps/web/src/domain/local-state.ts`.
- Keep storage access, migrations, and state-changing operations in `apps/web/src/lib/local-store.ts`.
- Import `localStore` separately from domain types and selectors. Feature code should not use the store module as a type registry.
- Put feature-independent calculations in focused `apps/web/src/domain/<area>` modules instead of feature files or the local store.
- Model complex state changes as domain operations that return updated records plus a typed result. Keep browser storage writes and notifications in `local-store.ts`.
- Inject ID and time factories into domain operations that create records so their rules stay deterministic and directly testable.
- Keep related invariants local to one deep module. Work-item hierarchy, inherited mappings, connector reconciliation, and estimate conflict decisions must not be reimplemented in feature components or the persistence adapter.
- Keep project/task and timer lifecycle changes behind their domain transition modules. Components and the local-store Adapter issue commands; they do not rebuild records or calculate transition timestamps.
- Keep imported browser review behavior in the timeline transition module so preservation, dismissal, commit idempotency, and rule creation stay deterministic.
- Keep timesheet import conflict detection, project/task recovery, and batch commit in the timesheet-import transition module so the whole import remains atomic and directly testable.
- Treat `local-store.ts` as an Adapter: it may load, migrate, persist, notify, and coordinate runtime side effects, but deterministic lifecycle rules belong in `domain`.
- Add safe defaults for older local records when adding fields.
- Preserve user-entered notes and time values exactly unless the user changes them.
- Connector imports should produce reviewable candidates or explicit conflict states.
- Standalone connector packages must compile and run without imports from
  Ajour application source. Keep the host protocol structural and validate
  every manifest, request, and result at the API boundary.
- Project data-shape plugins must remain format-neutral and must not import
  Ajour application source. Ajour owns Excel, CSV, and JSON serialization;
  shape plugins own only dataset definitions and canonical-data mappings.
- Run connector operations in ephemeral worker threads. Do not add persistent
  plugin child processes or load plugin modules into the API or Electron main
  execution context.
- Keep packaged connector installation behind the Electron preload/IPC bridge.
  Let the parent process choose and read the file; never accept paths or archive
  bytes from the renderer or expose installation through the loopback HTTP API.
- Scope connector work-item identity by source, connection, and source ID. Preserve user archives and notes on refresh; only auto-reactivate items marked as archived because they disappeared from sync.
- Keep logged-time estimate changes reversible. Persist hidden remaining-estimate overrun state instead of discarding time when the visible remaining estimate reaches zero.
- A project/task fallback may update estimates only when it resolves to exactly one active work item. Prefer an explicit work-item ID whenever the caller has one.
- Treat desktop bootstrap as a one-time recovery merge. Preserve locally referenced projects, normalize before persistence, and keep the complete merged state in memory when storage is unavailable.
- Timer-linked entry edits must update the active timer baseline. Starting a fresh timer or restarting a saved entry may switch timers only by saving the active timer and starting the requested timer at one shared transition boundary.

## Testing

Add focused tests for:

- shared domain logic
- normalization and aggregation behavior
- connector mapping and conflict behavior
- persisted-state helpers
- user-visible calculations such as durations, estimates, and totals
- deterministic domain transitions, including successful changes, rejected invalid states, conflict resolution, and reversals

Prefer direct domain tests for rules and a smaller number of storage integration tests for persistence wiring. User-facing acceptance tests should use deterministic local fixtures and keep external connector services outside the test path.

For UI-only changes, run typecheck and consider a browser check for layout or interaction risk.

For shared interaction changes, add direct state/geometry tests and verify every current caller. Pointer reordering currently serves backlog work items, timesheet entries, project tasks, and project navigation.

## Logging And Privacy

- Do not use scattered `console.log()` as the operational logging strategy.
- Follow the wide-events model in `docs/logging-strategy.md`.
- Never log raw URLs, query strings, URL fragments, meeting contents, uncommitted notes, or private activity details to a remote sink by default.

## Commands

Use `just`:

```sh
just test
just typecheck
just build
```

`just test` runs tests across workspace packages that expose a test script, including the web and shared suites.

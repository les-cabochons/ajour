# Code Standards

## General

- Use TypeScript for application and shared package code.
- Prefer existing local patterns over introducing new libraries or abstractions.
- Keep changes close to the feature or runtime that owns the behavior.
- Move code into `packages/shared` only when multiple runtimes need the same domain behavior.
- Add comments only when they explain non-obvious domain or runtime constraints.
- Prettier owns formatting with its default settings, plus `prettier-plugin-tailwindcss` for class order, in `prettier.config.mjs`. This matches create-t3-app. Run `just format` before committing; `just format-check` must pass.

## Before Editing

- Read the relevant feature, shared logic, and tests.
- Identify the owning runtime: web, desktop, api, or shared. For web code, also identify the owning layer: pure domain, runtime or application library, feature workflow, or reusable component.
- Check whether the change touches the local-first privacy boundary, and whether persisted local state needs compatibility handling.
- For UI changes, read `docs/agents/ui-rules.md`, `docs/agents/ui-registry.md`, `docs/agents/ui-tokens.md`, and `docs/agents/library-docs.md` first.
- For lifecycle changes, start from the owning transition module listed in `docs/agents/library-docs.md`, and keep `local-store.ts` as persistence and command wiring.
- State the intended files before a non-trivial edit, and keep edits scoped to the requested behavior.
- When a page grows mixed responsibilities, extract feature-local UI modules before adding more inline rendering.

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
- Feature pages should orchestrate workflow state and compose UI modules. Move repeated or plugin-driven rendering into feature-local UI modules such as `apps/web/src/features/settings/plugin-settings-ui.tsx`.
- Responsive renderers for the same workflow must share one semantic model. Backlog item editing uses one form, `features/backlog/backlog-item-editor-form.tsx`, in the side panel and the narrow dialog. Its draft rules, including what Save and switching items write (`commitBacklogTaskDraft`), live in `features/backlog/backlog-task-editor.ts`.
- Creating and editing a time entry use one form, `features/time/time-entry-editor-form.tsx`, in every host (the Day and Week side panel, the dialog, the titlebar popover in `features/time/time-entry-editor-popover.tsx`, which New entry… on tasks and backlog items reuses through `features/time/new-entry-request.ts`), and for the running entry too. Its draft rules, including what Save and switching entries write (`commitTimeEntryDraft`), live in `features/time/time-entry-editor.ts`. Hosts only supply the container. Preserve unchanged saved milliseconds rather than re-parsing rounded display text.
- Plugin settings operations and reconciliation belong to `features/settings/plugin-settings-workflow.ts`; pages keep form drafts and rendering.
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
- Keep related invariants local to one deep module. Work-item hierarchy, inherited mappings, backlog sync reconciliation, and estimate conflict decisions must not be reimplemented in feature components or the persistence adapter.
- Keep project/task and timer lifecycle changes behind their domain transition modules. Components and the local-store Adapter issue commands; they do not rebuild records or calculate transition timestamps.
- Keep imported browser review behavior in the timeline transition module so preservation, dismissal, commit idempotency, and rule creation stay deterministic.
- Keep timesheet import conflict detection, project/task recovery, and batch commit in the timesheet-import transition module so the whole import remains atomic and directly testable.
- Treat `local-store.ts` as an Adapter: it may load, migrate, persist, notify, and coordinate runtime side effects, but deterministic lifecycle rules belong in `domain`.
- Add safe defaults for older local records when adding fields.
- Preserve user-entered notes and time values exactly unless the user changes them.
- Backlog imports should produce reviewable candidates or explicit conflict states.
- Standalone plugin packages must compile and run without imports from
  Ajour application source. Keep the host protocol structural and validate
  every manifest, request, and result at the API boundary.
- Project data-shape plugins must remain format-neutral and must not import
  Ajour application source. Ajour owns Excel, CSV, and JSON serialization;
  shape plugins own only dataset definitions and canonical-data mappings.
- Run plugin operations in ephemeral worker threads. Do not add persistent
  plugin child processes or load plugin modules into the API or Electron main
  execution context.
- Keep packaged plugin installation behind the Electron preload/IPC bridge.
  Let the parent process choose and read the file; never accept paths or archive
  bytes from the renderer or expose installation through the loopback HTTP API.
- Scope synced work-item identity by source, connection, and source ID. Preserve user archives and notes on refresh; only auto-reactivate items marked as archived because they disappeared from sync.
- Keep logged-time estimate changes reversible. Persist hidden remaining-estimate overrun state instead of discarding time when the visible remaining estimate reaches zero.
- A project/task fallback may update estimates only when it resolves to exactly one active work item. Prefer an explicit work-item ID whenever the caller has one.
- Treat desktop bootstrap as a one-time recovery merge. Preserve locally referenced projects, normalize before persistence, and keep the complete merged state in memory when storage is unavailable.
- Timer-linked entry edits must update the active timer baseline. Starting a fresh timer or continuing a saved entry may switch timers only by saving the active timer and starting the requested timer at one shared transition boundary.

## Testing

Add focused tests for:

- shared domain logic
- normalization and aggregation behavior
- backlog sync mapping and conflict behavior
- persisted-state helpers
- user-visible calculations such as durations, estimates, and totals
- deterministic domain transitions, including successful changes, rejected invalid states, conflict resolution, and reversals

Prefer direct domain tests for rules and a smaller number of storage integration tests for persistence wiring. User-facing acceptance tests should use deterministic local fixtures and keep external plugin services outside the test path.

For UI-only changes, run typecheck and consider a browser check for layout or interaction risk.

For shared interaction changes, add direct state/geometry tests and verify every current caller. Pointer reordering currently serves backlog work items on the Backlog page and in the sidebar, timesheet entries, project tasks, and project navigation.

## Performance

Runtime performance is a hard constraint. Visual polish never costs render time.

- Every shell, list, sidebar, or other UI change runs `just ui-perf` before and after, on the seeded large workspace of 600 backlog items and 1,800 entries. No measurement may be more than 10% worse than the base branch. The procedure is `qa/routines/ui-capture.md`.
- A change that touches only CSS properties that trigger neither layout nor paint, such as `cursor`, skips `just ui-perf`. Its PR says so instead of giving numbers.
- `just ui-perf` reports four numbers: cold load, Start click, a Backlog store write, and renderer work per second with a timer running. Put the base and change numbers in the PR.
- Single runs vary by tens of percent. Warm the server first, run the base branch and the change on separate ports with `AJOUR_QA_PORT`, compare pairs taken at the same machine speed, and repeat a pair that disagrees.
- The dev server runs React's development build, so its numbers sit well above production. On Windows in production, after the October 2026 fixes, a cold load takes about 150 ms, a Start click about 40 ms, and a store write about 75 ms with 300 Backlog rows. A running timer costs about 4 ms of renderer work per second.
- These costs were removed once, and a change must not bring them back:
  - re-rendering the titlebar or the page every second while a timer runs, instead of sharing one clock through `useRunningClock`;
  - a store write that re-reads storage for each subscriber;
  - pickers, tooltips, and menus mounted on every row before hover or focus;
  - `backdrop-filter`, shadows on scrolling rows, and hover transitions on long lists;
  - a wrapper element around every row only to hold a drag ref.

## Logging And Privacy

- Do not use scattered `console.log()` as the operational logging strategy.
- Follow the wide-events model in `docs/logging-strategy.md`: one event per unit of work per runtime, through the runtime's emitter from `packages/wide-events`.
- Events never hold content (ADR 0011). A new field goes in the catalog with its privacy class, and an error message reaches an event only through `unit.fail()`, which scrubs it.
- Test an event at its seam's highest level with a recording sink, and assert its name, kind, outcome, reason and the fields that matter.
- Never log raw URLs, query strings, URL fragments, meeting contents, uncommitted notes, or private activity details to a remote sink by default.

## Verification

Use `just`:

```sh
just test
just typecheck
just build
just format-check
```

`just test` runs tests across workspace packages that expose a test script, including the web and shared suites.

For a narrow change, run the closest focused tests first, then the broader checks if risk remains. For a visual change, start the app and inspect the affected view in a browser.

These consistency checks should find nothing. A match is a boundary violation or an import from a retired path:

```sh
rg -n 'settings-panel|message-panel' apps/web/src/features
rg -n 'type="checkbox"' apps/web/src/features
rg -n '@base-ui/react' apps/web/src/features
rg -n 'from "@/features/' apps/web/src/domain apps/web/src/lib
rg -n 'hours-input|project-task-budget|project-task-import-utils' apps/web/src
rg -n 'features/backlog/(work-item-estimates|work-item-hierarchy)' apps/web/src
rg -n 'window.addEventListener\("pointer(move|up|cancel)"' apps/web/src/features
rg -n '^function (formatPriorityInput|parsePriorityInput|formatEstimateInput|parseEstimateInput|buildManualTimeEntryNote)' apps/web/src/features/backlog
```

Feature code consumes pure behavior from `domain`, runtime behavior from `lib`, local wrappers from `apps/web/src/components/ui`, app-level surfaces from `apps/web/src/components/app-surface.tsx`, or feature-local modules that own repeated rendering.

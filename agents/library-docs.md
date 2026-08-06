# Library Docs

Use this file as the local index for important library choices. Check official docs before changing APIs or upgrading versions.

## Package Management

- pnpm workspace
- root command surface: `just`
- package manager: `pnpm@10.7.0`

## Web App

- React 19
- Vite 8
- TypeScript 5.8
- Tailwind CSS 4
- shadcn UI package
- Base UI React
- TanStack Router
- TanStack Router Devtools in development
- Remix Icon React
- date-fns
- zod
- ExcelJS

## Web UI Usage

- Feature code should import app controls from `apps/web/src/components/ui`, not directly from Base UI, shadcn internals, or other primitive packages.
- Base UI is wrapped by local files such as `button.tsx`, `checkbox.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `input.tsx`, `popover.tsx`, `select.tsx`, `switch.tsx`, and `tabs.tsx`.
- App-specific repeated surfaces live in `apps/web/src/components/app-surface.tsx`.
- The settings connector form renders plugin fields through `apps/web/src/features/settings/connector-settings-ui.tsx`.
- Settings exposes installed capabilities through `/settings/plugins`; the catalog owns activation and links to `/settings/plugins/$pluginId`, where connector-specific forms and connection actions live.
- Use `@remixicon/react` for icons. Keep icon imports in feature modules or local UI modules; do not inline custom SVGs for common actions.
- Use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx` for app checkboxes, including indeterminate selection states.

## Web Domain Modules

- Persisted local-state contracts and pure selectors: `apps/web/src/domain/local-state.ts`
- Backlog status normalization, CRUD transitions, and connector mapping reconciliation: `apps/web/src/domain/backlog/backlog-status.ts`
- Work-item hierarchy lookup, validation, and inherited mapping rules: `apps/web/src/domain/backlog/work-item-hierarchy.ts`
- Work-item estimate normalization, display values, reversible logged-time adjustments, overrun tracking, and imported baselines: `apps/web/src/domain/backlog/work-item-estimates.ts`
- Manual work-item lifecycle, hierarchy-aware edits, ordering, status, deletion, and estimate-conflict decisions: `apps/web/src/domain/backlog/work-item-transitions.ts`
- Connector work-item identity, local-decision-preserving merge, missing-item archive provenance, and estimate-sync updates: `apps/web/src/domain/backlog/work-item-connector.ts`
- Clock formatting and hours-input parsing: `apps/web/src/domain/time/duration.ts`
- Timesheet entry creation, editing, deletion, ordering, submission state, and linked estimate adjustments: `apps/web/src/domain/time/timesheet-entry.ts`
- Timesheet import normalization, conflict detection, draft lifecycle, project/task recovery, and commits: `apps/web/src/domain/time/timesheet-import.ts`
- Timer hydration, single-active-timer enforcement, start/edit/cancel/save/restart transitions, elapsed duration, and restarted-entry replacement: `apps/web/src/domain/time/timer-transitions.ts`
- Imported browser review preservation, timeline materialization, dismissals, commits, and rule creation: `apps/web/src/domain/time/timeline-transitions.ts`
- Project task budgets and consumption: `apps/web/src/domain/projects/task-budget.ts`
- Project task import normalization: `apps/web/src/domain/projects/task-import.ts`
- Project task/workbook import transitions and the canonical transfer-row contract: `apps/web/src/domain/projects/project-import.ts`
- Project/task creation, hydration, ordering, edits, and archive transitions: `apps/web/src/domain/projects/project-transitions.ts`
- Persisted project icon contract: `apps/web/src/domain/projects/project-icon.ts`

Keep React rendering and runtime adapters outside these modules. For example, the persisted project icon contract lives in `domain`, while `ProjectIcon` rendering and uploaded-image preparation live in `apps/web/src/lib/project-icons.tsx`.

## Web Workflow Modules

- Canonical backlog task editor fields, parsing, validation, drafts, patches, hierarchy exclusions, and time-note fallback: `apps/web/src/features/backlog/backlog-task-editor.ts`
- Shared pointer-reordering session, geometry, row shifts, overlay positioning, and document state: `apps/web/src/lib/table-drag.ts`

The backlog editor module is feature-local because its vocabulary and commands belong to the backlog workflow. The drag module is runtime-aware and cross-feature, so it belongs in `lib`.

## Desktop

- Electron
- Electron Builder configuration in `apps/desktop/electron-builder.config.cjs`
- NSIS updater packaging and macOS DMG/ZIP update artifacts are produced through
  `apps/desktop/scripts/run-builder-command.cjs`
- desktop bootstrap in `apps/desktop/electron`
- GitHub release selection, tag-to-package-version mapping, and update
  availability checks: `apps/desktop/electron/update-check.cjs`
- Windows background download, track-bound cancellation, restart confirmation,
  and installer handoff:
  `apps/desktop/electron/automatic-update.cjs`
- Update checks cross the context-isolated preload/IPC bridge; the renderer does
  not fetch releases or open arbitrary external URLs directly.

## API

- Local API lives in `apps/api`
- Connector package validation and installation: `apps/api/src/plugin-package.ts`
- Ephemeral worker-thread orchestration: `apps/api/src/plugin-host.ts`
- Worker entrypoint bridge: `apps/api/src/plugin-worker.mjs`

## Connector Plugins

- Connector packages live in the standalone `les-cabochons/ajc-azure-devops`
  and `les-cabochons/ajc-jira` repositories.
- Each connector compiles to local JavaScript modules and packages
  `plugin.json` plus `dist/` into one `.harday-connector` archive.
- Development builds load configured plugin directories; production builds
  only install packaged archives into the managed user-data plugin directory.
- Desktop archive installation crosses the restricted preload/IPC bridge and
  calls the API runtime directly; it is not an HTTP endpoint.

## Shared

- Shared domain package: `@timetracker/shared`
- Contains validation schemas, connector contracts, timeline aggregation, activity normalization, rules, and time utilities.

## Documentation Lookup Rules

- For third-party API or framework questions, fetch current official docs before changing code.
- Prefer codebase patterns over generic documentation examples when they conflict.
- Record any important project-specific usage decisions in this file or in a dedicated doc under `docs/`.

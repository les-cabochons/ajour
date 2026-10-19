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
- react-markdown with remark-gfm and remark-breaks
- CodeMirror 6 (`@codemirror/state`, `view`, `language`, `commands`, `lang-markdown` and `@lezer/highlight`) for Markdown editing

## Web UI Usage

- Feature code should import app controls from `apps/web/src/components/ui`, not directly from Base UI, shadcn internals, or other primitive packages.
- Base UI is wrapped by local files such as `button.tsx`, `checkbox.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `input.tsx`, `popover.tsx`, `select.tsx`, `switch.tsx`, and `tabs.tsx`.
- App-specific repeated surfaces live in `apps/web/src/components/app-surface.tsx`.
- The plugin settings form renders plugin fields through `apps/web/src/features/settings/plugin-settings-ui.tsx`.
- Settings exposes installed capabilities through `/settings/plugins`; the catalog owns activation and links to `/settings/plugins/$pluginId`, where plugin-specific forms and connection actions live.
- Use `@remixicon/react` for icons. Keep icon imports in feature modules or local UI modules; do not inline custom SVGs for common actions.
- Render markdown text, such as backlog item descriptions, through `Markdown` in `apps/web/src/components/markdown.tsx`. It lazy-loads the parser from `markdown-renderer.tsx`, so do not import `react-markdown` elsewhere.
- Edit Markdown text through `MarkdownEditor` in `apps/web/src/components/markdown-editor.tsx`. It lazy-loads CodeMirror from `markdown-editor-view.tsx`, so do not import `@codemirror/*` elsewhere. It uses `markdownLanguage` without the `markdown()` helper, which would also load HTML, CSS and JavaScript highlighting. The text stays Markdown: markers are dimmed and the marked-up text is styled, and the editor never rewrites text the user did not touch. `preloadMarkdownEditor()` starts the download from an Edit button's pointer or focus.
- Use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx` for app checkboxes, including indeterminate selection states.

## Web Domain Modules

- Persisted local-state contracts and pure selectors: `apps/web/src/domain/local-state.ts`
- Workflow state normalization, the Done flag, CRUD and ordering transitions, and source state mapping reconciliation: `apps/web/src/domain/backlog/workflow-states.ts`
- Work-item hierarchy lookup, validation, and inherited mapping rules: `apps/web/src/domain/backlog/work-item-hierarchy.ts`
- Work-item estimate normalization, display values, reversible logged-time adjustments, overrun tracking, and imported baselines: `apps/web/src/domain/backlog/work-item-estimates.ts`
- Manual work-item creation, hierarchy-aware edits, ordering, deletion, and estimate-conflict decisions: `apps/web/src/domain/backlog/work-item-transitions.ts`
- Which synced items have comments, the New divider, edited comments and page merging: `apps/web/src/domain/backlog/comments.ts`. The thread is `features/backlog/backlog-item-comments.tsx`, and each item's last visit lives in `lib/comments-seen.ts`, outside the local state.
- Backlog item status (settle, unsettle, archive, restore), snooze, the Returned mark and the sidebar's item order: `apps/web/src/domain/backlog/backlog-item-lifecycle.ts`
- Description frontmatter, the YAML subset Ajour reads, its fields and its `timelog`: `apps/web/src/domain/backlog/description-frontmatter.ts`. Applying a timelog to an item's project and task, on save and when the user asks, and how an item differs from its timelog: `apps/web/src/domain/backlog/description-timelog.ts`. Which frontmatter sections are open lives in `lib/frontmatter-sections.ts`, outside the local state.
- Pull request fact reconciliation, local lifecycle, snooze, Returned, visibility and seven-day closure retention: `apps/web/src/domain/pull-requests/pull-request-lifecycle.ts`
- Synced work-item identity, local-decision-preserving merge, missing-item archive provenance, done-category archives, and estimate-sync updates: `apps/web/src/domain/backlog/work-item-sync.ts`
- Clock and decimal-hours formatting and hours-input parsing: `apps/web/src/domain/time/duration.ts`
- Timesheet entry creation, editing, deletion and tombstones, ordering, marking as committed, and linked estimate adjustments: `apps/web/src/domain/time/timesheet-entry.ts`
- Committed copies, change detection (added, updated, deleted), the week's change list and the names an external timesheet matches: `apps/web/src/domain/time/timesheet-commit.ts`
- Submitted weeks: the one rule `isDateLocked`, their normalization, the write check every store write runs, Submit week and Reopen week: `apps/web/src/domain/time/locked-weeks.ts`
- Commit page lines (grouping, comment merging) and the week summary warnings: `apps/web/src/domain/time/timesheet-submission.ts`
- Timesheet import normalization, conflict detection, draft lifecycle, project/task recovery, and commits: `apps/web/src/domain/time/timesheet-import.ts`
- Timer hydration, single-active-timer enforcement, start/edit/cancel/save/continue transitions, elapsed duration, and continued-entry replacement: `apps/web/src/domain/time/timer-transitions.ts`
- Imported browser review preservation, timeline materialization, dismissals, commits, and rule creation: `apps/web/src/domain/time/timeline-transitions.ts`
- Project task budgets and consumption: `apps/web/src/domain/projects/task-budget.ts`
- Project task import normalization: `apps/web/src/domain/projects/task-import.ts`
- Project task/workbook import transitions and the canonical transfer-row contract: `apps/web/src/domain/projects/project-import.ts`
- Format-neutral project dataset workbook adapter and built-in default shape: `apps/web/src/features/settings/settings-projects.ts`
- Project/task creation, hydration, ordering, edits, and archive transitions: `apps/web/src/domain/projects/project-transitions.ts`
- Persisted project icon contract: `apps/web/src/domain/projects/project-icon.ts`

Keep React rendering and runtime adapters outside these modules. For example, the persisted project icon contract lives in `domain`, while `ProjectIcon` rendering and uploaded-image preparation live in `apps/web/src/lib/project-icons.tsx`.

## Web Workflow Modules

- Time-entry draft seeding, metadata normalization, exact-duration preservation, validation, and save/relocation values: `apps/web/src/features/time/time-entry-editor.ts`. It also decides what Save and switching entries write. The one entry form, `features/time/time-entry-editor-form.tsx`, consumes this model in every host.
- Plugin settings reconciliation, background snapshot subscriptions, stale-response rejection, and serialized commands: `apps/web/src/features/settings/plugin-settings-workflow.ts`. Its React adapter is `use-plugin-settings-workflow.ts`; secret form drafts stay in the page and transports stay in `lib/app-api.ts`.
- Canonical backlog task editor fields, parsing, validation, drafts, patches, hierarchy exclusions, and time-note fallback: `apps/web/src/features/backlog/backlog-task-editor.ts`
- Project task draft seeding, budget and adjustment parsing, exact-duration preservation, validation, and what Save and switching tasks write: `apps/web/src/features/projects/project-task-editor.ts`. Project form drafts (display name following the full name, trimmed values): `apps/web/src/features/projects/project-form.ts`.
- Hierarchical project/task selection and capped mixed-term search for time entry: `apps/web/src/features/projects/project-task-picker.tsx` and `apps/web/src/features/projects/project-task-search.ts`
- Shared pointer-reordering session, geometry, row shifts, overlay positioning, and document state: `apps/web/src/lib/table-drag.ts`
- Keyboard shortcuts: `apps/web/src/lib/shortcuts.ts` is the registry (action id, keys, label, scope) with key matching, the text-field guard and key labels. Menus, tooltips and the palette read keys from it. `lib/shortcut-handlers.tsx` has the one window key listener (`ShortcutProvider`, mounted in the router root) and `useShortcut(id, handler, layer)`. A page handler wins over an app handler for the same action, so the Time page handles N and T while it is open and `features/layout/use-global-shortcuts.ts` handles them elsewhere. [, ], D and W only have Time page handlers. Pinned task digits are digit chords: they match `event.code` (Digit1 to Digit0) so Shift+digit works on every layout, the handler receives the digit, and they stay quiet while any entry editor is open (`lib/entry-editor-presence.ts` counts mounted editor forms) or a Week Grid cell (`data-grid-cell`) has focus. A digit chord wins over "?" when both match, so Shift+6 starts slot 6 on Canadian French layouts. Shortcuts with scope "item" (Edit, Delete, Move up, focus arrows and the others of "Focused rows and cards") stay out of the window listener (`APP_SHORTCUTS`): the focused row runs them through `lib/item-keys.ts`, only while the row itself has focus. Add a key to the registry only when its handler ships.

The backlog editor module is feature-local because its vocabulary and commands belong to the backlog workflow. The drag module is runtime-aware and cross-feature, so it belongs in `lib`.

### Backlog views

- Selection, filtering, grouping and ordering: `domain/backlog/backlog-view.ts`.
- Device-local preferences: `lib/backlog-view-settings.ts`. Ordering stays in local state.
- Page orchestration: `features/backlog/backlog-page.tsx`.
- Display controls and filters: `features/backlog/backlog-display.tsx`.
- Shared row/card controls: `features/backlog/backlog-item-surface.tsx`.
- Read-only details and immediate property pickers: `features/backlog/backlog-peek.tsx`.
- Pointer moves: `features/backlog/use-backlog-drag.ts`, using `lib/table-drag.ts`.
- The sidebar's hover card: `features/backlog/backlog-item-hover-card.tsx`. What it shows, including where an item comes from and the pull requests whose title names it: `domain/backlog/backlog-item-summary.ts`. When it opens, moves and closes: `lib/row-hover-card.ts`.
- The Undo module also captures custom work-item ordering. Group moves and their order change form one undoable operation.

## Desktop

- Electron
- Electron Builder configuration in `apps/desktop/electron-builder.config.cjs`
- NSIS updater packaging and macOS DMG/ZIP update artifacts are produced through
  `apps/desktop/scripts/run-builder-command.cjs`
- desktop bootstrap in `apps/desktop/electron`
- GitHub release selection, tag-to-package-version mapping, and update
  availability checks: `apps/desktop/electron/update-check.cjs`
- Application update state, check-only polling, confirmed Windows downloads, track-bound cancellation,
  and installer handoff:
  `apps/desktop/electron/automatic-update.cjs`
- Update checks cross the context-isolated preload/IPC bridge; the renderer does
  not fetch releases or open arbitrary external URLs directly.
- Plugin-index validation, image caching, built-in fallback, and release
  download: `apps/desktop/electron/plugin-catalog.cjs` and
  `apps/desktop/electron/plugin-catalog-seed.cjs`
- Catalog refresh persistence: `apps/desktop/electron/plugin-catalog-settings.cjs`
- Application menu per platform and build type: `apps/desktop/electron/app-menu.cjs`.
- Native right-click menus: `apps/desktop/electron/context-menu.cjs` validates the renderer's items and builds the object and edit menu templates; `apps/web/src/lib/native-context-menu.ts` turns an action set into those items.
  Action items send shortcut registry ids to the renderer over
  `ajour:menu-action`; role items run Electron roles in main. The renderer key
  listener stays the one binding path for registry keys. Single keys never
  become native accelerators: macOS shows them in the label, as "Day (D)", and
  Windows shows them unregistered. Production builds have no Reload or DevTools.

## API

- Local API lives in `apps/api`
- Plugin package validation and installation: `apps/api/src/plugin-package.ts`
- Plugin discovery, request/reply validation, and package mutation coordination: `apps/api/src/plugin-host.ts`
- Shared ephemeral worker admission, cancellation, timeout, termination, and shutdown drain: `apps/api/src/plugin-worker-lifetime.ts`. Each plugin/data-shape manager owns a separate four-operation quota and its own worker script.
- Worker entrypoint bridge: `apps/api/src/plugin-worker.mjs`
- Project data-shape manifest and dataset contracts: `packages/shared/project-data-shapes.ts`
- Project data-shape discovery and worker orchestration: `apps/api/src/project-data-shape-plugin.ts` and `apps/api/src/project-data-shape-host.ts`
- Standalone Workday shape plugin: `les-cabochons/ajp-workday`
- `@modelcontextprotocol/sdk`: the MCP server over Streamable HTTP in stateless mode, at `/mcp/ajour`. Transport, authentication and the tool table: `apps/api/src/mcp-server.ts`. Client tokens: `apps/api/src/mcp-clients.ts`. Sessions, questions and activity: `apps/api/src/agent-sessions.ts`. Tool schemas: `packages/shared/agent-tools.ts`. The renderer side: `apps/web/src/lib/mcp-bridge.ts` holds the bridge connection and `features/agents/agent-tool-runner.ts` runs the tools.
- `@playwright/mcp`: the browser tools the agent runner gives a coding agent. Pinned to an exact version, never fetched with `npx @latest`. Owned by `apps/api/src/agent-runner/playwright-mcp.ts`.

## Plugins

- Backlog plugin packages live in the standalone `les-cabochons/ajc-azure-devops`
  and `les-cabochons/ajc-jira` repositories, and the GitHub code host in
  `les-cabochons/ajc-github`.
- Each plugin compiles to local JavaScript modules and packages
  `plugin.json` plus `dist/` into one `.ajour-connector` archive.
- Development builds load configured plugin directories; production builds
  only install packaged archives into the managed user-data plugin directory.
- Desktop archive installation crosses the restricted preload/IPC bridge and
  calls the API runtime directly; it is not an HTTP endpoint.
- `plugin.json` (plugin API version 3) declares its capabilities:
  `"capabilities": { "connector": {}, "codeHost": {} }`, with at least one.
  The backlog capability is declared under the `connector` key until plugin
  API 4.
  Connections belong to the plugin and serve every capability it declares.
- Every plugin exports `validateConnection(config)`. A backlog plugin also exports
  `syncConnection(connection, workItems)`. A backlog plugin that declares
  `"connector": { "settle": true }` also exports
  `listSettleStates(connection, { sourceId })` and
  `writeSettle(connection, { sourceId, state?, priority? })`. The contract is
  in `packages/shared/plugins.ts`. See ADR 0001.
- A code host exports one function per entry of `codeHostOperations` in
  `packages/shared/code-host.ts`, each called as
  `operation(connection, request)`. The API exposes them at
  `POST /api/code-hosts/:pluginId/connections/:connectionId/:operation`.
  The GitHub code host lives in `les-cabochons/ajc-github`. See ADR 0002 and
  ADR 0003.
- A team plugin declares `"team": { "apiVersion": 1 }` and keeps a team's
  shared projects in step. Its payloads, page bounds and the team-owned fields
  are in `packages/shared/team-sync.ts`; the `createTeam` result is in
  `packages/shared/plugins.ts`. It exports `createTeam(config, request)` and
  `syncTeamProjects(connection, request)`; the API exposes them at
  `POST /api/teams/:pluginId/create` and
  `POST /api/teams/:pluginId/connections/:connectionId/sync`. The sync rules
  are in `apps/web/src/domain/projects/team-sync.ts`. The first team plugin is maintained separately. See ADR 0006.
- Sync reports each item's `stateCategory` and `stateDone`. The plugin decides
  which categories are done, and also reports Ajour's items that reached one,
  so Ajour archives them. The API returns those as `doneItems` and never stages
  them for review.
- A settle's change to the source is a `pendingSourceWrite` on the work item,
  set by `settleBacklogItem` and cleared by `completeSourceWrite` or
  `failSourceWrite` in `domain/backlog/backlog-item-lifecycle.ts`. Undo drops
  it with the rest of the settle, and a sync leaves its values in place.

## Shared

- Shared domain package: `@ajour/shared`
- Contains validation schemas, plugin contracts, timeline aggregation, activity normalization, rules, and time utilities.

## Documentation Lookup Rules

- For third-party API or framework questions, fetch current official docs before changing code.
- Prefer codebase patterns over generic documentation examples when they conflict.
- Record any important project-specific usage decisions in this file or in a dedicated doc under `docs/`.

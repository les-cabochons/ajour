# Progress Tracker

Use this file as a lightweight running checklist for agent work in this repo. Keep it current when a task spans multiple steps or sessions.

## Current Baseline

- [x] Compact Week Grid and row deletion (2026-10-15): seven 84px day columns
      and a 72px total column fit above an 820px content width. Delete row uses
      right-click or Shift+Backspace without an action icon. It saves a valid
      side-panel draft before counting entries, blocks invalid drafts, protects
      both rows of a running entry whose task changed, and offers one Undo.
      Row names share one context-menu root outside the cell menus. Paired
      large-workspace timer samples measured 49.3 ms/s on the base and 50.7 ms/s
      after the change, a 3% increase within the 10% budget. Domain tests cover the running-entry
      guard; six Chromium scenarios cover hours editing, confirmation, Undo,
      empty rows, saved drafts and invalid drafts. All 1,069 workspace tests,
      type checks, package boundaries and builds passed. The full formatting
      check still flags two unchanged files, `backlog-item-page.tsx` and
      `sidebar-backlog-list.tsx`.
- [x] UI foundation (2026-10-14): Geist Sans and Mono replace Raleway and
      Noto Serif; one type scale (11 to 28px), 28px and 32px controls, 4/6/8px
      radii and an indigo accent are tokens in `styles.css`; the top bar is the
      page header (`PageHeader` and `lib/page-header.ts`); `Chip`, `Value`,
      `Figure`, `SectionHeading` and `PropertyList` are the shared patterns; the
      chrome is solid with no blur. `just ui-capture` and `just ui-perf` give
      every UI change screenshots and budget numbers.
- [x] Migrate the Time, Backlog, Projects and Settings pages to the foundation
      patterns, one pull request per area, each with before and after captures
      and budget numbers: Time (#112), Backlog with the pull request pages
      (#113), Projects (#114) and Settings. Each page area owns a stylesheet
      under `apps/web/src/styles/`, and the browser's select, date, file and
      color controls are gone.
- [x] Projects is a list page like the Backlog (rows with code, task count,
      this week and budget) and a full-width project page with figures over a
      budget bar and Tasks | Time entries tabs; the second project sidebar is
      gone.
- [x] A running timer no longer re-renders the titlebar and Time page each
      second: running readouts share one clock (`useRunningClock`), and the
      status pulse animates on the compositor. Renderer work with a timer
      running fell from about 51 to 4 ms per second on Windows.
- [x] A large workspace (600 backlog items, 1,800 entries) no longer stalls on
      every click: a store write announces itself without re-reading storage per
      subscriber, children are indexed once per work item list, and sidebar
      rows are memoized with hover actions that mount on hover or focus. On
      Windows a Start click fell from about 280 ms to 38 ms and cold load from
      about 450 ms to 150 ms.
- [x] Backlog page rows keep their buttons but mount their pickers, tooltips
      and actions menu only while hovered or focused (always in the narrow
      view). A store write while on the page fell from about 240 ms to 75 ms
      for 300 rows, and opening the page from a 230 ms task to 76 ms.
- [ ] Each backlog row, in the sidebar and on the Backlog page, still mounts
      its own context menu root. One context menu per list, told which row was
      right-clicked, would remove the last per-row Base UI root.
- [ ] macOS sluggishness on a fresh install, with no timer running, is not
      reproduced on Windows. Collect a trace from a Mac, and check whether the
      x64 build runs under Rosetta on Apple Silicon. The titlebar and sidebar
      `backdrop-filter` blurs are the first thing to try removing there.
- [ ] A failed plugin connection save shows its error at the top of the page,
      off-screen from the form, and the error clears after about 6 seconds.

- [x] Issue #78 adds local pull request facts, lifecycle, Active/Settled/Recently
      closed groups, a summary route, conditional navigation and the active
      sidebar list. A follow-up replaces the stacked lists with Backlog and
      Pull requests tabs. The early snooze return setting
      applies to pull requests and synced backlog source changes. Deactivation
      retains local choices; connection removal confirms before deleting them.
- [x] Issue #78 verification passed 700 workspace unit tests, type checks,
      production builds and 53 Chromium scenarios, including nine new pull
      request scenarios. Six resource-interrupted scenarios passed when retried
      with one worker. A live GitHub plugin sync
      displayed six real authored Ajour pull requests. Independent review found
      no remaining blockers after lifecycle corrections.
- [x] The sidebar tab follow-up passed all 11 pull request Chromium scenarios,
      including keyboard switching, a 200px sidebar and code-host deactivation.
- [ ] Merge issue #78 and its GitHub event-facts companion after the capability
      and catalog stack. Full review content, time actions, repository rules and
      Browse remain in #79 through #82.

- [x] Catalog schema version 2 lists connector, code host, and schema capabilities
      separately from feature badges. Plugins with several capabilities appear
      under each matching filter, and code hosts can use managed downloads.
- [x] The built-in catalog includes GitHub and targets plugin API version 2 for
      GitHub, Jira, and Azure DevOps. The Workday schema retains its separate API.
- [ ] Merge the catalog and plugin-index follow-ups with the plugin API version 2
      provider packages. Full review UI remains later work in the pull requests
      issue map.

- [x] Monorepo structure identified.
- [x] Local-first privacy boundary documented.
- [x] Wide-events logging direction documented.
- [x] Root context files created and aligned with the current local-first product direction.
- [x] Repeated app surfaces use `AppPanel`, `MessagePanel`, and `SurfaceCallout`.
- [x] Feature checkboxes use the shared `Checkbox` UI primitive.
- [x] Settings pages carry no cards: sections and `SettingRow`s order them by space and type size, and the narrow Settings list groups its pages under App, Work and Data headings.
- [ ] Visually verify plugin connection rows and populated Sync review items in the desktop app; the catalog, schema plugin detail and empty Sync review were checked in the browser.
- [x] Connector settings plugin field rendering is extracted to a feature-local UI module.
- [x] Settings presents connectors as activatable Plugins catalog entries with dedicated configuration detail routes.
- [x] The Plugins catalog is populated from the Ajour plugin index, caches and
      conditionally refreshes catalog artwork in the desktop main process, and uses
      deterministic thumbnail and capability-band fallbacks when artwork is absent.
- [x] Catalog packages download through the managed connector installer in an
      inactive state; manual archive installation and Debug plugin directories keep
      their existing behavior.
- [x] A persisted plugin-system master switch blocks all connector and
      project-data-shape execution while preserving individual activation choices,
      and catalog refresh defaults to a configurable 15-minute interval.
- [x] Web-domain contracts and pure calculations are separated from persistence and feature UI.
- [x] Local state, duration, task budget/import, and project icon contracts have canonical domain modules.
- [x] `apps/web/src/lib` no longer depends on feature modules.
- [x] `just test` includes both web and shared workspace tests.
- [x] Project task and workbook import transitions are isolated from browser persistence and have direct domain tests.
- [x] Workflow state hydration (including data saved as backlog statuses), CRUD, ordering, the Done flag, and source state mapping transitions are isolated from browser persistence and have direct domain tests.
- [x] Moving a backlog item into a done state closes it and leaving one reopens it, with the open-subitems prompt and its Settings > Backlog choice (#85, #89).
- [x] Priority has five levels (#86, #88). Since plugin API 3, connector plugins map source values to levels and Ajour stores only levels.
- [x] Source states map to workflow states per source project, new ones map automatically by name or done category, and moves of synced items write the source state after the Undo window through per-state write rules (#87).
- [x] Work-item hierarchy, estimates, manual lifecycle, and connector reconciliation have canonical domain modules with direct tests.
- [x] Timesheet entry lifecycle and linked estimate adjustments are isolated from browser persistence and have direct tests.
- [x] Project/task creation, hydration, ordering, edits, and archive transitions are isolated from browser persistence and have direct domain tests.
- [x] Timer hydration, start/edit/cancel/save/restart transitions, elapsed time, and restarted-entry replacement are isolated from browser persistence and have direct domain tests.
- [x] Imported browser review preservation, timeline materialization, dismissal, idempotent commits, and rule creation are isolated from browser persistence and have direct domain tests.
- [x] Timesheet import normalization, conflict detection, draft lifecycle, project/task recovery, and commits are isolated from browser persistence and have direct domain tests.
- [x] Project import/export keeps an always-available default shape and can apply optional format-neutral data-shape plugins through validated worker operations.
- [x] The Workday project shape is maintained independently in `les-cabochons/ajp-workday` while Ajour retains Excel serialization and project merge ownership.
- [x] `local-store.ts` is reduced from 4,215 lines to about 1,100 lines and now coordinates persisted-state compatibility, desktop bootstrap, storage notifications, and domain commands.
- [x] Desktop inline and mobile modal backlog editing share one canonical field, validation, draft, and patch model.
- [x] Backlog, timesheet, project-task, and project-navigation reordering share one tested pointer lifecycle and geometry module.
- [x] Adversarial review regressions cover connector identity and archive provenance, reversible estimate overruns, timer-linked edits, import validation, one-time desktop recovery, and overlapping drag state.
- [x] Azure DevOps and Jira connectors are maintained and independently built
      in the standalone `les-cabochons/ajc-azure-devops` and
      `les-cabochons/ajc-jira` repositories.
- [x] Development builds load connector directories while production installs
      only validated `.ajour-connector` archives.
- [x] Development plugin directories are configurable from the Debug page, and
      managed production plugins can be uninstalled without deleting imported
      backlog items or being silently reinstalled on restart.
- [x] Connector operations use parent-owned ephemeral worker threads with
      timeout and shutdown termination.
- [x] Plugin worker admission, package mutation, origin authorization, canonical
      path validation, and reply-size limits cover the reviewed race and local
      boundary cases.
- [x] Desktop startup enforces a single application instance before starting
      the local API or connector workers.
- [x] Pushes to `main` publish collision-safe Toronto-dated nightly desktop releases,
      and a manual workflow promotes a selected published nightly commit into a
      commit-classified stable release for macOS and Windows with generated changelogs.
- [x] General Settings persists a stable/nightly update track and the desktop
      checks the matching published GitHub releases through a restricted IPC bridge.
- [x] Packaged Windows builds automatically check and download the selected
      update channel, cancel stale-track downloads, reject older-core nightlies, and
      ask before restarting. Releases publish NSIS/macOS updater artifacts without
      Squirrel `.nupkg` packages; macOS stays manual until signing and notarization.
- [x] Time-entry surfaces share a hierarchical shadcn project/task command picker
      with project drill-down, mixed-term direct task search, and bounded results.
- [x] Day remains the default timer-first view and now exposes a compact date-
      heading scope menu with `Day` and `Week`; the desktop-only Week view offers
      Grid and Days layouts, locally persisted capacity targets, hover-only
      utilization details, and configurable warnings.
- [x] Saved time entries share one Day-inline/Week-dialog editor with Duplicate,
      Duplicate to, and Move to actions; cross-day moves preserve identity and
      provenance while invalidating changed submissions through the existing
      fingerprint lifecycle.
- [x] Weekly-view adversarial review fixes lock running linked entries at the UI
      and domain boundaries, preserve taskless labels on duplicate, use stable
      Ledger row identities, and harden nested dialogs, drag ownership, keyboard
      focus, and entry-group semantics.
- [x] Weekly time visual refinement now uses one full-width continuous surface,
      leading return-to-Day navigation, attached Ledger totals/detail regions,
      fixed seven-day lane headers, project-color scanning cues, and a shared
      upper-right entry-options Popover with an anchored confirmed date picker.
- [x] Desktop navigation uses a persistent 200px application sidebar, Settings
      replaces it with section navigation and a bottom Back action, and Projects
      keeps an expanded secondary rail aligned directly beside the primary sidebar.
      The sidebar now owns the full window height with a distinct translucent tint,
      while Windows caption controls and macOS traffic lights keep dedicated chrome
      safe areas. Time and Backlog use centered 1440px content inside full-width
      color bands, table backgrounds, and row separators; both remain continuous
      and perimeter-free, and Backlog fills the available height. Between 641px and
      1023px, application, Settings, and Projects navigation remains available as
      compact 48px rails; Settings Back restores the full prior workspace URL
      without leaving Settings in browser history.

## Sidebar search and project filter, 2026-10-14

- [x] Search expands into a search box that filters the sidebar's work list by item and project name. A T3 Code style project filter sits next to it and is saved per device. See "Search and project filter" in `agents/ux-spec.md`.
- [x] `sidebar-search.feature` covers both. The full Chromium suite passed 127 of 132 on a free port. The 5 failures (board close, workflow settings draft, packaged connector install, Backlog preferences render, pull request Ctrl-click) fail the same way on `main`.
- [x] `just ui-perf`, 2026-10-14, port 4187, medians of 5 runs, main then this branch: cold load 1388 / 1273 ms, Start click 90 / 93 ms, Backlog store write 268 / 45 ms, renderer work with a timer running 25.1 / 25.6 ms per second. Nothing is more than 10% worse. The store write varies a lot between runs, so its drop is noise.

## Sidebar ordering, 2026-10-15

- [x] With Custom ordering, sidebar rows reorder by drag or Alt+Up and Alt+Down, with Undo. Pinned rows and the rest reorder apart, and subitems stay below their parent. The filter menu has a Custom or Priority icon toggle beside its search box. See "List" and "Search and project filter" in `agents/ux-spec.md`.
- [x] `sidebar-ordering.feature` covers drag, keys, the toggle by mouse and Enter, another Backlog ordering, a pinned row and a reorder under search. Domain tests cover `splitSidebarBacklogItems` and `canReorderSidebarItem`, and `use-backlog-drag.test.ts` covers the drop line.
- [x] `just ui-perf`, 2026-10-15, ports 4188 and 4189, medians of 5 runs, main then this branch, in pairs that ran at the same machine speed: Start click 89 / 90 and 86 / 89 ms, Backlog store write 46 / 50 and 48 / 51 ms, renderer work with a timer running 21 / 21 and 26 / 20 ms per second. All within 10%. A first version wrapped every row in a `div` for drag refs and cost about 16% on Start click; rows now take their drag state as a prop and the drag reads row positions on press.

## Ajour MCP, 2026-10-14

- [x] Spec A: MCP endpoint at `/mcp/ajour` (off by default, per-client tokens, Origin and Host checks), the renderer bridge, data tools for timers, entries, projects and backlog items with Undo, agent sessions and questions, and the agent indicator and panel. Spec: `docs/superpowers/specs/2026-10-14-ajour-mcp-design.md`.
- [x] Review fixes: agents settle and move synced items through the UI's move and settle rules, with a `sourceState` input where the UI opens a dialog. Every tool has a zod output schema, checked in the API. Refused writes show in the activity list.
- [x] `just ui-perf`, 2026-10-14, on a free port (`AJOUR_QA_PORT`), medians of 5 runs, main then this branch: cold load 1153 / 1178 ms, Start click 111 / 117 ms, Backlog store write 272 / 253 ms, renderer work with a timer running 37.2 / 24.1 ms per second. All within 10%. Runs vary a lot: one main run gave 30 ms for the store write. The script reuses any server already on port 4173, even another checkout's.
- [ ] Spec B: agent runner, the `mcp` plugin capability and the Workday plugin.

## Architecture follow-up, 2026-10-10

- [x] Day inline and Week/mobile dialog time editors share one draft interpretation module, preserve unchanged notes and exact milliseconds, and save the current inline draft on outside click.
- [x] Plugin settings use one workflow for installed/catalog reconciliation, background connector updates, stale-response rejection, and serialized operations. Secret form drafts remain in the page.
- [x] Connector and project-data-shape hosts share worker admission, timeout, cancellation, termination, and shutdown drain. Package coordination and schema validation remain in their owning hosts, with separate four-operation quotas.
- [x] Review follow-up: shared worker lifetime cases (startup failure, early exit, shutdown, per-plugin cancel) are tested once in `plugin-worker-lifetime.test.ts`; the host tests keep discovery, packaging, and schema cases. Catalog interval changes no longer wait on plugin operations, each command keeps its own error text, and mount reuses the cached connector overview.
- [x] Local verification passed: `just test` (356 tests), `just typecheck`, `just build`, and `just acceptance-test` (18 Chromium scenarios). Browser checks covered Day, Weeks, mobile, and the web plugin catalog. The internal API started with Node's TypeScript stripping.
- [x] The scoped security pattern scan returned no findings. This is a heuristic scan, not a complete security audit.

## UX vocabulary, 2026-10-11

- [x] The Backlog shows backlog items and subitems; "task" only means a project task.
- [x] Week layouts are Grid and Days, persisted as `grid` and `days`. The scope menu says Week.
- [x] Settings routes are `/settings/time-entries` (Import and export time entries) and `/settings/sync-review` (Sync review). The old `/settings/export`, `/settings/imports`, `/settings/connectors`, `/settings/projects/$projectId`, `/review/$date`, `/rules`, and `/sign-in` routes are removed without redirects.
- [x] Plugins tabs are All, Connectors, and Schemas. User-facing text says schema, not data shape, and time entries, not time logs.
- [x] Labels, headings, buttons, and aria-labels use sentence case.

## Sidebar redesign, 2026-10-13

- [x] The app sidebar is expanded or hidden; the 52px rail is removed. Below 1100px it hides on its own and opens over the page in a sheet. A saved "rail" reads as hidden.
- [x] A timer dock heads the sidebar with the running entry, its time, Stop and the share of the remaining estimate used, or today's total and a start for Up next. It replaces the titlebar's running pill. While the sidebar is off screen the dock floats at the bottom left, and in the narrow view it sits beside the entry buttons.
- [x] The window title shows the running entry, such as "● 1:24 · Fix export rounding — Ajour".
- [x] Navigation rows show today's total, the backlog count and the pull requests that need the user. The Backlog and Pull requests tabs become collapsible sections of one work list, with one-line rows, an Up next row instead of the card, and a settle circle on hover.
- [x] Verified with web unit tests, type checks, the Chromium acceptance suite and browser checks at 1440px, 1000px (overlay) and 420px (narrow view).
- [x] Merged the cardless Settings redesign from main. In wide windows the settings pages replace the app sidebar in the left column, headed by Back to app, and the timer dock floats inside that column. The sidebar list keeps main's memoized rows and hover-mounted controls, and the dock ticks on the shared running clock.

## App shell, 2026-10-11

- [x] The app sidebar collapses to a 52px icon rail from a button next to the logo or Cmd/Ctrl+B. The choice is saved per device, and below 1100px the rail is forced without changing it.
- [x] Settings opens inside the shell with its pages listed in a second column. The settings sidebar that replaced the app sidebar, and its Back control, are removed.
- [x] One breakpoint set: below 768px is the narrow view, 768px to 1099px the forced rail, 1100px and up the saved choice. `lib/breakpoints.ts` holds the numbers; `lib/tailwind-breakpoints.ts` exposes them to CSS as the `narrow`, `desktop` and `forced-rail` variants. The 640px and 1023px splits are removed.
- [x] The narrow view has no rail and no sidebars. Its titlebar holds a Time and Backlog switcher and a Settings cog. Settings opens on its list of pages, and Projects lives inside it with project import and export as an action.
- [x] The narrow view does not offer Week. A Week link shows Day with a note that Week needs a wider window. Long press opens a row's action menu on touch screens, and editing uses the entry dialog at the full window width.

## Windows sidebar spacing, 2026-10-12

- [x] Reproduced the 52px empty strip above the Windows sidebar header.
- [x] Restricted the sidebar chrome strip to macOS, which needs space for native traffic lights.
- [x] Browser checks with the platform CSS classes confirmed no gap in Windows expanded and rail layouts, the retained 52px macOS strip, and unchanged web spacing.
- [x] Repository typecheck passed. Formatting passed with the checkout's CRLF line endings; the default check reports line-ending differences in 329 files because Git uses `core.autocrlf=true`.

## Narrow timer controls, 2026-10-12

- [x] Move Start, Create time entry, and the running-entry pill to the bottom right below 768px; keep the daily total in the titlebar.
- [x] Preserve the shared editor and shortcuts, reserve scroll space, and place narrow Undo notifications above the controls.
- [x] Browser checks covered 320px and 374px narrow layouts, Windows titlebar CSS spacing, the 1280px titlebar controls, Start and running-entry editing, the Create time entry dialog, and Backlog. A 40-entry list scrolls its final row above the floating controls.
- [x] `just test` passed all 635 tests; `just typecheck` and the web and desktop renderer builds passed. Commands use the installed Git Bash shell because `sh` is not on PATH in this Windows worktree.
- [x] Final `just format-check` and web and desktop renderer builds passed after the scroll-height adjustment. A preview Undo toast sits above the floating controls without overlap.

## Submit week in totals, 2026-10-12

- [x] Move Submit week from the Day and Week headers into the titlebar totals popover, including the narrow view and Settings.
- [x] Keep totals and submission on the selected week and preserve the Time page's draft validation before navigation.
- [x] Verified historical-week navigation, wide and narrow popover layout, valid and invalid draft handling, and submission from Settings. After rebasing onto the Windows sidebar spacing fix, all 40 acceptance scenarios passed together on isolated port 5194. The default port sometimes served an older app.
- [x] Rebased-branch workspace typecheck and web and desktop renderer builds passed.
- [x] Scoped formatting checks passed and temporary test configuration was removed.

## Plugin installation recovery, 2026-10-12

- [x] Reproduced the installed app's missing internal API error through the real
      desktop IPC handlers with a healthy foreign API on the configured port.
- [x] Desktop startup now requires its owned API server and reports occupied
      ports with recovery instructions. Retrying after the port is freed works.
- [x] Reproduced missing packaged dependencies with electron-builder's actual
      extraResources copier and an independent Node import outside the repository.
- [x] Runtime dependencies now have a separate extraResources entry so the
      copier includes the top-level node_modules directory.
- [x] Desktop tests pass 74 cases, including seven new regression cases.
- [x] Windows desktop packaging succeeds. A smoke test using the packaged
      Ajour executable starts its copied API, passes health, installs the current
      published Azure DevOps archive in a temporary workspace, and discovers it.
- [x] Alex approved the local repair. Copied and hash-verified 918 dependency
      files in the installed runtime and stopped the approved competing APIs.
- [x] After reopening Ajour, Alex confirmed the catalog download works. The
      installed Ajour process owns port 8787, health passes, and Azure DevOps
      version 1.0.0-main.8.4229e5a appears in installed plugin discovery.
- [ ] Merge the fix and deliver it through the normal desktop release process.

## Connector review follow-up, 2026-10-12

- [x] Done-item, missing-item and ordinary sync processing preserve pending source writes and children carried by a parent reopen, so Undo can cancel the move.
- [x] Automatic source mapping applies the shared lifecycle transition before import. Settings discovery and done-item processing use the same transition.
- [x] Settle rejects priority levels without a source range, disables those choices and explains an invalid choice.
- [x] Seven new regressions cover sync during reopen, carried children, all three automatic mapping paths, local workflow overrides and incomplete priority scales. The foundation passes 690 unit tests.
- [x] The updated stack passes 703 unit tests, all 50 Chromium acceptance scenarios, workspace typecheck, production build and formatting. A browser fixture confirms unsupported Settle options are disabled and stale selections show an error and block submission.
- [ ] Complete Codex re-review after updating the view layer.

## Source-write acknowledgement follow-up, 2026-10-12

- [x] An older successful source request advances the recovery snapshot of its replacement, including workflow state, lifecycle, priority and carried children. The replacement retains its values and deadline.
- [x] Source acknowledgements update both snapshots of the replacement's Undo. Independent edits still block Undo.
- [x] Settle rejects unsupported priority clears. No priority remains available when it already matches the source's mapped level.
- [x] Eight new regressions cover recovery of open and done states, carried children, priority-only writes, replacement Undo, independent edits and No priority validation. The foundation passes 720 unit tests and workspace typecheck.
- [x] The full stack passes 733 unit tests, all 57 Chromium acceptance scenarios, workspace typecheck, production build and formatting. Browser fixtures verify No priority is disabled for mapped source priorities and available when it already matches the source.
- [ ] Complete Codex review of the updated stack.

## Standard Task Flow

- [ ] Understand the requested outcome.
- [ ] Read the relevant existing code and docs.
- [ ] Identify privacy, persistence, and runtime boundaries.
- [ ] Make scoped changes.
- [ ] Run focused verification.
- [ ] Run broader `just` checks when needed.
- [ ] Summarize changed files and verification results.

## Project Health Notes

### Modified settings-link activation, 2026-10-12

- [x] The workflow settings link applies the draft guard only to an unmodified left-click. Modified clicks retain the browser's requested browsing context without committing or closing the original editor.
- [x] Two new Chromium scenarios verify Control-click and Shift-click open a separate settings page while the original draft stays unsaved. All six settings-link scenarios pass, including same-tab saves, invalid input and cancelled subitem closure.
- [x] All 878 unit tests, workspace typecheck, production builds and formatting pass.
- [ ] Complete fresh Codex review of the pushed view head before integration. The integration thread owns merging.

### Workflow settings draft guard, 2026-10-12

- [x] The unmapped-source-state link awaits the editor's existing commit guard before opening workflow settings. Invalid drafts and cancelled lifecycle confirmation keep the user on Backlog with the draft intact.
- [x] Four new Chromium cases failed before the fix and pass afterward. They cover click and Enter saving, title validation and cancelled subitem closure. Five existing editor action and Alt-arrow cases also pass.
- [x] All 878 unit tests, workspace typecheck, production builds and formatting passed.
- [ ] Complete fresh Codex review of the pushed view head before integration. The integration thread owns merging.

### Top-level custom ordering, 2026-10-12

- [x] Custom keyboard, request and pointer reordering accepts only top-level items. Root moves exchange only root slots, leaving subitem positions unchanged. Subitems retain cross-group property moves without an ordering write.
- [x] Explicit subitem project drops disable parent mapping inheritance, including No project. Undo restores the prior assignment and custom order.
- [x] Seven new unit cases cover drag eligibility and root-only drop ordering. Browser scenarios cover rejected subitem reorder attempts, state/priority/project moves with Undo and root keyboard ordering. The failed-source ordering fixture now uses a root card.
- [x] All 878 unit tests, workspace typecheck and production builds passed. The full Chromium run passed 96 of 97 scenarios and exposed the project-inheritance defect. After fixing it, all ten focused ordering, property-drop and archived-project scenarios passed.
- [ ] Complete fresh Codex review of the pushed view head before integration. The integration thread owns merging.

### Task filter consistency, 2026-10-12

- [x] Task filters resolve assignments within each item's configured project. Missing tasks, tasks in another project and tasks without a valid project match No task. Known archived assignments remain filterable.
- [x] Six selector cases cover empty, known, stale, archived and combined task filters. Five cases failed before the fix.
- [x] All 871 unit tests, workspace typecheck, production builds, formatting and three focused Chromium scenarios for filtering and task-preserving project reselection passed.
- [ ] Complete Codex review of the updated view head before integration. The integration thread owns merging.

### Rejecting stale unlisted Settle drafts, 2026-10-12

- [x] Settle rejects an unlisted draft that differs from the current source state, rather than silently dropping it. Unchanged unlisted states still allow local Settle.
- [x] The dialog uses the shared draft validator, disables submission and shows a state-specific error. A valid priority does not receive a misleading range error.
- [x] Six validator cases cover changed, unchanged, absent and normalized source labels. The stale cases and browser submission guard failed before the fix. Browser coverage also confirms local Settle with an unchanged unlisted source state.
- [x] All 865 unit tests, six Settle Chromium scenarios, workspace typecheck, production builds and formatting passed.
- [ ] Complete fresh Codex reviews of the mapping and view heads before integration. The integration thread owns merging.

### Missing-sync archives after Done changes, 2026-10-12

- [x] Clearing Done leaves missing-sync archives in their source-following workflow. Deleting the state clears their workflow instead of treating them as explicit closes. The same provenance check applies to carried recovery snapshots.
- [x] Two persisted-store regressions reproduce clearing and deleting a temporary Done state, reload and an unchanged source return. Both failed before the fix and now return the item to active work.
- [x] The stack passes all 859 unit tests, workspace typecheck, production builds, formatting and four focused Chromium scenarios. Archive passed on retry after Chromium reported `ERR_NO_BUFFER_SPACE` during initial navigation; the other three passed on the first run.
- [ ] Complete fresh Codex reviews of the pushed stack before integration. The integration thread owns merging.

### Clearing Done during carried recovery, 2026-10-12

- [x] Clearing Done translates archived carried post-move snapshots to the replacement Done state, matching the live child. Pre-move snapshots remain unchanged, preserving pending-reopen Undo.
- [x] The reload and failed-close regression now covers deleting an open state, deleting Done and clearing Done. The new case failed before the fix, and the existing reopen Undo case also passes.
- [x] The rebased stack passes all 857 unit tests, three focused Chromium scenarios for failed drag recovery, parent close with Undo and Done settings, workspace typecheck, production builds and formatting.
- [ ] Complete fresh reviews of the mapping and view heads before integration. The integration thread owns merging.

### Done rollback and unlisted drafts, 2026-10-12

- [x] The foundation's failed-write command reapplies the domain lifecycle rules after restoring values. The mapping layer retains its stronger deferred-mapping reconciliation. A persisted-store regression covers a shared workflow marked Done during a pending Settle, failure, reload and Restore.
- [x] Deleting Done translates archived carried snapshots to the replacement Done state, matching the live child. Failed writes still recover that child's former active workflow. The new replacement-state case failed before the fix.
- [x] The Settle state fallback uses the preserved draft value and exact option membership. A browser case reproduces an unlisted draft disappearing after refresh and verifies selecting and submitting a listed replacement.
- [x] The rebased stack passes all 856 unit tests, eight focused Chromium scenarios, workspace typecheck, production builds and formatting. The full 90-scenario suite passed at `6eaaaa1` before these follow-ups.
- [ ] Complete fresh Codex reviews before integration. The integration thread owns merging.

### No project filter consistency, 2026-10-12

- [x] Project filters resolve item project IDs against configured projects. Missing and unknown IDs match No project, while archived projects remain known assignments.
- [x] Five selector cases cover No project, a known project, their union, a stale project filter and an archived assignment. Three cases failed before the fix.
- [x] All 854 unit tests, workspace typecheck, production builds and three focused Chromium scenarios for filtering and archived destinations passed.
- [ ] Complete Codex review of the updated view head. The integration thread owns merging.

### Combined review fixes verification, 2026-10-12

- [x] The rebased stack passes all 849 unit tests and all 90 Chromium acceptance scenarios, workspace typecheck, production builds and formatting.
- [x] The view-only head `c04a91c` passed Codex review with no major issues. Parent review fixes required rebasing the view layer, so all three updated heads need fresh reviews.
- [x] Deleted workflow IDs no longer return through parent or carried-child rollback after a failed source write. Settle retains its displayed priority intent when a connector refresh changes the imported value.
- [ ] Complete Codex review of the updated stack before integration. The integration thread owns merging.

### Settle refresh and carried recovery, 2026-10-12

- [x] Settle compares its priority draft with the current item's imported priority and range, rather than the item captured when the dialog opened. A connector refresh preserves the draft and submission writes its displayed value.
- [x] Workflow deletion clears deleted IDs from the mapping layer's lifecycle and carried-child recovery snapshots. Clearing both child snapshots keeps failed-write recovery valid after deletion.
- [x] The connector-refresh browser case and carried-child regression failed before their fixes. All mapping-layer unit tests, workspace typecheck and four Settle confirmation scenarios pass.
- [ ] Verify the rebased view layer and request fresh Codex reviews. The integration thread owns merging.

### Deleted workflow recovery references, 2026-10-12

- [x] Deleting a workflow state clears its ID from pending source-write rollback workflow and imported-workflow references. Other saved states remain available for recovery.
- [x] Two regressions reproduce stale IDs after a failed Settle write, including JSON reload and a preserved local workflow override. Both failed before the fix.
- [ ] Complete verification and fresh Codex review of the updated stack. The integration thread owns merging.

### Peek project reselection, 2026-10-12

- [x] Selecting the current project in the peek leaves the task assignment unchanged. Changing or clearing the project still clears the task through the existing command and Undo.
- [x] Click and Enter browser cases reproduced task loss before the fix. Both now retain the task and cover clearing, Undo and reload. The existing peek editing scenario also passes.
- [x] All 846 unit tests, workspace typecheck, production builds and formatting passed.
- [ ] Complete Codex review of the updated view head. The integration thread owns merging.

### No state filter consistency, 2026-10-12

- [x] State filters resolve item workflow IDs against the configured states. Missing and unknown IDs match No state, consistent with list and board grouping.
- [x] Four selector cases cover No state, a known state, their combined filter and a stale state filter. Three cases failed before the fix.
- [x] All 846 unit tests, workspace typecheck and production builds passed. The Chromium scenario for page filtering and sidebar isolation also passed.
- [ ] Complete Codex review of the updated view head. The integration thread owns merging.

### Markerless legacy explicit closes, 2026-10-12

- [x] Legacy archive inference uses the saved workflow ID and original source-state availability. Markerless explicit closes with an assigned Done ID remain explicit, while missing-sync archives with no workflow ID retain their provenance.
- [x] The same discriminator applies to carried snapshots. Existing boolean markers still take precedence.
- [x] The markerless explicit-close case failed before the fix. A paired markerless missing-sync case covers failed startup recovery, source return and Restore after reload.
- [x] The rebased stack passes 842 unit tests, workspace typecheck, production builds and three focused Chromium scenarios covering failed drag recovery, parent close with Undo and Done settings.
- [ ] Fresh Codex reviews of the pushed mapping and view heads are pending. Merging remains owned by the integration thread.

### Legacy source-write recovery provenance, 2026-10-12

- [x] Hydration fills missing archive-provenance markers in older pending recovery and carried-child snapshots. Source markers and pre-close history identify explicit closes; manual children remain explicit, and stored boolean markers take precedence.
- [x] Carried recovery compares snapshot fields, so JSON property order cannot invalidate an unchanged child.
- [x] Six persisted upgrade cases cover missing-sync archives, synced and manual children, explicit archives after a Done flag change and unknown source states. Reload, failed startup writes, source returns and Restore are checked.
- [x] The rebased stack passes 840 unit tests, workspace typecheck, production builds and three focused Chromium scenarios covering failed drag recovery, parent close with Undo and Done settings.
- [ ] Fresh Codex reviews of the pushed mapping and view heads are pending. Merging remains owned by the integration thread.

### Archived recovery after clearing Done, 2026-10-12

- [x] Failed or undone reopens move recovered explicit archives to the remaining Done state when their old state loses its Done flag. Carried children retain the archive markers and pre-close state for Restore.
- [x] Recovery saves entries started during the optimistic reopen. Source-write snapshots preserve missing-sync provenance, so missing-sync archives retain their open workflow state.
- [x] Six persisted-store regressions cover failure and Undo, carried children, Restore after reload and missing-sync archives. The archive migration and running-entry checks failed before their fixes.
- [x] The rebased stack passes 834 unit tests, workspace typecheck, production builds and three focused Chromium scenarios covering failed drag recovery, parent close with Undo and Done settings.
- [ ] Fresh Codex reviews of the pushed mapping and view heads are pending. Merging remains owned by the integration thread.

### Done flag changes during source-write recovery, 2026-10-12

- [x] Released source writes apply lifecycle reconciliation even when their workflow mapping IDs stay unchanged.
- [x] Four persisted-store regressions reproduce failed-write and Undo recovery into a state flagged Done during a pending move, with and without carried subitems. Recovery closes the items, saves the running entry once and survives reload.
- [x] The rebased stack passes 828 unit tests, workspace typecheck, production builds and three focused Chromium scenarios covering failed drag recovery, parent close and Done settings.
- [ ] Fresh Codex reviews of the pushed mapping and view heads are pending. Merging remains owned by the integration thread.

### Deferred mappings after failed writes, 2026-10-12

- [x] Failed source writes restore their recovery snapshot, then use the same mapping and lifecycle reconciliation as successful writes.
- [x] Carried children follow their current mapping after recovery. Independent child writes remain protected, and later notes and local workflow overrides remain intact.
- [x] Six persisted-store regressions cover Done, open and unmapped destinations, reload, carried children, independent child writes and local priority-write overrides. The three destination cases failed before the fix.
- [x] The rebased stack passes 824 unit tests, workspace typecheck, production builds and five focused Chromium scenarios, including failed source-move order recovery.
- [ ] Fresh Codex reviews of the pushed mapping and view heads are pending. Merging remains owned by the integration thread.

### Mapping changes after a source write, 2026-10-12

- [x] Successful source writes reconcile mappings deferred for the item and its carried children. A newly mapped Done state closes the item and saves its running entry.
- [x] Newer pending writes and local workflow overrides remain protected.
- [x] The UX specification retains the explicit Settle rules introduced in #95 and distinguishes them from workflow move write rules.
- [x] The mapping layer passes 783 unit tests and workspace typecheck. Regressions cover Done, open and unmapped destinations, carried children, newer writes, local overrides and reload.
- [x] Rebased the view layer. The complete stack passes 818 unit tests, all 87 Chromium scenarios, workspace typecheck, production builds and formatting.
- [ ] Fresh Codex reviews of the pushed heads are pending. Merging remains owned by the integration thread.

### Settle confirmation and archive warning, 2026-10-12

- [x] Settle keeps its selected state and priority until the subitem confirmation succeeds. Cancellation and a changed subitem set leave the draft open.
- [x] The archive warning and submit label use the same workflow mapping as the lifecycle transition.
- [x] The foundation passes 710 unit tests, workspace typecheck and three Chromium confirmation scenarios.
- [x] Carried the fixes through the stack and verified all 87 Chromium scenarios, including the three Settle confirmation cases.
- [ ] Fresh Codex reviews of the pushed heads are pending. Merging remains owned by the integration thread.

### Peek Start disabled reason, 2026-10-12

- [x] Peek Start exposes the shared action's disabled reason in its tooltip and accessible description, while remaining focusable with `aria-disabled` and guarded activation.
- [x] The running-entry Chromium regression covers hover and keyboard tooltip access, ignored mouse/Enter/Space activation, timer identity across reopening, another item's enabled Start, and the cleared reason after Stop.
- [x] All 812 unit tests and 84 Chromium scenarios pass, along with workspace typecheck, production build and formatting.
- [ ] Fresh Codex review is pending. Merging remains owned by the integration thread.

### Drag eligibility and sorted list scrolling, 2026-10-12

- [x] The shared drag module determines whether an item can reorder with a peer or move to another reachable group in its lane. Rendering and pointer startup use the same rule, and ordering changes cancel an active drag.
- [x] Sorted ungrouped lists, single-item groups without another destination and unavailable lanes retain native touch scrolling. Custom reordering and cross-group moves remain enabled when they can change an item.
- [x] Seven eligibility tests and Chromium scenarios cover actual sorted-list scrolling, restoring Custom reordering and Undo, sorted board touch moves, and archived swimlane scrolling. All 812 unit tests and workspace typecheck pass.
- [x] All 84 Chromium scenarios pass in the full run, along with production build and formatting.
- [ ] Fresh Codex review is pending. Merging remains owned by the integration thread.

### Archived swimlane touch scrolling, 2026-10-12

- [x] Archived project swimlane cards omit drag handlers because they have no reachable drop destination. Their native touch scrolling stays enabled.
- [x] Active swimlane cards retain drag handling. Existing assignments in archived project groups can still be dragged to active projects.
- [x] Chromium touch regression checks the actual board scroll position, the absence of a drag session during the swipe, and native touch handling for archived cards. Existing touch drag and Undo, archived destinations and active project creation pass.
- [x] All 805 unit tests and 82 Chromium scenarios pass, along with workspace typecheck, production build and formatting. The prior project-shortcut timeout did not recur in the full browser run.
- [ ] Fresh Codex review is pending. Merging remains owned by the integration thread.

### Peek returns and archived project destinations, 2026-10-12

- [x] Opening a peek through click, Space or the hosted editor clears Returned through the existing lifecycle command. Closing a peek does not mark an item opened.
- [x] Archived project groups and swimlanes retain their assigned items and an Archived label, with creation controls and drop destinations removed. Add and drop commands recheck current project availability after draft commits.
- [x] Browser regressions cover sync returns and expired snoozes in list and board, persistence after opening, blocked archived project drops and active project creation in groups and swimlanes.
- [x] All 805 unit tests, workspace typecheck, production build and formatting pass. Chromium passed 80 of 81 scenarios in the full run. The project-shortcut scenario timed out on a blank page and passed on a focused rerun without code changes.
- [ ] Fresh Codex review is pending. Merging remains owned by the integration thread.

### Running-item Start tooltips in rows and cards, 2026-10-12

- [x] Rows and cards expose the shared Start disabled reason in their tooltip and accessible description. The running item says Start instead of offering to switch to itself.
- [x] Start remains focusable with `aria-disabled`; its activation guard blocks clicks, Enter and Space. Other items retain Switch, and Stop enables the control again.
- [x] List and board Chromium regressions cover tooltip access, blocked activation, timer identity, the other item's enabled control and the cleared reason after Stop.
- [x] All 804 unit tests and 75 Chromium scenarios pass, along with workspace typecheck, production build and formatting. Keyboard tooltip assertions select the open popup so closing animations do not match.
- [ ] Fresh Codex review is pending. Merging remains owned by the integration thread.

### Failed source drag order recovery, 2026-10-12

- [x] Pending source moves retain the drag's affected custom order, including across persistence and coalesced moves. Recovery advances when an older source write succeeds.
- [x] Failed writes restore that order only while its affected items retain the drop order. Later explicit reorders, unrelated reorders, inserted items and field edits survive recovery.
- [x] Seven domain regressions and a Chromium drag through a rejected fixture source write pass. All 804 unit tests pass.
- [x] All 73 Chromium scenarios pass, along with workspace typecheck, production build and formatting.
- [ ] Fresh Codex review of the pushed view-layer fix is pending. Merging remains owned by the integration thread.

### Sidebar Start disabled reason, 2026-10-12

- [x] Sidebar Start icons show the action's disabled reason in their tooltip and accessible description. They keep their action name and remain focusable while unavailable.
- [x] Replaced the tooltip trigger's `disabled` prop with `aria-disabled` and an activation guard. The former disabled the tooltip rather than the button.
- [x] Chromium checks hover text, accessible description, ignored mouse and keyboard activation, unchanged timer identity, and the enabled control after Stop.
- [x] All 797 unit tests and 72 Chromium scenarios pass, along with workspace typecheck, production build and formatting.
- [ ] Fresh Codex review of the pushed view-layer fix is pending. Merging remains owned by the integration thread.

### Running ownership in every backlog action set, 2026-10-12

- [x] Item-page, editor, sidebar and both command-palette paths supply running ownership to the action model. The input is required, so omitted callers fail typechecking.
- [x] Item-page and sidebar Start controls use the same disabled reason as their menus.
- [x] Palette regressions cover focused and selected items with their own timer, another item's timer or none. Chromium checks every remaining control while running and after Stop, with timer identity preserved.
- [x] All 797 unit tests and 71 Chromium scenarios pass, along with workspace typecheck, production build and formatting.
- [ ] Fresh Codex review of the pushed view-layer head is pending. Merging remains owned by the integration thread.

### Running-item Start entry in action menus, 2026-10-12

- [x] The shared backlog action rules disable Start entry for the running item in peek and row menus. The peek button uses the same action set.
- [x] The shared Start command ignores requests for the already running item while allowing starts with no running item or another item running.
- [x] Domain, command and Chromium regressions pass. Browser checks include both menus, timer identity and start time, another item and starting after Stop.
- [x] All 795 unit tests and 67 Chromium scenarios pass, along with workspace typecheck, production build and formatting.
- [ ] Fresh Codex review of the pushed view-layer head is pending. Merging remains owned by the integration thread.

### Peek Start entry and the running item, 2026-10-12

- [x] The peek disables Start entry while its item owns the running entry, matching the row control.
- [x] Chromium verifies timer identity and start time after reopening the peek, another item's enabled Start entry and a fresh entry after stopping through the titlebar.
- [x] All 791 unit tests and 67 Chromium scenarios pass, along with workspace typecheck, production build and formatting.
- [ ] Fresh Codex review of the pushed view-layer head is pending. Merging remains owned by the integration thread.

### Parent return propagation and missing-sync restore history, 2026-10-12

- [x] Connector returns carry subitems only when the parent remains in an open workflow state. Source changes mapped Done leave its carried archived subitems unchanged.
- [x] A missing-sync return closed into Done remembers its former open workflow when no pre-close state exists.
- [x] The foundation passes 712 unit tests and workspace typecheck. Connector regressions cover closed-parent child retention, later genuine reopening and Restore after a missing-sync return.
- [x] Carried the fixes through the stack. All 791 unit tests and 66 Chromium scenarios pass, along with workspace typecheck, production build and formatting.
- [ ] Fresh Codex reviews of the pushed heads are pending. Merging remains owned by the integration thread.

### Reactivation in an unchanged Done state, 2026-10-12

- [x] Lifecycle reconciliation closes every open item in Done, including missing-sync returns, carried subitems and legacy records whose workflow ID stays unchanged.
- [x] Reclosing an archived item preserves a valid pre-close workflow for Restore.
- [x] The foundation passes 710 unit tests, with real connector-import regressions for missing-sync returns and carried settled subitems.
- [x] Carried the fix through the stack. All 789 unit tests and 66 Chromium scenarios pass, along with workspace typecheck, production build and formatting.
- [ ] Fresh Codex reviews of the pushed heads are pending. Merging remains owned by the integration thread.

### Enabling Done on an occupied state, 2026-10-12

- [x] Workflow settings apply the existing lifecycle transition when an open state becomes Done. Its active and settled items close and their running entries are saved.
- [x] Restore cannot return an archived item to a pre-close state that has since become Done. Other active items and archived history remain unchanged.
- [x] The foundation passes 705 unit tests and workspace typecheck, with direct lifecycle and persisted-store regressions.
- [x] Chromium verifies the Workflow checkbox, saved running entry and archived items after reload.
- [x] Carried the fix through the stack. All 784 unit tests and 66 Chromium scenarios pass, along with workspace typecheck, production build and formatting.
- [ ] Fresh Codex reviews of the pushed heads are pending. Merging remains owned by the integration thread.

### Mixed editor drafts and close confirmation, 2026-10-12

- [x] Editor updates keep non-state fields pending until the workflow move is confirmed. Cancelled or invalidated subitem confirmations leave the entire draft unsaved.
- [x] Chromium covers changed title and note fields with a dismissed confirmation or an added subitem, followed by editor Cancel.
- [x] The foundation passes 702 unit tests and workspace typecheck.
- [x] Accepted mixed-field Save and Undo pass in Chromium. The fix is carried through the stack, with 781 unit tests, all 65 Chromium scenarios, workspace typecheck, production build and formatting passing.
- [ ] Fresh Codex reviews of the pushed heads are pending. Merging remains owned by the integration thread.

### Done flag and subitem confirmation recovery, 2026-10-12

- [x] Clearing a Done flag moves its archived items to another Done state and preserves their pre-close state and carried-subitem restore path. Active items retain their workflow state.
- [x] Move and Settle cancel when the eligible subitem IDs change during confirmation. Added, reparented and replaced subitems require a new action and confirmation.
- [x] The foundation passes 702 unit tests, including archived parent and subitem Restore and both confirmation verbs.
- [x] Carried both fixes through the mapping and view layers. The full stack passes 781 unit tests, all 62 Chromium acceptance scenarios, workspace typecheck, production build and formatting checks.
- [ ] Fresh Codex reviews of the pushed heads are pending. Merging remains owned by the integration thread.

### Archived source mappings and pending editor saves, 2026-10-12

- [x] A changed connector-done source state mapped to an open workflow state reopens an archived item and its carried children. An unchanged local Archive stays archived, and a missing-sync archive returns when the item reappears in an open mapping.
- [x] Editor saves and switches await workflow moves and share an in-flight commit. Cancelling the subitem prompt leaves the editor and workflow draft intact.
- [x] The foundation passes 692 unit tests, workspace typechecking and a Chromium regression covering Save, cancellation and retry with Include subitem.
- [x] Carried the fixes through the mapping and view layers. Final validation passes 772 unit tests, all 62 Chromium scenarios in one run, workspace typechecking, production build and formatting.
- [x] A queued archived source write stays in place when sync reports its previous source state, even when that old state maps open.
- [x] Async moves recheck the parent, destination and eligible children after prompts and lookups, and reject superseded source-write choices. Six regressions cover moves, deletion, archiving and changes to the included children.
- [x] Persisted descending priority ordering keeps No priority first and preserves custom order within a level.
- [ ] Complete fresh Codex reviews on the pushed stack heads before integration.

### Source write races and persisted recovery, 2026-10-12

- [x] Source state choices revalidate the item's workflow, source identity, lifecycle and mapping after both the lookup and dialog.
- [x] State writes restore No state after JSON persistence. A move extending a priority-only write captures its pre-move workflow baseline.
- [x] Independent child source acknowledgements advance the parent's child recovery baseline. A failed parent keeps a child's own pending write, and a confirmed child close stays closed in either completion order.
- [x] Recovery updates leave in-flight requests current when their state, priority and Undo deadline are unchanged.
- [x] The updated mapping layer passes 748 unit tests and workspace typechecking. View-layer verification follows before pushing the stack.
- [x] The full stack passes 761 unit tests and all 61 Chromium scenarios in one run, plus workspace typechecking, production build and formatting.
- [x] Touch dragging uses native Chromium touch events. Narrow and Archive views retain native touch scrolling because they do not attach drag handlers.
- [ ] Complete fresh Codex review on the pushed stack heads before integration.

### Settle mapping recovery, 2026-10-12

- [x] Settle derives closure from the selected source state's workflow mapping, including a connector-open state mapped to Done and a connector-done state mapped to an open state.
- [x] Settling updates the imported workflow baseline and restores the prior workflow when a source write fails. Carried children follow the parent's settle or close.
- [x] The foundation passes 687 unit tests and workspace typechecking. Full stack verification follows in the view-layer PR.

### Project write options and persisted recovery, 2026-10-12

- [x] Move writes and Change source state choices use the connector's states for the actual item. Settings write rules offer only states seen or loaded in that source project.
- [x] Legacy pending recovery priorities migrate with the item's connection scale. Later manifest range seeding reconciles recovery values that follow their source and preserves local overrides.
- [x] Failed moves restore snooze and Returned markers on the parent and carried children, while retaining independently changed child lifecycles.
- [x] The foundation passes 731 unit tests and workspace typechecking. A browser fixture confirms Mercury offers only In QA and Venus only Resolved in their write-rule menus.
- [x] The updated stack passes 747 unit tests, workspace typechecking, production build and formatting. All 60 Chromium scenarios pass: 57 existing scenarios in the full run and three new editor-move scenarios after correcting their test inputs.
- [ ] Complete fresh Codex reviews on all three stack heads. The integration thread owns merging.

### Editor drag and keyboard moves, 2026-10-12

- [x] Board drops commit and close the editor, then read the saved item before changing its state, priority or project. Group comparisons use its committed fields.
- [x] Alt-arrow workflow moves commit and close the editor before reading its current workflow state. An invalid draft blocks the move.
- [x] Browser regressions cover a subitem drop followed by reopening and saving its editor, and unsaved titles followed by Alt-arrow moves to both open and Done states.

- Use `just` rather than invoking package scripts directly.
- Preserve local-first behavior unless the user explicitly asks to change it.
- Treat connector writes and imports as side-effect-sensitive.
- Feature code should use local UI primitives instead of direct Base UI imports or raw controls.
- Keep repeated app surfaces behind `apps/web/src/components/app-surface.tsx`.
- Larger page/controller splits remain useful for projects and backlog. Prefer extracting cohesive view/controller Modules over moving JSX into shallow files.
- `local-store.ts` is now the persistence Adapter. Do not move deterministic lifecycle rules back into it; extend the owning domain transition module instead.

## Testing Shell

- [x] Preserved the existing Vitest unit layout and `just test` entry point without adding overlapping smoke coverage.
- [x] Added Playwright-BDD feature discovery and step binding under `apps/web/tests/acceptance/`.
- [x] Added Chromium installation and executable acceptance commands through `just`.
- [x] Added a controlled empty connector fixture so the smoke scenario is local and deterministic.
- [x] Added the manual local-workspace smoke routine under `qa/routines/`.
- [x] Ran the UI context generator; all existing context files were preserved unchanged.
- [x] Moved project context files into `agents/` and documented them in the root `agents.md`.
- [x] Verified `just test`: 29 files and 198 tests passed.
- [x] Verified `just acceptance-test`: 1 Chromium scenario passed.
- [x] Verified `just typecheck`.
- [x] Verified `just build`.
- [x] Weekly time implementation verification: 210 web tests and 317 tests
      repository-wide passed; repository typecheck and production builds passed.
      Real-browser checks covered Day to Week navigation, Ledger, Lanes, the Week
      entry dialog, General capacity settings, visible keyboard focus, nested date
      dialog dismissal, corrected entry-group semantics, and the sub-1024px Day
      fallback. The Windows `just` parser rejected the repository's existing
      `short=` annotation, so equivalent locked pnpm commands were used for this
      pass.
- [x] Weekly visual refinement verification: all 210 web tests and 328 tests
      repository-wide passed; repository typecheck and production builds passed.
      Real-browser checks covered the unified Ledger/Lanes surface, seven visible
      lanes without horizontal overflow at 1280px, project markers and rails, the
      Week modal and Day inline editor, and the single-layer anchored date picker.
      The broader Playwright suite passed 8 of 12 scenarios on an isolated port;
      four pre-existing plugin-catalog scenarios still expect removed connector
      controls/copy and do not exercise the time view.
- [x] The Day-to-Weeks scope control was typechecked after replacing the old
      Week overview action; the scope menu intentionally omits Calendar until that
      feature exists.
- [x] Verified the full workspace test suite: 52 files and 341 tests passed.
- [x] Verified the Chromium acceptance suite: 15 scenarios passed.
- [x] Verified the full workspace typecheck.
- [x] Verified the production web and desktop renderer builds.
- [ ] Assign an owner and record a manual result in `qa/routines/local-workspace-smoke.md`.

## Backlog views, 2026-10-12

- [x] Grouped list and board share workflow state, priority and project grouping.
- [x] Display options and filter chips persist per device. Ordering remains in local state and the sidebar shares it.
- [x] Subitems have independent rows and cards, with closed-count progress on their parents.
- [x] State and priority pickers, keyboard moves and pointer moves use the shared lifecycle commands and Undo.
- [x] Peek shows item details and immediate property changes. Edit uses the existing form in the same panel.
- [x] Project swimlanes collapse independently. Archive includes old done items and items missing from sync.
- [x] Narrow windows force the list while retaining the desktop layout preference.
- [x] Foundation PR review fixes cover clearing done states, source reopen propagation, settled return, pending write deadlines, failed-move lifecycle restoration and priority migration.
- [x] Local verification passed: 689 unit tests, workspace typecheck, production build and format check. All 46 acceptance scenarios passed, with targeted retries for intermittent browser failures.
- [ ] Complete Codex review for the view-layer PR.

## Backlog review fixes, 2026-10-12

- [x] Parent closes carry only active subitems. Independently settled and archived subitems retain their lifecycle and reopen behavior.
- [x] Settings > Backlog renders its settle rules once, outside the preferences field.
- [x] Editor workflow changes use the shared move command, including source writes and Undo between open states.
- [x] Failed parent reopens restore carried children without overwriting independent edits.
- [x] Project mappings persist explicit No state overrides. Remapping source states clears incompatible write rules and blocks stale inherited rules.
- [x] Row and peek source-state pickers allow a single alternative. Archiving closes the editor and disables the peek's Edit action.
- [x] All 696 unit tests and all 50 Chromium acceptance scenarios passed. Workspace typecheck, production build and formatting passed.
- [ ] Complete Codex re-review of the updated PR stack.

## Backlog integration review follow-up, 2026-10-12

- [x] Changed done-category source states update their imported baseline and override local moves consistently with ordinary import.
- [x] Deleting an occupied Done state keeps archived items in another Done state, preserving their pre-close state for Restore.
- [x] Editor commits wait for workflow moves and share an in-flight commit. Actions consume the committed item once, and cancelling a move blocks the next action.
- [x] Each project swimlane owns its keyboard focus scope. Arrow navigation stays in that lane despite uneven columns in earlier projects.
- [x] Verification passed: 706 unit tests, all 54 Chromium acceptance scenarios, workspace typecheck, production build and formatting. Four new browser scenarios cover workflow drafts followed by Archive or Settle, cancellation and swimlane focus.
- [ ] Complete Codex re-review of the new stack heads before integration.

## Backlog capability migration integration, 2026-10-12

- [x] Rebased the stack onto main at `af1e48b`, including the API v2 capability migration and packaged plugin recovery.
- [x] Connector priority scales live under `capabilities.connector`. Import defaults, source write availability and Workflow settings use the migrated contract.
- [x] Preserved main's capability validation and tests alongside the priority-range tests.
- [x] Verification passed: all 725 unit tests and all 57 Chromium acceptance scenarios, workspace typecheck, production build and formatting.
- [ ] Complete Codex review on the rebased heads. The integration thread owns merging.

## Sidebar view switcher, 2026-10-14

- [x] Hide sidebar and the logo sit on the titlebar's row, right of the macOS traffic lights and in the top left corner elsewhere, as in T3 Code.
- [x] A ChatGPT-style view switcher replaces the Time, Backlog, Pull requests and Projects rows. Search sits beside it.
- [x] New entry (+) moves from the titlebar to the timer dock. Start (▶) leaves the titlebar: a small ▶ beside Search starts an empty entry, and the dock starts the Up next item. With the sidebar hidden and nothing running, the floating dock holds "+" and Start. The narrow view keeps its floating buttons.
- [x] The work list's Up next section, its setting and its View menu entry are gone. The dock already offers the first item.
- [x] Verification passed: unit tests, typecheck and the acceptance scenarios, except five that also fail on main at `7ed5ab4` (board close with subitems, Ctrl-click workflow settings link, packaged connector install, settle rules section, pull request Ctrl-click).

## Sidebar review fixes, 2026-10-15

- [x] Merged main at `11c630a` into the Comfortable sidebar branch.
- [x] Start entry and Stop share one running-entry lookup and action runner across sidebar rows, Backlog rows/cards, peek, page, editor menus and command palette. S switches or stops the focused item on the Backlog page as well as in the sidebar.
- [x] Comfortable titles reserve their action padding at rest. The state line uses `--text-tertiary`. Both densities keep the row highlight and transparent icon buttons; Compact keeps its item icon.
- [x] Updated the focused-row shortcuts and row-height documentation. Added List/Board shortcut coverage, Stop coverage in both sidebar densities, and rendered state-color and title-geometry assertions.
- [x] `just test`: 1,080 tests passed, including 857 web tests. All 142 Chromium acceptance scenarios passed with an isolated test server. `just typecheck`, package boundaries and `just format-check` passed.
- [x] Application production builds passed with `just --set PNPM 'corepack pnpm --recursive --filter !@ajour/docs' build`. The full `just build` remains blocked locally because the docs workspace has no installed VitePress dependency.
- [x] Browser inspection confirmed the tertiary state color, stable title geometry, transparent hover icons, and highlighted rows in Comfortable and Compact.
- [x] `just ui-perf`, identical script on main and this branch, five-run medians on the 600-item/1,800-entry fixture. Times in milliseconds, main / branch: cold load 1283.0 / 1272.6; Start click 89.5 / 86.0; Backlog store write 45.3 / 44.3; timer renderer work per second 28.6 / 31.0. The largest increase was 8.4%, below the 10% limit. Other local performance jobs overlapped parts of the measurements, so these are comparative development measurements, not production timings.

## Sidebar merge resolution, 2026-10-15

- [x] Merged main at `0594f4f` into the sidebar branch after the pinning PR was merged into it. Preserved the Comfortable/Compact row tokens, focused-item S shortcut, pin ordering, and main's Week Grid rules.
- [x] Kept main's idle timer dock with New entry, blank-entry Start, and today's total. Updated the sidebar specification and pinning acceptance scenario for that behavior.
- [x] The pin-icon assertion now waits for the menu to close and moves focus to Search before checking markers, avoiding the menu's focus-restoration race.
- [x] Verification passed: 1,090 unit tests, all 152 Chromium acceptance scenarios, workspace typecheck and package boundaries. Application production builds passed with the docs workspace excluded because VitePress is not installed locally. Browser inspection confirmed the pinned item first, 80px Comfortable rows, and the new idle dock.

## Narrow view floating navigation, 2026-10-15

- [x] The narrow view's titlebar holds the date, New entry, Start, then the totals pill. Start turns into Stop while an entry runs. The entry buttons left the floating bottom-right group.
- [x] While an entry runs, the totals pill shows its time instead of "Today", and the pill's popover has a Current timer row that opens the running entry's dialog. A click outside that dialog closes it.
- [x] Settings joins Time and Backlog in the segmented toggle, which floats at the bottom left. The separate cog is gone. Settings stays active on Projects pages.
- [x] The TanStack Router devtools no longer load in the acceptance run's `--mode test`: their corner button covered the toggle.
- [x] Verification: 875 web unit tests, `just typecheck`, and the 26 narrow and running-entry Chromium scenarios passed, with a new scenario for the narrow running entry. The full acceptance suite passed on the first version of this change and was not rerun since. Browser screenshots at 390px and 600px checked the idle, running and Settings layouts. `just ui-perf` was not run: it measures at 1440px, where this change renders nothing new.

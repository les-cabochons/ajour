# Progress Tracker

Use this file as a lightweight running checklist for agent work in this repo. Keep it current when a task spans multiple steps or sessions.

## Current Baseline

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
- [x] Backlog status hydration, CRUD, and connector mapping transitions are isolated from browser persistence and have direct domain tests.
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

## Standard Task Flow

- [ ] Understand the requested outcome.
- [ ] Read the relevant existing code and docs.
- [ ] Identify privacy, persistence, and runtime boundaries.
- [ ] Make scoped changes.
- [ ] Run focused verification.
- [ ] Run broader `just` checks when needed.
- [ ] Summarize changed files and verification results.

## Project Health Notes

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

# UI Registry

- Pull request rows live in `features/pull-requests/pull-request-row.tsx`. The list groups Active, Settled and Recently closed items. The expanded sidebar alternates its lists with Backlog and Pull requests tabs, shown only while a code host is enabled. Opening either feature selects its tab; manual switching changes only the sidebar. Backlog keeps Up next, Snoozed and Settled. The pull request panel contains active, unsnoozed items in longest-waiting-first order. E settles locally, B opens the shared snooze picker, Enter opens the summary and the context menu offers Open in the provider. Ctrl/Cmd-click opens the source without changing routes. Navigation and records are hidden while the code host is inactive.

This registry captures reusable visual patterns already present in Ajour. Update it after meaningful UI additions.

## App Shell

- Desktop uses a full-height application sidebar with a quiet translucent surface distinct from the workspace. Only macOS reserves a top chrome strip for native traffic lights. Windows places the sidebar header at the top of the window. The timer dock, then Time, Backlog, Pull requests and Projects, sit below the header, while Settings is anchored at the bottom.
- The application sidebar, `features/layout/app-navigation-sidebar.tsx`, is expanded or hidden; there is no icon rail. Hide sidebar next to the logo, Show sidebar at the start of the titlebar (`SidebarToggleButton`) and Cmd+B (Ctrl+B outside macOS) switch between them. `lib/app-sidebar.ts` owns the state: it saves the choice per device in `localStorage` under `ajour.app-sidebar` (a saved "rail" reads as hidden), and below 1100px it hides the sidebar without changing the saved choice. There the toggle opens it over the page in a left `Sheet`, which closes on navigation. `resolveAppSidebarDisplay` gives "inline", "overlay" or "none". The shell exposes "inline" or "none" as `data-app-sidebar` on `.ajour-app-body`, and sets `--app-sidebar-width` to 0 while it is not inline. Cmd+B lives in the shortcut registry, `lib/shortcuts.ts`, like every other key.
- `features/layout/timer-dock.tsx` owns the running entry's display. `TimerDock` heads the sidebar; `FloatingTimerDock` shows it on one line at the bottom left while the sidebar is not on screen, and beside the narrow view's entry buttons. Both open the running entry editor through one shared open state, `setRunningEntryEditorOpen`, which the titlebar's Start also uses. `RunningEntryWindowTitle` writes it to `document.title`. `summarizeRunningEntry` in `domain/time/running-entry.ts` picks the title, meta line and remaining estimate.
- "?" opens the shortcut overlay, `features/layout/shortcut-overlay.tsx`: a Dialog with a search field that lists every shortcut in the registry, grouped by scope ("Anywhere", "Time page", "Focused row or card"), with alternate keys after "or". Day rows and Week cards carry `data-entry-id` so C can continue the focused entry.
- Day rows, Days cards, Week Grid cells, backlog rows and task rows take keyboard focus. Each carries `data-focus-column` (the day index in the Week, "0" in lists) inside a `data-focus-scope` container, and its `onKeyDown` calls `handleItemKeyDown` from `lib/item-keys.ts`. Arrows move focus within the scope; the item keys in the registry (scope "item") run the action that the kind's `ActionKeys` map names, such as `TIME_ENTRY_ACTION_KEYS`; Alt+Up and Alt+Down call the row's reorder, which commits through `getSharedTableStepOrder` in `lib/table-drag.ts` and the same store command as a drag. ".", Shift+F10 and the context menu key open the "…" menu, or the right-click menu on Grid cells. The menus show each action's key from the same map, and the "…" menu gives focus back to its row on close. Grid cells keep their own Enter and digit editing. Project links in the Projects sidebar take Alt+Up and Alt+Down only. After Delete, focus goes to the next row still on screen, so a backlog item's deleted subitems are skipped.
- Cmd+K (Ctrl+K elsewhere) opens the command palette, `features/command-palette/command-palette.tsx`, and `openCommandPalette()` opens it from buttons such as the Projects list's Search. It lists the focused object's actions, search results across tasks, backlog items and projects, the registry's actions with their keys, and navigation. `command-palette-items.ts` builds and ranks the list. Focus attributes from `lib/focused-object.ts` name the focused object: `data-entry-id` with `data-running-entry`, `data-backlog-item-id`, `data-task-id` and `data-project-id`. Start entry and New entry… run in the palette. New entry… opens the titlebar popover anchored to the object's row while it is on screen, otherwise to the titlebar "+". Other object actions go to their page as `?action=<id>&target=<id>`, which the page runs through `useActionRequest` from `lib/action-request.ts`, so each action keeps one runner. While the Projects page is open, the palette sends every project and task command to it, including opening a project, the archive and Create project, so a task draft is saved first or blocks the command. Items show a disabled reason or hint on a second line, like the "…" menus.
- A pinned task shows its slot as a small key badge, `PinnedSlotBadge` in `features/projects/pinned-slot.tsx`, on its task row and in the project task picker. "Assign shortcut…" opens `PinnedSlotDialog` from the same file: ten slot buttons that name the task holding each slot, a number key picks a slot, and Clear shortcut frees it. The Projects page owns the picker, so the row menus and the palette's `?action=assign-shortcut` open the same one and write at once. The task panel's Shortcut field, `PinnedSlotField`, opens it too but only changes the draft, which Save writes.
- In wide windows Settings opens inside the shell in place of the application sidebar. The shell renders `SettingsNavigation` from `features/settings/settings-navigation.tsx` in the full-height left column, with the shell sidebar classes and the app sidebar's width, under the App, Work and Data group labels from `getSettingsGroups`. Its header holds Back to app, which returns to the last path outside Settings that the shell remembers. `SettingsLayout` renders only the page. The floating timer dock shows meanwhile, sized to the column.
- Projects keeps the application sidebar and adds a permanently expanded 200px project sidebar aligned directly against its right edge, with no collapse control of its own; the project detail pane continues left-to-right from that list rather than centering the split layout.
- Breakpoints live in `lib/breakpoints.ts` only: below 768px is the narrow view, 768px to 1099px hides the app sidebar and makes the Projects list a rail, and 1100px and up follows the saved choice. Scripts use its media queries or `useIsNarrowView` from `lib/use-narrow-view.ts`. Styles use the `narrow`, `desktop` and `forced-rail` Tailwind variants that `lib/tailwind-breakpoints.ts` builds from it, as `@variant narrow { ... }` in CSS or `narrow:` in class names. Do not write width media queries for layout.
- From 768px to 1099px the Projects sidebar is a 48px icon rail at the window's left edge; its links keep accessible names.
- The narrow view renders no sidebars. `features/layout/narrow-titlebar.tsx` puts a segmented Time and Backlog switcher at the start of the titlebar (the active section shows its label) and a Settings cog at the trailing edge. Settings opens on a full-width list of its pages in the same groups: a small tertiary heading per group and 52px rows of icon, label and chevron, with no cards, borders or fills, and `features/layout/narrow-navigation.ts` decides each page's back arrow, shown in a bar under the titlebar. The Settings list's Projects entry opens `/projects` as a full-width project list; project detail, the archive and project import and export (`/settings/projects`) lead back to it.
- Desktop structural surfaces consume the full area beside the application sidebar. Readable Time and Backlog content stays centered in a column capped at 1440px, while their color bands, table backgrounds, and row separators stretch to the workspace edges; individual pages may apply narrower readable inner columns.
- The daily Time view is a continuous page surface rather than an outer card: retain internal day and row separators, but do not draw a perimeter around the combined day strip and entry area. The day strip is a `day-viewer` size container: below 840px its padding tightens, and below 720px, as next to the entry side panel, it drops the seven days and the week total.
- Time and Backlog remove the generic page inset and meet the full workspace edges. Backlog fills the available workspace height and uses full-width internal header/row separators without a rounded outer card.
- The compact titlebar begins beside the application sidebar. Date and new-entry controls remain clear of the native Windows caption-control area.
- Below 768px, Start and Create time entry float together at the bottom right with 44px targets. The floating timer dock replaces Start there. `GlobalTimerBar` keeps one editor and shortcut owner, portals the controls outside the titlebar's backdrop filter, and leaves the daily total in the titlebar. The scroll area reserves bottom space, safe-area insets keep the controls reachable, and narrow toasts sit above them. Wider windows keep the titlebar controls.
- The app menu comes from `apps/desktop/electron/app-menu.cjs`. macOS shows it in the native menu bar. On Windows at 768px and up, `features/layout/app-menu-bar.tsx` draws the same menus at the start of the titlebar with the `components/ui/menubar.tsx` wrapper. Items run once their menu has closed and focus is back on the element the user was in, so Copy and Continue act on it. The narrow view and the web build show no menu bar.

- The sidebar's work list is one scroll, `features/layout/sidebar-backlog-list.tsx`. `selectSidebarBacklogItems` in `domain/backlog/backlog-item-lifecycle.ts` decides which items show and their order. The highlighted Up next row comes first, then the collapsible Backlog section with one-line rows in Comfortable (28px with the estimate, 272px by default) or Compact (26px, 200px) density, the Pull requests section from `sidebar-pull-requests.tsx` (compact `PullRequestRow`s), and the collapsible Snoozed and Settled sections. `SidebarSectionHeader` draws every section label. Rows show a green running marker and a Returned dot; hover and focus swap the type icon for a settle circle and show Start entry, Snooze and "…" in place of the end of the row. `lib/sidebar-layout.ts` saves the density, Up next, the dragged width and each section's state per device under `ajour.sidebar-layout`. The shell sets `--app-sidebar-width` and the centering offset inline from it. `.ajour-sidebar-resize-handle` on the sidebar's right edge resizes it from 200px to 400px, hides the sidebar past the minimum, and resets on double-click.
- Moving a backlog item between workflow states runs through `moveBacklogItemWithUndo` in `features/backlog/backlog-item-moves.ts`, from any surface, and the editor's state field uses it when a done state is involved. Closing or settling a parent with open subitems asks through the one `CloseSubitemsDialogHost` from `features/backlog/close-subitems-dialog.tsx`, mounted in the app shell, unless the Settings > Backlog choice answers. Settings > Workflow (`features/settings/settings-workflow-page.tsx`) lists the workflow states in board order with their Done flag, then the source states and their mapping.
- Every backlog item action runs through `runBacklogItemAction` in `features/backlog/backlog-item-actions.ts`; hosts only run Edit and Add subitem. Snooze… opens the one `SnoozePickerHost` from `features/backlog/snooze-picker.tsx`, mounted in the app shell. `useNow` from `lib/use-now.ts` re-renders views that hide snoozed items, so a snooze ends on its own. `getSettleBehavior` in `features/backlog/settle-dialog.tsx` decides what Settle does. Items whose connector can't settle are settled locally at once. Otherwise the source project's settle rule decides: Ask opens the one `SettleDialogHost`, also mounted in the app shell, and Apply settles with the rule's change. Shift+E (`item.settle-ask`) and Shift-click open the dialog prefilled with the rule, and action menus label Settle "Settle…" when it opens the dialog. Settings > Backlog edits the rules in `features/settings/settle-rules-section.tsx`, and `domain/backlog/settle-rules.ts` owns them. `features/backlog/backlog-source-writes.ts` sends a settle's pending write when its Undo toast closes (`offerUndo`'s `onWindowClosed`) and at launch.
- The backlog item page, `features/backlog/backlog-item-page.tsx` at `/backlog/$itemId`, has an icon tile header with the actions, a state notice, four estimate tiles, a progress bar, then the note, subitems and time entries next to a properties panel. The page root is the focused object, so Enter edits, E settles and B snoozes. Edit opens the backlog item editor in a `SidePanel` over the page, and `?action=edit` or `?action=add-subitem` open it from the sidebar and the palette.

## Surfaces

- Use semantic surfaces from `styles.css`: `--surface-lowest`, `--surface-low`, `--surface`, `--surface-high`, and `--surface-highest`.
- Borders and muted backgrounds carry most hierarchy.
- Shadows are reserved for popovers, dialogs, drag states, and elevated overlays.
- App settings surfaces use `AppPanel` and `SettingRow` from `apps/web/src/components/app-surface.tsx`; neither draws a border or background. Keep `settings-panel` and `settings-row` class ownership inside that module.
- Status, empty, and warning messages use `MessagePanel` from `apps/web/src/components/app-surface.tsx`. Keep `message-panel` class ownership inside that module.
- Icon/title/body callouts use `SurfaceCallout` from `apps/web/src/components/app-surface.tsx`.

## Controls

- Compact controls use 13px sizing and tight radii.
- Popovers handle secondary choices such as calendar selection and compact creation flows.
- Searchable selects are preferred where project/task lists can grow.
- Time-entry project/task selection uses the shadcn command navigator in `features/projects/project-task-picker.tsx`: its default view lists projects only, selecting a project drills into active tasks, and typed task or mixed project/task terms return capped direct matches.
- Toggle groups and tabs are preferred for mutually exclusive local view modes.
- Checkboxes use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx`, backed by Base UI. Use its `indeterminate` prop for mixed selection state instead of mutating DOM refs.
- Connector settings fields are rendered through `apps/web/src/features/settings/connector-settings-ui.tsx`, so plugin-driven field styling stays consistent.
- Immediate on/off settings use `Switch` from `apps/web/src/components/ui/switch.tsx`; labels describe the action as Activate or Deactivate plus the capability name.
- Reorderable tables and navigation lists use `apps/web/src/lib/table-drag.ts` for consistent mouse/touch thresholds, cancellation, row movement, and drag-preview positioning. Its pointer session cancels the drag on Escape and keeps that Escape from closing the panel or dialog behind it. `getSharedTableDropOrder` returns null for a drop where the item started, so nothing is saved. The Week's cross-day drag, `lib/cross-day-entry-drag.ts`, runs on the same session.
- Icon-only buttons use `TooltipButton` from `apps/web/src/components/tooltip-button.tsx`: a `Tooltip` with the button's label and, when a `shortcut` id is given, its key from `lib/shortcuts.ts`, as "Previous day [". It sets `aria-label` and `aria-keyshortcuts`. Pass `render` for a `Button`, a `Link` or a `DropdownMenuTrigger` or `PopoverTrigger`. `ShortcutTooltipLabel` from the same file fills tooltips that other components render, such as the app sidebar's navigation. The Projects sidebar shows its project and Archive tooltips only in the 48px rail.
- Modal surfaces are `Dialog`, `AlertDialog` or `Sheet`; the titlebar totals pill opens its day and week totals in a `Popover`.
- Creating and editing a time entry use one form, `features/time/time-entry-editor-form.tsx`: header with title, date, "…" and ×; Project / task, Note, Hours, Date (`time-entry-fields.tsx`); footer Cancel · Start (Switch while another entry runs, Continue on a saved entry, Stop on the running entry) · Save. Day and Week host it in `components/side-panel.tsx`, a panel docked on the right that keeps the page clickable and returns focus to the row or card on close. Clicking another entry saves a valid draft first; an invalid draft blocks the switch. In the narrow view, below 768px, `features/timer/time-entry-modal.tsx` hosts the same form in a dialog that spans the window, less an 8px margin on each side. The titlebar "+" and the timer dock host it in `features/time/time-entry-editor-popover.tsx`, a popover anchored to them that ignores outside clicks. Its `anchor` prop moves the popover to another element and gives focus back to it on close. Entry actions come from `domain/actions/object-actions.ts` and render through `components/object-actions-menu.tsx` as a right-click menu and a "…" button.
- Delete entry, Discard running entry, Move to…, cross-day drag and Duplicate to… another day act at once and show an Undo toast for 8 seconds instead of a confirmation. `components/ui/toast.tsx` wraps the Base UI toast: `Toaster` is mounted once in `main.tsx`, bottom right, bottom center below 768px, at most three, newest on top. `showUndoToast` keeps one Undo toast open, and Cmd+Z (Ctrl+Z) presses it when focus is not in a text field. Time entry actions call it through `offerTimeEntryUndo` in `features/time/time-entry-actions.tsx`.
- Projects: "New project" in the project list header and Edit open `features/projects/project-form-dialog.tsx`, a standard `Dialog` that ignores outside clicks. Tasks open in `features/projects/project-task-editor-form.tsx` with the entry editor's Save and Escape rules, hosted in `components/side-panel.tsx`, or a full-width dialog in the narrow view. "New task" sits in the project header; "Import tasks…" is in the project header's "…" menu only.
- Projects, tasks and backlog items use the same pattern. Project rows in the project sidebar, the archived list and the project header; task rows; and backlog rows and the backlog item editor all show their kind's action set. Archive and Restore act at once. Backlog Delete asks for confirmation and states the subitem count.
- Backlog has a grouped list and board with shared state and priority pickers. `features/backlog/backlog-page.tsx` owns the view, `backlog-display.tsx` owns Display and filters, and `backlog-item-surface.tsx` owns rows and cards. Clicking opens `backlog-peek.tsx` in the right panel. Edit replaces it with `backlog-item-editor-form.tsx`, with explicit Save and discard returning to peek. Narrow windows show only the list and use the existing full-width editing dialog. Display preferences remain device-local and ordering stays shared with the sidebar. Archive lives in the header options menu. The detailed interaction contract is in `agents/ux-spec.md`.
- Logging time from a task or backlog item goes through New entry…. Its row menus, the right-click menu and the palette call `openNewEntryEditor` from `features/time/new-entry-request.ts`. The titlebar's popover opens with the task, and for a backlog item the work item link and note, filled in and Date on today. It anchors to the object's row while any of it shows on screen (`pickOnScreenAnchor`), otherwise to the titlebar "+". The narrow view opens the dialog instead. The backlog has no inline hours field. Backlog rows keep the play button as the Start entry shortcut.
- The narrow view always shows the "…" on task and backlog rows. The 48px project rail hides it; right-click on the rail and the project header "…" cover projects there.
- On touch screens, a long press on any row or card with an action set opens the same menu as right-click. Base UI's `ContextMenu.Trigger` handles the press (500ms, cancelled by a 10px move); styles.css turns off text selection on those elements for coarse pointers so iOS does not start a selection on the same gesture.
- In the narrow view, Backlog keeps Display and filter chips in its header and shows an icon-only floating New backlog item action at the bottom right. Reserve scroll space and safe-area padding for it.

## Icons

- The app uses `@remixicon/react`.
- Common navigation and action icons include timer, backlog/list, folder/project, settings, plus, check, close, play, stop, and chevrons.
- Project icon persistence and normalization live in `apps/web/src/domain/projects/project-icon.ts`; React rendering and uploaded-image preparation live in `apps/web/src/lib/project-icons.tsx`.

## Typography

- Body text uses Raleway Variable.
- Heading moments use Noto Serif Variable where the existing design calls for more editorial weight.
- Dense app panels should keep headings small and direct.

## Empty And Loading States

- Use existing UI primitives for skeletons and empty states.
- Lazy routes in `router.tsx` load inside `RouteSuspense`, whose fallback is `PageSkeleton` from `apps/web/src/components/page-skeleton.tsx`: a header and six rows of `Skeleton` blocks. It renders nothing for the first 150ms, so fast loads do not flash.
- Empty states should tell the user what is missing and provide the next action when there is one.
- Loading states should preserve layout dimensions.

### Plugin Catalog And Detail

Files: `apps/web/src/features/settings/settings-connectors-page.tsx`, `plugin-catalog-ui.tsx`, `connector-settings-ui.tsx`
Last updated: 2026-10-13

| Property         | Class or token                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Background       | none; catalog rows tint `--hover-bg` on hover                                                     |
| Border           | none on entries, connections, forms or lists; only the identity mark tile keeps its border        |
| Border radius    | `rounded-lg` for the identity mark, hero image and row hover; `--control-radius` for focus        |
| Text — title     | `settings-section-title` for sections; `text-lg font-semibold` for the page and plugin name       |
| Text — label     | `text-sm font-medium text-foreground` for entry, feature and connection names                     |
| Text — secondary | `text-[13px] text-muted-foreground` for descriptions and connection status                        |
| Text — meta      | `text-xs text-[var(--text-tertiary)]` for capabilities, version, config summary and last sync     |
| Spacing          | `settings-sections` between sections; `gap-1` catalog rows, `gap-6` connections, `gap-4` features |
| Hover state      | `hover:bg-[var(--hover-bg)]` on catalog rows                                                      |
| Shadow           | none                                                                                              |
| Accent usage     | `Badge variant="secondary"` for installed and active state; status colors only for errors         |

**Pattern notes:**
The catalog page carries no cards. The header holds the page title, Install
from file, and two `SettingRow`s: the Plugin system switch and the Refresh
catalog select. Below it the category tabs (All, Connectors, Code hosts,
Schemas) sit over a single-column list of plain rows: identity mark, name with
a status badge, a two-line description, and a meta line with capabilities and
version, such as "Connector · Code host · v1.2.0". The trailing action is the
activation `Switch` for an installed connector, or Download for an available
remote connector or code host. Rows are separated by spacing and only tint on
hover. Catalog entries merge normalized Ajour-index metadata with installed
connector and schema capabilities; a plugin with several capabilities appears
under each tab. The filter tabs use compact spacing below 768px so all four
fit at 320px. Only an installed plugin can be activated. Manual file
installation remains a separate action.

Opening an entry moves to a dedicated detail route, a cardless page of
sections. Its first section holds the back link, identity-first header,
status-driven primary action, status badges, any notices (`MessagePanel`),
and the capability band. Features, Information, Configuration and Uninstall
plugin follow as `settings-section`s. Features and Information are spaced
lists with no dividers. Configuration lists connections as plain rows (name,
sync-mode badge, tenant, status line, meta lines, then Edit, Sync and Remove
trailing on desktop and below on narrow widths); the connection form renders
unframed above them, and empty lists show plain text. Cached catalog artwork
is optional: the identity mark supplies a consistent generated default
thumbnail, and the hero image keeps rounded corners with no border. Without a
hero, the capability band is a plain line of text ("External service → Plugin
→ Local backlog") above the feature badges. Never fetch remote images from the
renderer. Dialogs and `MessagePanel` notices are the only framed surfaces.

### Application Updates

File: `apps/web/src/features/settings/settings-general-page.tsx`
Last updated: 2026-08-06

The stable/nightly choice is a `SettingRow` with the shared outline toggle
group. Keep exactly one track selected and explain nightly risk in the row's
description. Repository status follows below it, separated by space only. Status text uses `aria-live`, preserves its layout while checking,
and shows the release action only when a newer matching release exists. Web-only
rendering keeps the preference available but identifies the desktop requirement.
Packaged Windows builds download the selected track in the background and use a
native restart confirmation only after the update is ready; the app never
restarts without the user's confirmation. Other platforms show truthful manual
update guidance while preserving the same release-track status and link.

### Weekly Time Overview

Files: `apps/web/src/features/time/weekly-time-view.tsx`, `apps/web/src/features/time/week-grid.tsx`, `apps/web/src/features/time/week-grid-cell-panel.tsx`, `apps/web/src/features/time/time-entry-fields.tsx`
Last updated: 2026-10-11

Day remains the default, timer-first time surface. The date heading exposes a
compact anchored scope menu with `Day` and `Week` at desktop widths of 768px
and above. The narrow view has no scope menu. A Week link there (`?view=week`)
shows Day with a note that Week needs a wider window, and keeps `view=week`, so
widening the window shows Week.
Week offers Grid and Days through the shared toggle group,
with the preference persisted locally as `grid` or `days`. Grid aggregates project/task time by
day and shows project markers and daily totals. A click on a Grid cell opens it
in the side panel: a new entry for an empty cell, the entry of a one-entry cell
with "Add another entry for <day>", or the list of a cell with several entries
(`week-grid-cell-panel.tsx`). Double-click, Enter or a digit edits an empty or
one-entry cell in place; the typed-cell rules live in `domain/time/week-grid-cell.ts`.
A cell with several entries shows "3:30 ×2" and never edits in place. "+ Add row"
adds an empty row for the week, never saved on its own. Days use seven
equal-height headers, restrained weekend/today cues, and a project-color rail
on each entry card. Cards drag between days with thresholded pointer dragging,
explicit weekday drop targets, and Escape/pointer-cancel cleanup. A click or
Enter on a card opens it in the side panel. Running entries stay locked. Normal headers show logged totals only;
capacity target and utilization live in hover cards, with an optional compact
over-target warning.

The Week toolbar, grid or day columns, and totals form one full-width
desktop workspace rather than stacked cards. Return to Day is the leading
left-arrow action. Every time entry surface (Day rows, Days cards, Grid cells,
the Grid cell list and the entry form) exposes the same action set through a
right-click menu and a "…" button, which the narrow view always shows. Duplicate
to and Move to open a calendar dialog; Delete and Discard happen at once and show an Undo toast.
`features/time/time-entry-actions.tsx` runs the actions for every surface.

Capacity targets and the two independent warning switches live in General
Settings. Targets are Monday-first, default to eight hours on weekdays and zero
on weekends, and remain local user preferences.

### Submit Page

Files: `apps/web/src/features/time/submit-page.tsx`, `apps/web/src/features/time/submit-week-controls.tsx`

Route `/time/$date/submit` shows the week that holds `$date`. The
titlebar totals popover opens it with the shared `SubmitWeekButton` at every width. Totals and submission follow the selected date, including historical weeks. The action saves valid entry drafts and keeps invalid drafts open through the Time page's action request handler. The Week
header shows `WeekSubmittedBadge` once every entry is submitted. The page has a
summary (total against target, progress bar, warnings, result in place) and the
lines grouped by Day and task, Day or Task. Every value copies on click with an
always-visible icon; hours copy as decimals. Grouping, selection, summary and
status rules live in `domain/time/timesheet-submission.ts`. Submitting below the
week target asks for confirmation.

### Project Import And Export

File: `apps/web/src/features/settings/settings-projects-page.tsx`
Last updated: 2026-10-13

The Projects settings workflow separates the schema selector from the Excel
format actions. `Ajour default` is always the first option and remains usable
without the plugin host. Discovered plugins add provider-specific schemas; the
selection persists in user preferences. Export and import copy identifies the
active schema and explains that the schema controls fields while Ajour owns
the file format. The schema, export and import are three cardless sections of
`SettingRow`s; projects to export are plain checkbox rows, and a finished
transfer is a line of text under its action. Time entry import and export
(`settings-export-page.tsx`) follows the same layout, with staged import drafts
as plain rows that carry Add and Dismiss.

# UI Registry

- Pull request rows live in `features/pull-requests/pull-request-row.tsx`. The list groups Active, Settled and Recently closed items. The sidebar work list shows them as a collapsible Pull requests section, only while a code host is enabled, between the Backlog section and Snoozed: active, unsnoozed items in longest-waiting-first order, as one-line compact rows. E settles locally, B opens the shared snooze picker, Enter opens the summary and the context menu offers Open in the provider. Ctrl/Cmd-click opens the source without changing routes. Navigation and records are hidden while the code host is inactive.

This registry captures reusable visual patterns already present in Ajour. Update it after meaningful UI additions.

## Foundation

The redesign direction decided on 2026-10-14: Linear's density and structure, Vercel's restraint in color. These are the shared patterns every page is built from. Pages that still carry their own styles migrate to them one area at a time (Time, Backlog, Projects, Settings).

- **Top bar and page header.** The 48px bar is the page header. `PageHeader` in `components/page-header.tsx` renders a `title` or a `breadcrumb` and `actions` into the bar through a portal; an optional muted `backLink` renders in the page content above the object title; `lib/page-header.ts` owns the slot. Until a page mounts one, the shell shows the route's default title, and on Time the selected day as a calendar trigger with a "Today" chip. On Windows the menus sit at the bar's left, then a hairline, then the title. The bar's right end holds the day total as plain text (`.ajour-nav-total`): "Today" and the value on today, the value alone on another day. Its popover shows the week and day totals and has no actions.
- **Chip.** `components/ui/chip.tsx`: 20px, 4px corners, 12px medium, neutral by default, with a `color` dot for projects and workflow states. The only metadata treatment.
- **Value, Figure, FigureRow.** `components/ui/value.tsx`: every duration, total, count and id in mono tabular figures. `Figure` is a 12px label over a 16px value; a `FigureRow` replaces stat cards.
- **SectionHeading.** `components/section-heading.tsx`: 12px medium muted, with a trailing count or total, heading every cardless section.
- **PropertyList.** `components/property-list.tsx`: label and value pairs in a two-column grid with 28px rows, replacing boxed side panels on detail pages.
- **Empty.** `components/ui/empty.tsx`: a 13px title, a 12px line and at most one outline button; `align="start"` in lists, centered on empty pages.
- **Buttons.** `xs` 20px, `sm` 24px, default 28px, `lg` 32px; `icon-xs`, `icon-sm`, `icon`, `icon-lg` likewise. Primary is the accent indigo. Inputs and selects are 32px with 4px corners.
- **Sidebar.** Solid surface one step below the content (above it in dark), no blur, a header as tall as the titlebar with Hide sidebar, an 18px mark and a 14px semibold wordmark (left padding clears the macOS traffic lights), the view switcher (`features/layout/sidebar-view-switcher.tsx`, the open view's icon and name opening a dropdown of link items with mono counts and a check on the open view) with Search and the filter menu (`features/layout/sidebar-search.tsx`: Search expands into a search box; the filter is a `Popover` with a `Command` project list and a Custom or Priority `ToggleGroup` beside its search box; `domain/backlog/sidebar-filter.ts` decides which rows match), the timer dock as a flat bordered block, a fixed footer with Settings and selected-week Commit icons on the left and the desktop update control on the right. The footer lives in `features/layout/sidebar-footer.tsx`. Returned pull requests show a filled accent count in the switcher's menu.
- **Capture and budgets.** `just ui-capture` screenshots every surface into `qa/ui/out`; `just ui-perf` prints the renderer budgets on the 600-item workspace. See `qa/routines/ui-capture.md`.

## App Shell

- Desktop uses a full-height application sidebar with a quiet translucent surface distinct from the workspace. Only macOS reserves a top chrome strip for native traffic lights. Windows places the sidebar header at the top of the window. The timer dock, then Time, Backlog, Pull requests and Projects, sit below the header. The foot is one row of icon-only buttons with tooltips: Settings (`app.settings` shortcut) and Commit week (`CommitWeekButton` in `features/time/commit-week-button.tsx`, `RiCalendarCheckLine`, tooltip "Commit") at the left, and desktop updates at the right. The sidebar has no rail state, so the foot has no collapsed layout. While the sidebar is hidden in a wide window on a Time page, the top bar shows the same `CommitWeekButton` right after Show sidebar. Other pages, Settings included, show no Commit button while the sidebar is hidden.
- The application sidebar, `features/layout/app-navigation-sidebar.tsx`, is expanded or hidden; there is no icon rail. Hide sidebar next to the logo, Show sidebar at the start of the titlebar (`SidebarToggleButton`) and Cmd+B (Ctrl+B outside macOS) switch between them. `lib/app-sidebar.ts` owns the state: it saves the choice per device in `localStorage` under `ajour.app-sidebar` (a saved "rail" reads as hidden), and the sidebar follows that choice at every desktop width, beside the page. The shell exposes "inline" or "none" as `data-app-sidebar` on `.ajour-app-body`, and sets `--app-sidebar-width` to 0 while it is not inline. Cmd+B lives in the shortcut registry, `lib/shortcuts.ts`, like every other key.
- `features/layout/timer-dock.tsx` owns the running entry's display. `TimerDock` heads the sidebar. While idle, it shows "+" (`NewEntryButton`, "Create time entry"), Start for an empty entry and today's total at the right on one line, with no suggested backlog item. While an entry runs, "+" sits before Stop. The "+" at the right of the sidebar's view-switcher row, after Search and the filter menu, is New backlog item: it navigates to `/backlog?action=create`, and the Backlog page opens its editor through `useActionRequest`. `FloatingTimerDock` shows the running entry on one line at the bottom left while the sidebar is not on screen, and not in the narrow view, where the totals pill carries the running time. Both open the running entry editor through one shared open state, `setRunningEntryEditorOpen`, which `startBlankEntry` also uses after it starts an empty entry from the sidebar's or the floating dock's Start. `RunningEntryWindowTitle` writes it to `document.title`. `summarizeRunningEntry` in `domain/time/running-entry.ts` picks the title, meta line and remaining estimate.
- "?" opens the shortcut overlay, `features/layout/shortcut-overlay.tsx`: a Dialog with a search field that lists every shortcut in the registry, grouped by scope ("Anywhere", "Time page", "Focused row or card"), with alternate keys after "or". Day rows and Week cards carry `data-entry-id` so C can continue the focused entry.
- Day rows, Days cards, Week Grid cells, backlog rows and task rows take keyboard focus. Each carries `data-focus-column` (the day index in the Week, "0" in lists) inside a `data-focus-scope` container, and its `onKeyDown` calls `handleItemKeyDown` from `lib/item-keys.ts`. Arrows move focus within the scope; the item keys in the registry (scope "item") run the action that the kind's `ActionKeys` map names, such as `TIME_ENTRY_ACTION_KEYS`; Alt+Up and Alt+Down call the row's reorder, which commits through `getSharedTableStepOrder` in `lib/table-drag.ts` and the same store command as a drag. ".", Shift+F10 and the context menu key open the "…" menu, or the right-click menu on rows without one, such as time entry rows, cards and Grid cells. The menus show each action's key from the same map, and the "…" menu gives focus back to its row on close. Grid cells keep their own Enter and digit editing. Project rows in the Projects list take Alt+Up and Alt+Down only. After Delete, focus goes to the next row still on screen, so a backlog item's deleted subitems are skipped.
- Cmd+K (Ctrl+K elsewhere) opens the command palette, `features/command-palette/command-palette.tsx`. No button opens it. It lists the focused object's actions, search results across tasks, backlog items and projects, the registry's actions with their keys, and navigation. `command-palette-items.ts` builds and ranks the list. Focus attributes from `lib/focused-object.ts` name the focused object: `data-entry-id` with `data-running-entry`, `data-backlog-item-id`, `data-task-id` and `data-project-id`. Start entry and New entry… run in the palette. New entry… opens the titlebar popover anchored to the object's row while it is on screen, otherwise to the titlebar's totals. Other object actions go to their page as `?action=<id>&target=<id>`, which the page runs through `useActionRequest` from `lib/action-request.ts`, so each action keeps one runner. While the Projects page is open, the palette sends every project and task command to it, including opening a project, the archive and Create project, so a task draft is saved first or blocks the command. Items show a disabled reason or hint on a second line, like the "…" menus, except an item a submitted week locks, which says why as a toast when chosen.
- A pinned task shows its slot as a small key badge, `PinnedSlotBadge` in `features/projects/pinned-slot.tsx`, on its task row and in the project task picker. "Assign shortcut…" opens `PinnedSlotDialog` from the same file: ten slot buttons that name the task holding each slot, a number key picks a slot, and Clear shortcut frees it. The Projects page owns the picker, so the row menus and the palette's `?action=assign-shortcut` open the same one and write at once. The task panel's Shortcut field, `PinnedSlotField`, opens it too but only changes the draft, which Save writes.
- In wide windows Settings opens inside the shell in place of the application sidebar. The shell renders `SettingsNavigation` from `features/settings/settings-navigation.tsx` in the full-height left column, with the shell sidebar classes and the app sidebar's width, under the App, Work and Data group labels from `getSettingsGroups`. Its header holds Back to app, which returns to the last path outside Settings that the shell remembers. `SettingsLayout` renders only the page. The floating timer dock shows meanwhile, sized to the column.
- Projects has no column of its own. `/projects` is a list page like the Backlog: no top bar title, with "…" (Import and export…) and the primary "New project" in the top bar, a 40px filter row with an Active | Archived toggle (the archive is `/projects/archive`), then 36px rows: icon, name, code `Chip`, active task count, this week's hours as a mono `Value`, the budget as a 3px bar with its percent (or "No budget"), and a hover "…". Active projects reorder by dragging rows or Alt+Up and Alt+Down; a row opens the project. Its styles live in `apps/web/src/styles/projects.css`.
- The project page, `features/projects/projects-page.tsx` at `/projects/$projectId`, has no top bar actions and no "…" menu. A subtle "Back to Projects" link with a back arrow sits above the project name in the content. The content follows the backlog item page: the 20px title with its icon and code `Chip`, a `FigureRow` (This week, All time, then Budget, Used and Remaining when its active tasks carry budgets, else Active tasks) over a 3px budget bar, notices, then Tasks | Time entries tabs beside the Properties card, `ProjectPropertiesCard` in `features/projects/project-properties.tsx`, which stacks under them in the narrow view. The title and the card's fields edit in place through `getProjectPatch` in `project-form.ts` and `localStore.updateProjectWithUndo`; the icon picker is `ProjectIconField`, shared with the project form. Tasks has the Active | Archived toggle and 36px rows (name, pinned slot, billable `Chip`, hover "…", a budget bar with "consumed / budget" or the consumed hours as a toned mono `Value`), then a ghost "New task" row. Time entries lists the project's entries newest first under a `SectionHeading` per day with the day's total; each row links to its day. The project form's color is `components/ui/color-field.tsx`, a swatch that opens a preset palette and a hex input, never the browser's color control. Plugins with `projectProperties` add a collapsed section each (`PluginPropertySection` in `features/projects/project-properties.tsx`), with rules in `domain/projects/plugin-properties.ts`.
- Breakpoints live in `lib/breakpoints.ts` only: below 768px is the narrow view, and 768px and up follows the saved sidebar choice. Scripts use its media queries or `useIsNarrowView` from `lib/use-narrow-view.ts`. Styles use the `narrow` and `desktop` Tailwind variants that `lib/tailwind-breakpoints.ts` builds from it, as `@variant narrow { ... }` in CSS or `narrow:` in class names. Do not write width media queries for layout.
- Settings: the pages are sections of a 13px title, a muted description and `SettingRow`s (label and description leading, the control trailing, or stacked for wide controls), without panels. Their styles live in `apps/web/src/styles/settings.css`. Workflow states save on blur when the name changed (Enter blurs) and at once when the color or Done changes; there is no Save button. In the web build the plugin catalog notice is informational, not a warning.
- The narrow view renders no sidebars. `features/layout/narrow-titlebar.tsx` owns `NarrowSectionSwitcher`, a segmented Time, Backlog and Settings toggle fixed at the bottom left (the active section shows its label). A hairline, then Commit week (icon only, never active) end the toggle, away from the titlebar's "+" and Start. Settings stays active on Projects pages. Settings opens on a full-width list of its pages in the same groups: a small tertiary heading per group and 52px rows of icon, label and chevron, with no cards, borders or fills, and `features/layout/narrow-navigation.ts` decides each page's back arrow, shown in a bar under the titlebar. The Settings list's Projects entry opens `/projects` as a full-width project list; project detail, the archive and project import and export (`/settings/projects`) lead back to it.
- Desktop structural surfaces consume the full area beside the application sidebar. Time and Backlog remove the generic page inset and meet the full workspace edges; Backlog fills the available workspace height. Each page area owns a stylesheet under `apps/web/src/styles/` (`time.css`, `backlog.css`), imported at the top of `styles.css`; page files use the plain `(width < 768px)` media query for the narrow view because the breakpoint plugin registers its variants after the imports are inlined.
- The Time pages put their header in the top bar through `features/time/time-page-header.tsx`: previous and next, the day as a calendar trigger (`features/time/time-date-picker.tsx`, which the shell's default title and the narrow titlebar also use) or the week's range, a Today chip or the way back to today, then Day | Week. Under it the Day view shows `features/time/day-strip.tsx`, a 56px row of seven day tabs with their totals and the week total, then one-line 40px rows (`time-entry-row` in `features/timer/timer-panel.tsx`: dot, project, task, note, hover actions, the duration as a `Value`), and a quiet "New entry" row at the end.
- The top bar begins beside the application sidebar. Its controls remain clear of the native Windows caption-control area.
- Below 768px, `GlobalTimerBar` puts Create time entry and Start before the totals pill, and Start turns into Stop while an entry runs. `DayTotalsPill` with `showsRunningEntry` shows the running time instead of the day total and adds a Current timer row to its popover. On an outside click, `TimeEntryModal` saves the running entry's valid draft through the form's `commitBeforeSwitch` and closes; the other entries ignore it. It keeps one editor and shortcut owner. The scroll area reserves `--narrow-nav-clearance` under the content for the floating toggle, safe-area insets keep it reachable, narrow toasts sit above it, and the agent indicator sits on its row at the bottom right.
- The app menu comes from `apps/desktop/electron/app-menu.cjs`. macOS shows it in the native menu bar. Windows shows no menu bar for now, because `showWindowsMenuBar` in `features/layout/app-menu-bar.tsx` is off. When it is on, Windows at 768px and up draws the same menus at the start of the titlebar with the `components/ui/menubar.tsx` wrapper. Items run once their menu has closed and focus is back on the element the user was in, so Copy and Continue act on it. The narrow view and the web build show no menu bar.

- The sidebar's work list is one scroll, `features/layout/sidebar-backlog-list.tsx`. `selectSidebarBacklogItems` in `domain/backlog/backlog-item-lifecycle.ts` decides which items show and their order. The backlog items come first, pinned ones on top, with no header (empty sections never show), in `ComfortableItemRow`s (80px, three lines: project icon and name with the remaining estimate at 13px, the title at 14px, then a faint workflow state and, on a subitem, an arrow that opens the parent; 272px by default) or Compact `BacklogItemRow`s (26px, one line; 200px), the Pull requests section from `sidebar-pull-requests.tsx` (compact `PullRequestRow`s, only while pull requests need the user), and the collapsible Snoozed and Settled sections. `SidebarSectionHeader` draws every section label. Rows show a green running marker and a Returned dot; hover and focus show Start entry centered at a Comfortable row's end and Snooze and Settle at the end of its project line, and in Compact swap the type icon for a settle circle and show Start entry and Snooze at the end of the row. The rows have no "…" button; right-click and the menu keys open the action set. Resting the mouse on a row shows `BacklogItemHoverCard` from `features/backlog/backlog-item-hover-card.tsx` beside it: one card for the whole list, a `HoverCard` anchored to the row, fed by `summarizeBacklogItem` in `domain/backlog/backlog-item-summary.ts`. `useRowHoverCard` in `lib/row-hover-card.ts` listens on the list itself, so the rows mount nothing for it. Under Custom ordering, rows reorder by drag or Alt+Up and Alt+Down through `useBacklogDrag`, within their block: `splitSidebarBacklogItems` keeps pinned rows apart from the rest, and `canReorderSidebarItem` leaves subitems in place. `lib/sidebar-layout.ts` saves the density, the dragged width and each section's state per device under `ajour.sidebar-layout`. The shell sets `--app-sidebar-width` and the centering offset inline from it. `.ajour-sidebar-resize-handle` on the sidebar's right edge resizes it from 200px to 400px, hides the sidebar past the minimum, and resets on double-click.
- Moving a backlog item between workflow states runs through `moveBacklogItemWithUndo` in `features/backlog/backlog-item-moves.ts`, from any surface, and the editor's state field uses it when a done state is involved. Closing or settling a parent with open subitems asks through the one `CloseSubitemsDialogHost` from `features/backlog/close-subitems-dialog.tsx`, mounted in the app shell, unless the Settings > Backlog choice answers. Settings > Workflow (`features/settings/settings-workflow-page.tsx`) lists the workflow states in board order with their Done flag, then the source states and their mapping.
- Every backlog item action runs through `runBacklogItemAction` in `features/backlog/backlog-item-actions.ts`; hosts only run Edit and Add subitem. Snooze… opens the one `SnoozePickerHost` from `features/backlog/snooze-picker.tsx`, mounted in the app shell. `useNow` from `lib/use-now.ts` re-renders views that hide snoozed items, so a snooze ends on its own. `getSettleBehavior` in `features/backlog/settle-dialog.tsx` decides what Settle does. Items whose backlog plugin can't settle are settled locally at once. Otherwise the source project's settle rule decides: Ask opens the one `SettleDialogHost`, also mounted in the app shell, and Apply settles with the rule's change. Shift+E (`item.settle-ask`) and Shift-click open the dialog prefilled with the rule, and action menus label Settle "Settle…" when it opens the dialog. Settings > Backlog edits the rules in `features/settings/settle-rules-section.tsx`, and `domain/backlog/settle-rules.ts` owns them. Settings > Calendar (`features/settings/settings-calendar-page.tsx`), listed under Work only while a calendar plugin is on, holds the suggestion filters, the refresh interval and the Remembered meetings list, whose Remove offers Undo. Its copy says remembered and hidden meetings, never rule. `features/backlog/backlog-source-writes.ts` sends a settle's pending write when its Undo toast closes (`offerUndo`'s `onWindowClosed`) and at launch.
- The backlog item page, `features/backlog/backlog-item-page.tsx` at `/backlog/$itemId`, puts a "<project> / <title>" breadcrumb (the project's icon and name, linking to its page, or "Backlog" without a project) and the item's actions in the top bar, then a subtle "Back to Backlog" link with a back arrow above the 20px title with type and project chips, a state notice, the estimates as a `FigureRow` over a 3px progress bar, and the description (rendered as markdown) beside a column of `backlog-item-card`s on `--surface-tint` under a hairline border: the properties, then the Subitems and Time entries cards from `backlog-item-side-cards.tsx`. Each of those has a chevron title that opens or closes it and a + at its top right, a `TooltipButton` (Add subitem opens the card on the name field until it closes, without saving it open, and Escape gives focus back to the page; Add time entry opens the new entry popover on the +). They start closed on a summary: a 3px segment per subitem, filled when done (one bar past ten), and the hours left, or the entry count and the last day. The counts come from `getSubitemProgress` and `getSubitemHoursLeft` in `domain/backlog/backlog-view.ts`. `lib/backlog-item-cards.ts` saves which are open per device. Open, they list `backlog-item-row`s. The page edits in place (`backlog-item-inline-edit.tsx`): click the title or an estimate to type, and the description's subtle Edit swaps the markdown for `MarkdownEditor` (⌘/Ctrl+Enter or blur saves). Each saves on Enter or blur with the Undo toast; Escape cancels. The card's rows come from `BacklogItemProperties`, shared with the peek, plus Source, and Archive at the bottom of the card for synced items, as a `PropertyAction` tile from `components/property-list.tsx`: a borderless 20px icon over a muted label that brightens on hover. The shared rows end with When missing for synced items, a ghost menu of Archive and Keep under a "When missing from sync" label, so the peek has it too.
- The item page and the peek render a description without its frontmatter: `splitDescription` from `domain/backlog/description-frontmatter.ts` returns the body for `Markdown` and the fields as a tree. `BacklogItemProperties` shows the fields through `features/backlog/frontmatter-properties.tsx`: `FrontmatterRows` adds plain values as rows of its `PropertyList`, and `FrontmatterSections` follows with a closed section per list or nested key, each a `PropertySection` from `components/property-list.tsx`, the collapsible section the project page's plugin properties also use. `lib/frontmatter-sections.ts` keeps which sections are open per device, by key path. The description text renders through `DescriptionText` from `features/backlog/description-links.tsx`, which listens for clicks on its web links; it and the field links ask through `useLinkQuestion`'s `AlertDialog`, one per card, while `asksBeforeOpeningDescriptionLinks` from `domain/local-state.ts` is true, then open with `openSourceUrl`. `TimelogButton` in `features/backlog/timelog-button.tsx` follows the Project picker in `BacklogItemProperties` while `getTimelogMismatch` from `domain/backlog/description-timelog.ts` finds a difference: an amber warning with an `AlertDialog` for a missing project or task, or a muted back arrow that applies at once. An archived item, read-only until Restore, shows none. Both call `localStore.applyTimelogWithUndo`. The store applies a changed timelog in `updateWorkItem`, `updateWorkItemWithUndo`, `addWorkItem` and `importSyncedWorkItems` through `applyDescriptionTimelogs`.
- The Backlog page puts its actions (layout toggle, Display) in the top bar without a repeated title or count. A 40px filter row follows, with a Filter button that uses the sidebar's filter icon. It lists the fields, then the picked field's values as a checkable `Command` list that stays open. Each filtered field is one chip ("State To do, In progress"): the chip opens the same list and its × removes the field. Values of one field match any, fields must all match. The State filter's Archived value lists every archived item, including those that left the sync. then 32px sticky group headers, each with a + that adds an item to that group, and 36px list rows with fixed leading columns (priority, id, state, type) so titles align whether or not an item has an id; the project is a `Chip` and the estimate a mono value at the row's end. An ungrouped list or board has no header, so it ends with a "New backlog item" row instead. Board columns sit on a faint `--highlight-bg` tint and board cards are flat 6px `--surface` cards above it. The Display popover's choices are shadcn `Select`s. The pull request pages follow the same anatomy: title and Sync in the bar, `SectionHeading`s over rows, a subtle back link and `PropertyList` on the detail page. The Backlog page root is the focused object, so Enter edits, E settles and B snoozes. Edit opens the backlog item editor in a `SidePanel` over the Backlog page. On the item page there is no editor or "…" menu: Enter and `?action=edit` start renaming the title, and `?action=add-subitem` opens the subitem name field.

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
- A choice among a few options is `components/ui/option-select.tsx` (`OptionSelect`: a 28px or 32px trigger over a menu of items, with optional groups); the browser's `<select>` is not used. Dates are `components/ui/date-field.tsx`, colors `components/ui/color-field.tsx`, files `components/ui/file-field.tsx` (an outline "Choose file…" button and the chosen name over a visually hidden input). Searchable selects are preferred where project/task lists can grow.
- Time-entry project/task selection uses the shadcn command navigator in `features/projects/project-task-picker.tsx`: its start view lists Favorites, Recent tasks (`domain/projects/recent-tasks.ts`), then All projects; selecting a project drills into active tasks, "N more favorites" and "More recent tasks" open their pages, and typed task or mixed project/task terms return capped direct matches. Its one-line rows, the favorite star and the "more" row live in `features/projects/project-task-picker-rows.tsx`, and its hover card, which also follows the arrow keys, in `features/projects/project-task-picker-card.tsx` on top of `lib/row-hover-card.ts`.
- Toggle groups and tabs are preferred for mutually exclusive local view modes.
- Checkboxes use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx`, backed by Base UI. Use its `indeterminate` prop for mixed selection state instead of mutating DOM refs.
- Plugin settings fields are rendered through `apps/web/src/features/settings/plugin-settings-ui.tsx`, so plugin-driven field styling stays consistent.
- Immediate on/off settings use `Switch` from `apps/web/src/components/ui/switch.tsx`; labels describe the action as Activate or Deactivate plus the capability name.
- Reorderable tables and navigation lists use `apps/web/src/lib/table-drag.ts` for consistent mouse/touch thresholds, cancellation, row movement, and drag-preview positioning. Its pointer session cancels the drag on Escape and keeps that Escape from closing the panel or dialog behind it. `getSharedTableDropOrder` returns null for a drop where the item started, so nothing is saved. The Week's cross-day drag, `lib/cross-day-entry-drag.ts`, runs on the same session.
- Icon-only buttons use `TooltipButton` from `apps/web/src/components/tooltip-button.tsx`: a `Tooltip` with the button's label and, when a `shortcut` id is given, its key from `lib/shortcuts.ts`, as "Previous day [". It sets `aria-label` and `aria-keyshortcuts`. Pass `render` for a `Button`, a `Link` or a `DropdownMenuTrigger` or `PopoverTrigger`. `ShortcutTooltipLabel` from the same file fills tooltips that other components render, such as the app sidebar's navigation.
- **Disabled reason.** `components/disabled-reason.tsx` wraps a disabled control in a focusable span with a tooltip and the accessible name `<label>: <reason>`. Agent task buttons, Submit week and the controls of a submitted week use it.
- The comment header's reaction and actions buttons are an exception to `TooltipButton`. Their accessible names and focus rings remain, and background tints distinguish hover, pressed and open-menu states without a tooltip.
- Modal surfaces are `Dialog`, `AlertDialog` or `Sheet`; the top bar's day total opens its day and week totals in a `Popover`.
- `features/time/week-target-prompt.tsx` (`WeekTargetPromptHost`, mounted once in the app shell) watches store writes. When `findWeekReachingTarget` in `domain/time/week-target-prompt.ts` finds a week whose saved total just reached its capacity target, it marks the week in `commitPromptedWeeks` at once and opens an `AlertDialog`: "Week complete", "You logged 37:30 of 37:30 for the week of Oct 12. Commit and submit it now?", Later and Commit, which opens `/time/<monday>/commit`. Running time never counts; stopping the entry saves it and can. A submitted week never asks.
- Creating and editing a time entry use one form, `features/time/time-entry-editor-form.tsx`, laid out like the backlog peek: a muted "Edit time entry" or "New time entry" line with "…" and ×; the draft's task as an 18px heading over Running or Committed, project and date chips; Start (Switch while another entry runs, Continue on a saved entry, Stop on the running entry); a `PropertyList` of Task, Hours and Date whose fields show only on hover and focus, then a Note section (`time-entry-fields.tsx`, where Date is `components/ui/date-field.tsx`: an ISO text input with a calendar popover, never the browser's date control); footer Cancel · Save. Day and Week host it in `components/side-panel.tsx`, a panel docked on the right that keeps the page clickable and returns focus to the row or card on close. On a Time page narrower than 1160px (a container query on `.time-page-stack` in `styles/time.css`), the entry panel floats over the page's right side with a shadow instead of narrowing it. Every side panel resizes from its left edge. Each page passes its own `widthKey`, saved per device in `lib/side-panel-width.ts`, and the panel publishes the width as `--side-panel-width` on its parent for the page layout. Clicking another entry saves a valid draft first; an invalid draft blocks the switch. In the narrow view, below 768px, `features/timer/time-entry-modal.tsx` hosts the same form in a dialog that spans the window, less an 8px margin on each side. The timer dock hosts it in `features/time/time-entry-editor-popover.tsx`, a popover anchored to its trigger that ignores outside clicks. Its `anchor` prop moves the popover to another element and gives focus back to it on close when it can take focus. Without children it renders no trigger: the titlebar hosts the new entry editor that way, anchored to the dock's "+", a task or backlog row, or the titlebar's totals. Entry actions come from `domain/actions/object-actions.ts` and render through `components/object-actions-menu.tsx` as a right-click menu and a "…" button. An entry of a submitted week opens read-only: a disabled `fieldset` holds the fields, `WeekLockChip` replaces Committed, and the lock reason shows under Date. A draft dated on a submitted day shows the same reason and cannot save.
- Delete entry, Discard running entry, Move to…, cross-day drag, Duplicate to… another day and Mark as not committed act at once and show an Undo toast for 8 seconds instead of a confirmation. `components/ui/toast.tsx` wraps the Base UI toast: `Toaster` is mounted once in `main.tsx`, bottom right, bottom center below 768px, at most three, newest on top. Toast titles wrap instead of truncating, so a refusal reads whole. `showUndoToast` keeps one Undo toast open, and Cmd+Z (Ctrl+Z) presses it when focus is not in a text field. Time entry actions call it through `offerTimeEntryUndo` in `features/time/time-entry-actions.tsx`. `showActionToast` shows a toast with one other action button that stays until used, such as Answer on an agent's question.
- The agent indicator, `features/agents/agent-indicator.tsx`, sits at the bottom right only while MCP is on. `domain/agents/agent-indicator.ts` picks its one state (needs input, error, failed, active, idle) and label; a lost API connection (`reconnecting` or `disconnected` bridge status) is the error state. It sets `--agent-indicator-clearance` on the root so the toast viewport rises above it in a full window. In the narrow view it sits on the navigation toggle's row, below the toasts. Clicking it, or the Answer action on a question toast, opens the agent panel. `agent-panel.tsx` knows nothing about MCP: it takes the snapshot, `open`, `onOpenChange`, `onAnswer` and `onSeen` as props, so later LLM plugins can reuse it, and `agent-panel-host.tsx` wires it to the bridge store and the local API. It lists sessions (title, client, state, time left from `domain/agents/agent-sessions.ts`), shows the selected session as a chat with its open questions (default: the session with a question, else the newest), and has an Activity tab for writes and errors. In a wide window it is a docked `SidePanel` beside the page, mounted in `app-shell.tsx`; in the narrow view it is a `Sheet` from the bottom. Opening it marks earlier errors and failures as seen.
- Agent tasks from plugins: Settings > Agents (`features/settings/settings-agents-page.tsx`) picks the coding agent, the browser and the model. The Tasks section of its plugin's page on Settings > Plugins (`features/settings/agent-task-settings.tsx`) lists each task with what blocks it, then one form for the settings the tasks share by ID. `AgentTaskButtons` (`features/agents/agent-task-buttons.tsx`) sits in the Commit page's actions row: one button per `commit-week` task next to Mark as committed, and the `submit-week` tasks alongside Submit week, with its disabled reasons. Manual Submit week stays available while the runner overview loads, and waits with the agent buttons' reason while a run starts or goes (`useAgentRunGoing`). `AgentTaskWeekLinks` puts each distinct week link in the week summary, under the status line, as muted text with an external link icon, when the link fills to an https URL. A task whose link uses a secret setting has no link; the line says why in muted text. The button is disabled with its reason (a tooltip on the wrapper) while a setting is missing or a run is going. Starting a run opens the agent panel, where an open runner session shows Stop, and an ended one shows its link.
- Projects: "New project" in the project list header and in the top bar, and Edit, open `features/projects/project-form-dialog.tsx`, a standard `Dialog` that ignores outside clicks. Tasks open in `features/projects/project-task-editor-form.tsx` with the entry editor's Save and Escape rules, hosted in `components/side-panel.tsx`, or a full-width dialog in the narrow view. "New task" sits under the task list; "Import tasks…" is a `PropertyAction` tile at the bottom of the Properties card, beside Archive or Restore, and a button in the empty task list.
- Projects, tasks and backlog items use the same pattern. Project rows in the list and the archive, and the project page's title (right-click); task rows; and backlog rows and the backlog item editor all show their kind's action set. Archive and Restore act at once. Backlog Delete asks for confirmation and states the subitem count.
- Backlog has a grouped list and board with shared state and priority pickers. Board columns stay 280px wide regardless of card content or available space, with horizontal scrolling for overflow. Board cards show the project icon and display name in the muted monospace header instead of the source ID; cards without a project show "No project". The Project display choice controls this header, and the project chip remains list-only. `features/backlog/backlog-page.tsx` owns the view, `backlog-display.tsx` owns Display and filters, and `backlog-item-surface.tsx` owns rows and cards. Clicking opens `backlog-peek.tsx`, a smaller item page, in the right `SidePanel`. Edit replaces it with `backlog-item-editor-form.tsx`, with explicit Save and discard returning to peek. Narrow windows show only the list and use the existing full-width editing dialog. Display preferences remain device-local and ordering stays shared with the sidebar. Archive lives in the header options menu. The detailed interaction contract is in `docs/agents/ux-spec.md`.
- Logging time from a task or backlog item goes through New entry…. Its row menus, the right-click menu and the palette call `openNewEntryEditor` from `features/time/new-entry-request.ts`. The titlebar's popover opens with the task, and for a backlog item the work item link and note, filled in and Date on today. It anchors to the object's row while any of it shows on screen (`pickOnScreenAnchor`), otherwise to the titlebar's totals. The narrow view opens the dialog instead. The backlog has no inline hours field. Backlog rows show Start entry, replaced by Stop while the item's entry runs.
- The narrow view always shows the "…" on project, task and backlog rows.
- Right-click menus go through `ObjectContextMenu` in `components/object-actions-menu.tsx`. In the desktop app it pops up the system's menu: `lib/native-context-menu.ts` turns the action set into plain items, and `apps/desktop/electron/context-menu.cjs` validates them and builds the Electron menu. In the browser it renders the Base UI menu. Both draw lines where `getObjectActionSections` splits the set. A right-click on a text field inside the trigger is left to the main process's edit menu. Menus that open from a row-wide handler, such as the Week Grid row names and the Days column paste menu, use a hidden `ObjectContextMenu` trigger and dispatch a `contextmenu` event on it.
- On touch screens, a long press on any row or card with an action set opens the same menu as right-click. In the browser, Base UI's `ContextMenu.Trigger` handles the press (500ms, cancelled by a 10px move); the desktop app gets the system's `contextmenu` event from the press. styles.css turns off text selection on those elements for coarse pointers so iOS does not start a selection on the same gesture.
- In the narrow view, Backlog keeps Display and filter chips in its header. New items start from the "+" in each group header, or the New backlog item row that ends an ungrouped list, as in a wide window. There is no floating add button.

## Icons

- The app uses `@remixicon/react`.
- Common navigation and action icons include timer, backlog/list, folder/project, settings, plus, check, close, play, stop, and chevrons.
- Project icon persistence and normalization live in `apps/web/src/domain/projects/project-icon.ts`; React rendering and uploaded-image preparation live in `apps/web/src/lib/project-icons.tsx`.

## Typography

- Body text uses Raleway Variable.
- Heading moments use Noto Serif Variable where the existing design calls for more editorial weight.
- Dense app panels should keep headings small and direct.
- Backlog item descriptions, in the item page, the peek and import review, render through `Markdown` from `apps/web/src/components/markdown.tsx`: GitHub-flavoured markdown where single line breaks stay breaks. The parser in `markdown-renderer.tsx` loads on first use and shows the text as plain text until then. Raw HTML stays text, only web and mail links are links (opening in the system browser), images become links instead of loading, and task lists use `Checkbox`.

## Empty And Loading States

- Use existing UI primitives for skeletons and empty states.
- Lazy routes in `router.tsx` load inside `RouteSuspense`, whose fallback is `PageSkeleton` from `apps/web/src/components/page-skeleton.tsx`: a header and six rows of `Skeleton` blocks. It renders nothing for the first 150ms, so fast loads do not flash.
- Empty states should tell the user what is missing and provide the next action when there is one.
- Loading states should preserve layout dimensions.

### Plugin Catalog And Detail

Files: `apps/web/src/features/settings/settings-plugins-page.tsx`, `plugin-catalog-ui.tsx`, `plugin-settings-ui.tsx`
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
catalog select. Below it the category tabs (All, Backlog, Code hosts,
Calendars, Agent tasks, Schemas) sit over a single-column list of plain rows: identity mark, name with
a status badge, a two-line description, and a meta line with capabilities and
version, such as "Backlog · Code host · v1.2.0". The trailing action is the
activation `Switch` for an installed plugin, or Download for an available
remote backlog, code host, calendar, team or agent task plugin. Rows are separated by spacing and only tint on
hover. Catalog entries merge normalized Ajour-index metadata with installed
backlog and schema capabilities; a plugin with several capabilities appears
under each tab. The filter tabs wrap with compact spacing below 768px so every filter
fits at 320px. Only an installed plugin can be activated. Manual file
installation remains a separate action.

An unavailable installed plugin shows its reason in the catalog row and a
notice on its detail page. Update downloads a compatible catalog package over
the installed package. If no compatible catalog download exists, the desktop
detail page offers Update from file. Both paths preserve saved connections and
activation settings. Connection creation and editing stay disabled until the
plugin is available again.

Opening an entry moves to a dedicated detail route, a cardless page of
sections. Its first section holds the back link, identity-first header,
status-driven primary action, status badges, any notices (`MessagePanel`),
and the capability band. Features, Information, Configuration and Uninstall
plugin follow as `settings-section`s. A plugin with more than one of the
backlog, code host and calendar capabilities adds a Capabilities section before
Configuration (`features/settings/plugin-capability-switches.tsx`): a
`SettingRow` with a `Switch` for each it declares, Backlog items, Pull requests
or Calendar events, labelled "Deactivate backlog items for GitHub". The connection form hides the fields of a capability that is off. Features and Information are spaced
lists with no dividers. Configuration lists connections as plain rows (name,
connection status chip, sync-mode badge, tenant, then Edit, Sync and Remove
trailing on desktop and below on narrow widths). The status chip shows Connected,
Paused, Error or Unavailable. Error details and manual-sync staged counts remain
visible; configuration summaries, sync timestamps and readiness copy are omitted.
The connection form renders
unframed above them, and empty lists show plain text. Cached catalog artwork
is optional: the identity mark supplies a consistent generated default
thumbnail, and the hero image keeps rounded corners with no border. Without a
hero, the capability band is a plain line of text ("External service → Plugin
→ Local backlog") above the feature badges. Never fetch remote images from the
renderer. Dialogs and `MessagePanel` notices are the only framed surfaces.

### Secret field and Vault

Files: `apps/web/src/features/settings/secret-field.tsx`, `connection-form.tsx`, `connection-status-ui.tsx`, `settings-vault-page.tsx`; the state model is `apps/web/src/domain/plugins/secret-state.ts`, `connection-status.ts` and `vault-model.ts`
Last updated: 2026-10-25

**Secret field.** `PluginFieldInput` renders `SecretFieldInput` for every field a plugin marks `secret`, whatever its type, in connection forms and in agent task settings. No mask and no saved value: the API sends none, and a form starts every secret empty. Patterns used: `Field`, `Chip`, `Button`, `AlertDialog` and `DateField`; nothing new.

- A new connection shows the password input alone. An existing connection shows a row: the state `Chip` (`describeSecret`), the last use in `text-xs` tertiary, then Replace (outline `sm`) and Remove (ghost `sm`) trailing. A field with no secret shows the "Not set" chip over its input.
- Replace opens an empty `type="password"` input with Cancel beside it, and keeps the chip above. A secret the service refused (Token rejected) opens with Replace open.
- Remove opens an `AlertDialog` that says what happens to the connection, and acts at once, not with the form's Save.
- Under it, a `DateField` labelled "<Field> expires on (optional)" and the line "A reminder only. Ajour keeps using it after this date." It shows once the field holds or is given a secret.
- The chip tones are the `Chip` ones: neutral for Saved, warning for "Expires in N days" and Not set, danger for Expired, Token rejected and "Can't be read on this computer". Every chip carries `data-secret-state` for tests.
- The form takes its state from the overview's `secretFields`, never from a value. `PluginFormState` holds the typed values and the reminder dates as date text; `expiryForSave` turns them into the end of each local day.

**Connection row status.** `ConnectionStatusChip` and `ConnectionStatusNote` show `connectionStatus` (and, under the name, `expiryWarnings`: a field's name with an expiry chip): Connected, Paused, Unavailable, Error, Token rejected or "Can't be read on this computer", and under the name why sync is paused. A paused connection's Sync buttons are disabled.

**Vault page.** `/settings/vault`, cardless like the other settings pages: an `h1`, then one `settings-section` per plugin, headed by its name, in alphabetical order, with plugins that are not installed last as "<Plugin> (not installed)" with a ghost Remove (an `AlertDialog`). A row is a `role="group"` named "<owner>, <kind>": the owner (connection label, or "Agent tasks") and under it "<kind> · <last use>" in `text-xs` tertiary, the state `Chip`, and Replace as a `Link` styled with `buttonVariants` (outline, `sm`) to the plugin page, which opens the form with Replace open (`?connection=<id>&field=<id>`, or `?field=<id>` for task settings). Rows are bordered with `border-border`, no outer frame, and wrap on narrow widths. The two failures of the vault show first as `MessagePanel` warnings; "Ajour can't protect credentials on this computer" has an outline Try again.

### Access list and consent panel

Files: `apps/web/src/features/settings/plugin-access-section.tsx`; the lines come from `apps/web/src/domain/plugins/plugin-access-model.ts`
Last updated: 2026-10-25

`PluginAccessSection` is a `settings-section` titled Access, placed before Features on an installed plugin's page. `CatalogAccessSection` stands in for a plugin that isn't downloaded. Patterns used: `MessagePanel`, `Chip`, `Button`; nothing new.

- **The access list** is a `ul` of items: a 16px icon (globe for hosts, key for the credential, robot for agent tasks, cpu for the start mode, puzzle for a new capability), a `text-sm font-medium` title, a `text-sm` detail, and under a host a native `details` disclosure, "N endpoints", in `text-xs` tertiary. Its `summary` has the 2px focus ring, and the chevron turns without a transition. Endpoints are `font-mono`, each with its access choice after a dot. Every item carries `data-access-item` for tests.
- **New** is the accent `Chip`, after the title of an item that is new, or "New endpoints" on an item whose host is old. A new endpoint carries its own New chip in the disclosure.
- **Activity** is a `text-sm` line under the description, worded by `describeLastUse` as on the Vault page. Refused requests (`data-access-refused`) and blocked attempts to connect directly (`data-access-blocked`) are each a warning-colored line with an icon.
- **The consent panel**, `PluginAccessUpdatePanel`, is a warning `MessagePanel` (`data-access-update`) in the page header's notices: the title "Version N needs more access", a line saying it stays inactive and that connections and settings are kept, the access list of new items only, and the primary Button "Allow and activate". It is disabled while another plugin change runs.
- **The model** (`describeAccess`) takes the overview's access view and, for an update, its difference. With `onlyNew` it lists only the new items with only their new endpoints, so the panel and the section say the same thing. `describeLegacyAccess` lists what a plugin API 3 plugin can do without limits.

### Connection access and held edits

Files: `apps/web/src/features/settings/connection-access-ui.tsx`, `held-edits-review.tsx`, `connection-form.tsx`; the actions are in `apps/web/src/features/backlog/held-edit-review.ts`, the store in `apps/web/src/lib/held-edits.ts` and `apps/web/src/domain/backlog/held-edits.ts`, and the choices in `packages/shared/connection-access.ts`
Last updated: 2026-10-25

**Access group.** `ConnectionAccessGroup` closes the connection form of a plugin with access choices (Azure DevOps): a `FieldSet` whose `FieldLegend` (label variant) names it Access, the `text-xs` line "Ajour blocks anything not chosen here, even when the token allows more.", then one `Checkbox` per choice in a horizontal `Field`, its label and a `FieldDescription` that ends with "The token needs <scope>." A choice that is always on (Read the backlog) is checked and disabled, with "Always on.". Under Edit work items, a `MessagePanel` says how many changes are held while the connection has some. The choices are part of the form's draft (`PluginFormState.access`) and save with it; a plugin without choices shows nothing. Patterns used: `FieldSet`, `Field`, `Checkbox`, `MessagePanel`; nothing new.

**Connection row.** `ConnectionAccessBadge` adds an outline `Badge` after the sync-mode badge: "Reads backlog", or "Edits work items" once editing is on. `HeldEditsLine` adds `text-xs` muted text under the tenant: "N changes held. Turn on editing to review and send them.", or, once editing is on, a link "Review them in Sync review" to `/settings/sync-review?held=<connection>`.

**Held changes in Sync review.** `HeldEditsReview` is the first panel of Sync review, an `AppPanel` named "Held changes": its count as a `settings-subsection-title`, a line saying nothing goes until it is sent, then one group per connection (`data-held-connection`), its name and its count as a muted mono `Value`, and, while the changes can't be sent, a `text-xs` muted line saying why (`data-held-blocker`): the connection was removed (discard them, or add it again), it is paused (a "Fix it" link to the plugin page), or editing is off (a "Turn it on" link). Each change is a row like the estimate issues: the item's title as a link, a muted `Badge` naming the kind (Settle or move, Original estimate, Remaining estimate, Completed, Description, Comment, Comment edit, Comment deleted), the change itself in muted `text-xs` (a comment's Markdown clamped to three lines), and outline Send and Discard trailing. Send is disabled while the connection can't send it. Discard opens an `AlertDialog` that asks with the kind's noun ("Discard this held settle?", "Discard this held comment deletion?") and says what happens to the source's side. A connection's Remove confirms in an `AlertDialog` whenever it holds changes, and says how many are discarded. `?held=<connection>` scrolls its group into view and tints it with `--hover-bg`.

### Application updates

Files: `apps/web/src/features/settings/application-updates-settings.tsx`, `apps/web/src/features/layout/sidebar-footer.tsx`, `apps/web/src/lib/desktop-updates.ts`
Last updated: 2026-10-19

The stable/nightly choice is a `SettingRow` with the shared outline toggle
group. Keep exactly one track selected and explain nightly risk in the row's
description. Repository status follows below it, separated by space only. Status text uses `aria-live`, preserves its layout while checking,
and shows the release action only when a newer matching release exists. Web-only
rendering keeps the preference available but identifies the desktop requirement.
The desktop controller owns update state, shared through `lib/desktop-updates.ts`.
Startup, periodic, and manual checks only report availability. The sidebar footer
uses `TooltipButton` for Settings and Commit on the left and updates on the right.
The update arrow stays outlined, with stronger contrast when an update is available.
On supported Windows builds, clicking an available update opens a native warning
before downloading and restarting. Cancel leaves the update available, and an
ordinary quit never installs it. Other desktop builds open the release page for
manual installation. The browser has no footer update button.

### Weekly Time Overview

Files: `apps/web/src/features/time/weekly-time-view.tsx`, `apps/web/src/features/time/week-grid.tsx`, `apps/web/src/features/time/week-grid-cell-panel.tsx`, `apps/web/src/features/time/time-entry-fields.tsx`
Last updated: 2026-10-16

Day is the default, timer-first time surface. The top bar's Day | Week
control switches views at desktop widths of 768px and above. The view shown
at those widths is remembered (`timeView` in the user preferences), and a Time
link without `view`, such as the sidebar's, opens it; `?view=day` and
`?view=week` pick one. At those widths the page then names the view in the URL
in place, so Back returns to the view each history entry showed. The narrow view
has no switcher. A Week link there (`?view=week`) shows Day with a note that
Week needs a wider window, and keeps `view=week`, so widening the window shows
Week. The week's range is the top bar's title in Week, with a Today chip while
the week holds today.
Under the bar a 44px toolbar holds Grid | Days (persisted locally as `grid` or
`days`) and the week total. The Grid table uses a fixed layout: 84px day
columns, a 72px total column, and the project and task column takes the rest,
ellipsizing the project name first. It scrolls sideways when its visible columns
do not fit, below 820px with all seven days.
Grid rows are 40px with the project and task on one line, day headings show
"Mon 12" over the logged time, today's column is tinted, weekends
are muted, and a "Totals" footer closes the table. A click on a Grid cell
opens it in the side panel: a new entry for an empty cell, the entry of a
one-entry cell with "Add another entry for <day>", or the list of a cell with
several entries (`week-grid-cell-panel.tsx`). Double-click, Enter or a digit
edits an empty or one-entry cell in place; the typed-cell rules live in
`domain/time/week-grid-cell.ts`. A cell with several entries shows "3:30 ×2"
and never edits in place. "+ Add row" adds an empty row for the week, never
saved on its own. Right-click on the row name or a cell, or Shift+Backspace on
a focused cell, offers Delete row, with no "…" button. Row names share one
context-menu root; its content mounts only while open. Only the cell menu shows
the keyboard shortcut. Deletion saves and closes the row's side-panel draft first;
an invalid draft blocks deletion. A row with time confirms its entry count and
total in an AlertDialog, then deletes its week's entries with one Undo toast.
Rows containing a running entry or its saved part cannot be deleted.

Days use up to seven 40px column headers and flat 6px entry cards
with the project's color as a rail; the running card wears a success-tone
chip. Each day reads oldest first, like the Day list, so a new entry lands at
the end. A continued entry's running card keeps that entry's place, as its Day
row does (`placeRunningRow` in `domain/time/timesheet-entry.ts`); a new running
entry's card comes last. The running card does not drag. Cards drag between days with thresholded pointer dragging, explicit
weekday drop targets, and Escape/pointer-cancel cleanup. Dropping a card on
its own day reorders the day, with a 2px primary line where it will land, and
commits through the same `reorderTimesheetEntries` as Alt+Up and Alt+Down. A
click or Enter on a card opens it in the side panel. Columns run to the bottom
of the page, and a double-click on a column's header or empty space opens a
new entry for that day, like its Add button. Normal headers show logged totals only;
capacity target and utilization live in hover cards, with an optional compact
warning once a day runs more than 50% over its target or the week passes its own.

A submitted week (`domain/time/locked-weeks.ts`) shows `WeekLockChip` beside
the week total. Its cards and Day rows do not drag or reorder, and its days'
tabs in the day strip take no dropped row. Add, Add entry, Add row, Delete
row, Paste here and in-place Grid edits are disabled with the lock reason
through `DisabledReason` or the action's `disabledReason`. An action it
disables also carries `locked`, set by `markLockedActions` in
`domain/actions/object-actions.ts`: `ObjectActionItems` and the command
palette grey it without the reason but let it be chosen, which shows the
reason as a toast, and `handleItemKeyDown` does the same for its key and,
through `reorderLockedReason`, for Alt+arrows. Cmd+X on its entries shows the
reason from `use-entry-selection.ts` and cuts nothing. Native
right-click menus only grey it, since a native item cannot be greyed and
chosen. The Move to and
Duplicate to calendars grey out its days, and it gets no calendar suggestion. Writes without a control of their own, such as Cmd+V, show the
refusal as a toast from `features/feedback/app-error-handler.ts`, the handler that also emits `app.error`.

Calendar suggestions (`features/time/calendar-suggestions.tsx`) show while a
calendar plugin is on. The Day view adds a "From your calendar" section under
its rows: 40px dashed rows with the time span, the title, a `ProjectTaskPicker`
seeded from the remembered meeting, the duration, Add, a dismiss button and the
"…" menu, then a line counting what the Settings filters hide, with Show hidden.
Each Days column lists dashed cards under its Add button, headed "From
calendar": the compact time span, the title, and the project with an Add hint on
hover, or the picker. Choosing a project in a picker adds the entry at once and
remembers the project for a recurring meeting. One action set,
`getCalendarSuggestionActions`, and `useCalendarSuggestionActions` serve every
surface. The copy says meeting, never rule, series or occurrence. A
"Calendar · N" button in the Time top bar opens the week's suggestions in the
side panel (`features/time/calendar-week-panel.tsx`), grouped by day with a
checkbox each; those with a project start checked, and "Add N entries · H:MM"
adds them with one Undo. Grid day headers show a calendar chip with the count
beside the day total, which opens that panel on the day. An editor or a listed
Grid cell takes the side panel from the Calendar.

Every time entry surface (Day rows, Days cards, Grid cells, the Grid cell list
and the entry form) exposes the same action set through a right-click menu.
Only the entry form also has a "…" button. Day rows show Continue at their
end, or Stop on the running row, always in the narrow view. Duplicate to and Move to
open a calendar dialog; Delete and Discard happen at once and show an Undo
toast. `features/time/time-entry-actions.tsx` runs the actions for every
surface.

Capacity targets and the two independent warning switches live in General
Settings. Targets are Monday-first, default to eight hours on weekdays and zero
on weekends, and remain local user preferences. The Hide non-working days switch
defaults to off. When enabled, zero-capacity days leave the Day strip and both
Week layouts, while logged time on those days stays in weekly and row totals.
Working weekends remain visible. If every day has zero capacity, Week shows a
message explaining how to restore the columns. The date picker and submission
still include every day.

### Commit Page

Files: `apps/web/src/features/time/commit-page.tsx`, `apps/web/src/features/time/commit-changes.tsx`, `apps/web/src/features/time/use-open-commit-page.ts`, `apps/web/src/features/time/week-lock.tsx`

Route `/time/$date/commit` shows the week that holds `$date`. Commit week in
the sidebar foot (or the top bar while the sidebar is hidden or Settings
replaces it) and at the end of the narrow toggle opens it through
`useOpenCommitPage`, for the week on screen; the Week complete prompt opens it too.
Opening it saves valid entry drafts and keeps invalid drafts open through the
Time page's action request handler. The page leads with the week summary: the
total as a 28px figure beside the target, a 3px progress bar and amber
warnings. Under a "Changes" `SectionHeading`, whose title is a disclosure
button (chevron, `aria-expanded`, no transition) that hides the list and its
"checked" count and opens expanded on every visit, `CommitChangeList` shows one row
per change: a `Checkbox`, the kind's symbol (Added, Updated, Deleted; an icon
with its own color, named for screen readers), the day, the project and task,
the hours as a `Value` and the note, each as "old → new" when the committed
copy differs. "Everything is committed." replaces the list when there is none.
The plugin actions and "Mark as committed" (with the Undo toast) sit in a
wrapping row below; collapsing Changes leaves them visible. Submit week
follows in the same row, primary once no change waits unless a plugin submit task
is present. It stays available alongside that task and while the runner overview
loads, disabled through `DisabledReason` with "Commit your changes first" or
"Stop the running entry first". It asks through an `AlertDialog` when `needsPaceConfirmation` says so
("Submit a week under pace?", Review and Submit anyway), then locks the week
with the Undo toast "Week submitted". A submitted week shows `WeekLockChip`
(`features/time/week-lock.tsx`) and "Submitted Oct 16." in the summary, and
Reopen week, with the Undo toast "Week reopened", replaces the row. "Lines"
closes the page: the toolbar with Group by and, when a plugin adds project
properties, a Names `ToggleGroup` (Ajour, then each plugin's section title,
saved as `commitLinesNameSource` in the user preferences), then the copyable
lines under day `SectionHeading`s. A line's project, its full name or the
plugin's name field, and its task are one value shown as "Project / Task" and
copied as "Project Task"; while a saved plugin choice waits for the plugins
to load, it shows "Loading names…" and copies nothing. Every value copies on click with an always-visible
icon; hours copy as decimals. Change rules live in
`domain/time/timesheet-commit.ts`, line grouping and the summary in
`domain/time/timesheet-submission.ts`, and the unchecked changes in
`lib/commit-selection.ts`, which agents read too.

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

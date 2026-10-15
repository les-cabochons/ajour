# UI Registry

- Pull request rows live in `features/pull-requests/pull-request-row.tsx`. The list groups Active, Settled and Recently closed items. The sidebar work list shows them as a collapsible Pull requests section, only while a code host is enabled, between the Backlog section and Snoozed: active, unsnoozed items in longest-waiting-first order, as one-line compact rows. E settles locally, B opens the shared snooze picker, Enter opens the summary and the context menu offers Open in the provider. Ctrl/Cmd-click opens the source without changing routes. Navigation and records are hidden while the code host is inactive.

This registry captures reusable visual patterns already present in Ajour. Update it after meaningful UI additions.

## Foundation

The redesign direction decided on 2026-10-14: Linear's density and structure, Vercel's restraint in color. These are the shared patterns every page is built from. Pages that still carry their own styles migrate to them one area at a time (Time, Backlog, Projects, Settings).

- **Top bar and page header.** The 48px bar is the page header. `PageHeader` in `components/page-header.tsx` renders a `title` and `actions` into the bar through a portal; an optional muted `backLink` renders in the page content above the object title; `lib/page-header.ts` owns the slot. Until a page mounts one, the shell shows the route's default title, and on Time the selected day as a calendar trigger with a "Today" chip. On Windows the menus sit at the bar's left, then a hairline, then the title. The bar's right end holds the day total as plain text (`.ajour-nav-total`), whose popover still shows the week total and Submit week.
- **Chip.** `components/ui/chip.tsx`: 20px, 4px corners, 12px medium, neutral by default, with a `color` dot for projects and workflow states. The only metadata treatment.
- **Value, Figure, FigureRow.** `components/ui/value.tsx`: every duration, total, count and id in mono tabular figures. `Figure` is a 12px label over a 16px value; a `FigureRow` replaces stat cards.
- **SectionHeading.** `components/section-heading.tsx`: 12px medium muted, with a trailing count or total, heading every cardless section.
- **PropertyList.** `components/property-list.tsx`: label and value pairs in a two-column grid with 28px rows, replacing boxed side panels on detail pages.
- **Empty.** `components/ui/empty.tsx`: a 13px title, a 12px line and at most one outline button; `align="start"` in lists, centered on empty pages.
- **Buttons.** `xs` 20px, `sm` 24px, default 28px, `lg` 32px; `icon-xs`, `icon-sm`, `icon`, `icon-lg` likewise. Primary is the accent indigo. Inputs and selects are 32px with 4px corners.
- **Sidebar.** Solid surface one step below the content (above it in dark), no blur, a header as tall as the titlebar with Hide sidebar, an 18px mark and a 14px semibold wordmark (left padding clears the macOS traffic lights), the view switcher (`features/layout/sidebar-view-switcher.tsx`, the open view's icon and name opening a dropdown of link items with mono counts and a check on the open view) with Search and the project filter (`features/layout/sidebar-search.tsx`: Search expands into a search box, the filter is a `Popover` with a `Command` list; `domain/backlog/sidebar-filter.ts` decides which rows match), the timer dock as a flat bordered block, Settings at the bottom. Returned pull requests show a filled accent count in the switcher's menu.
- **Capture and budgets.** `just ui-capture` screenshots every surface into `qa/ui/out`; `just ui-perf` prints the renderer budgets on the 600-item workspace. See `qa/routines/ui-capture.md`.

## App Shell

- Desktop uses a full-height application sidebar with a quiet translucent surface distinct from the workspace. Only macOS reserves a top chrome strip for native traffic lights. Windows places the sidebar header at the top of the window. The timer dock, then Time, Backlog, Pull requests and Projects, sit below the header, while Settings is anchored at the bottom.
- The application sidebar, `features/layout/app-navigation-sidebar.tsx`, is expanded or hidden; there is no icon rail. Hide sidebar next to the logo, Show sidebar at the start of the titlebar (`SidebarToggleButton`) and Cmd+B (Ctrl+B outside macOS) switch between them. `lib/app-sidebar.ts` owns the state: it saves the choice per device in `localStorage` under `ajour.app-sidebar` (a saved "rail" reads as hidden), and below 1100px it hides the sidebar without changing the saved choice. There the toggle opens it over the page in a left `Sheet`, which closes on navigation. `resolveAppSidebarDisplay` gives "inline", "overlay" or "none". The shell exposes "inline" or "none" as `data-app-sidebar` on `.ajour-app-body`, and sets `--app-sidebar-width` to 0 while it is not inline. Cmd+B lives in the shortcut registry, `lib/shortcuts.ts`, like every other key.
- `features/layout/timer-dock.tsx` owns the running entry's display. `TimerDock` heads the sidebar; `FloatingTimerDock` shows it on one line at the bottom left while the sidebar is not on screen, and beside the narrow view's entry buttons. Both open the running entry editor through one shared open state, `setRunningEntryEditorOpen`, which `startBlankEntry` also uses after it starts an empty entry from the sidebar's or the floating dock's Start. `RunningEntryWindowTitle` writes it to `document.title`. `summarizeRunningEntry` in `domain/time/running-entry.ts` picks the title, meta line and remaining estimate.
- "?" opens the shortcut overlay, `features/layout/shortcut-overlay.tsx`: a Dialog with a search field that lists every shortcut in the registry, grouped by scope ("Anywhere", "Time page", "Focused row or card"), with alternate keys after "or". Day rows and Week cards carry `data-entry-id` so C can continue the focused entry.
- Day rows, Days cards, Week Grid cells, backlog rows and task rows take keyboard focus. Each carries `data-focus-column` (the day index in the Week, "0" in lists) inside a `data-focus-scope` container, and its `onKeyDown` calls `handleItemKeyDown` from `lib/item-keys.ts`. Arrows move focus within the scope; the item keys in the registry (scope "item") run the action that the kind's `ActionKeys` map names, such as `TIME_ENTRY_ACTION_KEYS`; Alt+Up and Alt+Down call the row's reorder, which commits through `getSharedTableStepOrder` in `lib/table-drag.ts` and the same store command as a drag. ".", Shift+F10 and the context menu key open the "…" menu, or the right-click menu on Grid cells. The menus show each action's key from the same map, and the "…" menu gives focus back to its row on close. Grid cells keep their own Enter and digit editing. Project rows in the Projects list take Alt+Up and Alt+Down only. After Delete, focus goes to the next row still on screen, so a backlog item's deleted subitems are skipped.
- Cmd+K (Ctrl+K elsewhere) opens the command palette, `features/command-palette/command-palette.tsx`. No button opens it. It lists the focused object's actions, search results across tasks, backlog items and projects, the registry's actions with their keys, and navigation. `command-palette-items.ts` builds and ranks the list. Focus attributes from `lib/focused-object.ts` name the focused object: `data-entry-id` with `data-running-entry`, `data-backlog-item-id`, `data-task-id` and `data-project-id`. Start entry and New entry… run in the palette. New entry… opens the titlebar popover anchored to the object's row while it is on screen, otherwise to the titlebar's totals. Other object actions go to their page as `?action=<id>&target=<id>`, which the page runs through `useActionRequest` from `lib/action-request.ts`, so each action keeps one runner. While the Projects page is open, the palette sends every project and task command to it, including opening a project, the archive and Create project, so a task draft is saved first or blocks the command. Items show a disabled reason or hint on a second line, like the "…" menus.
- A pinned task shows its slot as a small key badge, `PinnedSlotBadge` in `features/projects/pinned-slot.tsx`, on its task row and in the project task picker. "Assign shortcut…" opens `PinnedSlotDialog` from the same file: ten slot buttons that name the task holding each slot, a number key picks a slot, and Clear shortcut frees it. The Projects page owns the picker, so the row menus and the palette's `?action=assign-shortcut` open the same one and write at once. The task panel's Shortcut field, `PinnedSlotField`, opens it too but only changes the draft, which Save writes.
- In wide windows Settings opens inside the shell in place of the application sidebar. The shell renders `SettingsNavigation` from `features/settings/settings-navigation.tsx` in the full-height left column, with the shell sidebar classes and the app sidebar's width, under the App, Work and Data group labels from `getSettingsGroups`. Its header holds Back to app, which returns to the last path outside Settings that the shell remembers. `SettingsLayout` renders only the page. The floating timer dock shows meanwhile, sized to the column.
- Projects has no column of its own. `/projects` is a list page like the Backlog: no top bar title, with "…" (Import and export…) and the primary "New project" in the top bar, a 40px filter row with an Active | Archived toggle (the archive is `/projects/archive`), then 36px rows: icon, name, code `Chip`, active task count, this week's hours as a mono `Value`, the budget as a 3px bar with its percent (or "No budget"), and a hover "…". Active projects reorder by dragging rows or Alt+Up and Alt+Down; a row opens the project. Its styles live in `apps/web/src/styles/projects.css`.
- The project page, `features/projects/projects-page.tsx` at `/projects/$projectId`, puts the project's "…" and the primary "New task" in the top bar, with no title. A subtle "Back to Projects" link with a back arrow sits above the project name in the content. The content follows the backlog item page: the 20px title with its icon and code `Chip`, a `FigureRow` (This week, All time, then Budget, Used and Remaining when its active tasks carry budgets, else Active tasks) over a 3px budget bar, notices, then Tasks | Time entries tabs. Tasks has the Active | Archived toggle and 36px rows (name, pinned slot, billable `Chip`, hover "…", a budget bar with "consumed / budget" or the consumed hours as a toned mono `Value`). Time entries lists the project's entries newest first under a `SectionHeading` per day with the day's total; each row links to its day. The project form's color is `components/ui/color-field.tsx`, a swatch that opens a preset palette and a hex input, never the browser's color control.
- Breakpoints live in `lib/breakpoints.ts` only: below 768px is the narrow view, 768px to 1099px hides the app sidebar, and 1100px and up follows the saved choice. Scripts use its media queries or `useIsNarrowView` from `lib/use-narrow-view.ts`. Styles use the `narrow`, `desktop` and `forced-rail` Tailwind variants that `lib/tailwind-breakpoints.ts` builds from it, as `@variant narrow { ... }` in CSS or `narrow:` in class names. Do not write width media queries for layout.
- Settings: the pages are sections of a 13px title, a muted description and `SettingRow`s (label and description leading, the control trailing, or stacked for wide controls), without panels. Their styles live in `apps/web/src/styles/settings.css`. Workflow states save on blur when the name changed (Enter blurs) and at once when the color or Done changes; there is no Save button. In the web build the plugin catalog notice is informational, not a warning.
- The narrow view renders no sidebars. `features/layout/narrow-titlebar.tsx` puts a segmented Time and Backlog switcher at the start of the titlebar (the active section shows its label) and a Settings cog at the trailing edge. Settings opens on a full-width list of its pages in the same groups: a small tertiary heading per group and 52px rows of icon, label and chevron, with no cards, borders or fills, and `features/layout/narrow-navigation.ts` decides each page's back arrow, shown in a bar under the titlebar. The Settings list's Projects entry opens `/projects` as a full-width project list; project detail, the archive and project import and export (`/settings/projects`) lead back to it.
- Desktop structural surfaces consume the full area beside the application sidebar. Time and Backlog remove the generic page inset and meet the full workspace edges; Backlog fills the available workspace height. Each page area owns a stylesheet under `apps/web/src/styles/` (`time.css`, `backlog.css`), imported at the top of `styles.css`; page files use the plain `(width < 768px)` media query for the narrow view because the breakpoint plugin registers its variants after the imports are inlined.
- The Time pages put their header in the top bar through `features/time/time-page-header.tsx`: previous and next, the day as a calendar trigger (`features/time/time-date-picker.tsx`, which the shell's default title and the narrow titlebar also use) or the week's range, a Today chip or the way back to today, then Day | Week and Submit week. Under it the Day view shows `features/time/day-strip.tsx`, a 56px row of seven day tabs with their totals and the week total, then one-line 40px rows (`time-entry-row` in `features/timer/timer-panel.tsx`: dot, project, task, note, hover actions, the duration as a `Value`), and a quiet "New entry" row at the end.
- The top bar begins beside the application sidebar. Its controls remain clear of the native Windows caption-control area.
- Below 768px, Start and Create time entry float together at the bottom right with 44px targets. The floating timer dock replaces Start there. `GlobalTimerBar` keeps one editor and shortcut owner, portals the controls outside the titlebar's backdrop filter, and leaves the daily total in the titlebar. The scroll area reserves bottom space, safe-area insets keep the controls reachable, and narrow toasts sit above them. Wider windows keep the titlebar controls.
- The app menu comes from `apps/desktop/electron/app-menu.cjs`. macOS shows it in the native menu bar. On Windows at 768px and up, `features/layout/app-menu-bar.tsx` draws the same menus at the start of the titlebar with the `components/ui/menubar.tsx` wrapper. Items run once their menu has closed and focus is back on the element the user was in, so Copy and Continue act on it. The narrow view and the web build show no menu bar.

- The sidebar's work list is one scroll, `features/layout/sidebar-backlog-list.tsx`. `selectSidebarBacklogItems` in `domain/backlog/backlog-item-lifecycle.ts` decides which items show and their order. The collapsible Backlog section comes first with one-line rows in Comfortable (28px with the estimate, 272px by default) or Compact (26px, 200px) density, the Pull requests section from `sidebar-pull-requests.tsx` (compact `PullRequestRow`s, only while pull requests need the user), and the collapsible Snoozed and Settled sections. `SidebarSectionHeader` draws every section label. Rows show a green running marker and a Returned dot; hover and focus swap the type icon for a settle circle and show Start entry, Snooze and "…" in place of the end of the row. `lib/sidebar-layout.ts` saves the density, the dragged width and each section's state per device under `ajour.sidebar-layout`. The shell sets `--app-sidebar-width` and the centering offset inline from it. `.ajour-sidebar-resize-handle` on the sidebar's right edge resizes it from 200px to 400px, hides the sidebar past the minimum, and resets on double-click.
- Moving a backlog item between workflow states runs through `moveBacklogItemWithUndo` in `features/backlog/backlog-item-moves.ts`, from any surface, and the editor's state field uses it when a done state is involved. Closing or settling a parent with open subitems asks through the one `CloseSubitemsDialogHost` from `features/backlog/close-subitems-dialog.tsx`, mounted in the app shell, unless the Settings > Backlog choice answers. Settings > Workflow (`features/settings/settings-workflow-page.tsx`) lists the workflow states in board order with their Done flag, then the source states and their mapping.
- Every backlog item action runs through `runBacklogItemAction` in `features/backlog/backlog-item-actions.ts`; hosts only run Edit and Add subitem. Snooze… opens the one `SnoozePickerHost` from `features/backlog/snooze-picker.tsx`, mounted in the app shell. `useNow` from `lib/use-now.ts` re-renders views that hide snoozed items, so a snooze ends on its own. `getSettleBehavior` in `features/backlog/settle-dialog.tsx` decides what Settle does. Items whose connector can't settle are settled locally at once. Otherwise the source project's settle rule decides: Ask opens the one `SettleDialogHost`, also mounted in the app shell, and Apply settles with the rule's change. Shift+E (`item.settle-ask`) and Shift-click open the dialog prefilled with the rule, and action menus label Settle "Settle…" when it opens the dialog. Settings > Backlog edits the rules in `features/settings/settle-rules-section.tsx`, and `domain/backlog/settle-rules.ts` owns them. `features/backlog/backlog-source-writes.ts` sends a settle's pending write when its Undo toast closes (`offerUndo`'s `onWindowClosed`) and at launch.
- The backlog item page, `features/backlog/backlog-item-page.tsx` at `/backlog/$itemId`, puts the item's actions in the top bar, then a subtle "Back to Backlog" link with a back arrow above the 20px title with type and project chips, a state notice, the estimates as a `FigureRow` over a 3px progress bar, and the note (rendered as markdown), subitems and time entries (`backlog-item-row`s with `SectionHeading`s) beside a `PropertyList`.
- The Backlog page puts "Backlog n" and its actions (layout toggle, Display, "…", New backlog item) in the top bar; the archive view swaps the title for "Archive" with a back arrow. A 40px filter row follows, then 32px sticky group headers and 36px list rows with fixed leading columns (priority, id, state, type) so titles align whether or not an item has an id; the project is a `Chip` and the estimate a mono value at the row's end. Board cards are flat 6px cards. The Display popover's choices are shadcn `Select`s. The pull request pages follow the same anatomy: title and Sync in the bar, `SectionHeading`s over rows, a subtle back link and `PropertyList` on the detail page. The page root is the focused object, so Enter edits, E settles and B snoozes. Edit opens the backlog item editor in a `SidePanel` over the page, and `?action=edit` or `?action=add-subitem` open it from the sidebar and the palette.

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
- Time-entry project/task selection uses the shadcn command navigator in `features/projects/project-task-picker.tsx`: its default view lists projects only, selecting a project drills into active tasks, and typed task or mixed project/task terms return capped direct matches.
- Toggle groups and tabs are preferred for mutually exclusive local view modes.
- Checkboxes use `Checkbox` from `apps/web/src/components/ui/checkbox.tsx`, backed by Base UI. Use its `indeterminate` prop for mixed selection state instead of mutating DOM refs.
- Connector settings fields are rendered through `apps/web/src/features/settings/connector-settings-ui.tsx`, so plugin-driven field styling stays consistent.
- Immediate on/off settings use `Switch` from `apps/web/src/components/ui/switch.tsx`; labels describe the action as Activate or Deactivate plus the capability name.
- Reorderable tables and navigation lists use `apps/web/src/lib/table-drag.ts` for consistent mouse/touch thresholds, cancellation, row movement, and drag-preview positioning. Its pointer session cancels the drag on Escape and keeps that Escape from closing the panel or dialog behind it. `getSharedTableDropOrder` returns null for a drop where the item started, so nothing is saved. The Week's cross-day drag, `lib/cross-day-entry-drag.ts`, runs on the same session.
- Icon-only buttons use `TooltipButton` from `apps/web/src/components/tooltip-button.tsx`: a `Tooltip` with the button's label and, when a `shortcut` id is given, its key from `lib/shortcuts.ts`, as "Previous day [". It sets `aria-label` and `aria-keyshortcuts`. Pass `render` for a `Button`, a `Link` or a `DropdownMenuTrigger` or `PopoverTrigger`. `ShortcutTooltipLabel` from the same file fills tooltips that other components render, such as the app sidebar's navigation.
- Modal surfaces are `Dialog`, `AlertDialog` or `Sheet`; the top bar's day total opens its day and week totals in a `Popover`.
- Creating and editing a time entry use one form, `features/time/time-entry-editor-form.tsx`: header with title, date, "…" and ×; Project / task, Note, Hours, Date (`time-entry-fields.tsx`, where Date is `components/ui/date-field.tsx`: an ISO text input with a calendar popover, never the browser's date control); footer Cancel · Start (Switch while another entry runs, Continue on a saved entry, Stop on the running entry) · Save. Day and Week host it in `components/side-panel.tsx`, a panel docked on the right that keeps the page clickable and returns focus to the row or card on close. Every side panel resizes from its left edge. Each page passes its own `widthKey`, saved per device in `lib/side-panel-width.ts`, and the panel publishes the width as `--side-panel-width` on its parent for the page layout. Clicking another entry saves a valid draft first; an invalid draft blocks the switch. In the narrow view, below 768px, `features/timer/time-entry-modal.tsx` hosts the same form in a dialog that spans the window, less an 8px margin on each side. The timer dock hosts it in `features/time/time-entry-editor-popover.tsx`, a popover anchored to its trigger that ignores outside clicks. Its `anchor` prop moves the popover to another element and gives focus back to it on close when it can take focus. Without children it renders no trigger: the titlebar hosts the new entry editor that way, anchored to the dock's "+", a task or backlog row, or the titlebar's totals. Entry actions come from `domain/actions/object-actions.ts` and render through `components/object-actions-menu.tsx` as a right-click menu and a "…" button.
- Delete entry, Discard running entry, Move to…, cross-day drag and Duplicate to… another day act at once and show an Undo toast for 8 seconds instead of a confirmation. `components/ui/toast.tsx` wraps the Base UI toast: `Toaster` is mounted once in `main.tsx`, bottom right, bottom center below 768px, at most three, newest on top. `showUndoToast` keeps one Undo toast open, and Cmd+Z (Ctrl+Z) presses it when focus is not in a text field. Time entry actions call it through `offerTimeEntryUndo` in `features/time/time-entry-actions.tsx`. `showActionToast` shows a toast with one other action button that stays until used, such as Answer on an agent's question.
- The agent indicator, `features/agents/agent-indicator.tsx`, sits at the bottom right only while MCP is on. `domain/agents/agent-indicator.ts` picks its one state (needs input, error, failed, active, idle) and label; a lost API connection (`reconnecting` or `disconnected` bridge status) is the error state. It sets `--agent-indicator-clearance` on the root so the toast viewport rises above it. Clicking it, or the Answer action on a question toast, opens the agent panel. `agent-panel.tsx` knows nothing about MCP: it takes the snapshot, `open`, `onOpenChange`, `onAnswer` and `onSeen` as props, so later LLM plugins can reuse it, and `agent-panel-host.tsx` wires it to the bridge store and the local API. It lists sessions (title, client, state, time left from `domain/agents/agent-sessions.ts`), shows the selected session as a chat with its open questions (default: the session with a question, else the newest), and has an Activity tab for writes and errors. In a wide window it is a docked `SidePanel` beside the page, mounted in `app-shell.tsx`; in the narrow view it is a `Sheet` from the bottom. Opening it marks earlier errors and failures as seen.
- Projects: "New project" in the project list header and in the top bar, and Edit, open `features/projects/project-form-dialog.tsx`, a standard `Dialog` that ignores outside clicks. Tasks open in `features/projects/project-task-editor-form.tsx` with the entry editor's Save and Escape rules, hosted in `components/side-panel.tsx`, or a full-width dialog in the narrow view. "New task" sits in the top bar; "Import tasks…" is in the project's "…" menu and the empty task list.
- Projects, tasks and backlog items use the same pattern. Project rows in the list and the archive and the project's top bar; task rows; and backlog rows and the backlog item editor all show their kind's action set. Archive and Restore act at once. Backlog Delete asks for confirmation and states the subitem count.
- Backlog has a grouped list and board with shared state and priority pickers. `features/backlog/backlog-page.tsx` owns the view, `backlog-display.tsx` owns Display and filters, and `backlog-item-surface.tsx` owns rows and cards. Clicking opens `backlog-peek.tsx`, a smaller item page, in the right `SidePanel`. Edit replaces it with `backlog-item-editor-form.tsx`, with explicit Save and discard returning to peek. Narrow windows show only the list and use the existing full-width editing dialog. Display preferences remain device-local and ordering stays shared with the sidebar. Archive lives in the header options menu. The detailed interaction contract is in `agents/ux-spec.md`.
- Logging time from a task or backlog item goes through New entry…. Its row menus, the right-click menu and the palette call `openNewEntryEditor` from `features/time/new-entry-request.ts`. The titlebar's popover opens with the task, and for a backlog item the work item link and note, filled in and Date on today. It anchors to the object's row while any of it shows on screen (`pickOnScreenAnchor`), otherwise to the titlebar's totals. The narrow view opens the dialog instead. The backlog has no inline hours field. Backlog rows keep the play button as the Start entry shortcut.
- The narrow view always shows the "…" on project, task and backlog rows.
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
- Backlog item notes, in the item page, the peek and import review, render through `Markdown` from `apps/web/src/components/markdown.tsx`: GitHub-flavoured markdown where single line breaks stay breaks. The parser in `markdown-renderer.tsx` loads on first use and shows the note as plain text until then. Raw HTML stays text, only web and mail links are links (opening in the system browser), images become links instead of loading, and task lists use `Checkbox`.

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
Last updated: 2026-10-14

Day remains the default, timer-first time surface. The top bar's Day | Week
control switches views at desktop widths of 768px and above. The narrow view
has no switcher. A Week link there (`?view=week`) shows Day with a note that
Week needs a wider window, and keeps `view=week`, so widening the window shows
Week. The week's range is the top bar's title in Week, with a Today chip while
the week holds today and the Submitted chip once every entry is submitted.
Under the bar a 44px toolbar holds Grid | Days (persisted locally as `grid` or
`days`) and the week total. Grid rows are 40px with the project and task on
one line, day headings read "Mon 12 7:30", today's column is tinted, weekends
are muted, and a "Totals" footer closes the table. A click on a Grid cell
opens it in the side panel: a new entry for an empty cell, the entry of a
one-entry cell with "Add another entry for <day>", or the list of a cell with
several entries (`week-grid-cell-panel.tsx`). Double-click, Enter or a digit
edits an empty or one-entry cell in place; the typed-cell rules live in
`domain/time/week-grid-cell.ts`. A cell with several entries shows "3:30 ×2"
and never edits in place. "+ Add row" adds an empty row for the week, never
saved on its own. Days use seven 40px column headers and flat 6px entry cards
with the project's color as a rail; the running card wears a success-tone
chip. Cards drag between days with thresholded pointer dragging, explicit
weekday drop targets, and Escape/pointer-cancel cleanup. Dropping a card on
its own day reorders the day, with a 2px primary line where it will land, and
commits through the same `reorderTimesheetEntries` as Alt+Up and Alt+Down. A
click or Enter on a card opens it in the side panel. Normal headers show logged totals only;
capacity target and utilization live in hover cards, with an optional compact
over-target warning.

Every time entry surface (Day rows, Days cards, Grid cells, the Grid cell list
and the entry form) exposes the same action set through a right-click menu
and a "…" button, which the narrow view always shows. Duplicate to and Move to
open a calendar dialog; Delete and Discard happen at once and show an Undo
toast. `features/time/time-entry-actions.tsx` runs the actions for every
surface.

Capacity targets and the two independent warning switches live in General
Settings. Targets are Monday-first, default to eight hours on weekdays and zero
on weekends, and remain local user preferences.

### Submit Page

Files: `apps/web/src/features/time/submit-page.tsx`, `apps/web/src/features/time/submit-week-controls.tsx`

Route `/time/$date/submit` shows the week that holds `$date`. The Time page's
Submit week action and the top bar's totals popover (`SubmitWeekButton`) open
it; the narrow view keeps the popover path. Totals and submission follow the
selected date, including historical weeks. Opening it saves valid entry drafts
and keeps invalid drafts open through the Time page's action request handler.
The top bar carries a back arrow, the title and the primary "Mark n entries as
submitted" action; in the narrow view the header renders inline. The page
leads with the total as a 28px figure beside the target, a 3px progress bar,
amber warnings and the result as a `ResultLine`, then a Group by and day-chip
toolbar and the lines under `SectionHeading`s. Every value copies on click
with an always-visible icon; hours copy as decimals. Grouping, selection,
summary and status rules live in `domain/time/timesheet-submission.ts`.
Submitting below the week target asks for confirmation.

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

# UX spec

This spec defines how Ajour behaves for the user, across the whole app. It is built one decision at a time through the [UX wayfinder map](https://github.com/les-cabochons/ajour/issues/6). Each section links the ticket that decided it. Terms follow [`GLOSSARY.md`](GLOSSARY.md).

Scope: desktop (Electron) first with web parity. The narrow view is a first-class layout. This spec covers interaction and layout. Visual tokens stay in [`ui-tokens.md`](ui-tokens.md).

## Action model

Decided in [Action model for entries, timers, projects, tasks and work items](https://github.com/les-cabochons/ajour/issues/10).

### Rules

1. Each object kind has one action set. The same items appear in the same order on every surface:
   - the right-click menu on any row, card or cell that shows the object,
   - the "…" button on the row or card, shown on hover and keyboard focus, and always shown in the narrow view,
   - keyboard shortcuts on the focused object,
   - the command palette (Cmd+K), acting on the focused object,
   - the Electron menu bar.
2. Kind decides which actions the set lists. State decides which of them are enabled. A disabled action stays in the menu with a short reason, for example "Duplicate · Stop the timer first". An action that never applies to a kind is not listed for it.
3. Some actions swap with a state counterpart in the same slot: Continue and Stop, Delete and Discard, Archive and Restore.
4. Delete, Discard and Archive come last and use the destructive style.
5. Every action has a shortcut slot. The keyboard section assigns the keys.
6. Selection is single. Focus and selection are the same thing, and actions apply to the focused object. Multi-select and bulk actions are out of scope.
7. Exception to rule 1: Move up and Move down (Alt+Up and Alt+Down) reorder sortable objects. They exist as keyboard shortcuts and palette commands only, not in the right-click or "…" menus. Sortable objects are time entries within a day, projects, tasks and top-level backlog items.

### Time entry

| Slot             | Saved    | Submitted                                                | Running                                     |
| ---------------- | -------- | -------------------------------------------------------- | ------------------------------------------- |
| Edit             | Enabled  | Enabled, with "Saving marks this entry as not submitted" | Enabled, saved with the form, keeps running |
| Continue / Stop  | Continue | Continue                                                 | Stop                                        |
| Duplicate        | Enabled  | Enabled, the copy is saved                               | Disabled: "Stop the timer first"            |
| Duplicate to…    | Enabled  | Enabled, the copy is saved                               | Disabled: "Stop the timer first"            |
| Move to…         | Enabled  | Enabled, marks the entry as not submitted                | Disabled: "Stop the timer first"            |
| Delete / Discard | Delete   | Delete                                                   | Discard                                     |

- Continue on today's entry resumes that entry. Continue on another day's entry starts a new running entry today with the same task and note. Today the code adds the new time to the original entry, even on a past day. That changes.
- Discard throws away the time counted since the entry last started. A running entry that started from nothing disappears.
- Move up and Move down apply to saved and submitted entries. The running entry stays first in its day, so Move up and Move down are disabled on it: "The running entry stays on top".

### Project

Edit · New task · Archive (Restore when archived)

- An archived project disables Edit and New task: "Restore the project first".
- Archive leaves the edit form and moves into the action set.
- Projects have no Delete.

### Task

Start entry · New entry… · Edit · Assign shortcut… · Archive (Restore when archived)

- Start entry starts a new running entry for this task.
- Assign shortcut… makes the task a pinned task with a number slot from 1 to 0, or changes or clears its slot. See the Keyboard section.
- New entry… opens the entry editor with this task filled in.
- An archived task, or a task in an archived project, disables Start entry, New entry… and Edit: "Restore the task first" or "Restore the project first".

### Backlog item

Start entry · New entry… · Edit · Add subitem · Snooze… (Unsnooze when snoozed) · Settle… (Unsettle when settled, Restore when archived) · Open in source · Archive · Delete

Changed in [#69](https://github.com/les-cabochons/ajour/issues/69). See the Backlog sidebar section for what Snooze and Settle do.

- Open in source is listed only for items synced from a connector.
- Archive is listed only for synced items. It archives the item in Ajour and leaves the source tool as it is. On a manual item, Settle already archives. An archived item disables Archive: "The item is archived".
- Settle shows as "Settle…" when it opens the settle dialog, and as "Settle" when a settle rule applies a fixed change.
- New entry… replaces the inline "Log time" field as the action for logging time.
- An archived item disables Start entry, New entry…, Edit, Add subitem and Snooze…: "Restore the item first".
- A settled item disables Snooze…: "Unsettle the item first".
- A subitem disables Add subitem: "Subitems can't have subitems".
- Delete removes the item's subitems too, and its label states the count, for example "Delete (and 2 subitems)".

### Decided elsewhere

- How Edit opens and where the action set appears inside the editor: [One entry editor for Day and Week](https://github.com/les-cabochons/ajour/issues/14).
- Which day Start entry and New entry… use from the backlog and tasks: [Running timer editing and empty duration meaning](https://github.com/les-cabochons/ajour/issues/15).
- What right-click does on a Grid cell, which can hold several entries: see the Week view section.
- Undo or confirmation for Delete, Discard, Archive and moves: see the Feedback section.
- Keys, palette layout and menu bar menus: see the Keyboard section.

## Vocabulary

Decided in [Product name and vocabulary](https://github.com/les-cabochons/ajour/issues/11). Domain terms live in [`GLOSSARY.md`](GLOSSARY.md). This section covers names and labels.

### Product name

The product is **Ajour** everywhere: window title, tab title, sidebar logo, installer and app bundle (`Ajour.app`), artifact names, copy, docs, the Electron app id, the desktop data folder, storage keys and package names. "HarDay", "Time Tracker" and "TimeTracker" disappear.

The app is not in production. The rename ships with no migration code, no redirects and no aliases. The release note tells users to export time entries and projects to Excel from Settings before upgrading, then import them again. Backlog items and preferences start fresh.

### Labels

- All labels, headings and buttons use sentence case.
- "Task" only ever means a task inside a project. Pickers keep the "Project / task" label.
- The Backlog page shows **backlog items** and **subitems**, never "tasks" or "subtasks".
- Time views are **Day** and **Week**. The Week view layouts are **Grid** (the project-by-day table, formerly Ledger) and **Days** (one column of cards per day, formerly Lanes).
- The user sees **Schema**, never "data shape". Code identifiers may keep `dataShape`.

### Settings navigation

Each nav label matches its page title. Old routes are removed, not redirected.

| Nav label    | Page title                     | Route                    |
| ------------ | ------------------------------ | ------------------------ |
| General      | General                        | `/settings/general`      |
| Plugins      | Plugins                        | `/settings/plugins`      |
| Backlog      | Backlog                        | `/settings/backlog`      |
| Projects     | Projects                       | `/settings/projects`     |
| Time entries | Import and export time entries | `/settings/time-entries` |
| Sync review  | Sync review                    | `/settings/sync-review`  |
| Debug        | Debug                          | `/settings/debug`        |

The Plugins page tabs are **All · Connectors · Schemas**.

## App shell

Decided in [App shell and collapsible sidebar](https://github.com/les-cabochons/ajour/issues/12). Prototype: branch `prototype/app-shell`, variant A.

### Desktop widths

- The app sidebar has two states: expanded (logo and labels, resizable, see the Backlog sidebar section for widths) and a 52px icon rail (icons with tooltips). Time, Backlog and Projects sit at the top, and Settings at the bottom.
- The expanded sidebar lists backlog items below Time, Backlog and Projects. The rail does not. See the Backlog sidebar section.
- Cmd+B (Ctrl+B on Windows) and a button next to the logo toggle it. The View menu gets "Show sidebar" or "Hide sidebar" once the menu bar exists. There is no second shortcut.
- The state is saved per device. Below 1100px the sidebar collapses to the rail on its own, without changing the saved preference.
- Settings opens inside the shell. The app sidebar stays visible with Settings active, and the settings pages are listed in a second column next to the page. There is no separate "back" control, because the user never leaves the app.
- Projects keeps its own list of projects next to the app sidebar, with no collapse control of its own.
- The titlebar keeps New entry (+), Start (▶), the running entry pill and the totals pill. The date picker only shows in the narrow view.

### Narrow view

Below 768px there is no rail and no sidebar, including the Projects list. See the Narrow view section.

## Narrow view

Decided in [Narrow view](https://github.com/les-cabochons/ajour/issues/13). Prototype: branch `prototype/narrow-view`, variant C. The narrow view is a first-class layout, also used on desktop as a small companion window.

### Breakpoints

| Width           | Layout                                          |
| --------------- | ----------------------------------------------- |
| 1100px and up   | Desktop, sidebar expanded or rail by preference |
| 768px to 1099px | Desktop, 52px rail                              |
| Below 768px     | Narrow view, no rail and no sidebars            |

Today's splits at 640px and 1023px go away.

### Navigation

- The titlebar holds a segmented switcher for Time and Backlog. The active section shows its label, the other shows only its icon.
- The running entry pill, the totals pill and New entry stay in the titlebar.
- A cog button at the trailing edge opens Settings. A search button may join it later. See [Keyboard model and command palette](https://github.com/les-cabochons/ajour/issues/18).
- Settings opens on a list of its pages. Each page has a back arrow to that list.
- Projects lives inside Settings in the narrow view. The Settings list has one Projects entry that opens the full Projects section: the project list, project detail and the archive. Importing and exporting projects is an action inside that section, not a separate settings page.
- Wide windows keep Projects in the sidebar and keep the separate import and export settings page.

### Jobs and views

- The narrow view covers the running entry, logging and fixing entries by day, browsing and starting backlog items, changing settings and projects, and submitting a timesheet. The submit flow belongs to [Submit timesheet flow in full and narrow windows](https://github.com/les-cabochons/ajour/issues/24).
- Week is not available. The view menu does not offer it, and a Week link opens Day with a short note that Week needs a wider window.

### Actions and editing

- Rows always show the "…" button. On touch screens, a long press opens the same menu.
- Page actions that floated over the content, such as the Backlog filter and "+", move into the page header.
- Editing an entry uses the full-width entry dialog. Its behavior comes from [One entry editor for Day and Week](https://github.com/les-cabochons/ajour/issues/14).

## Entry editor

Decided in [One entry editor for Day and Week](https://github.com/les-cabochons/ajour/issues/14). Prototype: branch `prototype/entry-editor`, route `/prototype/entry-editor`.

### One form

Creating and editing a time entry always use the same form:

- Header: the title ("New time entry" or "Edit time entry"), the entry's date, the "…" action menu for saved entries, and × to close.
- Fields: Project / task, Note, Hours, Date (`TimeEntryFields`), with the shared draft rules (`time-entry-editor.ts`). See the Running entries section for Date and empty Hours.
- Footer: Cancel · Start (Switch while another entry runs, Continue on a saved entry, Stop on the running entry) · Save.

The Day view's inline new row and the titlebar's own create form go away. What an empty Hours field means belongs to [Running timer editing and empty duration meaning](https://github.com/les-cabochons/ajour/issues/15).

### Hosts

| Where                                                                     | Host                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Day and Week views (rows, Days cards, Grid cells, "+ New entry", "+ Add") | Side panel docked on the right. The day or week stays visible.                      |
| Titlebar "+", on any page                                                 | Popover anchored to the "+". Adding an entry never requires going to the Time page. |
| New entry… on tasks and backlog items                                     | The same popover, anchored to the row or menu that opened it.                       |
| Narrow view, everywhere                                                   | Full-width dialog.                                                                  |

The form is the same in every host. Only its container changes.

### Saving and closing

- Save: the Save button, Enter in Hours or in Note, or Cmd/Ctrl+Enter anywhere in the form. Shift+Enter in Note inserts a line break.
- Escape or × closes the editor and discards changes.
- Clicking outside does nothing.
- In the side panel, clicking another entry while the draft has valid changes saves it, then loads the new entry. An invalid draft blocks the switch and shows its error.
- After saving, the editor closes and focus returns to the row or card it came from.

## Running entries

Decided in [Running timer editing and empty duration meaning](https://github.com/les-cabochons/ajour/issues/15).

### Editing

- The running entry opens in the same form as every entry. Edit from its menu, or a click on its row or card, opens the side panel in Day and Week. A click on the titlebar's Running pill opens the form in a popover anchored to the pill. The narrow view uses the full-width dialog.
- The footer reads Cancel · Stop · Save. Save applies the changes and the entry keeps running. Nothing changes until the user saves. The old live-editing popup goes away.
- Hours shows the time counted so far and stays editable, so the user can correct a late start before saving.
- Discard happens at once and shows the Undo toast (see Feedback).

### Starting

- In a new entry with empty Hours, Save is disabled with "Enter hours, or press Start", and Enter presses Start. Ajour never saves a 0h entry.
- With Hours filled, Start counts on from that time: typing 0:30 then Start gives a running entry at 0:30.
- A running entry is always on today. Starting from another day's form starts the entry today, and the form says "Starts today". An entry that runs past midnight stays on the day it started; Move to… changes that.
- Starting while another entry runs saves the running one and switches, without a prompt. The button reads Switch instead of Start. The Running pill and the rows show the switch; no message appears.
- Start entry on tasks and backlog items starts on today, as it does now.

### Date field

The form gets a Date field after Hours. It defaults to the open day in Day, the clicked day in Week, and today everywhere else, such as the titlebar "+" or New entry… on a backlog item. The running entry hides it, because it is always today.

### Labels

Buttons read Start, Switch and Stop, and the titlebar pill reads Running. Users never see the word "timer". Tasks and backlog items keep "Start entry".

## Week view

Decided in [Adding and changing time in the week view](https://github.com/les-cabochons/ajour/issues/16). Prototype: branch `prototype/week-grid`, route `/prototype/week-grid`, variant C. Editing and creating use the side panel from the Entry editor section.

### Grid

- A click on a cell opens it in the side panel:
  - an empty cell opens a new entry with the row's task and the day filled in,
  - a cell with one entry opens that entry, with an "Add another entry for <day>" button under the form,
  - a cell with several entries lists them, with "Add another entry".
- Double-click, Enter, or typing a digit on a focused cell edits its hours in place. Enter or Tab saves, Tab moves to the next day, Escape cancels. Clearing the hours of a one-entry cell deletes that entry and shows the Undo toast.
- A cell with several entries shows its total and a count, such as "3:30 ×2", and never edits in place.
- The side panel's cell list replaces the old tray in the bottom-left corner.
- "+ Add row" picks a project or task and shows an empty row. The row disappears when the user leaves the week unless it gets hours. Rows are never saved on their own.
- Right-click on a cell starts with Add entry. On a one-entry cell, that entry's action set follows. On a cell with several entries, Open entries follows.

### Days

- "+ Add" in each column opens a new entry for that day in the side panel.
- A click on a card opens it in the side panel. Cards keep "…" and right-click with the time entry action set.
- Dragging a card to another day moves it. Move to… is the keyboard path. Shortcuts come from [Keyboard model and command palette](https://github.com/les-cabochons/ajour/issues/18), and a move shows the Undo toast.

## Feedback

Decided in [Undo, confirmation and feedback policy](https://github.com/les-cabochons/ajour/issues/17).

### Principle

Feedback appears where the action happened. Toasts are kept to two cases: Undo, and errors from background work that has no place on screen.

### Undo instead of confirmation

These actions happen at once and show a toast with Undo for about 8 seconds. No confirmation dialog.

- Deleting a time entry, or clearing a one-entry Grid cell.
- Discarding a running entry.
- Moving an entry to another day, by drag or Move to….
- Duplicate to… another day. Undo removes the copy. The toast names the day, such as "Duplicated to Thu, Oct 8".
- Archiving a project, task or backlog item.
- Snoozing or settling a backlog item. A settle that writes to the source tool sends the write when the toast closes, so Undo cancels it.
- Deleting a backlog item and its subitems.
- Deleting a backlog status.
- Dismissing import drafts.

Undo restores the records as they were before the action. Only the last action can be undone, and only while its toast shows. Cmd+Z (Ctrl+Z) presses Undo while the toast shows and focus is not in a text field. Saved edits have no undo.

### Confirmation

A confirmation dialog stays only for actions that cannot be undone or that reach outside Ajour:

- Uninstalling a plugin.
- Submitting under the week target.
- Any other action that writes to Azure DevOps or Jira. Settle is the exception: its dialog is the confirmation, then the Undo toast gives a few seconds to cancel before the write. A settle rule set to Apply skips the dialog, because the user chose that change in Settings.

### Success

No success toasts. The result shows where the action happened:

- Submitting a timesheet: the submit flow shows its own result. See [Submit timesheet flow in full and narrow windows](https://github.com/les-cabochons/ajour/issues/24).
- Imports and exports: the page shows the result inline, such as the file name and counts.
- A connector sync the user started: the connector shows that it is syncing, then when it last synced.
- Starting or switching an entry from another page: the Running pill and the row update.

### Errors

- Form mistakes show next to the field, as now.
- An operation the user started (import, export, sync, plugin install) shows its error inline on that page.
- Background failures, such as an automatic connector sync, show one error toast per failure that stays until dismissed, and a "Last sync failed" line on that connector in Settings.
- A settle write that fails after the Undo window puts the item back to active and shows an error toast, naming the item and the reason, that stays until dismissed.

### Toasts

Bottom right in a full window, bottom center above the content in the narrow view. At most three, newest on top. Built on the Base UI toast component.

## Keyboard

Decided in [Keyboard model and command palette](https://github.com/les-cabochons/ajour/issues/18).

### Style

Frequent in-app actions use single keys. They only work when focus is not in a text field. Modifier shortcuts are kept for OS conventions and app-wide commands: Cmd+K, Cmd+B, Cmd+Z, Cmd+, and Cmd+Enter. Cmd means Ctrl on Windows. The web build uses the same keys.

### Global shortcuts

| Key                | Action                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| N                  | New entry: side panel on the Time pages, popover elsewhere                  |
| S                  | Stop the running entry, or start a new one when nothing runs                |
| C                  | Continue the focused entry, or the most recent entry when none is focused   |
| T                  | Go to today                                                                 |
| [ / ]              | Previous / next day, or week in the Week view                               |
| D / W              | Day view / Week view                                                        |
| G then T, B, P, S  | Go to Time, Backlog, Projects, Settings                                     |
| 1 to 0             | Open the new entry form with the pinned task in that slot filled in         |
| Shift+1 to Shift+0 | Start a running entry for that pinned task, switching if another entry runs |
| Cmd+B              | Show or hide the sidebar                                                    |
| Cmd+Z              | Press Undo on the visible Undo toast                                        |
| Cmd+,              | Settings                                                                    |
| Cmd+K              | Command palette                                                             |
| ?                  | Keyboard shortcuts                                                          |

### Pinned tasks

- A pinned task has a number slot from 1 to 0, ten in all. "Assign shortcut…" on the task sets, changes or clears it. A slot belongs to at most one task.
- The slot shows next to the task in the project task picker and on the task row.
- The plain digit only opens the form, so a stray key press never stops the running entry. Starting needs Shift.
- While an entry is being edited, the digits do nothing special.
- When a Grid cell has focus, digits edit its hours instead. Anywhere else, digits start pinned tasks.

### Focused rows and cards

- Day rows become focusable, like Week cards.
- ↑ and ↓ move focus between rows or cards. ← and → move between days in Days and between cells in the Grid.
- Enter goes one level deeper. On a time entry, task or project it opens Edit. On a backlog item row it opens the backlog item page, and on that page it opens Edit. E no longer opens Edit. Delete or Backspace deletes, with the Undo toast.
- On a focused backlog item, or on its page, E settles and B snoozes, as in Gmail. Shift+E opens the settle dialog even when a settle rule applies a fixed change. Cmd+D duplicates. M opens Move to…. Alt+↑ and Alt+↓ reorder.
- The context menu key, Shift+F10 or "." opens the "…" menu. Escape closes whatever is open.
- Every item in the "…" and right-click menus shows its key, so the menus teach the shortcuts.

### Command palette

Cmd+K opens one palette with navigation, global actions, the focused item's actions, and search across projects, tasks and backlog items, so "Start Development" works from anywhere. The narrow view's future search button opens it. It replaces the Projects command dialog. Searching time entry notes is left for later.

### Menu bar

- Menus:
  - Ajour: About, Settings… (Cmd+,), Check for updates, Quit.
  - Edit: the standard Undo, Cut, Copy, Paste and Select All. macOS needs them for clipboard shortcuts.
  - View: Day, Week, Show or Hide sidebar, Today, Previous, Next, zoom.
  - Entry: the focused entry's action set.
  - Window, and Help with Keyboard shortcuts.
- macOS uses the native menu bar. On Windows the menus live in the app's title bar at full widths, like the ChatGPT app, and disappear in the narrow view.
- Production builds drop Reload and DevTools. Development builds keep them.
- Single-key shortcuts show in the menus as labels without being registered, so they never fire while the user types.
- The web build has no menu bar. The palette and the "?" overlay cover everything the menus offer.

### Shortcut reference

"?" opens an overlay listing every shortcut, with a search field.

## Submit timesheet

Decided in [Submit timesheet flow in full and narrow windows](https://github.com/les-cabochons/ajour/issues/24). Prototype: branch `prototype/submit-flow`, route `/prototype/submit`, variant B. Submitting means copying the week into Workday by hand, then marking the entries as submitted in Ajour.

### Entry point

One "Submit week" button, styled the same, sits in the Day and Week headers at every width, including the narrow view. It opens the submit page for the selected week. The submit page replaces the modal.

### Summary

- The page leads with the week's total against its target, a progress bar, and warnings such as days under target or entries without a task.
- The total and warnings follow the current selection.
- Submitting under the week target still asks for confirmation.

### Grouping and copying

- A "Group by" control offers three options:
  - Day and task (the default): one section per day, one line per task in that day, hours added up, comments merged with " | ".
  - Day: one section per day, one line per entry.
  - Task: one line per task for the whole week, no days, hours added up, comments merged.
- Every line shows project, task, hours and comments. Each value has an always-visible copy icon. Clicking the value or the icon copies it, and a checkmark replaces the icon for a second. There is no hover reveal and no popover.
- Copied hours use decimals, such as 5.00. The screen shows clock time, such as 5:00.

### Selection

- All the week's unsubmitted entries start selected.
- Day chips, Mon to Sun, drop or add a whole day's entries, for partial weeks.
- Each line has one checkbox that includes or excludes all the entries behind it.
- The button reads "Mark 9 entries as submitted".

### Result

- After marking, the summary shows "Week submitted on Oct 11, 2:54 AM · 14 entries · 37:00" in place. No toast.
- The Week header shows a Submitted badge for that week.
- Editing a submitted entry returns it to saved. The submit page then shows "3 entries changed since you submitted", and the button reads "Mark changes as submitted".

## Backlog

Decided in [Backlog page under the new conventions](https://github.com/les-cabochons/ajour/issues/25).

- Editing a backlog item uses the side panel, like time entries, with the same rules: explicit Save (button, Enter in the title, Cmd+Enter), Escape or × discards, outside clicks do nothing. The narrow view uses the full-width dialog. This replaces the inline expanded editor, the mobile modal, the title edit mode and the separate note modal. Escape no longer saves.
- The panel holds title, status, priority, project and task mapping, note, the estimates with their "Reset to subitem total" buttons, and "Keep when missing from sync" for synced items. Its header has the "…" action menu.
- "New backlog item" in the page header opens a blank panel. "Add subitem" opens the panel with the parent set.
- Subitems stay listed under their parent row, expanded with the row's chevron.
- The page header holds the Active / Settled / Archived switch and the sort menu at every width. Snoozed items stay under Active with a snoozed marker. The floating filter and "+" buttons go away.
- Clicking a row or pressing Enter opens the backlog item page. Edit opens the side panel.
- The row's play button stays as the Start entry shortcut. Entries start on today.

## Backlog sidebar

Decided in [Backlog sidebar with settle, snooze and a backlog item page](https://github.com/les-cabochons/ajour/issues/69). The connector side is [#70](https://github.com/les-cabochons/ajour/issues/70). Delayed writes are recorded in [ADR 0001](adr/0001-connector-writes-after-undo-window.md).

The sidebar works like the T3 Code sidebar: navigation at the top, then the work itself.

### List

- Below Time, Backlog and Projects, the expanded sidebar lists active backlog items in the Backlog page's current order, custom or priority. There is one ordering.
- The list holds top-level items and subitems that have their own priority. A subitem without a priority follows its parent and does not show.
- With priority order, a subitem with its own priority mixes with top-level items by priority. With custom order, it sits right below its parent. If its parent is snoozed or settled, it takes the parent's place.
- Snoozed, settled and archived items leave the list.
- The rail and the narrow view have no item list. The Backlog page is the way in.

### Layout options

Decided after the prototype on branch `prototype/backlog-sidebar`: variant B is the default, variant A is the compact layout, and variant C's Up next card is an option.

- Density has two values. Comfortable is the default. Compact fits more items.
- Show Up next is on by default. It works with both densities.
- Both live in a "Sidebar" group in Settings > General and as View menu entries next to Show or Hide sidebar. They are saved per device.
- The Snoozed and Settled sections are the same in every layout.

### Width

- Dragging the sidebar's edge resizes it from 200px to 400px.
- The default width is 272px for Comfortable and 200px for Compact. It applies until the user drags the edge, or after a double-click on the edge resets it.
- One dragged width is saved per device. Switching density keeps it.
- Dragging the edge below 200px snaps the sidebar to the rail, as in VS Code. Dragging the rail's edge outward expands it again at the saved width.
- The toggle button next to the logo stays visible in both states, so there is always a visible control to show the sidebar again. Cmd+B still toggles it.

### Rows

- Comfortable: the type icon, the title on up to two lines, and a muted meta line with the external id ("Local" for a manual item), the source state and the remaining estimate, such as "#48213 · Active · 2.5h left". A subitem's meta line shows its parent instead, such as "↳ Login page".
- Compact: one line with the type icon and the title. A subitem shows its parent after the title in muted text, such as "Fix token refresh · Login page". The title comes first because 200px leaves about 18 characters, and about 8 once the hover actions show.
- In Comfortable, the hover actions float over the row's top right corner. In Compact, they replace the markers at the end of the line.
- A marker shows on the item with the running entry.
- A dot shows on a returned item. Opening the item from anywhere, or clicking the dot, clears it.
- Clicking a row opens the backlog item page.
- With Show Up next on, the first item of the list shows as a card above the others: type icon, external id, title, markers, and Start entry, Snooze and Settle buttons. Compact shows the buttons as icons only. The list below starts at the second item.
- Hover and keyboard focus show Start entry, Snooze and Settle. The button always says Settle. Right-click and "…" open the full action set.

### Snoozed and Settled sections

- Two collapsible sections follow the list: "Snoozed (n)", then "Settled". Both start collapsed. Their state is saved per device.
- Snoozed lists items by the time they return, and each row shows it, such as "Tomorrow 9:00". The hover action is Unsnooze. An unsnoozed item goes back to the list with no dot.
- Settled lists every settled item, newest first, 20 at a time with "Show more". The hover action is Unsettle. Archived items are not listed. They live in the Backlog page's Archived view.
- Clicking a row in either section opens the backlog item page.

### Snooze

- Snooze… offers: In an hour, In 3 hours, This afternoon (13:00, offered only before noon), Tomorrow (9:00 the next calendar day), Next week (Monday 9:00), and Custom (date and time).
- Snooze is local. The source tool never learns about it. It shows the Undo toast.
- A running entry on the item keeps running.
- When the snooze ends, the item returns to the list as returned, at its normal place in the order. A snooze that ended while Ajour was closed returns at the next launch.
- Any item that can show in the list can be snoozed, including subitems with their own priority.

### Settle

Settle means the user has nothing left to do on the item for now.

- A manual item becomes archived.
- A synced item becomes settled. Its source project's settle rule decides how:
  - Ask, the default, opens the settle dialog: a state picker grouped by state category and a priority field, both starting at the item's current values. Settling with nothing changed is allowed and stays local, such as for "waiting on the client" when no matching state exists.
  - Apply sets a fixed state, priority or both without a dialog.
- Settling into a state in a done category archives the item instead. Done categories are Azure DevOps Completed and Removed, and Jira Done. Azure DevOps Resolved is not done, because it usually means waiting on QA.
- Only changed fields are written, and only after the Undo toast closes. If Ajour quits during the window, the write is sent at the next launch. There is no offline queue beyond that.
- Settling stops and saves the running entry on the item. Undo restores the entry as it was, still running from its original start.
- A plugin without the settle capability settles its items locally, with no write.
- Settling a parent carries its subitems that have no priority of their own: they settle or archive with it, and Undo restores them together. Subitems with their own priority keep their own state. Settling a synced subitem writes that subitem, under its own source project's settle rule.
- The dialog does not offer an assignee yet. Ajour does not import assignees. See [#71](https://github.com/les-cabochons/ajour/issues/71).
- Settle is the only action that writes priority to the source. Priority edits in the side panel stay local.

### Unsettle and restore

- Unsettle puts a settled item back to active. It is local, with no dialog and no write.
- Restore puts an archived item back to active, as before.

### Sync

Syncs move synced items between states:

| What the sync shows                                     | Result                                         |
| ------------------------------------------------------- | ---------------------------------------------- |
| An active or settled item reached a done category       | Archived                                       |
| Someone else changed a settled item's state or priority | Active, as returned                            |
| An item dropped out of the sync                         | Archived, as today. It returns if it reappears |

### Settle rules

- Settings > Backlog lists, for each connection, the source projects seen in syncs. Each has a settle rule: Ask or Apply, and for Apply the target state, priority or both.
- Manual items have no settle rule. They always archive.
- With Apply, E and the sidebar's Settle button use the rule. Shift+E or Shift-click opens the dialog prefilled with it.

### Backlog item page

- The page lives at `/backlog/$itemId`. Clicking a row in the sidebar or on the Backlog page, or pressing Enter on it, opens it.
- V1 shows only what Ajour stores: title, type and external id with Open in source, source state and backlog status, project and task mapping, priority, estimates with their sync state, note, parent and subitems, and the time entries logged on it.
- Layout, from the prototype: variant C's header over variant A's body.
  - Header: the type icon in a square tile, the title, and a muted line with the external id (linked to the source), the source project and the source state. The actions sit on the right: Start entry, Snooze, Settle and "…", or Unsnooze, Unsettle or Restore depending on the state.
  - A notice under the header when the item is snoozed, settled, archived or returned, such as "Settled today 7:51 p.m. · waiting in "Waiting for client"".
  - Four tiles: Original, Remaining, Completed and Logged in Ajour. A tile shows the estimate's sync conflict when there is one.
  - A progress bar: completed over original.
  - Two columns below. The main column has the note, the subitems and the time entries. The right panel lists state, backlog status and priority, then project, task and source project.
- The right panel leaves room for fields not imported yet, such as assignee, iteration, area path, tags, acceptance criteria and comments. See [#71](https://github.com/les-cabochons/ajour/issues/71).
- The page is designed for Azure DevOps first, then Jira.
- The page header has the "…" action menu. Edit opens the side panel over the page.

## Projects

Decided in [Projects pages under the new conventions](https://github.com/les-cabochons/ajour/issues/26).

- The project list keeps its search field and an "Archived" entry at the bottom. Wide windows show it next to the app sidebar. The narrow view shows it inside Settings.
- "New project" in the list header and Edit from the project's action set open the project form as a standard dialog: name, display name, code, icon and color.
- Editing a task uses the side panel, with the same Save and Escape rules as entries. It holds name, billable, budget and adjustment, and the pinned slot. The inline task editor that saved on outside click goes away.
- "New task" in the project header opens a blank task panel. "Import tasks…" moves into the project header's "…" menu.
- A task row shows its pinned slot, such as "3", next to its name.
- The old Projects command dialog is removed. Cmd+K offers "Create project" and "Create task in…".

## Settings

Decided in [Settings and Sync review under the new conventions](https://github.com/les-cabochons/ajour/issues/27).

- Pages keep their content, with sentence case and the labels from the Vocabulary section.
- Results and errors of imports, exports and syncs show inline on their page, per the Feedback section.
- When the local connector API is not running, as in the web build, Plugins shows one calm notice: "Connectors need the desktop app". Backlog and Sync review hide their connector sections instead of showing red error banners.
- Sync review keeps its list with selection, "Sync selected to backlog", and Dismiss. Dismiss shows the Undo toast instead of asking.
- The Debug page only exists in development builds.
- Settings > Backlog lists, for each connection, the source projects seen in syncs, each with its settle rule. See the Backlog sidebar section.

## Consistency

Decided in [Consistent dialogs, tooltips, loading and drags](https://github.com/les-cabochons/ajour/issues/28).

- Every modal surface uses the `Dialog`, `AlertDialog` or `Sheet` primitive. The hand-built overlays (backlog task and note, project form, the old submit modal) go away.
- Icon-only buttons use the `Tooltip` primitive, showing the label and its shortcut, instead of `title=` attributes.
- Route loading shows a `Skeleton` of the page layout after 150ms instead of a blank page.
- Escape cancels every drag and puts the item back. Dropping an item where it started changes nothing. Moves between days show the Undo toast.

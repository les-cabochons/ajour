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

Start entry · New entry… · Edit · Add subitem · Open in source · Archive (Restore when archived) · Delete

- Open in source is listed only for items synced from a connector.
- New entry… replaces the inline "Log time" field as the action for logging time.
- An archived item disables Start entry, New entry…, Edit and Add subitem: "Restore the item first".
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

- The app sidebar has two states: expanded (200px, logo and labels) and a 52px icon rail (icons with tooltips). Time, Backlog and Projects sit at the top, and Settings at the bottom.
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

| Where                                                                         | Host                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Day and Week views (rows, Days cards, Grid tray rows, "+ New entry", "+ Add") | Side panel docked on the right. The day or week stays visible.                      |
| Titlebar "+", on any page                                                     | Popover anchored to the "+". Adding an entry never requires going to the Time page. |
| New entry… on tasks and backlog items                                         | The same popover, anchored to the row or menu that opened it.                       |
| Narrow view, everywhere                                                       | Full-width dialog.                                                                  |

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
- Deleting a backlog item and its subitems.
- Deleting a backlog status.
- Dismissing import drafts.

Undo restores the records as they were before the action. Only the last action can be undone, and only while its toast shows. Cmd+Z (Ctrl+Z) presses Undo while the toast shows and focus is not in a text field. Saved edits have no undo.

### Confirmation

A confirmation dialog stays only for actions that cannot be undone or that reach outside Ajour:

- Uninstalling a plugin.
- Submitting under the week target.
- Any future action that writes to Azure DevOps or Jira.

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
- Enter or E opens Edit. Delete or Backspace deletes, with the Undo toast. Cmd+D duplicates. M opens Move to…. Alt+↑ and Alt+↓ reorder.
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

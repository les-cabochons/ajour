# UX spec

This spec defines how Ajour behaves for the user, across the whole app. It is built one decision at a time through the [UX wayfinder map](https://github.com/les-cabochons/ajour/issues/6). Each section links the ticket that decided it. Terms follow [`GLOSSARY.md`](../../GLOSSARY.md).

Scope: desktop (Electron) first with web parity. The narrow view is a first-class layout. This spec covers interaction and layout. Visual tokens stay in [`ui-tokens.md`](ui-tokens.md).

## Action model

Decided in [Action model for entries, timers, projects, tasks and work items](https://github.com/les-cabochons/ajour/issues/10).

### Rules

1. Each object kind has one action set. The same items appear in the same order on every surface:
   - the right-click menu on any row, card or cell that shows the object,
   - the "…" button on the row or card, shown on hover and keyboard focus, and always shown in the narrow view, except Grid rows as described in rule 8 and time entry rows and cards as described in rule 10,
   - keyboard shortcuts on the focused object,
   - the command palette (Cmd+K), acting on the focused object,
   - the Electron menu bar.
2. Kind decides which actions the set lists. State decides which of them are enabled. A disabled action stays in the menu, greyed out. Menus do not say why (decided in [#288](https://github.com/les-cabochons/ajour/issues/288)); screen readers hear the reason as the item's description, and the command palette and disabled buttons still show it, for example "Stop the running entry first". An action that never applies to a kind is not listed for it.
3. Some actions swap with a state counterpart in the same slot: Continue and Stop, Delete and Discard, Archive and Restore.
4. Delete, Discard and Archive come last and use the destructive style.
5. Every action has a shortcut slot. The keyboard section assigns the keys.
6. Focus and selection are the same thing, and actions apply to the focused object, except for time entries on the Day list and the Week Days cards, which select like a file explorer (see "Selecting, copying and pasting entries"). There, selection-wide actions apply to every selected entry and single-subject actions to the focused entry. Delete row in the Week Grid removes the entries of one project/task row for that week.
7. Exception to rule 1: Move up and Move down (Alt+Up and Alt+Down) reorder sortable objects. They exist as keyboard shortcuts and palette commands only, not in the right-click or "…" menus. Sortable objects are time entries within a day, projects, tasks and top-level backlog items.

8. Grid rows have no "…" button. Delete row appears in the right-click menu on the row name and its cells. Shift+Backspace works on focused cells only, so only the cell menu shows the shortcut.

9. Exception to rule 2: Mark as not committed is listed on committed entries only. Listed and disabled on every other entry, it would add a line to most menus for a rare repair.

10. Time entry rows and cards (Day rows, Days cards and the Grid cell list) have no "…" button. Right-click and the menu keys open their action set. Day rows show Continue at their end, and the running row shows Stop in the same slot.

11. Exception to rule 1: Cut, Copy and Paste are listed only in the menus of Day rows and Days cards, where entries can be selected. Grid cells and editors do not list them.

12. Exception to rule 2: an action disabled because its week is submitted shows no reason in the command palette either, since every such action would repeat the same sentence. In Ajour's own menus and the palette it stays greyed out but can still be chosen: choosing it, or pressing its key, changes nothing and shows the reason as a toast, "The week of Oct 12 is submitted. Reopen it to change it." The desktop app's native right-click menus cannot choose a greyed-out item, so there it is only greyed out.

### Time entry

| Slot                  | Saved      | Committed                                                       | Running                                     |
| --------------------- | ---------- | --------------------------------------------------------------- | ------------------------------------------- |
| Edit                  | Enabled    | Enabled                                                         | Enabled, saved with the form, keeps running |
| Continue / Stop       | Continue   | Continue                                                        | Stop                                        |
| Duplicate             | Enabled    | Enabled, the copy is saved                                      | Disabled: "Stop the timer first"            |
| Duplicate to…         | Enabled    | Enabled, the copy is saved                                      | Disabled: "Stop the timer first"            |
| Move to…              | Enabled    | Enabled                                                         | Disabled: "Stop the timer first"            |
| Mark as not committed | Not listed | Enabled, the entry shows as updated on the Commit page (rule 9) | Not listed                                  |
| Delete / Discard      | Delete     | Delete                                                          | Discard                                     |

- Continue on today's entry resumes that entry. Continue on another day's entry starts a new running entry today with the same task and note. Today the code adds the new time to the original entry, even on a past day. That changes.
- Discard throws away the time counted since the entry last started. A running entry that started from nothing disappears.
- Move up and Move down apply to saved and committed entries. Each day lists its entries oldest first, so a new entry lands at the end. Continuing an entry never moves it: the running entry keeps that entry's place in every view and moves like it. A new running entry, with no saved entry yet, stays last in its day, so Move up and Move down are disabled on it: "A new running entry stays last".

### Project

Edit · New task · Add to favorites (Remove from favorites when starred) · Archive (Restore when archived)

- An archived project disables Edit, New task and Add to favorites: "Restore the project first".
- Archive leaves the edit form and moves into the action set.
- Projects have no Delete.

### Task

Start entry · New entry… · Edit · Assign shortcut… · Add to favorites (Remove from favorites when starred) · Archive (Restore when archived)

- Start entry starts a new running entry for this task.
- Assign shortcut… makes the task a pinned task with a number slot from 1 to 0, or changes or clears its slot. See the Keyboard section.
- New entry… opens the entry editor with this task filled in.
- Add to favorites stars the task, so it shows in the task menu's Favorites. See [Task menu](#task-menu).
- An archived task, or a task in an archived project, disables Start entry, New entry… and Edit: "Restore the task first" or "Restore the project first".

### Backlog item

Start entry (Stop while its entry runs) · New entry… · Edit · Add subitem · Snooze… (Unsnooze when snoozed) · Pin (Unpin when pinned) · Settle… (Unsettle when settled, Restore when archived) · Open in source · Archive · Delete

Changed in [#69](https://github.com/les-cabochons/ajour/issues/69). See the Backlog sidebar section for what Snooze and Settle do.

- Open in source is listed only for items synced from a backlog plugin.
- Archive is listed only for synced items. It archives the item in Ajour and leaves the source tool as it is. On a manual item, Settle already archives. An archived item disables Archive: "The item is archived".
- Settle shows as "Settle…" when it opens the settle dialog, and as "Settle" when a settle rule applies a fixed change.
- New entry… replaces the inline "Log time" field as the action for logging time.
- An archived item disables Start entry, New entry…, Edit, Add subitem, Snooze… and Pin: "Restore the item first".
- A settled item disables Snooze… and Pin: "Unsettle the item first".
- A subitem disables Add subitem: "Subitems can't have subitems".
- Delete removes the item's subitems too, and its label states the count, for example "Delete (and 2 subitems)".

### Right-click menus

Decided in [Native right-click menus with groups and Cut, Copy, Paste](https://github.com/les-cabochons/ajour/issues/288).

- A menu draws a line between groups of related actions. Each action set names its groups (`group` in `domain/actions/object-actions.ts`), and the destructive actions at the end share the last one:
  - time entry: Edit · Continue/Stop | Cut · Copy · Paste | Duplicate · Duplicate to… · Move to… · Mark as not committed | Delete/Discard
  - backlog item: Start entry/Stop · New entry… | Edit · Add subitem | Snooze… · Pin · Settle | Change source state… · Open in source | Archive · Delete
  - task: Start entry · New entry… | Edit · Assign shortcut… · Add to favorites | Archive/Restore
  - project: Edit · New task | Archive/Restore
  - calendar suggestion: Add · Choose project… | Dismiss · Hide this meeting · Forget this meeting
  - pull request: Open in the provider | Settle · Snooze…
- The desktop app shows right-click menus with the system's menus: an NSMenu on macOS, and Electron's menus styled for the platform on Windows and Linux, as T3 Code does. They follow Ajour's theme, not only the system's. Each item shows its key and nothing else: no reason, no hint. macOS puts a bin before Delete and Discard and a box before Archive. The browser keeps Ajour's own menu, and the "…" menus stay Ajour's own everywhere.
- A right-click in a text field, or on selected text, opens the system's edit menu: Cut, Copy, Paste, then Select all, after spelling suggestions and Copy link when they apply. A text field inside a row or card gets this menu, not the object's. A right-click anywhere else that no object claims opens nothing.
- Day rows and Days cards list Cut, Copy and Paste after Continue, with ⌘X, ⌘C and ⌘V (rule 11). They act as those keys do (see "Selecting, copying and pasting entries"). Paste is disabled until entries are copied.

### Decided elsewhere

- How Edit opens and where the action set appears inside the editor: [One entry editor for Day and Week](https://github.com/les-cabochons/ajour/issues/14).
- Which day Start entry and New entry… use from the backlog and tasks: [Running timer editing and empty duration meaning](https://github.com/les-cabochons/ajour/issues/15).
- What right-click does on a Grid cell, which can hold several entries: see the Week view section.
- Undo or confirmation for Delete, Discard, Archive and moves: see the Feedback section.
- Keys, palette layout and menu bar menus: see the Keyboard section.

## Vocabulary

Decided in [Product name and vocabulary](https://github.com/les-cabochons/ajour/issues/11). Domain terms live in [`GLOSSARY.md`](../../GLOSSARY.md). This section covers names and labels.

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

The pages sit in three groups, **App**, **Work** and **Data**, in this order. Pull requests also appears under Work in the narrow view, and Calendar only while a calendar plugin is on.

| Group | Nav label    | Page title                     | Route                    |
| ----- | ------------ | ------------------------------ | ------------------------ |
| App   | General      | General                        | `/settings/general`      |
| App   | Plugins      | Plugins                        | `/settings/plugins`      |
| App   | Vault        | Vault                          | `/settings/vault`        |
| App   | MCP          | MCP                            | `/settings/mcp`          |
| App   | Agents       | Agents                         | `/settings/agents`       |
| App   | Debug        | Debug                          | `/settings/debug`        |
| Work  | Backlog      | Backlog                        | `/settings/backlog`      |
| Work  | Workflow     | Workflow                       | `/settings/workflow`     |
| Work  | Projects     | Projects                       | `/settings/projects`     |
| Work  | Calendar     | Calendar                       | `/settings/calendar`     |
| Data  | Time entries | Import and export time entries | `/settings/time-entries` |
| Data  | Sync review  | Sync review                    | `/settings/sync-review`  |

The Plugins page tabs are **All · Backlog · Code hosts · Calendars · Agent tasks · Schemas**. The tabs wrap on narrow windows. Agent task plugins can be downloaded from the catalog. A plugin a source lists that this Ajour version can't read, or that an earlier source already lists, is left out, and the page names it.

The catalog lists every plugin of the person's **plugin sources** (ADR 0012). Plugin sources, below the list, shows each source with its state (Signed, Unsigned, Key not approved, Key changed, Signature missing, Signature invalid, Unreachable), its address, plugin count and key fingerprint. Adding a source reads it first and shows its plugins and key in a dialog; nothing is saved until the person confirms. Remove asks first, and keeps the plugins installed from it. Review approves the key a source is signed with now. The official source is listed by default and can be removed and added back. Ajour checks it against the keys built into the app, so it never asks to approve its key, and blocks a listing signed with another key or not signed.

A plugin that didn't come from a signed source shows an **Unsigned** badge. **Allow installing unsigned plugins** is off by default; while it is off, Install from file and Update from file are disabled and an unsigned download is refused. When it is on, every unsigned install or update shows the desktop's own warning dialog, every time. **Deactivate unsigned plugins** pauses every unsigned plugin without changing its own switch, which is disabled while the deactivation holds. **Update** appears when the plugin's own source lists a newer version; nothing updates on its own.

## App shell

Decided in [App shell and collapsible sidebar](https://github.com/les-cabochons/ajour/issues/12). Prototype: branch `prototype/app-shell`, variant A.

### Desktop widths

- The app sidebar is expanded (resizable, see the Backlog sidebar section for widths) or hidden. There is no icon rail. From the top: Hide sidebar and the logo, the view switcher with Search, the project filter and New backlog item (+), the timer dock, then the work list. New backlog item opens the Backlog page with a blank backlog item editor; time entries start from the timer dock's "+". Its fixed footer has Settings and Commit icon buttons at the left. Commit opens the selected date's week. The desktop app's update button sits at the right.
- Hide sidebar and the logo sit on the titlebar's row, as in T3 Code: right of the traffic lights on macOS, in the window's top left corner elsewhere. Hide sidebar sits where Show sidebar sits in the titlebar, so the button does not move when the sidebar toggles.
- The view switcher works like ChatGPT's: the open view's name, such as "Time", opens a menu of Time, Backlog, Pull requests (only while a code host plugin is enabled) and Projects with their live counts, today's total next to Time, the number of listed items next to Backlog, and next to Pull requests the number that need the user, as a filled badge when any returned. A check marks the open view. A backlog item's page belongs to Backlog, unless it was opened from the sidebar while Time, Projects or Pull requests showed: that view stays selected.
- Cmd+B (Ctrl+B on Windows), Hide sidebar next to the logo and Show sidebar at the start of the titlebar toggle it. The View menu gets "Show sidebar" or "Hide sidebar" once the menu bar exists. There is no second shortcut.
- The state is saved per device. The sidebar stays beside the page at every desktop width, down to the narrow view. It never opens over the page.
- Settings opens inside the shell, in place of the app sidebar: the left column lists the settings pages under their App, Work and Data groups, at the app sidebar's width and at every desktop width. "Back to app" at its top returns to the last page outside Settings. While Settings is open the timer dock floats, fitted to the bottom of that column, and the titlebar shows no Show sidebar button.
- Projects keeps its own list of projects next to the app sidebar, with no collapse control of its own.
- The titlebar keeps the totals pill. New entry (+) and Start (▶) live in the timer dock. The date picker only shows in the narrow view. The running entry lives in the timer dock, not the titlebar.

### Timer dock

- While an entry runs, the dock shows it: a running dot, its title (the backlog item's, else the note, the task or the project), the time counted with seconds, New entry (+) and Stop. With a remaining estimate, a bar shows how much of it the running time uses, with "1.1h left" or "0.4h over", next to the project code and task.
- Clicking the dock opens the running entry's editor in a popover. New entry (+) opens a blank entry editor in a popover anchored to it.
- With nothing running, the dock shows New entry (+), Start (▶) and today's total on one line. Start begins an empty entry and opens its editor; the dock does not suggest a backlog item.
- N opens the new entry editor from anywhere, anchored to the titlebar's totals off the Time pages. S starts an empty entry.
- While the sidebar is not on screen, the dock floats at the bottom left on one line: dot, title, time counted and Stop. While nothing runs it holds New entry (+) and Start (▶), the only buttons that start an entry there.
- The window title shows the running entry, such as "● 1:24 · Fix export rounding — Ajour", so it shows on the taskbar or Dock. It changes once a minute and goes back to "Ajour" when nothing runs.

### Narrow view

Below 768px there is no sidebar, including the Projects list. See the Narrow view section.

## Narrow view

Decided in [Narrow view](https://github.com/les-cabochons/ajour/issues/13). Prototype: branch `prototype/narrow-view`, variant C. The narrow view is a first-class layout, also used on desktop as a small companion window.

### Breakpoints

| Width        | Layout                                            |
| ------------ | ------------------------------------------------- |
| 768px and up | Desktop, sidebar expanded or hidden by preference |
| Below 768px  | Narrow view, no sidebars                          |

Today's splits at 640px and 1023px go away.

### Navigation

- A segmented toggle for Time, Backlog and Settings floats at the bottom left, over the page. The active section shows its label, the others show only their icon. A search button may join it later. See [Keyboard model and command palette](https://github.com/les-cabochons/ajour/issues/18).
- The titlebar holds the date, New entry (+), Start (▶), then the totals pill. Start turns into Stop while an entry runs.
- While an entry runs, the totals pill shows its time instead of "Today". The pill's popover adds a Current timer row with the entry's title and an arrow, which opens the running entry in the full-width dialog.
- Start opens the running entry's dialog too. A click outside it saves the draft and closes the dialog, and the entry keeps running. An invalid draft keeps the dialog open with its error. The other entry dialogs ignore outside clicks.
- Settings opens on a list of its pages. Each page has a back arrow to that list.
- Projects lives inside Settings in the narrow view. The Settings list has one Projects entry that opens the full Projects section: the project list, project detail and the archive. Importing and exporting projects is an action inside that section, not a separate settings page.
- Pull requests also has a Settings-list entry in the narrow view, shown only while a code host plugin is enabled. Its Active, Settled and Recently closed groups use the same local actions as desktop.
- Wide windows keep Projects in the sidebar and keep the separate import and export settings page.

### Jobs and views

- The narrow view covers the running entry, logging and fixing entries by day, browsing and starting backlog items, changing settings and projects, and submitting a timesheet. The submit flow belongs to [Submit timesheet flow in full and narrow windows](https://github.com/les-cabochons/ajour/issues/24).
- Week is not available. The view menu does not offer it, and a Week link opens Day with a short note that Week needs a wider window.

### Actions and editing

- Rows always show their "…" button, and Day rows their Continue or Stop. On touch screens, a long press opens the right-click menu.
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

## Task menu

The project and task picker of the entry editor, the Week Grid's new row and calendar suggestions.

The menu list grows to 30rem when space permits, and scrolls within the available window height, leaving room for its search field.

### Rows

- Every row is one line. A long name is cut.
- A task row shows a star, the name, its pinned key and "Non-billable" when the task is not billable. A billable task says nothing about billing.
- A project row shows a star, the project's icon and name, its active task count and a chevron. Choosing it opens its tasks.
- Search results add the project's name after the task's name, because task names repeat across projects.

### Favorites

- A favorite is a task or a project the user starred. It is personal, like a pinned slot: a shared project's favorites stay on this computer. A task can be a favorite and a pinned task.
- The star at the start of a row adds the row to favorites or removes it. A starred row always shows a filled star; other rows show the outline on hover and highlight. Pressing the star does not choose the row or close the menu. Removing a star, from the menu or the action sets, shows the Undo toast, because on the Favorites page the row leaves.
- Add to favorites and Remove from favorites are also in the task and project action sets, with F on a focused task or project.
- The start view lists, without a search: No project, Favorites, Recent tasks, then All projects. An empty section is hidden.
- Favorites mixes tasks and projects, newest star first. The first 3 show, then "N more favorites" opens a Favorites page with all of them. The page works like a project's tasks: Back to projects at the top, Backspace on an empty search goes back, and typing filters the page.
- A favorite task row shows its project's icon. A favorite project opens its tasks.
- An archived task, or anything in an archived project, keeps its star but leaves Favorites until it is restored.

### Recent tasks

- Recent tasks lists tasks only, never projects, newest first. A task is used when an entry on it is saved, by its first save, Stop or an edit, or when a running entry starts on it. A continued entry keeps its place in the Day view, so each entry stores when it was last saved apart from its first save.
- Each row shows the project's icon and how long ago the task was used, such as "5m", "2h", "3d" or "2w".
- The start view shows the first 3 recent tasks that are not favorites, so it never repeats a row. "More recent tasks" opens the Recent page with the 10 tasks used last, favorites included. It works like the Favorites page.
- Archived tasks and tasks in archived projects are left out.

### Task card

Like the backlog [Hover card](#hover-card), a card beside the menu shows what a row has no room for.

- On a task: its project's icon and name, the whole task name, Billing (Billable, or Non-billable in amber), Last used, such as "2h ago", and the pinned key. Last used and the pinned key show only when they apply.
- On a project: the whole project name and its active task count.
- It opens after the pointer rests on a row for 800ms, and moves at once to the next row while it shows, like the backlog card.
- It also follows the highlight of the arrow keys, with the same timing. Opening the menu and typing never show it; only an arrow key does. Typing closes it.
- Scrolling the list with the wheel, pressing, and leaving the row or the window close it. The keyboard's scrolling does not. Nothing in it takes a press, and it takes no focus.

## Running entries

Decided in [Running timer editing and empty duration meaning](https://github.com/les-cabochons/ajour/issues/15).

### Editing

- The running entry opens in the same form as every entry. Edit from its menu, or a click on its row or card, opens the side panel in Day and Week. A click on the timer dock opens the form in a popover anchored to it. The narrow view uses the full-width dialog.
- The footer reads Cancel · Stop · Save. Save applies the changes and the entry keeps running. Nothing changes until the user saves. The old live-editing popup goes away.
- Hours shows the time counted so far and stays editable, so the user can correct a late start before saving.
- Discard happens at once and shows the Undo toast (see Feedback).

### Starting

- In a new entry with empty Hours, Save is disabled with "Enter hours, or press Start", and Enter presses Start. Ajour never saves a 0h entry.
- With Hours filled, Start counts on from that time: typing 0:30 then Start gives a running entry at 0:30.
- A running entry is always on today. Starting from another day's form starts the entry today, and the form says "Starts today". An entry that runs past midnight stays on the day it started; Move to… changes that.
- Starting while another entry runs saves the running one and switches, without a prompt. The button reads Switch instead of Start. The timer dock and the rows show the switch; no message appears.
- Start entry on tasks and backlog items starts on today, as it does now.

### Date field

The form gets a Date field after Hours. It defaults to the open day in Day, the clicked day in Week, and today everywhere else, such as the dock's "+" or New entry… on a backlog item. The running entry hides it, because it is always today.

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
- Right-click on a row's name or any of its cells offers Delete row, last in the menu. Shift+Backspace on a focused cell runs it. The row has no "…" button. An empty row goes at once. A row with time opens a dialog showing the project/task name, entry count and total duration, then deletes those entries with the Undo toast. If its side panel is open, deletion saves and closes that draft before counting entries; an invalid draft keeps the panel open and blocks deletion. A row containing a running entry or its saved part can't be deleted until it stops.
- Right-click on a cell starts with Add entry. On a one-entry cell, that entry's action set follows. On a cell with several entries, Open entries follows.

### Days

- "+ Add" in each column opens a new entry for that day in the side panel.
- A click on a card opens it in the side panel. Right-click on a card opens the time entry action set.
- Dragging a card to another day moves it. Move to… is the keyboard path. Shortcuts come from [Keyboard model and command palette](https://github.com/les-cabochons/ajour/issues/18), and a move shows the Undo toast.

### Over-capacity warning

- While Settings › General › Over-capacity warning is on, a day total more than 50% over its capacity target shows a warning icon: past 12 hours on an 8-hour day. The week total shows it once the week passes its target.
- An hour or two past the target is a normal day and shows nothing. Hovering a total still shows its exact share of the target.

## Feedback

Decided in [Undo, confirmation and feedback policy](https://github.com/les-cabochons/ajour/issues/17).

### Principle

Feedback appears where the action happened. Toasts are kept to three cases: Undo, errors from background work that has no place on screen, and a submitted week's refusal of a write, which has no other place to say why (rule 12 of the action model).

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
- A backlog sync the user started: the plugin shows that it is syncing, then when it last synced.
- Starting or switching an entry from another page: the timer dock and the row update.

### Errors

- Form mistakes show next to the field, as now.
- An operation the user started (import, export, sync, plugin install) shows its error inline on that page.
- Background failures, such as an automatic backlog sync, show one error toast per failure that stays until dismissed, and a "Last sync failed" line on that plugin in Settings.
- A settle write that fails after the Undo window puts the item back to active and shows an error toast, naming the item and the reason, that stays until dismissed.

### Toasts

Bottom right in a full window, bottom center above the content in the narrow view. At most three, newest on top. Built on the Base UI toast component.

## Keyboard

Decided in [Keyboard model and command palette](https://github.com/les-cabochons/ajour/issues/18).

### Style

Frequent in-app actions use single keys. They only work when focus is not in a text field. Modifier shortcuts are kept for OS conventions and app-wide commands: Cmd+K, Cmd+B, Cmd+Z, Cmd+, and Cmd+Enter. Cmd means Ctrl on Windows. The web build uses the same keys.

### Global shortcuts

| Key                | Action                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| N                  | New entry: side panel on the Time pages, popover elsewhere                                                         |
| S                  | Start an entry on the focused backlog item; otherwise stop the running entry, or start a new one when nothing runs |
| C                  | Continue the focused entry, or the most recent entry when none is focused                                          |
| T                  | Go to today                                                                                                        |
| [ / ]              | Previous / next day, or week in the Week view                                                                      |
| D / W              | Day view / Week view                                                                                               |
| G then T, B, P, S  | Go to Time, Backlog, Projects, Settings                                                                            |
| 1 to 0             | Open the new entry form with the pinned task in that slot filled in                                                |
| Shift+1 to Shift+0 | Start a running entry for that pinned task, switching if another entry runs                                        |
| Cmd+B              | Show or hide the sidebar                                                                                           |
| Cmd+Z              | Press Undo on the visible Undo toast                                                                               |
| Cmd+,              | Settings                                                                                                           |
| Cmd+K              | Command palette                                                                                                    |
| ?                  | Keyboard shortcuts                                                                                                 |

### Pinned tasks

- A pinned task has a number slot from 1 to 0, ten in all. "Assign shortcut…" on the task sets, changes or clears it. A slot belongs to at most one task.
- The slot shows next to the task in the project task picker and on the task row.
- The plain digit only opens the form, so a stray key press never stops the running entry. Starting needs Shift.
- While an entry is being edited, the digits do nothing special.
- When a Grid cell has focus, digits edit its hours instead. Anywhere else, digits start pinned tasks.

### Focused rows and cards

- Day rows become focusable, like Week cards.
- ↑ and ↓ move focus between rows or cards. ← and → move between days in Days and between cells in the Grid.
- Enter goes one level deeper. On a time entry, task or project it opens Edit. On a backlog item row it opens the backlog item page, and on that page it opens Edit. E no longer opens Edit. Delete or Backspace deletes, with the Undo toast. On a focused Grid cell, Shift+Backspace deletes the whole row.
- On a focused backlog item, or on its page, S starts an entry on it (Stop when its entry runs), E settles and B snoozes, as in Gmail. Shift+E opens the settle dialog even when a settle rule applies a fixed change. Cmd+D duplicates. M opens Move to…. Alt+↑ and Alt+↓ reorder.
- On a focused task or project, F adds it to favorites or removes it.
- The context menu key, Shift+F10 or "." opens the "…" menu, or the right-click menu on a row without one. Escape closes whatever is open.
- Every item in the "…" and right-click menus shows its key, so the menus teach the shortcuts.
- Calendar suggestions are focusable too: Day rows under "From your calendar" and the dashed cards under a Days column. Enter adds the suggestion when it has a project, and opens the project picker when it does not. Space does the same on a card. Delete or Backspace dismisses it, with the Undo toast. Their menus list Add, Choose project…, Dismiss, Hide this meeting and Forget this meeting. Suggestions never join the entry selection.

### Selecting, copying and pasting entries

Decided in the 2026-10-16 grilling of the selection feature: [Entry selection acts like a file explorer](https://github.com/les-cabochons/ajour/issues/199). The Day list and the Week Days cards select like a file explorer, and the selection is the subject of every action that can take several entries.

#### Selecting

- A click selects one entry and focuses it, Cmd or Ctrl+click adds or removes one, and Shift+click selects the range from the anchor: the last plain or Cmd click. Week ranges follow reading order: Monday's cards top to bottom, then Tuesday's.
- Mouse-down on an unselected entry replaces the selection with that entry at once, as Finder does. Mouse-down on a selected entry keeps the selection, and a plain click without a drag collapses it to that entry on mouse-up.
- A right-click on an unselected entry selects that entry alone before its menu opens. A right-click on a selected entry keeps the selection, and the menu acts on it.
- Cmd+A, and the Edit menu's Select All, selects every shown entry of the day or week while focus is in the list or the columns and not in a text field.
- Plain ↑ and ↓ move focus and collapse the selection to the focused entry. Shift+↑ and Shift+↓ extend the range from the anchor, in reading order on the Week cards too. With no anchor, the focused entry is the anchor; after Cmd+A, the first shown entry is.
- A double click or Enter opens the editor, and Space does on Week cards. A single click no longer does. A tap on a touch screen still opens it. Week Grid cells keep their click. Calendar suggestions never join the selection.
- Escape, a click on empty space, or showing another day or week clears the selection.

#### Which actions take the selection

- Selection-wide actions apply to every selected entry with one Undo: Delete, Copy, Cut, Drag (reorder and move), Move to…, Duplicate, Duplicate to… and Mark as not committed. Their keys (Delete, Cmd+C, Cmd+X, M, D) follow the selection even when focus sits on an entry Cmd+click just deselected.
- Single-subject actions apply to the focused entry only: Edit, Continue, Stop and Discard. Their keys (Enter, C, S) follow focus.
- The running entry is skipped by every selection-wide action and stays where it is. The toast counts only what moved: "Moved 2 entries".
- On a selection of two or more, the right-click menu of a selected entry pluralizes the selection-wide actions with the count ("Cut 3 entries", "Copy 3 entries", "Delete 3 entries", "Move 3 entries to…", "Duplicate 3 entries", "Mark 3 entries as not committed") and hides the single-subject ones.
- Move to… and Duplicate to… open their date dialog once, titled "Move 3 entries" or "Duplicate 3 entries". Every selected entry lands on the chosen day at its end in reading order. Duplicate (D) puts each copy at the end of its own entry's day, in reading order, with "Duplicated 3 entries". Mark as not committed marks every committed entry in the selection.
- Delete goes straight through with one Undo toast naming the count. No confirmation dialog.

#### Dragging a selection

- Dragging a selected entry drags the whole selection. The preview shows the pressed card or row with a count badge, like a Finder stack.
- Dropped entries become one contiguous block at the drop line, in reading order, whether they came from that day or from other days. A drop on another day with no drop line puts the block at the end of that day, as a single move and a paste do.
- On the Week Days cards, a drop on another day's column moves the block there. On the Day list, dragging rows over a day in the day strip highlights it as a drop target, and dropping moves the block to that day. Dropping on the shown day's own tab or on the week total does nothing. The view stays on the shown day.
- A same-day reorder stays silent. A move to another day, by card drag or day-strip drop, shows "Moved 3 entries to Tue 14" with one Undo for the block.

#### What stays selected

- Moved entries stay selected where they land. In the Day view they leave the shown day, so the selection empties. After Duplicate, Duplicate to… or a copy paste, the new copies become the selection, as Finder does. Deleted and cut-then-pasted entries follow the move rule.

#### Clipboard

- Ajour listens to the browser's copy, cut and paste events, so the desktop Edit menu works too, and text fields keep their own clipboard. The entries stay in memory, and their text summary goes on the system clipboard. Cmd+V pastes entries only while the system clipboard still holds that summary.
- Cut entries stay dimmed until the paste moves them, like Move to…. Copies are new entries, which the Commit page lists as added. Pasted entries go to the end of their day in reading order.
- Cmd+V on the Day view pastes on the shown day. On the Week view each entry keeps its weekday in the shown week. A right-click on a Days column's empty space offers Paste here and Paste on same weekdays.
- Paste from a menu (an entry's Paste, Paste here and Paste on same weekdays) also pastes only while the system clipboard holds the summary. Where the page may not read the clipboard, as in a browser that refuses, it pastes Ajour's copy.

### Command palette

Cmd+K opens one palette with navigation, global actions, the focused item's actions, and search across projects, tasks and backlog items, so "Start Development" works from anywhere. The narrow view's future search button opens it. It replaces the Projects command dialog. Searching time entry notes is left for later.

### Menu bar

- Menus:
  - Ajour: About, Settings… (Cmd+,), Check for updates, Quit.
  - Edit: the standard Undo, Cut, Copy, Paste and Select All. macOS needs them for clipboard shortcuts.
  - View: Day, Week, Show or Hide sidebar, Today, Previous, Next, zoom.
  - Entry: the focused entry's action set.
  - Window, and Help with Keyboard shortcuts.
- macOS uses the native menu bar. Windows shows no menu bar for now. Keyboard shortcuts do not depend on it. When turned back on, the menus live in the app's title bar at full widths, like the ChatGPT app, and disappear in the narrow view.
- Production builds drop Reload and DevTools. Development builds keep them.
- Single-key shortcuts show in the menus as labels without being registered, so they never fire while the user types.
- The web build has no menu bar. The palette and the "?" overlay cover everything the menus offer.

### Shortcut reference

"?" opens an overlay listing every shortcut, with a search field.

Superseded by the Commit page: `docs/specs/2026-10-15-commit-week-design.md`.

## Submit timesheet

Decided in [Submit timesheet flow in full and narrow windows](https://github.com/les-cabochons/ajour/issues/24). Prototype: branch `prototype/submit-flow`, route `/prototype/submit`, variant B. Submitting means copying the week into Workday by hand, then marking the entries as submitted in Ajour.

### Entry point

One "Submit week" button, styled the same, sits in the Day and Week headers at every width, including the narrow view. It opens the submit page for the selected week. The submit page replaces the modal.

### Summary

- The page leads with the week's total against its target, a progress bar, and warnings such as days under target or entries without a task.
- On the Commit page, Submit week remains available beside a plugin's submit-week task, including while agent tasks load. It locks the week in Ajour without starting an agent or submitting to the external timesheet. The plugin task stays primary when the week is ready. Both actions retain the uncommitted-change and running-entry guards; manual submission keeps its pace confirmation, Undo and Reopen week. Submit week waits while an agent task starts or runs, with the reason "An agent task is already running.", because the task may submit the week itself.
- A plugin API 4 agent task runs like an API 3 one: no "can't run yet" reason shows for it any more. Its run sees only the Ajour MCP data tools its plugin declares for it, plus the session tools, and a call to any other is refused with a message that names the tool; the run's activity shows the refusal. API 3 tasks keep every tool until their plugin moves to API 4.
- A secret setting never reaches an agent. Starting a task whose prompt uses one fails with "The task's prompt uses the secret setting <label>. Ajour never gives a secret to an agent." (400), and the run does not start.
- A secret setting never fills a task's week link either, since the user opens the link with a click and its host is the plugin's. A task whose week link uses one has no "Open the week in <plugin>" link on the Commit page, and the week summary says in its place "The week link uses the secret setting <label>. Ajour never puts a secret in a link." A run of that task starts without a link. This holds for every plugin API version.
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

Decided in [Backlog page under the new conventions](https://github.com/les-cabochons/ajour/issues/25), then redesigned as a list and a board inspired by Linear: [ADR 0002](../adr/0002-workflow-states-and-done.md), and the prototype on branch `prototype/backlog-views`, where variant A won, with the peek and project swimlanes from variant B. The page takes Linear's density and options and keeps Ajour's tokens, fonts and quiet style.

### Workflow

- The user defines a workflow in Settings > Workflow: an ordered list of workflow states, each with a name and a color. New workspaces start with To do, In progress, In review and Done.
- A state can carry the Done flag, and more than one can, such as Done and Canceled. The workflow keeps at least one done state.
- Moving an item into a done state settles and archives it. Moving it out of one makes it active again and unsettles it. No other state changes whether an item is active, settled or archived. Settle and Snooze stay explicit actions.
- A settled item stays in its state's column with a muted Settled marker and its settle date.

### Mapping source states

Settings > Workflow lists, for each connection and source project, its source states. It replaces the Synced status mapping. Explicit Settle rules stay in Settings > Backlog. Moves use the per-workflow write rules below.

- **In:** each source state maps to one workflow state. Backlog plugins list every source state of a source project, so states are mapped before any item reaches them. A plugin that can't list them falls back to the states seen in syncs.
- A new source state in the tool's done category is preselected to map to the first done state. A source state whose name matches a workflow state exactly, ignoring case, maps to it. Anything else stays unmapped.
- Items in an unmapped source state show under "No state", first on the board and in the list. Settings > Workflow shows the count of unmapped source states, and the Backlog header shows a quiet notice that links there.
- **Out:** each workflow state has a default source state, Ask, or Don't write. The default starts on the first mapped source state. Ask is offered when two or more source states map in, and opens a dialog with them when an item moves there.
- Moving a synced item writes its new source state after the Undo window, as Settle does in [ADR 0001](../adr/0001-connector-writes-after-undo-window.md). A plugin without the write capability moves the item locally.
- "Change source state…" writes another source state of the same workflow state and leaves the item in place. It shows in the "…" and right-click menus when two or more source states map in, and on the card's source-state label.
- A sync that shows a different source state moves the item to that state's mapping. A sync that shows an archived item in a source state that isn't done makes it active again in the mapped column, as returned.

### Priority

- Priority has five levels with Linear's icons: Urgent, High, Medium, Low and No priority.
- Each backlog plugin maps its source priority values to levels. A plugin can let the user set that mapping in its connection settings, such as Azure DevOps 1 Urgent, 2 High, 3 Medium and 4 Low by default. A value the plugin maps to no level is No priority.
- Settle and moving into a done state write the level only when it changed. The plugin picks the source value, such as the lowest value of the level's range.
- Within a level, items keep the custom order.

### Layouts

- The page has a list and a board. The header's two-icon toggle and the Display popover switch between them. The narrow view always shows the list and hides the toggle.
- The list groups rows under sticky group headers. A row is one line: priority, id, state, type, title, a muted "↳ Parent" for a subitem, subitem progress, the running and Settled markers, then project and remaining estimate on the right.
- The board shows one column per group. A card shows the id, the state and title on up to two lines, "↳ Parent" for a subitem, then priority, type, the Settled marker, subitem progress, project and remaining estimate.
- Each group and column header has a "+" that opens New backlog item with that state, priority or project set. Done states have none.
- Subitems are their own rows and cards, in their own state. "Show subitems" hides them. Their parent shows "2/5" subitem progress.

### Display

The Display popover holds:

- Layout: List or Board.
- Grouping: workflow state (the default), priority, project, or none. None is list-only.
- Swimlanes, on the board only: None (the default) or Project. One collapsible swimlane per project, with "No project" last. Hidden when grouping is Project.
- Ordering: Custom (the default), Priority, Created, Remaining estimate or Title.
- Done items: Past week (the default), All or None.
- Show settled items and Show subitems, both on by default.
- Display properties: ID, priority, project, estimate and source state.

The layout, grouping, swimlanes, done window, toggles and properties are saved per device. The ordering stays in local state, because the sidebar shares it.

### Filters

- Filter adds removable chips: state, priority, project, task, source project or connection, type, has estimate, and running.
- Filters apply to the page only. The sidebar keeps its own list.

### Peek

- Clicking a row or card opens the peek on the right. Space toggles it on the focused row. It follows the clicked item until Escape or × closes it.
- The peek is a smaller item page. It shows the id with Open page and ×, the title with its type, project and source link, the item page's snoozed, settled, archived or returned notice, Start entry and Edit, the estimate figures, then the properties (state, source state, priority, lifecycle, project, task), the description and the subitems.
- The peek has no "…" menu. The row's context menu and the item page carry the other actions.
- Dragging the peek's left edge resizes it, like every side panel: 300px to 720px, at most half the page. Arrow keys on the edge move it by 16px and a double-click resets 340px. Each page keeps its own panel width, per device: Backlog (peek and editor), the backlog item page, Time, Projects and Agents.
- State, priority, project and task change in place and save at once with Undo, like the pickers on a card.
- Edit turns the peek into the backlog item editor in the same slot, with its explicit Save. Saving or discarding goes back to the peek.
- Enter, a double-click or Open page opens the backlog item page.
- The narrow view has no peek: a tap opens the item page.

### Moving items

- Dragging a card to another column, or a row to another group, sets its state, priority or project. A drop on a done state follows the done rules above.
- With Custom ordering, dragging within a column or group moves the item in the one custom order, so the sidebar follows. Other orderings allow moves across columns only.
- The state and priority icons on a row or card open pickers. Picking a state is the same as dropping on it, with the same Ask and subitem prompts.
- Every move shows the Undo toast.

### Closing a parent

- Moving a parent into a done state, or settling it, while it has open subitems asks "Also close its 3 subitems?" (or "settle"), with Include subitems, Only this item, and "Remember my choice".
- Settings > Backlog holds the choice: Ask (the default), Include them, or Leave them.
- Included synced subitems are written through their own source project's mapping. Subitems already settled or archived are left alone.
- Reopening the parent brings back the subitems that closed with it.

### Archive

- Archived items older than the done window live in Archive, from the header's "…" menu: the list layout filtered to archived items, including items archived because they dropped out of the sync. Restore puts an item back in its state's column.

### Keyboard

- ←/→ move focus between columns, ↑/↓ within a column or list.
- Alt+←/→ move the focused card to the previous or next workflow state. Alt+↑/↓ reorder, as before.
- Shift+S opens the state picker and P the priority picker. S stays the global start or stop key.
- Space toggles the peek. Enter opens the item page. E, B, M and "." keep their meaning.

### Editing

- Editing a backlog item uses the editor form, in the peek slot on wide windows and the full-width dialog in the narrow view, with the entry editor's rules: explicit Save (button, Enter in the title, Cmd+Enter), Escape or × discards, outside clicks do nothing.
- The form holds title, workflow state, priority, project and task mapping, description, the estimates with their "Reset to subitem total" buttons, and "Keep when missing from sync" for synced items. Its header has the "…" action menu.
- "New backlog item" in the page header, or the "+" at the top of the app sidebar, opens a blank form. "Add subitem" opens it with the parent set.
- Start entry stays on hover, in the "…" menu and in the peek. Entries start on today.

## Application updates

Decided in [Sidebar footer actions and user-controlled application updates](https://github.com/les-cabochons/ajour/issues/274).

- Desktop checks the selected Stable or Nightly track on startup and every four hours. Opening Settings > General, the application menu's Check for updates, and the neutral footer update button also check. Checks never download or install an update.
- The footer button keeps an outlined upward arrow, shown with stronger contrast when a newer version is available. Its tooltip names the version. Clicking the neutral button checks and reports availability, an up-to-date result, or a retryable error. Finding an update waits for another click.
- On supported Windows builds, clicking the available version opens a warning before any download. It names the version, explains that Ajour will download and restart, and asks the user to save work first. Cancel is the default button. Update and restart confirms the download, followed by orderly shutdown and installation. An ordinary quit never installs an update.
- The button reports checking, confirmation, download progress, and restart without resizing the footer. It ignores repeated actions while busy. Errors offer another check. Settings shares the same state and offers Check again and, while available, Update and restart.
- Changing release track invalidates the old candidate and cancels its download. Once installation starts, the track is locked through shutdown and restart. Late results from the old track cannot trigger installation. A temporary check failure retains a previously discovered candidate on the same track.
- Desktop platforms without in-place installation open the release page for manual installation. The browser app has no footer update button. Hidden sidebars and the narrow view keep their existing layout; Settings and the desktop menu remain available.
- Update and restart waits at most ten seconds for plugins to stop, then installs, even when they failed to stop, as quitting does (see Desktop window and quitting).

## Desktop window and quitting

Decided in [#331](https://github.com/les-cabochons/ajour/issues/331).

- When the window crashes, Ajour reloads it at its start page. The third crash within a minute stops the reloads, and a dialog says "Ajour keeps crashing" and offers Reload and Quit. Reload starts the count again.
- When the window stops responding, a dialog says "Ajour is not responding" and offers Wait, the default, and Reload. It closes by itself when the window responds again. Reload restarts the page, and changes that are not saved yet are lost. That restart does not count as a crash.
- When the window cannot load Ajour, a dialog says "Ajour could not load its window", gives the reason, and offers Try again and Quit.
- When the window itself cannot open, Ajour shows "Ajour could not start" with the reason, and quits.
- A local API that cannot start, for example because another app holds its port, is not a startup failure. The window opens and Ajour works without plugins (see Settings).
- One of these dialogs shows at a time. A crash or a newer dialog closes an open one, and the closed dialog's answer does nothing.
- Web and mail links open in the system browser or mail app. Any other link does nothing, including links to local files or to another app.
- Quitting waits at most ten seconds for plugins and a running agent to stop, then quits anyway. It also quits when they fail to stop.

## Backlog sidebar

Decided in [Backlog sidebar with settle, snooze and a backlog item page](https://github.com/les-cabochons/ajour/issues/69). The backlog plugin side is [#70](https://github.com/les-cabochons/ajour/issues/70). Delayed writes are recorded in [ADR 0001](../adr/0001-connector-writes-after-undo-window.md).

The sidebar works like the T3 Code and Linear sidebars: the view switcher, the timer dock, then the work itself in one scroll.

### List

- Below the timer dock, the sidebar lists active backlog items in the Backlog page's current order, custom or priority. There is one ordering.
- With Custom ordering, dragging a row or pressing Alt+Up and Alt+Down moves it in the one custom order, with Undo. Pinned items and the rest move apart: a row stays among the pinned items or among the others. Subitems follow their parent and do not move. Other orderings do not allow dragging.
- The work list is one scroll: the backlog items, pinned ones first, with no header and no collapse, like T3 Code's thread list, then collapsible sections for Pull requests (only while pull requests need the user), Snoozed and Settled. A section with nothing in it is not shown. Pull requests starts open, and every section's state is saved per device. The Backlog and Pull requests tabs are gone.
- The list holds top-level items and subitems that have their own priority. A subitem without a priority follows its parent and does not show.
- With priority order, a subitem with its own priority mixes with top-level items by priority. With custom order, it sits right below its parent. If its parent is snoozed or settled, it takes the parent's place.
- Snoozed, settled and archived items leave the list.
- Pin puts an item at the top of the list with a pin icon. Pinned items keep the list's order among themselves. Pinning does not select an item for the timer dock's Start action. Pin is local, a sync keeps it, and the item stays pinned through a snooze or a settle. Pull requests cannot be pinned.
- The narrow view has no item list. The Backlog page is the way in.

### Search and project filter

- Search, next to the view switcher, expands into a search box in place of the switcher. It filters the work list as the user types. Cmd+K still opens the command palette.
- Every typed word must appear in the item's title or its project's name, display name or code. Case and accents do not count. A pull request matches on its title and repository.
- Escape clears the box and closes it. Leaving the box empty closes it too. A typed query stays while the user opens the rows it found, including when the sidebar hides in between, as the overlay does after a row opens. It is not saved across launches.
- The filter button, like T3 Code's, opens a menu with its own search and an ordering toggle beside it, then "All projects" and the active projects. The toggle has two icon buttons, Custom order and Priority order. Neither is pressed when the Backlog page picked another ordering. Picking one changes the Backlog page's ordering too and keeps the menu open. Without active projects, the menu holds the toggle only. Picking a project keeps only its items. Pull requests have no project, so they hide while a project is picked. The pick is saved per device. The button stays highlighted while a project is picked.
- Every section keeps only the matching rows, and its count follows. A section left with no rows is not shown. While the list is narrowed, Settled shows its count and an empty backlog list says "No matching items."
- The view switcher's counts and the Backlog page ignore the sidebar's search and filter.

### Layout options

Decided after the prototype on branch `prototype/backlog-sidebar`: variant B is the default and variant A is the compact layout. Variant C's Up next card was removed; the idle timer dock starts an empty entry.

- Density has two values. Comfortable is the default. Compact fits more items.
- Density lives in a "Sidebar" group in Settings > General and as a View menu entry next to Show or Hide sidebar. It is saved per device.
- The Snoozed and Settled sections are the same in every layout.

### Width

- Dragging the sidebar's edge resizes it from 200px to 400px.
- The default width is 272px for Comfortable and 200px for Compact. It applies until the user drags the edge, or after a double-click on the edge resets it.
- One dragged width is saved per device. Switching density keeps it.
- Dragging the edge below 200px hides the sidebar, as in VS Code, and keeps the saved width for when it shows again.
- Show sidebar at the start of the titlebar is always visible while the sidebar is hidden. Cmd+B still toggles it.

### Rows

- Comfortable rows are 80px and three lines, like T3 Code threads: the project's icon and name ("No project" without one) at 13px with the remaining estimate at the end, such as "4h", "4h30" or "45m", then the title at 14px, then the workflow state's ring and name at 12px in a faint color. An item without a remaining estimate shows none.
- Compact rows are 26px and one line: the type icon and the title.
- In Compact, a subitem shows its parent after the title in muted text, such as "Fix token refresh · Login page". In Comfortable, the parent's title does not show: an arrow at the end of the state line opens the parent, and its tooltip is the parent's title.
- In Comfortable, hover and keyboard focus show Start entry centered at the row's end, since logging time is the main job, and replace the end of the project line with Snooze… and Settle. In Compact, they swap the type icon for a settle circle and replace the end of the row with Start entry and Snooze…. Nothing floats over the title. These hover actions show no tooltip. On the item with the running entry, Start entry becomes Stop, which saves that entry. Shift-click on Settle or the circle asks first.
- A marker shows on the item with the running entry.
- A dot shows on a returned item. Opening the item from anywhere, or clicking the dot, clears it.
- Clicking a row opens the backlog item page.
- Right-click opens the full action set, as do ".", Shift+F10 and the context menu key. Sidebar backlog rows have no "…" button.
- Pull request rows are one line too: the pull request icon, the title (bold when returned), and its reason and age, such as "Review · 2h". Like the backlog rows, they have no "…" button; right-click opens their actions.

### Hover card

Like T3 Code's thread card, resting the mouse on a backlog row shows a card beside the sidebar with what the row has no room for.

- It opens after the pointer rests on one row for 800ms, so moving down the list shows nothing. Once it shows, moving to another row moves it there at once.
- From top to bottom: the whole title; where the item comes from, as its source tool's logo, the organization and the source project, such as "les-cabochons / ajour", with its id at the end, such as "1234" or "PAY-12"; and on a subitem, its parent's title. A manual item has no source line.
- Then the subitems, open ones first, with their workflow state's ring and the closed count over the total, such as "1/3". Eight show, then "n more".
- Then the pull requests whose title names the item, open ones first: the state icon, the number and the title. Five show, then "n more". Code hosts do not report links to backlog items, so the title is the link: a key such as "PAY-12" names the item from any repository, and a number such as "#1234" only from the same GitHub repository, or the same Azure DevOps organization, where every project shares the numbers. Only the pull requests the Pull requests page lists count, so none show while no code host is enabled.
- The card stays while the pointer crosses over to it. A subitem or a pull request in it opens on click, and Ctrl or Cmd-click opens it in its source. Leaving the row and the card, pressing anywhere in the list, scrolling it, Escape and leaving the window close the card. A press closes it until the pointer leaves the row.
- Only a mouse opens it. It takes no focus, and keyboard focus on a row does not open it: the item page shows the same things. The task menu's card is the exception: it follows the arrow keys (see [Task card](#task-card)).
- Compact rows have no browser tooltip: the card shows the title and the parent.

### Snoozed and Settled sections

- Two collapsible sections end the list: "Snoozed n", then "Settled". Both start collapsed, and each shows only while it has items. Their state is saved per device.
- Snoozed lists items by the time they return, and each row shows it, such as "Tomorrow 9:00". The hover action is Unsnooze. An unsnoozed item goes back to the list with no dot.
- Settled lists every settled item, newest first, 20 at a time with "Show more". Subitems settled along with their parent have no row of their own: they show on the parent's page. A subitem that has its own priority and isn't in a done state keeps its own state, so it gets its own row when it is settled. The hover action is Unsettle. Archived items are not listed. They live in the Backlog page's Archived view.
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
- A synced item becomes settled. Its source project's Settle rule decides how:
  - Ask, the default, opens the settle dialog: a state picker grouped by state category and a priority field, both starting at the item's current values. Settling with nothing changed is allowed and stays local, such as for "waiting on the client" when no matching state exists.
  - Apply sets a fixed state, priority or both without a dialog.
- Settling into a source state that maps to a done state archives the item instead and moves it there. Azure DevOps Resolved usually maps to a state that isn't done, because it means waiting on QA.
- Only changed fields are written, and only after the Undo toast closes. If Ajour quits during the window, the write is sent at the next launch. There is no offline queue beyond that.
- When the item's plugin provides comments, the dialog ends with an optional Comment, a Markdown editor with @ mentions. ⌘/Ctrl+Enter settles. The comment is posted after the write lands, or when the Undo toast closes if nothing is written, and joins the item's thread. Undo, a failed write or a refused post keeps it as the item's comment draft instead; the last two say so in an error toast (ADR 0008).
- Settling stops and saves the running entry on the item. Undo restores the entry as it was, still running from its original start.
- A plugin without the settle capability settles its items locally, with no write.
- Settling a parent with open subitems asks whether to include them, as in Closing a parent under Backlog. Undo restores them together. Settling a synced subitem writes that subitem through its own source project's mapping.
- The dialog does not offer an assignee yet. Ajour does not import assignees. See [#71](https://github.com/les-cabochons/ajour/issues/71).
- Settle is the only action that writes priority to the source. Priority edits in the side panel stay local.

### Unsettle and restore

- Unsettle puts a settled item back to active. It is local, with no dialog and no write.
- Restore puts an archived item back to active, as before.

### Sync

Syncs move synced items between states:

| What the sync shows                                                     | Result                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------- |
| An active or settled item reached a source state mapped to a done state | Archived, in that done state                   |
| Someone else changed a settled item's state or priority                 | Active, as returned                            |
| Someone else commented on a settled item after it was settled           | Active, as returned, naming who commented      |
| An item dropped out of the sync                                         | Archived, as today. It returns if it reappears |

- For settled items, a sync asks the plugin for the comments posted since the settle: id, author and time, never the text (ADR 0008). The user's own comments don't count.

### Settle rules

- Explicit Settle rules stay in Settings > Backlog, as introduced on main in #95. They control the Settle action and its Shift+E override. Moving an item between workflow states uses the write rules in Settings > Workflow.
- Manual items always archive.

### Backlog item page

- The page lives at `/backlog/$itemId`. Clicking a row in the sidebar or on the Backlog page, or pressing Enter on it, opens it.
- The top bar shows where the item sits: its project's icon and name, then the item's title, such as "ajour / Build latest main". The project opens the project page. An item without a project shows "Backlog" instead. The breadcrumb is the same whichever page the item was opened from, so an item opened from Time offers both the way back to Time and the way to its project.
- Its back link returns to the page it was opened from. Opened from the sidebar while Time, Projects or Pull requests showed, it reads "Back to Time" (or Projects, Pull requests) and returns to that page with its search, such as the Week view. Moving to a parent or subitem keeps that page. Otherwise it reads "Back to Backlog". The page keeps its origin in `?from=`.
- V1 shows only what Ajour stores: title, type and external id with Open in source, source state and workflow state, project and task mapping, priority, estimates with their sync state, description, parent and subitems, and the time entries logged on it.
- Layout, from the prototype: variant C's header over variant A's body.
  - Header: the type icon in a square tile, the title, and a muted line with the external id (linked to the source), the source project and the source state. The actions sit on the right: Start entry, Snooze, Settle and New entry, or Unsnooze, Unsettle or Restore depending on the state. There is no "…" menu; the page's keys still run Delete and the other item actions, and a synced item's Archive sits at the bottom of the properties card.
  - A notice under the header when the item is snoozed, settled, archived or returned, such as "Settled today 7:51 p.m. · waiting in "Waiting for client"". A returned item says why, "Changed in the source since you settled it" or "Ana Silva commented since you settled it", and keeps saying it until the user leaves the page, though opening it clears the Returned mark. The peek does the same.
  - Four tiles: Original, Remaining, Completed and Logged in Ajour. A tile shows the estimate's sync conflict when there is one. Clicking an estimate turns it into a field.
  - A progress bar: completed over original.
  - Two columns below, layout B from map #234. The main column has the description, then the comments of a synced item whose plugin provides them (map #234, ADR 0008): blocks on a timeline, the newest 5 oldest first, "Show earlier comments" for 20 more each time, and a New divider before the first comment someone else posted since the last visit on this device. The editor sits under the thread and stays at the bottom of the window while it scrolls: a plain "Leave a comment…" field until opened, so CodeMirror loads on first use, then ⌘/Ctrl+Enter or Comment sends at once, Escape closes it, and Discard clears the draft. The draft text is kept per item on this device; a failed send keeps it with the reason. The user's own comments have a "…" menu with Edit, which swaps the text for the editor and saves at once, and Delete, which hides the comment with the Undo toast and sends the delete when the toast closes, or at the next launch. Reactions the plugin supports are buttons that add or remove the user's own; a smiley in each comment's header adds another. Both show at once and go back if the plugin refuses. Typing @ at the start of a line, after whitespace or after an opening bracket in a comment editor opens the people picker when the plugin declares mentions. An @ inside a word, such as an email address, never starts a people search. A bare @ lists the item's people at once. Each row shows the person's initials, name and email, and a footer says "Showing N suggestions". While a name is searched, the picker stays open over its last answer and the footer says "Searching…". The name after @ can run to three words, so a first and last name search together; two spaces or a fourth word end it. A one-word search that finds no one, or fails, says "No one found", and a bare @ with no one to list says "Type a name to mention someone". After a space, a name with no one to show shows nothing, since the user is likely writing on. Up and Down move through the people, and Enter or Tab or a click picks one, inserting `[@Name](mention:<id>)`, which the editor and the thread show as a chip. The pick replaces the name up to the cursor, and past it only whole words of the person's name, even skipping a middle name, so other words and punctuation stay. Escape closes the picker and keeps the editor open, and that @ opens no more until Ctrl+Space; with no picker showing, Escape closes the editor. The description's heading has a subtle Edit that swaps the rendered markdown for the Markdown editor. A synced item whose plugin sends its full description keeps it in step with the source tool (#301): each sync brings the source's changes, keeps the user's own, and records a conflict when both changed. A sync that records description conflicts shows a toast naming the item, or the count, with Resolve. A conflict mark, for any sync conflict on the item, description or estimate, shows on its sidebar row, its backlog row or card, and beside its description, where it reads "Conflict". The mark and Resolve open Sync review on the item, scrolled to its conflicts and highlighted, after saving an open side panel draft; a draft that cannot be saved keeps the user on Backlog. Sync review shows a description conflict's two texts side by side, with Take source, which offers Undo, and Keep mine when the plugin writes descriptions, which writes the user's text to the source unless the source changed again since. When the plugin writes descriptions, Edit opens the editor at once and reads the source's description in the background: when it changed since the last sync, a line under the editor says "Changed in Work since the last sync.", with Load latest, which puts the source's text in the editor, until the user types, and then adds "Saving will merge the changes." A failed read shows nothing. Saving keeps the text in Ajour, then reads the source again and merges both edits by lines, with no Undo: changes to other lines are merged and written, and the editor shows the merged text; changes to the same lines write nothing, and a line says "Changed in Work too, in the same lines." with Resolve, which opens Sync review, and the conflict toast shows. A source that changed between the read and the write gives the same conflict. While the write runs, a line says "Saving to Work…". A failed write keeps the text, with "Not saved to Work:" and the reason, Retry and an error toast. The side panel saves the same way, in the background once it closes. The editor stops at the smaller of 64,000 characters and the plugin's limit: from 80% of it a count shows, and over it "Too long to save" in red, and the text is not saved: the item page's editor stays open, and the side panel's Save says to shorten it. When the plugin cannot write descriptions, the text was longer than the 64,000 characters Ajour keeps, or its conversion to Markdown lost something, such as an underline, and its connection does not have Allow lossy conversion on, the description is read-only, with no Edit and a line under it saying why, with Edit in source. The side panel's description follows the same rule. With Allow lossy conversion on, a connection setting Ajour adds next to Agent access for plugins that write descriptions, off by default, such a description is editable, and each save of it, on the item page, in the side panel, with Retry or with Keep mine, first opens a dialog, "Save and lose formatting?", listing each loss, with Cancel, Edit in source and Save anyway. Cancel keeps the edit open and writes nothing. A save whose fresh read finds a loss the user did not see writes nothing and says so. The right column holds three cards, one small step off the page. The properties card lists workflow state, source state and priority, then project, task and source project, each editable in place like the peek, and When missing for synced items: Archive, the default, or Keep. Under it, the Subitems and Time entries cards start closed on a summary: a segment per subitem, filled when done (past ten subitems, one bar filled to the share done), and the hours left on the open ones, or the entry count and the last day one was logged. Their title opens the list and their + adds a subitem or a time entry (the new entry popover). Adding a subitem opens the card on the name field until the field closes; Escape closes it and gives the keys back to the page. Each card stays open or closed on the device, as its title last left it. The comment header's reaction and actions buttons show a background tint on hover and a stronger tint while pressed or while their menu is open, in both themes. They have accessible names and keyboard focus rings, without tooltips.
- The right panel leaves room for fields not imported yet, such as assignee, iteration, area path, tags, acceptance criteria and comments. See [#71](https://github.com/les-cabochons/ajour/issues/71).
- The page is designed for Azure DevOps first, then Jira.
- The page edits in place: no editor side panel. Click the title, or press Enter, to rename. Every inline edit saves on Enter or blur with the Undo toast, and Escape cancels.

### Description frontmatter

Decided in [#281](https://github.com/les-cabochons/ajour/issues/281).

- A description can start with a YAML block between two `---` lines that sends data to Ajour. Ajour reads a small subset: `key: value`, maps nested by indentation up to 16 levels, single- and double-quoted strings with YAML's escapes, `#` comments, `- item` and `[a, b]` lists of plain values, and `...` as the closing line. Keys match ignoring case, so a key repeated in any case makes the block invalid, and a key without a value shows nothing. Invalid YAML and anything outside the subset, such as anchors, aliases, tags, block strings or a `null`, is not frontmatter, and the description shows as written.
- The item page and the peek never show the block in the description. Edit shows the whole text, block included.
- Every key except `timelog` shows in the item's properties, in the page's card and the peek, after the item's own rows, When missing included. A plain value is a row labelled with the key as written. A list or a key with nested keys is a section under a divider whose title toggles it: a list shows its count and opens to one value per line, and a nested key opens to its own rows and sections. Sections start closed. This device remembers the sections the user opened, by their keys and ignoring case, on every item: the newest 200. An `http` or `https` value is a link.
- Web links in the description text and in the frontmatter ask "Open this link?" with the full address, Cancel, Open link and a "Don't ask again" checkbox. Settings > Backlog > Descriptions > "Ask before opening description links" turns the question back on. Mail links open as before.
- `timelog.project` and `timelog.task` name the item's project and task. The project is the active project whose name, display name or code matches, ignoring case. The task is that project's task of that name. A timelog with only a task looks in the item's current project. A timelog without a task accepts any task of its project.
- Saving a description applies its timelog when the timelog changed: an edit in Ajour, a new item, an agent's edit, or a newly synced item. It restores an archived task or adds a missing one, except in a shared project, whose tasks the team gets. A missing project, or a shared project's missing task, waits for the user. A write that sets the project or task itself keeps it, even when it is the one the item had, and so does a new item created with a project of its own. A new subitem whose project only came from its parent takes its timelog's. The change shares the write's Undo. The backlog editor's Save has no Undo of its own and keeps that: what the timelog then sets or creates gets its own Undo ("Project and task set from the description"), which keeps the saved text. When the Save also moves the item, or creates it in a done state, that Undo also takes back the move or the close.
- While the item's project or task differs from its timelog, a button follows the Project property. An archived item is read-only until Restore and shows none:
  - When the project does not exist, an amber warning, "Create project Beta Corp", opens an AlertDialog with Cancel and Create project, or Restore project when an archived project has that name. Confirming creates or restores it with the task.
  - When the task does not exist or is archived, an amber warning, "Add task Deploy to Team site", opens an AlertDialog with Cancel and Add task or Restore task. For a shared project it says the team gets the task too.
  - When both exist but the item is set to others, as after a pick in the properties, a muted back arrow, "Use Acme website › Development from the description", sets them at once.
  - Each sets the project and task on the item and shows the Undo toast.

## Projects

Decided in [Projects pages under the new conventions](https://github.com/les-cabochons/ajour/issues/26).

- The project list keeps its search field and an "Archived" entry at the bottom. Wide windows show it next to the app sidebar. The narrow view shows it inside Settings.
- "New project" in the list header and Edit from the project's action set open the project form as a standard dialog: name, display name, code, icon and color. On the project page, these fields change in place instead.
- Editing a task uses the side panel, with the same Save and Escape rules as entries. It holds name, billable, budget and adjustment, and the pinned slot. The inline task editor that saved on outside click goes away.
- The project page has no "…" menu and no top bar actions. Like the backlog item page, it edits in place: click the title to rename the display name, and the Properties card on the right changes full name, code, color and icon. Each edit saves on Enter, blur or pick, with Undo; Escape cancels. "Import tasks…" and Archive (Restore when archived) sit at the bottom of the card. An archived project's fields are read-only.
- "Import tasks…" reads the file with the schema picked in Settings › Projects when it is a plugin, and merges the tasks into the project by name: new names are added, known tasks take the file's status, billable and budget. A file for another project, or with several projects, changes nothing and says why. With Ajour default, it adds the task names in column C of the first worksheet.
- In Settings › Projects, a schema without an export layout only imports. The Export projects section then says so, and names Ajour default for exports. A file whose schema names no project is refused there, and points to "Import tasks…".
- "New task" under the task list opens a blank task panel.
- A task row shows its pinned slot, such as "3", next to its name.
- The old Projects command dialog is removed. Cmd+K offers "Create project" and "Create task in…".

## Settings

Decided in [Settings and Sync review under the new conventions](https://github.com/les-cabochons/ajour/issues/27).

- Pages keep their content, with sentence case and the labels from the Vocabulary section.
- Results and errors of imports, exports and syncs show inline on their page, per the Feedback section.
- When the local app API is not running, as in the web build, Plugins shows one calm notice: "Plugins need the desktop app". Backlog and Sync review hide their plugin sections instead of showing red error banners.
- When this computer can't run plugins in a sandbox, Plugins and each plugin page show the warning "Plugins are turned off: this computer can't run them in a sandbox", with the reason under it, such as "Ajour was started with --no-sandbox." or "Plugins run only on Windows and macOS." (decided in [#231](https://github.com/les-cabochons/ajour/issues/231), built in [#390](https://github.com/les-cabochons/ajour/issues/390)). No plugin runs, Ajour's own included, and every plugin shows as off with its activation switches disabled (a tooltip gives the same words), so automatic syncs pause; connections and synced data stay. A sync started anyway leaves the same words as its connection's last error. There is no override. Until the cut-over (#403) this happens only in development builds, which run plugin API 4 plugins in their sandbox.
- A plugin API 4 plugin's page ends with an Advanced section (#391, decided in [#217](https://github.com/les-cabochons/ajour/issues/217)) that says "Start applies at once. A new Memory ceiling applies the next time the plugin starts." Start offers "Plugin's choice (…)", naming what the plugin declares, "Always ready" and "Load when needed", and saves on pick. Always ready starts the plugin with Ajour and keeps it running, using about 30 MB; Load when needed starts it at its first call and closes it 2 minutes after its last. Memory ceiling takes 64 to 2048 MB, saves on blur or Enter when it changed, and left empty uses the plugin's ceiling, shown as its placeholder (256 MB unless the plugin declares another). Any other value keeps what was typed and says "Enter a whole number of MB from 64 to 2048." under it, and nothing is saved. Above its ceiling, Ajour closes the plugin, and the call it was running fails saying its process went over its memory ceiling. Plugins of the older plugin API have no Advanced section.
- A plugin may run 4 calls at once; a fifth fails at once with "Too many operations of plugin "<id>" are already running." A call that takes more than 30 seconds fails, and Ajour closes the plugin; its next call starts it again.
- A plugin that stops 3 times within 10 minutes, by crashing, running past 30 seconds or going over its memory ceiling, is turned off: its page shows the warning "This plugin keeps stopping", then "It stopped 3 times in 10 minutes. The last time, <its process crashed | it ran out of memory | the system ended it | it used more memory than its ceiling allows | a call took longer than 30 seconds>. Ajour keeps it off until you turn it back on or restart Ajour.", and a Turn back on button, which says "<Plugin> turned back on." Meanwhile its calls fail at once with "Plugin "<id>" keeps stopping, so Ajour turned it off. Turn it back on from its page in Settings.", and an Always ready plugin stays closed. Turning a plugin off doesn't count as a stop.
- Quitting lets the plugin calls already running finish for up to 5 seconds, then closes every plugin.
- A plugin that tries a way out its sandbox closes, such as its own `fetch` instead of `ajour.http`, is not stopped: the attempt fails inside the plugin and counts as a blocked attempt for the plugin's Access review, which says "Tried to connect directly, blocked" (#394).
- Sync review keeps its list with selection, "Sync selected to backlog", and Dismiss. Dismiss shows the Undo toast instead of asking.
- The Debug page only exists in development builds.
- Settings > Backlog lists, for each connection, the source projects seen in syncs, each with its settle rule. See the Backlog sidebar section.
- A connection whose plugin provides comments or writes descriptions has Ajour's own "Agent access" select, after the plugin's fields: None (the default), Read, or Read and write (map #234, spec #301). A plugin cannot declare or preset it. While it is not None, the connection's row shows what agents may do: "Agents read comments", "Agents read and write comments", "Agents read and write comments and descriptions", or "Agents change descriptions" for a plugin without comments. The MCP tools check it at each call: `list_work_item_comments` needs Read, and `post_work_item_comment` and `settle_work_item`'s `comment` need Read and write. `edit_work_item`'s change to a synced description needs Read and write, and goes through the user's save: the read-only rule, the length limit, then the read, merge and write with no Undo for the text, reported in `descriptionSave` as written, merged, unchanged, conflict or failed. Lossy text is refused unless the connection has Allow lossy conversion on, which then stands for Save anyway. The checks run on the item after reading the settings; a change to the description meanwhile refuses the edit, and resending the text of a description in conflict reports the conflict. The call's other fields and what the timelog sets share one Undo, taken after the write. An agent's description read and write carry `agent=1` too, and the API checks Read and write before the plugin runs. An agent's comment waits for its own Undo toast, titled "<Client>: Commented on a backlog item", and a refused post, or access taken back before it goes, keeps it as the item's comment draft. Every check reads the connection from the local API at that moment, never a cached overview, and the local API enforces it too: an agent's comment call carries `agent=1`, and the API checks the stored access before the plugin runs and, for a read, again before the text leaves.

## Saved secrets and the Vault

Decided in [Access review and credential management for existing plugins](https://github.com/les-cabochons/ajour/issues/222), built in [#393](https://github.com/les-cabochons/ajour/issues/393). Secrets live in the vault, encrypted by the operating system ([#233](https://github.com/les-cabochons/ajour/issues/233)).

- **A saved secret is never shown.** A form never holds its value, and there is no mask. This applies to every field a plugin marks secret, whatever its type: a token, a password, or a secret calendar address, which a form used to show as text. Agent task settings marked secret get the same field.
- **A secret address can't hold a user name or password.** Saving one refuses with "Remove the user name and password from" and the field's label, and nothing is saved. A redirect to such an address is not followed.
- **A secret field in a connection form** shows a state chip, the last use, and Replace and Remove, in place of an input:
  - Saved.
  - "Expires in N days", from a week before its reminder date, and "Expires today". "Expired on 21 Oct 2026" after it.
  - Token rejected, after a 401 from the service, and only then.
  - "Can't be read on this computer", for a secret the vault can't decrypt.
  - Not set, for a field with no secret, such as one the user removed. A field that is not set shows its input at once.
  - Replace opens an empty password input with Cancel. Saving the form with the input empty keeps the saved secret. A form opened for a rejected secret starts with Replace open, and a chip stays above the input.
  - Remove asks first, then deletes the secret now, without saving the rest of the form. The connection keeps its settings and synced data and pauses until a new secret is saved, when its plugin requires the secret. A secret the plugin doesn't require is only deleted.
  - Replace, Remove and the input are disabled while Ajour can't protect credentials on this computer, with the reason in place of the help text.
- **The connection row** also warns about a reminder date, with the field's name and the chip "Expires in N days" or "Expired on …", while the connection stays connected: Ajour keeps using the secret.
- **The reminder date** is an optional date under each secret field, "<Field> expires on (optional)", with the line "A reminder only. Ajour keeps using it after this date." It counts to the end of that day. Replacing a secret starts the new one without a date unless the form gives one.
- **A 401** from a plugin call marks the connection's saved secrets rejected. The connection row shows the chip "Token rejected" in place of Error, with "<Plugin> refused the token. Sync is paused. Edit the connection to replace it.", and sync is paused: its Sync buttons are disabled and the automatic sync leaves it alone. Saving a new secret resumes it. Another status, such as a 403, only sets the Error chip and the last error. Plugins on API 3 report errors as messages, so only an error that names its HTTP status is recognised; the broker reports every 401 once plugins use it.
- **Settings > Vault**, between Plugins and MCP, lists every secret Ajour holds, never a value, grouped by plugin by name. A plugin whose package is missing comes last, as "<Plugin> (not installed)".
  - A row shows the connection (or "Agent tasks" for a plugin's task settings), the kind of secret (the field's label), the last use, a state chip and Replace. Replace opens the connection's form with Replace open, or the plugin's task settings.
  - A missing plugin's connections show as "Saved settings and secrets", because nothing says which of their settings are secret. Its group has Remove, which asks first, then deletes the plugin's connections and saved secrets, and the connections' local pull requests, calendar data and team data with them. Synced backlog items stay.
  - Two notices come first. "Ajour can't protect credentials on this computer" gives the reason and says connections that need a token are paused; Try again opens the vault again and runs the encryption check once more. "Saved secrets can't be read on this computer" gives the reason, as after moving Ajour's data to another computer, and says to paste each token again. It has no Try again, because pasting a token is what fixes it.
  - With no secret saved, the page says "No saved secrets".

## Access review and consent

Decided in [Access review and credential management for existing plugins](https://github.com/les-cabochons/ajour/issues/222), variant A of its prototype, built in [#394](https://github.com/les-cabochons/ajour/issues/394).

- **The Access section** sits on each plugin's page before Features, in plain words. It says "What this plugin can reach. Requests it makes through Ajour are limited to what is listed here." Until plugins run in their sandbox (#403), that is all Ajour can promise.
  - Each host the plugin reaches: the address a connection saves ("The address in "Site URL"") and each derived host under the name its plugin gives it, with the address it works out. The endpoints of a host, as method and path, sit behind a disclosure ("N endpoints"), each with the access choice that unlocks it.
  - Public hosts, which Ajour reaches without a credential.
  - "Addresses on your own network", for a plugin that lets a connection be marked on-premises, and "Request headers", listing the headers it may set, when it may set any.
  - The credential: the connection field Ajour adds to each request, which the plugin never sees. A secret address is the credential and the destination.
  - Each agent task and the Ajour tools it gets, or "Gets no Ajour tools.".
  - The start mode: "Loads when needed" or "Always ready", which keeps the plugin loaded and uses about 30 MB.
  - An installed plugin also says "Last used N minutes ago." (or "Not used yet."), as the Vault page says of a secret. When the broker refused requests for access the plugin doesn't have, such as an endpoint it doesn't list, a warning says "Asked for access it doesn't have, refused. N times, last at 14:32." When its sandbox blocked a way out (#390), another says "Tried to connect directly, blocked. N times, last at 14:32." These come from the broker's records, which are written every 30 seconds.
- **A catalog plugin** that isn't installed has the same section, saying its addresses, credential, agent tasks and start mode are listed once it is downloaded, because the catalog doesn't carry them, and that it stays inactive until turned on.
- **A plugin on plugin API 3** says "This plugin was built for an older plugin API, so Ajour can't limit it. Update it to move it onto one that does." and lists what it can do without limits: any address, each connection's saved settings as saved, and every Ajour tool for its agent tasks.
- **Turning a plugin on is the consent.** A download and a first install from a file stay inactive, and so does a reinstall after an uninstall. Ajour records the access the plugin had, and its version, when the user turns it on. A plugin that was on before Ajour recorded consent counts as having been allowed what it reached then, or nothing, if that version couldn't run.
- **A connection is saved only on a plugin that is on.** Saving validates the connection, which runs the plugin with the credential just typed, so it waits for the user's consent. On an inactive plugin, Add a connection is disabled, with "Activate this plugin to save a connection."; on one held for more access, "Press Allow and activate to save a connection."; and while the plugin system is off, "Enable the plugin system to save a connection." Edit stays available, so a connection can be read, but its form shows the same hint above its buttons and Update connection (or Add connection) is disabled, whether the form was opened from Edit or from Replace on the Vault page. A save that still arrives is refused with "Activate this plugin before saving a connection.", "Allow the new access first." or "Enable the plugin system before saving a connection.", before anything runs, and a refused save holds none of the connection's estimate changes. Saved connections, secrets and settings stay.
- **A plugin that reaches more than the user allowed is inactive,** whatever its switch says. That holds after an update, after an update Ajour was stopped in the middle of, and for a plugin in a development directory whose manifest changes.
- **An update that reaches more** installs inactive, and keeps connections and settings. The page shows a warning, "Version N needs more access", listing only what is new, each line marked New and with only its new endpoints, and "Allow and activate". The Access section marks the same items New. Allow and activate turns the plugin on for the version the page lists, which records the new access; if another version was installed meanwhile, Ajour refuses with "<Plugin> is now version N. Review its access, then turn it on again." This holds for catalog updates and file updates alike, and while the plugin stays inactive the update's status message says it needs more access.
  - An update reaches more when it adds a capability, host, derived host, endpoint, public host, request header, auth scheme or MCP tool, changes an agent task's prompt, lets a connection be marked on-premises, switches the plugin to "Always ready", or turns an access choice always on or adds an operation to one ("Now also lets a connection settle backlog items in the source.").
  - It also reaches more when it removes a gate: an endpoint no longer behind its access choice, or behind another one, or an operation that no longer sits behind any choice, listed as "No longer behind an access choice: settle backlog items in the source". The manifest lists only gated operations, so a removed operation can't be told from an ungated one, and the line says either may be the case. An endpoint put behind a choice, and any other removal, does not count.
  - An update that reaches no more keeps the plugin as it was, active or not.

## Connection access and held edits

Decided in [the connection access decisions](https://github.com/les-cabochons/ajour/issues/223#issuecomment-6322442188) and [the held-edit decisions](https://github.com/les-cabochons/ajour/issues/223#issuecomment-6322497778), built in [#395](https://github.com/les-cabochons/ajour/issues/395).

- **Each connection chooses its access.** The connection form of a plugin with access choices, Azure DevOps today, ends with an **Access** group: "Ajour blocks anything not chosen here, even when the token allows more." Each choice is a checkbox whose description names the token scope it needs:
  - Read the backlog: work items, queries, comments and descriptions. Always on. Work Items (Read).
  - Edit work items: send estimates, settled and moved work, descriptions and comments. Work Items (Read & write).
  - Pull requests: the pull requests you're involved in, and your teams' review requests. Code (Read), and Project and Team (Read) for teams.
  - Search people across the organisation: @ suggestions from the whole organisation. Identity (Read).
- **New connections, and connections from before access choices, read only.** Their settings and local values stay. Nothing writes to the source until the user turns a choice on, and the first sync after the update sends no change.
- **Ajour enforces the choices, whatever the token allows.** The local API refuses a write, a pull request call or a people search with a query whose choice is off before the plugin runs; reads that Azure DevOps sends as POST, such as queries and batch reads, still work. Turning a choice off cancels the calls it allowed that still run. With Pull requests off, the connection's pull requests don't sync, on the interval or by hand, and don't show. A bare @ asks the plugin for the item's own people, such as its assignee and commenters, which reading the backlog covers, so it runs with people search off. With people search off, the comment editor's @ suggestions are those people, matched in Ajour against the name typed; a typed name never looks the organisation up.
- **The connection row** shows "Reads backlog", or "Edits work items" once editing is on, after the sync-mode badge.
- **A change refused because editing is off is held on this computer:** a settle or move, an estimate, a description, a comment, a comment edit and a comment delete. It is never rolled back or dropped: the item stays as the user left it, a deleted comment stays hidden, and a posted comment leaves the composer. A toast says "Held on this computer: editing work items is off for "<connection>". Turn it on to review and send the change.", once for a burst of holds. A sync of a connection that reads only uploads no estimate; the estimates it would have sent are held. A reaction is not held: it goes back, with the refusal as its error.
- **The row and the Access group count them**: "N changes held. Turn on editing to review and send them." Once editing is on, the row's line links to Sync review instead.
- **Turning editing on is not approval.** Saving the form with Edit work items newly on first holds every estimate change the connection would upload, before the save goes, so a sync during the save or a quit sends none of them. When the connection holds any change, the save then opens Sync review on its held changes.
- **Held changes in Sync review** come first, grouped by connection. Each shows its item, what kind of change it is and the change itself, with Send and Discard. Send is the approval: the change goes through its usual path, so a source that changed meanwhile still answers with a conflict, which then shows with the other issues. Send is disabled while the change can't go, and the group says why: the connection was removed, so the changes can only be discarded; it is paused, with a link to fix it; or editing is off, with a link to turn it on. Discard asks first, naming the kind of change ("Discard this held settle?"), then drops the change and takes the source's side back: a settle's item returns to its state before, an estimate and a description take the source's value.
- **Held changes stay** when the user leaves Sync review, restarts Ajour or turns editing off again. A held settle or move keeps its settle comment waiting with it. A held comment change stays held until the source took it, so a quit while it is sent keeps it.
- **A new change replaces a held one.** A settle, move or description saved again while editing is on goes as usual and replaces the held one of the same item.
- **Removing a connection discards what it holds.** Remove then always asks first, and says "Its N held changes are discarded and never sent."

## Consistency

Decided in [Consistent dialogs, tooltips, loading and drags](https://github.com/les-cabochons/ajour/issues/28).

- Every modal surface uses the `Dialog`, `AlertDialog` or `Sheet` primitive. The hand-built overlays (backlog task and note, project form, the old submit modal) go away.
- Icon-only buttons use the `Tooltip` primitive, showing the label and its shortcut, instead of `title=` attributes. The sidebar rows' hover actions and the comment header's reaction and actions buttons are the exceptions described in `ui-rules.md`.
- Route loading shows a `Skeleton` of the page layout after 150ms instead of a blank page.
- Escape cancels every drag and puts the item back. Dropping an item where it started changes nothing. Moves between days show the Undo toast.

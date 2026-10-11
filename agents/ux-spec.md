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

| Slot             | Saved    | Submitted                                                | Running                          |
| ---------------- | -------- | -------------------------------------------------------- | -------------------------------- |
| Edit             | Enabled  | Enabled, with "Saving marks this entry as not submitted" | Enabled, changes apply live      |
| Continue / Stop  | Continue | Continue                                                 | Stop                             |
| Duplicate        | Enabled  | Enabled, the copy is saved                               | Disabled: "Stop the timer first" |
| Duplicate to…    | Enabled  | Enabled, the copy is saved                               | Disabled: "Stop the timer first" |
| Move to…         | Enabled  | Enabled, marks the entry as not submitted                | Disabled: "Stop the timer first" |
| Delete / Discard | Delete   | Delete                                                   | Discard                          |

- Continue on today's entry resumes that entry. Continue on another day's entry starts a new running entry today with the same task and note. Today the code adds the new time to the original entry, even on a past day. That changes.
- Discard throws away the time counted since the entry last started. A running entry that started from nothing disappears.
- Move up and Move down apply to saved and submitted entries. The running entry stays first in its day, so Move up and Move down are disabled on it: "The running entry stays on top".

### Project

Edit · New task · Archive (Restore when archived)

- An archived project disables Edit and New task: "Restore the project first".
- Archive leaves the edit form and moves into the action set.
- Projects have no Delete.

### Task

Start entry · New entry… · Edit · Archive (Restore when archived)

- Start entry starts a new running entry for this task.
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
- What right-click does on a Grid cell, which can hold several entries: [Adding and changing time in the week view](https://github.com/les-cabochons/ajour/issues/16).
- Undo or confirmation for Delete, Discard, Archive and moves: [Undo, confirmation and feedback policy](https://github.com/les-cabochons/ajour/issues/17).
- Keys, palette layout and menu bar menus: [Keyboard model and command palette](https://github.com/les-cabochons/ajour/issues/18).

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
- Fields: Project / task, Note, Hours (`TimeEntryFields`), with the shared draft rules (`time-entry-editor.ts`).
- Footer: Cancel · Start timer (Continue on a saved entry) · Save.

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

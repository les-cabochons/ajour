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
7. Exception to rule 1: Move up and Move down (Alt+Up and Alt+Down) reorder sortable objects. They exist as keyboard shortcuts and palette commands only, not in the right-click or "…" menus. Sortable objects are time entries within a day, projects, project tasks and top-level work items.

### Time entry

| Slot             | Saved    | Submitted                                                | Running                          |
| ---------------- | -------- | -------------------------------------------------------- | -------------------------------- |
| Edit             | Enabled  | Enabled, with "Saving marks this entry as not submitted" | Enabled, changes apply live      |
| Continue / Stop  | Continue | Continue                                                 | Stop                             |
| Duplicate        | Enabled  | Enabled, the copy is saved                               | Disabled: "Stop the timer first" |
| Duplicate to…    | Enabled  | Enabled, the copy is saved                               | Disabled: "Stop the timer first" |
| Move to…         | Enabled  | Enabled, marks the entry as not submitted                | Disabled: "Stop the timer first" |
| Delete / Discard | Delete   | Delete                                                   | Discard                          |

- Continue on today's entry resumes that entry. Continue on another day's entry starts a new running entry today with the same project task and note. Today the code adds the new time to the original entry, even on a past day. That changes.
- Discard throws away the time counted since the entry last started. A running entry that started from nothing disappears.
- Move up and Move down apply to saved and submitted entries. The running entry stays first in its day, so Move up and Move down are disabled on it: "The running entry stays on top".

### Project

Edit · New task · Archive (Restore when archived)

- An archived project disables Edit and New task: "Restore the project first".
- Archive leaves the edit form and moves into the action set.
- Projects have no Delete.

### Project task

Start entry · New entry… · Edit · Archive (Restore when archived)

- Start entry starts a new running entry for this task.
- New entry… opens the entry editor with this task filled in.
- An archived task, or a task in an archived project, disables Start entry, New entry… and Edit: "Restore the task first" or "Restore the project first".

### Backlog work item

Start entry · New entry… · Edit · Add subtask · Open in source · Archive (Restore when archived) · Delete

- Open in source is listed only for items synced from a connector.
- New entry… replaces the inline "Log time" field as the action for logging time.
- An archived item disables Start entry, New entry…, Edit and Add subtask: "Restore the item first".
- A subtask disables Add subtask: "Subtasks can't have subtasks".
- Delete removes the item's subtasks too, and its label states the count, for example "Delete (and 2 subtasks)".

### Decided elsewhere

- How Edit opens and where the action set appears inside the editor: [One entry editor for Day and Week](https://github.com/les-cabochons/ajour/issues/14).
- Which day Start entry and New entry… use from the backlog and project tasks: [Running timer editing and empty duration meaning](https://github.com/les-cabochons/ajour/issues/15).
- What right-click does on a Ledger cell, which can hold several entries: [Adding and changing time in the week view](https://github.com/les-cabochons/ajour/issues/16).
- Undo or confirmation for Delete, Discard, Archive and moves: [Undo, confirmation and feedback policy](https://github.com/les-cabochons/ajour/issues/17).
- Keys, palette layout and menu bar menus: [Keyboard model and command palette](https://github.com/les-cabochons/ajour/issues/18).
- Final labels: [Product name and vocabulary](https://github.com/les-cabochons/ajour/issues/11).

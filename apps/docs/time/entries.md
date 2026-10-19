# Time entries

A time entry is time spent on a task on one day, with an optional note. This page covers creating, editing and moving entries.

<Shot name="time-new-entry" alt="The new entry popover" />

## Create an entry

Press <kbd>N</kbd>, or the **+** button in the sidebar. You can also choose **New entry…** on a task or a backlog item, which fills in its project and task.

| Field     | What to enter                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task**  | Search by project, task or code. Choose **Use project without a task** to log time on the project only.                                                                                   |
| **Hours** | `1:30`, `1.5` or `1,5`. Ajour shows it as `01:30` once you leave the field.                                                                                                               |
| **Date**  | The day of the entry. On the Time page, <kbd>N</kbd>, the **New entry** row and Week cells and columns start on their day. The sidebar **+**, and <kbd>N</kbd> elsewhere, start on today. |
| **Note**  | Optional. What you did. Notes become the comments of your timesheet lines.                                                                                                                |

Press **Save**, <kbd>⌘</kbd> <kbd>Enter</kbd>, or <kbd>Enter</kbd> in **Hours** or **Note**. <kbd>Shift</kbd> <kbd>Enter</kbd> starts a new line in the note.

To start the entry instead of logging hours, leave **Hours** empty and press **Start**. With hours filled in, **Start** counts on from them. A running entry always starts on today, so on another day the form says **Starts today**. See [Running entries](/time/running-entries).

## Edit an entry

Double-click the entry's row in the [Day view](/time/day-view) or its card in the [Week view](/time/week-view), or click its Week Grid cell. The editor opens in the side panel. On a touch screen, tap the row.

The editor's **…** button lists the entry's actions. A committed entry shows a **Committed** chip. If you change it, the change shows on the Commit page until you commit it again. See [Commit your week](/time/commit).

## Copy and move entries

| Action            | Key                       | What it does                        |
| ----------------- | ------------------------- | ----------------------------------- |
| **Duplicate**     | <kbd>⌘</kbd> <kbd>D</kbd> | Copies the entry on the same day.   |
| **Duplicate to…** |                           | Copies the entry to a day you pick. |
| **Move to…**      | <kbd>M</kbd>              | Moves the entry to a day you pick.  |

**Duplicate to…** and **Move to…** ask for the day in a calendar, where the days of submitted weeks are greyed out. A copy or a move to another day shows an Undo toast, such as `Moved to Thu, Oct 8`.

Stop a running entry before you copy or move it.

## Select, copy and paste entries

The Day list and the Week Days cards select entries like a file explorer:

- Click an entry to select it. Double-click it, or press <kbd>Enter</kbd>, to open it.
- <kbd>⌘</kbd>-click, or <kbd>Ctrl</kbd>-click on Windows, adds an entry to the selection or removes it.
- <kbd>Shift</kbd>-click selects every entry between the last one you clicked and this one. In the Week view the range runs from Monday's cards to Sunday's.
- <kbd>Shift</kbd> <kbd>↑</kbd> and <kbd>Shift</kbd> <kbd>↓</kbd> grow or shrink the selection. <kbd>↑</kbd> and <kbd>↓</kbd> alone move to the next entry and select it alone.
- <kbd>⌘</kbd> <kbd>A</kbd> selects every entry of the day, or of the week in the Days layout, while an entry has focus.
- Right-clicking an entry outside the selection selects it alone first.
- <kbd>Esc</kbd>, a click on empty space, or another day or week clears the selection.

### Act on a selection

**Delete**, **Duplicate**, **Duplicate to…**, **Move to…**, **Mark as not committed**, cut, copy and dragging act on every selected entry, with one Undo. Their keys do too. The right-click menu of a selected entry names the count, such as **Move 3 entries to…** or **Delete 3 entries**, and leaves out **Edit**, **Continue**, **Stop** and **Discard**, which act on one entry only.

- **Duplicate** puts each copy at the end of its own day.
- **Duplicate to…** and **Move to…** ask for one day, and every entry goes to the end of that day.
- Moved entries stay selected. Copies become the new selection.
- The running entry can be selected, but every one of these actions skips it. In the Day list, a continued running entry can still be dragged on its own to reorder it within its day. In the Week Days layout, the running card cannot be dragged.

### Copy and paste

<kbd>⌘</kbd> <kbd>C</kbd> copies the selected entries and <kbd>⌘</kbd> <kbd>X</kbd> cuts them. <kbd>Backspace</kbd> deletes them all, with one Undo. Right-clicking an entry offers **Cut**, **Copy** and **Paste** too. **Paste** is greyed out until you copy or cut entries.

<kbd>⌘</kbd> <kbd>V</kbd> pastes:

- In the Day view, every entry lands on the day you are looking at.
- In the Week view, each entry keeps its weekday. An entry copied from a Monday lands on the Monday of the week you are looking at.
- In the Week Days view, right-click a column's empty space for **Paste here**, which puts every entry in that column, or **Paste on same weekdays**.

A paste of copied entries adds new entries and keeps the originals. Cut entries stay dimmed where they are until you paste them, then they move. Pasted entries go to the end of their day, and an Undo toast follows each paste. The copied entries also reach the system clipboard as lines of text, so you can paste them into a chat. If you copy something else afterward, <kbd>⌘</kbd> <kbd>V</kbd> no longer pastes the entries.

## Delete an entry

Press <kbd>Backspace</kbd> or <kbd>Delete</kbd> on a focused row, or choose **Delete** in its actions menu. An Undo toast shows for 8 seconds. Press **Undo** or <kbd>⌘</kbd> <kbd>Z</kbd> to bring the entry back.

## Import and export

**Settings › Time entries** exports a date range to an Excel file with the date, project, task, note and hours of each entry. It also imports entries from such a file. Ajour stages the rows for review first, and flags the ones that look like an entry you already have. See [Settings](/app/settings#time-entries).

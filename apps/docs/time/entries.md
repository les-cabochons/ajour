# Time entries

A time entry is time spent on a task on one day, with an optional note. This page covers creating, editing and moving entries.

<Shot name="time-new-entry" alt="The new entry popover" />

## Create an entry

Press <kbd>N</kbd>, or the **+** button in the sidebar. You can also choose **New entry…** on a task or a backlog item, which fills in its project and task.

| Field              | What to enter                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Project / task** | Search by project, task or code. Choose **Use project without a task** to log time on the project only.                           |
| **Note**           | Optional. What you did. Notes become the comments of your timesheet lines.                                                        |
| **Hours**          | `1:30`, `1.5` or `1,5`. Ajour shows it as `01:30` once you leave the field.                                                       |
| **Date**           | The day of the entry. <kbd>N</kbd> and the sidebar **+** start on today. The **New entry** row and Week cells start on their day. |

Press **Save**, <kbd>Enter</kbd> or <kbd>⌘</kbd> <kbd>Enter</kbd>. To start the entry instead of logging hours, leave **Hours** empty and press **Start**.

## Edit an entry

Double-click the entry's row in the [Day view](/time/day-view) or its card in the [Week view](/time/week-view), or click its Week Grid cell. The editor opens in the side panel. On a touch screen, tap the row.

If the entry was submitted, editing it marks it as not submitted, so you remember to submit the change. See [Submit your week](/time/submit).

## Copy and move entries

| Action            | Key                       | What it does                        |
| ----------------- | ------------------------- | ----------------------------------- |
| **Duplicate**     | <kbd>⌘</kbd> <kbd>D</kbd> | Copies the entry on the same day.   |
| **Duplicate to…** |                           | Copies the entry to a day you pick. |
| **Move to…**      | <kbd>M</kbd>              | Moves the entry to a day you pick.  |

Stop a running entry before you copy or move it.

## Select, copy and paste entries

The Day list and the Week Days cards select entries like a file explorer:

- Click an entry to select it. Keys such as <kbd>Enter</kbd>, <kbd>C</kbd> and <kbd>⌘</kbd> <kbd>D</kbd> act on it.
- <kbd>⌘</kbd>-click, or <kbd>Ctrl</kbd>-click on Windows, adds an entry to the selection or removes it.
- <kbd>Shift</kbd>-click selects every entry between the last one you clicked and this one. In the Week view the range runs from Monday's cards to Sunday's.
- <kbd>Esc</kbd>, or a click on empty space, clears the selection.

<kbd>⌘</kbd> <kbd>C</kbd> copies the selected entries and <kbd>⌘</kbd> <kbd>X</kbd> cuts them. <kbd>Backspace</kbd> deletes them all, with one Undo. The running entry can be selected, but copy and cut skip it.

<kbd>⌘</kbd> <kbd>V</kbd> pastes:

- In the Day view, every entry lands on the day you are looking at.
- In the Week view, each entry keeps its weekday. An entry copied from a Monday lands on the Monday of the week you are looking at.
- In the Week Days view, right-click a column's empty space for **Paste here**, which puts every entry in that column, or **Paste on same weekdays**.

A paste of copied entries adds new entries and keeps the originals. Cut entries stay dimmed where they are until you paste them, then they move. An Undo toast follows each paste. The copied entries also reach the system clipboard as lines of text, so you can paste them into a chat.

## Delete an entry

Press <kbd>Backspace</kbd> on a focused row, or choose **Delete** in its actions menu. An Undo toast shows for 8 seconds. Press **Undo** or <kbd>⌘</kbd> <kbd>Z</kbd> to bring the entry back.

## Import and export

**Settings › Time entries** exports a date range to an Excel file with the date, project, task, note and hours of each entry. It also imports entries from such a file. Ajour stages the rows for review first, and flags the ones that look like an entry you already have. See [Settings](/app/settings#time-entries).

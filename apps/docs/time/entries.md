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

Click the entry's row in the [Day view](/time/day-view), or its cell or card in the [Week view](/time/week-view). The editor opens in the side panel.

If the entry was committed, the change shows on the Commit page until you commit it again. See [Commit your week](/time/commit).

## Copy and move entries

| Action            | Key                       | What it does                        |
| ----------------- | ------------------------- | ----------------------------------- |
| **Duplicate**     | <kbd>⌘</kbd> <kbd>D</kbd> | Copies the entry on the same day.   |
| **Duplicate to…** |                           | Copies the entry to a day you pick. |
| **Move to…**      | <kbd>M</kbd>              | Moves the entry to a day you pick.  |

Stop a running entry before you copy or move it.

## Delete an entry

Press <kbd>Backspace</kbd> on a focused row, or choose **Delete** in its actions menu. An Undo toast shows for 8 seconds. Press **Undo** or <kbd>⌘</kbd> <kbd>Z</kbd> to bring the entry back.

## Import and export

**Settings › Time entries** exports a date range to an Excel file with the date, project, task, note and hours of each entry. It also imports entries from such a file. Ajour stages the rows for review first, and flags the ones that look like an entry you already have. See [Settings](/app/settings#time-entries).

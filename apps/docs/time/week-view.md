# Week view

The Week view shows a whole week at once. Use it to fill gaps at the end of the week, or to check your week against your timesheet.

<Shot name="time-week-grid" alt="The Week view as a grid: one row per task, one column per day" />

Press <kbd>W</kbd> on the Time page, or press **Week** in the header. Press <kbd>D</kbd> to go back to the Day view, and <kbd>[</kbd> or <kbd>]</kbd> to move a week back or forward.

The Week view has two layouts. Switch between **Grid** and **Days** at the top of the page. Ajour remembers your choice.

## Grid

The grid has one row per project and task, and one column per day. Each cell holds the time logged on that task that day:

- `—` when the cell is empty.
- `3:30` for one entry.
- `3:30 ×2` for several entries.

The **Totals** row and the **Total** column add up the week. To leave out weekends and other days with no capacity, turn on **Settings › General › Hide non-working days**. Time logged on hidden days still counts in the totals. Hover a day's total to see it against your capacity target.

### Edit hours in a cell

Focus a cell with the arrow keys, then type a digit, press <kbd>Enter</kbd> or double-click. Type the hours and press <kbd>Enter</kbd> or <kbd>Tab</kbd> to save. <kbd>Tab</kbd> also moves to the next day, so you can fill a row in one pass. Press <kbd>Esc</kbd> to cancel.

- In an empty cell, the hours create a new entry for that task and day.
- In a cell with one entry, the hours replace that entry's hours. Clearing them deletes the entry, with Undo.
- A cell with several entries does not edit in place. Click it to list its entries in the side panel.

### Add or delete a row

Press **+ Add row** under the grid and pick a project or task. A row with no hours goes away when you leave the week.

To delete a row, right-click its name and choose **Delete row**, or press <kbd>Shift</kbd> <kbd>Backspace</kbd> on one of its cells. If the row has time, Ajour asks first and tells you how many entries it will delete. You cannot delete the row that holds the running entry.

## Days

The Days layout has one column per day, with a card per entry. Use it to see the order of your day and your notes.

<Shot name="time-week-days" alt="The Week view as days: one column per day with a card per entry" />

- Drag a card to another day to move the entry there. Drag it within a day to reorder it.
- Click a card, or press <kbd>Space</kbd> on it, to open it in the side panel.
- Press **+ Add** at the bottom of a column for a new entry on that day.

::: info Narrow windows
The Week view needs a window at least 768 pixels wide. In a narrower window, Ajour shows the Day view instead.
:::

# Week view

The Week view shows a whole week at once. Use it to fill gaps at the end of the week, or to check your week against your timesheet.

<Shot name="time-week-grid" alt="The Week view as a grid: one row per task, one column per day" />

Press <kbd>W</kbd> on the Time page, or press **Week** in the header. Press <kbd>D</kbd> to go back to the Day view, and <kbd>[</kbd> or <kbd>]</kbd> to move a week back or forward. Ajour remembers which view you used last and opens the Time page on it.

The Week view has two layouts. Switch between **Grid** and **Days** at the top of the page. Ajour remembers your choice.

Next to the switch, **Week total** adds up the week. A submitted week also shows **Submitted** with a lock. See [Commit your week](/time/commit#submit-the-week).

## Totals and capacity

Hover a day's total, or the week total, to see it against your capacity target, such as `91% of capacity`. With **Over-capacity warning** on in [Settings](/app/settings#general), a warning icon marks a day more than 50% over its target, such as 13 hours on an 8-hour day, and a week over its target.

To leave out weekends and other days with no capacity, turn on **Settings › General › Hide non-working days**. Time logged on hidden days still counts in the totals.

## Grid

The grid has one row per project and task, and one column per day. Each cell holds the time logged on that task that day:

- `—` when the cell is empty.
- `3:30` for one entry.
- `3:30 ×2` for several entries.

The **Totals** row and the **Total** column add up the week.

Click a cell to open it in the side panel:

- An empty cell opens a new entry with the row's task and the day filled in.
- A cell with one entry opens that entry, with **Add another entry for Monday** under the form.
- A cell with several entries lists them, with **Add another entry**.

Right-click a cell for **Add entry**, then the actions of its entry, or **Open entries** for a cell with several.

While a calendar plugin is on, a calendar chip with a count shows next to a day's total when the day has meetings to add. Click it to open the Calendar panel on that day. See [Calendar suggestions](/time/calendar-suggestions).

### Edit hours in a cell

Focus a cell with the arrow keys, then type a digit, press <kbd>Enter</kbd> or double-click. Type the hours and press <kbd>Enter</kbd> or <kbd>Tab</kbd> to save. <kbd>Tab</kbd> also moves to the next day, and <kbd>Shift</kbd> <kbd>Tab</kbd> to the previous one, so you can fill a row in one pass. Press <kbd>Esc</kbd> to cancel.

- In an empty cell, the hours create a new entry for that task and day.
- In a cell with one entry, the hours replace that entry's hours. Clearing them deletes the entry, with Undo.
- A cell with several entries, or with the running entry, does not edit in place. Click it instead.

### Add or delete a row

Press **+ Add row** under the grid and pick a project or task. A row with no hours goes away when you leave the week.

To delete a row, right-click its name and choose **Delete row**, or press <kbd>Shift</kbd> <kbd>Backspace</kbd> on one of its cells. If the row has time, Ajour asks first and tells you how many entries it will delete, then shows an Undo toast. You cannot delete the row that holds the running entry.

## Days

The Days layout has one column per day, with a card per entry. Use it to see the order of your day and your notes. Each card shows the project, the hours, the task, the note, and whether the entry is **saved** or **committed**. The running entry's card shows **Running**.

Each day reads from top to bottom in the order you worked: the oldest entry first. A continued entry keeps its place while it runs, and a new running entry comes last. Right-click a card for its actions.

<Shot name="time-week-days" alt="The Week view as days: one column per day with a card per entry" />

- Drag a card to another day to move the entry there. Drag it within a day to reorder it. Dragging a selected card drags every selected card except the running entry, and they land together where you drop them.
- Double-click a card, or press <kbd>Enter</kbd> or <kbd>Space</kbd> on it, to open it in the side panel. A single click selects it, so you can [copy and paste](/time/entries#select-copy-and-paste-entries) it.
- Right-click a column's empty space for **Paste here** and **Paste on same weekdays**.
- Press **+ Add** at the bottom of a column, or double-click the day's header or the empty space in its column, for a new entry on that day. It lands at the end of the day.
- While a calendar plugin is on, the day's meetings show as dashed cards under **From calendar**. See [Calendar suggestions](/time/calendar-suggestions).

::: info Narrow windows
The Week view needs a window at least 768 pixels wide. In a narrower window, Ajour shows the Day view instead.
:::

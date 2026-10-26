# Day view

The Day view lists the entries of one day. Ajour opens on today, in the view you used last: Day or [Week](/time/week-view).

<Shot name="time-day" alt="The Day view: the week strip, today's entries and the running entry" />

## Overview

- **The header** has the previous and next day buttons and the date. Click the date to pick another day from a calendar. On the right sit **Calendar**, while a calendar plugin is on, and **Day** and **Week**.
- **The week strip** shows the days of the week with their totals, and the **Week** total on the right. Click a day to open it. With **Hide non-working days** on in [Settings](/app/settings#general), days with no capacity are left out.
- **The rows** are the day's entries. Each row shows the project, the task, the note and the duration. The running entry shows a green dot and counts up. A check marks an entry your timesheet tool has as it is.
- **From your calendar**, under the rows, lists the day's meetings while a calendar plugin is on. See [Calendar suggestions](/time/calendar-suggestions).
- **The totals** at the top right show the total of the day you are on, with **Today** in front on today. Click them for the day and week totals. To commit the week, see [Commit your week](/time/commit).

## Move between days

| Key          | Action         |
| ------------ | -------------- |
| <kbd>T</kbd> | Go to today    |
| <kbd>[</kbd> | Previous day   |
| <kbd>]</kbd> | Next day       |
| <kbd>W</kbd> | Switch to Week |

On today, a **Today** chip shows next to the date. On another day, a **Return to today** button shows there instead.

## Add an entry

Press <kbd>N</kbd>, or **New entry** under the rows, for a new entry on the day you are looking at. The **+** next to **Start** or **Stop** in the sidebar starts on today. Pick the task, type the hours, and save. See [Time entries](/time/entries).

To log time while you work instead, start a [running entry](/time/running-entries).

## Edit an entry

Double-click a row, or press <kbd>Enter</kbd> on it, to open it in the side panel. A single click selects the row, so you can [copy and paste](/time/entries#select-copy-and-paste-entries) it. The panel shows the task, its project and the date at the top, with **Continue** to start the entry again, or **Stop** on the running entry. Change the task, the hours, the date or the note, then press **Save** or <kbd>⌘</kbd> <kbd>Enter</kbd>. The running entry has no date to change.

<Shot name="time-entry-editor" alt="An entry open in the side panel next to the day" />

Drag the panel's edge to resize it. Ajour remembers the width for each page. When the Time page is narrower than about 1160 pixels, the panel floats over the right side of the page instead of squeezing it. The page behind it still responds to clicks.

::: tip
Press <kbd>Esc</kbd> to close the editor without saving. Clicking outside the panel does not close it, so a stray click never loses your changes.
:::

## Entry actions

Right-click a row, or press <kbd>.</kbd> on it, for the actions on that entry. Hovering a row also shows **Continue**, or **Stop** on the running entry. When several entries are selected, the menu acts on all of them, such as **Move 3 entries to…**. See [Act on a selection](/time/entries#act-on-a-selection).

<Shot name="time-entry-menu" alt="The actions menu of an entry" />

| Action                    | What it does                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| **Edit**                  | Opens the entry in the side panel.                                                               |
| **Continue**              | Starts the entry again. On another day, it starts a new entry today with the same task and note. |
| **Stop**                  | Stops the running entry.                                                                         |
| **Cut**, **Copy**         | Cut or copy the entry, as <kbd>⌘</kbd> <kbd>X</kbd> and <kbd>⌘</kbd> <kbd>C</kbd> do.            |
| **Paste**                 | Pastes the entries you copied or cut on this day.                                                |
| **Duplicate**             | Copies the entry on the same day.                                                                |
| **Duplicate to…**         | Copies the entry to another day.                                                                 |
| **Move to…**              | Moves the entry to another day.                                                                  |
| **Mark as not committed** | On a committed entry: lists it on the Commit page again. See [Commit your week](/time/commit).   |
| **Delete**                | Deletes the entry. An Undo toast shows for 8 seconds.                                            |
| **Discard**               | On the running entry: throws away the time counted since it last started.                        |

## Reorder and move entries

The day lists entries oldest first, so a new entry lands at the bottom. Drag a row, or press <kbd>Alt</kbd> <kbd>↑</kbd> and <kbd>Alt</kbd> <kbd>↓</kbd>. A continued entry keeps its place while it runs and moves like the others. A new running entry stays last.

Dragging a selected row drags every selected row except the running entry. They land together where you drop them. Dragging a continued running entry reorders it alone, within its day.

To move rows to another day, drag them onto that day in the week strip. The day lights up, and the rows go to the end of that day, with an Undo toast such as `Moved 2 entries to Tue, Oct 14`. The Day view stays on the day you are looking at. A day of a submitted week takes no drop.

# Day view

The Day view lists the entries of one day. Ajour opens on today's Day view.

<Shot name="time-day" alt="The Day view: the week strip, today's entries and the running entry" />

## Overview

- **The header** has the previous and next day buttons, the date, and **Day** and **Week**. Click the date to pick another day from a calendar.
- **The week strip** shows the seven days of the week with their totals, and the week total on the right. Click a day to open it.
- **The rows** are the day's entries. Each row shows the project, the task, the note and the duration. The running entry shows a green dot and counts up. A check marks a submitted entry.
- **The totals** at the top right show the total of the day you are on. Click them for the day and week totals, and **Submit week**.

## Move between days

| Key          | Action         |
| ------------ | -------------- |
| <kbd>T</kbd> | Go to today    |
| <kbd>[</kbd> | Previous day   |
| <kbd>]</kbd> | Next day       |
| <kbd>W</kbd> | Switch to Week |

When you are not on today, a **Return to today** button shows next to the date.

## Add an entry

Press <kbd>N</kbd>, the **+** button in the sidebar, or **+ New entry** under the rows. Pick the task, type the hours, and save. See [Time entries](/time/entries).

To log time while you work instead, start a [running entry](/time/running-entries).

## Edit an entry

Double-click a row, or press <kbd>Enter</kbd> on it, to open it in the side panel. A single click selects the row, so you can [copy and paste](/time/entries#select-copy-and-paste-entries) it. Change the task, the hours, the note or the date, then press **Save** or <kbd>⌘</kbd> <kbd>Enter</kbd>.

<Shot name="time-entry-editor" alt="An entry open in the side panel next to the day" />

Drag the panel's edge to resize it. Ajour remembers the width for each page.

::: tip
Press <kbd>Esc</kbd> to close the editor without saving. Clicking outside the panel does not close it, so a stray click never loses your changes.
:::

## Entry actions

Hover a row and press **…**, or right-click it, for the actions on that entry.

<Shot name="time-entry-menu" alt="The actions menu of an entry" />

| Action            | What it does                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| **Edit**          | Opens the entry in the side panel.                                                               |
| **Continue**      | Starts the entry again. On another day, it starts a new entry today with the same task and note. |
| **Stop**          | Stops the running entry.                                                                         |
| **Duplicate**     | Copies the entry on the same day.                                                                |
| **Duplicate to…** | Copies the entry to another day.                                                                 |
| **Move to…**      | Moves the entry to another day.                                                                  |
| **Delete**        | Deletes the entry. An Undo toast shows for 8 seconds.                                            |
| **Discard**       | On the running entry: throws away the time counted since it last started.                        |

## Reorder entries

Drag a row, or press <kbd>Alt</kbd> <kbd>↑</kbd> and <kbd>Alt</kbd> <kbd>↓</kbd>. The running entry always stays first.

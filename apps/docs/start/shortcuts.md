# Keyboard shortcuts

Ajour is built to be used from the keyboard. Press <kbd>?</kbd> anywhere to see the shortcuts, with a search box. This page also lists the keys the overlay leaves out, such as those of selections, editors and Undo.

<Shot name="shortcuts" alt="The keyboard shortcuts overlay" />

Single keys such as <kbd>N</kbd> or <kbd>S</kbd> work when focus is not in a text field, a menu or a dialog. On Windows, use <kbd>Ctrl</kbd> where this page shows <kbd>⌘</kbd>.

## Anywhere

| Key                                           | Action                                                    |
| --------------------------------------------- | --------------------------------------------------------- |
| <kbd>N</kbd>                                  | New entry                                                 |
| <kbd>S</kbd>                                  | Start the focused backlog item, or stop or start an entry |
| <kbd>C</kbd>                                  | Continue the focused or most recent entry                 |
| <kbd>T</kbd>                                  | Go to today                                               |
| <kbd>G</kbd> then <kbd>T</kbd>                | Go to Time                                                |
| <kbd>G</kbd> then <kbd>B</kbd>                | Go to Backlog                                             |
| <kbd>G</kbd> then <kbd>P</kbd>                | Go to Projects                                            |
| <kbd>G</kbd> then <kbd>S</kbd>                | Go to Settings                                            |
| <kbd>⌘</kbd> <kbd>,</kbd>                     | Open Settings                                             |
| <kbd>⌘</kbd> <kbd>B</kbd>                     | Show or hide the sidebar                                  |
| <kbd>⌘</kbd> <kbd>K</kbd>                     | [Command palette](/app/command-palette)                   |
| <kbd>⌘</kbd> <kbd>Z</kbd>                     | Undo the last change, while its Undo toast shows          |
| <kbd>?</kbd>                                  | Keyboard shortcuts                                        |
| <kbd>1</kbd> to <kbd>0</kbd>                  | New entry for a [pinned task](/projects/tasks#pin-a-task) |
| <kbd>Shift</kbd> <kbd>1</kbd> to <kbd>0</kbd> | Start a pinned task                                       |

On a focused cell of the Week Grid, the number keys type hours instead.

## Time page

| Key                          | Action                       |
| ---------------------------- | ---------------------------- |
| <kbd>[</kbd> or <kbd>]</kbd> | Previous or next day or week |
| <kbd>D</kbd>                 | Day view                     |
| <kbd>W</kbd>                 | Week view                    |

## Focused row or card

Use <kbd>↑</kbd> and <kbd>↓</kbd> to move focus between rows, and <kbd>←</kbd> and <kbd>→</kbd> between days in the Week view or between columns on the backlog board. These keys then act on the focused row. They also work on a backlog item's page, where <kbd>Enter</kbd> renames the item.

| Key                                                                   | Action                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| <kbd>Enter</kbd>                                                      | Open or edit. On a calendar meeting with a project, add it.                                                     |
| <kbd>Space</kbd>                                                      | Open or close the peek of a backlog item. Open a Week Days card. Add a meeting card, or pick its project first. |
| <kbd>.</kbd>, <kbd>Shift</kbd> <kbd>F10</kbd> or the context menu key | Open the actions menu                                                                                           |
| <kbd>E</kbd>                                                          | Settle a backlog item or pull request                                                                           |
| <kbd>Shift</kbd> <kbd>E</kbd>                                         | Settle a backlog item with the settle dialog                                                                    |
| <kbd>B</kbd>                                                          | Snooze a backlog item or pull request                                                                           |
| <kbd>Shift</kbd> <kbd>S</kbd>                                         | Change state                                                                                                    |
| <kbd>P</kbd>                                                          | Change priority                                                                                                 |
| <kbd>Alt</kbd> <kbd>←</kbd> or <kbd>Alt</kbd> <kbd>→</kbd>            | Move to the previous or next workflow state                                                                     |
| <kbd>Alt</kbd> <kbd>↑</kbd> or <kbd>Alt</kbd> <kbd>↓</kbd>            | Move up or down                                                                                                 |
| <kbd>⌘</kbd> <kbd>D</kbd>                                             | Duplicate an entry                                                                                              |
| <kbd>M</kbd>                                                          | Move an entry to another day                                                                                    |
| <kbd>Backspace</kbd> or <kbd>Delete</kbd>                             | Delete an entry or backlog item, discard a running entry, archive a task                                        |
| <kbd>Shift</kbd> <kbd>Backspace</kbd>                                 | Delete a row of the Week Grid                                                                                   |

On a calendar meeting, <kbd>Backspace</kbd> or <kbd>Delete</kbd> dismisses it. See [Calendar suggestions](/time/calendar-suggestions).

## Select entries

On the Day list and the Week Days cards, entries select like files in a file explorer. See [Select, copy and paste entries](/time/entries#select-copy-and-paste-entries).

| Key                                                            | Action                                |
| -------------------------------------------------------------- | ------------------------------------- |
| <kbd>⌘</kbd> <kbd>A</kbd>                                      | Select every entry of the day or week |
| <kbd>Shift</kbd> <kbd>↑</kbd> or <kbd>Shift</kbd> <kbd>↓</kbd> | Extend the selection up or down       |
| <kbd>⌘</kbd> <kbd>C</kbd>                                      | Copy the selected entries             |
| <kbd>⌘</kbd> <kbd>X</kbd>                                      | Cut the selected entries              |
| <kbd>⌘</kbd> <kbd>V</kbd>                                      | Paste the copied or cut entries       |
| <kbd>Esc</kbd>                                                 | Clear the selection                   |

<kbd>⌘</kbd> <kbd>A</kbd> works while an entry has focus. <kbd>⌘</kbd> <kbd>D</kbd>, <kbd>M</kbd> and <kbd>Backspace</kbd> act on every selected entry.

## Week Grid

| Key                                               | Action                                   |
| ------------------------------------------------- | ---------------------------------------- |
| A number or <kbd>Enter</kbd>                      | Edit the hours of the focused cell       |
| <kbd>Enter</kbd>                                  | Save the hours                           |
| <kbd>Tab</kbd> or <kbd>Shift</kbd> <kbd>Tab</kbd> | Save, and go to the next or previous day |
| <kbd>Esc</kbd>                                    | Cancel                                   |

On a cell with several entries or the running entry, number keys do nothing. <kbd>Enter</kbd> or a click opens it in the side panel. See [Edit hours in a cell](/time/week-view#edit-hours-in-a-cell).

## In editors

| Key                               | Action                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| <kbd>⌘</kbd> <kbd>Enter</kbd>     | Save                                                          |
| <kbd>Enter</kbd>                  | Save, from a one-line field such as Hours, or an entry's note |
| <kbd>Shift</kbd> <kbd>Enter</kbd> | New line in an entry's note                                   |
| <kbd>Esc</kbd>                    | Close without saving                                          |

Fields that change in place, such as an item's title or a project's code, save on <kbd>Enter</kbd> and cancel on <kbd>Esc</kbd>.

## In Markdown editors

Descriptions and [comments](/backlog/comments) use a Markdown editor.

| Key                           | Action                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------- |
| <kbd>⌘</kbd> <kbd>Enter</kbd> | Save the description, send or save the comment, or settle from the settle dialog |
| <kbd>Enter</kbd>              | New line. In a list, the next item.                                              |
| <kbd>Esc</kbd>                | Close the editor. A comment keeps its draft.                                     |

Type <kbd>@</kbd> in a comment to mention someone. While the people picker is open:

| Key                                | Action                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| <kbd>↑</kbd> or <kbd>↓</kbd>       | Move through the people                                                                                                           |
| <kbd>Enter</kbd> or <kbd>Tab</kbd> | Mention the highlighted person                                                                                                    |
| <kbd>Esc</kbd>                     | Close the picker and keep writing                                                                                                 |
| <kbd>Ctrl</kbd> <kbd>Space</kbd>   | Open the picker again for the **@** at the cursor. On macOS, also <kbd>Alt</kbd> <kbd>I</kbd> or <kbd>Alt</kbd> <kbd>&#96;</kbd>. |

## Other keys

| Key                          | Action                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| <kbd>Esc</kbd>               | Close the open menu, dialog, panel or peek. Clear the sidebar search. Cancel a drag.             |
| <kbd>Backspace</kbd>         | In an empty search, go back to the command palette's main list, or the project picker's projects |
| <kbd>←</kbd> or <kbd>→</kbd> | Resize the sidebar or a side panel, while its edge has focus                                     |
| <kbd>1</kbd> to <kbd>0</kbd> | Pick a number in **Assign shortcut**                                                             |
| <kbd>⌘</kbd> <kbd>+</kbd>    | Zoom in, in the desktop app                                                                      |
| <kbd>⌘</kbd> <kbd>-</kbd>    | Zoom out, in the desktop app                                                                     |
| <kbd>⌘</kbd> <kbd>0</kbd>    | Actual size, in the desktop app                                                                  |

## Menus

The **…** and right-click menus show the key of each action that has one, so the menus teach you the shortcuts. In the desktop app, right-clicking a text field opens the system's edit menu, with **Cut**, **Copy**, **Paste** and **Select all**, and spelling suggestions for a misspelled word. Right-clicking selected text offers **Copy**.

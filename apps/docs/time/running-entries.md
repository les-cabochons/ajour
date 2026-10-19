# Running entries

A running entry counts your time as you work. When you stop it, Ajour saves it as an entry on the day it started.

<Shot name="timer-dock" alt="The running entry at the top of the sidebar" />

## Start an entry

There are several ways to start, depending on what you are about to work on:

- Press **Start** in the sidebar to start an empty entry. Its editor opens so you can pick the task. <kbd>S</kbd> starts an empty entry too, without opening the editor.
- Press **Start entry** on a backlog item, or focus it and press <kbd>S</kbd>. The entry gets the item's project and task.
- Press <kbd>Shift</kbd> and the number of a [pinned task](/projects/tasks#pin-a-task).
- Press <kbd>C</kbd> to continue the focused entry, or your most recent one.
- In the entry editor, leave **Hours** empty and press **Start**. With hours filled in, the entry counts on from them.

Only one entry runs at a time. Starting another one stops the running entry and saves it. The editor names this **Switch**. A running entry always runs on today.

## While it runs

The sidebar shows the running entry at the top: its title, the time with seconds, and the project code and task. If the entry is on a backlog item with an estimate, a bar shows how much of the estimate is used, such as `0.7h left` or `0.4h over`. While the sidebar is hidden, the running entry floats at the bottom left with its title, its time and the stop button.

The window title shows the time too, such as `● 1:24 · Fix export rounding`, so you can see it from the taskbar or the window switcher.

Click the running entry to open its editor. Change its task, its note or the hours counted so far, then press **Save**: the entry keeps running. **Stop** saves your changes and stops it.

<Shot name="timer-dock-editor" alt="The running entry's editor" />

## Stop an entry

Press <kbd>S</kbd>, or the stop button next to the time. Ajour saves the entry on the day it started, even past midnight. Use **Move to…** to put it on another day.

To throw away the time counted since the entry last started, choose **Discard** in its actions menu, or press <kbd>Backspace</kbd> on its row. An Undo toast shows for 8 seconds.

## Continue an entry

**Continue** on one of today's entries starts it again and adds the new time to it. The entry keeps its place in the Day and Week views while it runs. On an entry from another day, it starts a new entry today with the same task and note.

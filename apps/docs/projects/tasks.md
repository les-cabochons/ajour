# Tasks

A task is a kind of work inside one project, such as `Development`, `Code review` or `Meetings`. Time entries point at a task, and the Commit page groups your week by task.

<Shot name="project-task-editor" alt="A project page with the task editor open" />

## Create a task

Open a project and press **New task**. The task editor opens in the side panel.

| Field          | What it is for                                                                             |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Name**       | The task's name, as your timesheet tool knows it.                                          |
| **Billable**   | Whether the time is billable. Exports and schemas carry it.                                |
| **Budget**     | Optional. The hours planned for the task. The project page shows the time used against it. |
| **Adjustment** | Optional. Hours to add to the time used, for time tracked outside Ajour.                   |
| **Shortcut**   | Optional. A number key for the task. See below.                                            |

Press **Save** or <kbd>⌘</kbd> <kbd>Enter</kbd>.

A plugin can add its own section to the editor. [Workday (agent)](/plugins/workday-agent#map-a-task-to-a-workday-task) adds **Workday task**, to commit a task of your own as one Workday knows.

Each row of the task list shows the task's shortcut, whether it is billable, and its time used against its budget. A mapped task shows the task it commits as, such as "→ 07 Run". Drag a row, or press <kbd>Alt</kbd> <kbd>↑</kbd> and <kbd>Alt</kbd> <kbd>↓</kbd>, to reorder the active tasks.

In a [shared project](/projects/shared-projects), the name, billable, budget and status follow your team. The adjustment, the shortcut and plugin properties stay yours.

## Pin a task

Give the tasks you use every day a number from <kbd>1</kbd> to <kbd>0</kbd>. Choose **Assign shortcut…** in the task's actions, or press **Assign shortcut…** in its editor, and press a free number. A number already in use shows the task that holds it. Assigning it moves it to this task. **Clear shortcut** removes it.

Then, anywhere in Ajour:

- Press the number to open a new entry on the task.
- Press <kbd>Shift</kbd> and the number to start the task.

## Task actions

Right-click a task, or press its **…** button.

| Action               | What it does                                   |
| -------------------- | ---------------------------------------------- |
| **Start entry**      | Starts a running entry on the task.            |
| **New entry…**       | Logs hours on the task.                        |
| **Edit**             | Opens the task editor.                         |
| **Assign shortcut…** | Gives the task a number key.                   |
| **Archive**          | Hides the task from pickers. Its entries stay. |

Tasks are archived, never deleted. Press <kbd>Backspace</kbd> on a focused task to archive it. An Undo toast follows. The **Archived** tab of the task list shows archived tasks, with **Restore**.

## Import tasks from Excel

Choose **Import tasks…** in the project's properties. Ajour reads the file with the schema picked in **Settings › Projects**:

- With **Ajour default**, it reads task names from column C of the first worksheet, then tells you how many tasks it imported and skipped.
- With a schema plugin, such as [Workday](/plugins/workday), the plugin reads the file. Ajour adds the new tasks and updates the others by name, then tells you how many. A file for another project changes nothing.

To import whole projects with their tasks, see [Import and export](/projects/import-export).

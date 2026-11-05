# Tasks

A task is a kind of work inside one project, such as `Development`, `Code review` or `Meetings`. Time entries point at a task, and the Commit page groups your week by task.

<Shot name="project-task-editor" alt="A project page with the task editor open" />

## Create a task

Open a project and press **New task**. The task editor opens in the side panel.

You can also create a task where you pick one, when it isn't in Ajour yet:

- In a backlog item's **Task**, or in the task menu of a time entry after opening a project, type the name and choose **Create task "07 Run"**, or press <kbd>Enter</kbd> when nothing matches. Ajour creates the task in that project and picks it.
- In the task menu's first view, choose **Create task "07 Run"…**. A dialog asks for the project, and **Commits as** when your timesheet plugin needs it.

A toast offers **Undo** and, with a timesheet plugin, **Change**, which sets what the task [commits as](#commits-as). A name an archived task has restores it. In a shared project, Ajour asks first, because your team gets the task too.

When you import the same task later, the import finds it by name, whatever its case, accents or spaces, and updates it. Its time and backlog items stay on it. Type the name as your timesheet tool spells it; if you don't know it yet, choose **Not known yet**.

| Field          | What it is for                                                                             |
| -------------- | ------------------------------------------------------------------------------------------ |
| **Name**       | The task's name, as your timesheet tool knows it.                                          |
| **Billable**   | Whether the time is billable. Exports and schemas carry it.                                |
| **Budget**     | Optional. The hours planned for the task. The project page shows the time used against it. |
| **Adjustment** | Optional. Hours to add to the time used, for time tracked outside Ajour.                   |
| **Shortcut**   | Optional. A number key for the task. See below.                                            |

Press **Save** or <kbd>⌘</kbd> <kbd>Enter</kbd>.

A plugin can add its own section to the editor. [Workday (agent)](/plugins/workday-agent#map-a-task-to-a-workday-task) adds a **Workday** section with **Commits as**.

### Commits as

**Commits as** says what happens to the task's time when you [commit your week](/time/commit):

| Choice            | What it does                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Its own name**  | The time goes to your timesheet tool under the task's name. Imported tasks start here.                                                                                                           |
| **Another task…** | The time goes under another task of the project, which you pick under it, such as `07 Run`. Use it for a task of your own that Workday doesn't have. Type a name the project lacks to create it. |
| **Not known yet** | A temporary task, while its Workday task is created and you don't know its name. Its time waits on the Commit page until you pick something else.                                                |
| **Local only**    | The time stays in Ajour and never goes to your timesheet tool, such as `Team lunch`.                                                                                                             |

A project can be local only as a whole: see [The project page](/projects/#the-project-page). Its tasks then say "The project is local only, so this task is never committed." in place of **Commits as**.

Each row of the task list shows the task's shortcut, whether it is billable, and its time used against its budget. A task that commits as another task shows it, such as "→ 07 Run". A Not known yet task shows an amber **Not known yet**, and a Local only task shows **Local**. Drag a row, or press <kbd>Alt</kbd> <kbd>↑</kbd> and <kbd>Alt</kbd> <kbd>↓</kbd>, to reorder the active tasks.

In a [shared project](/projects/shared-projects), the name, billable, budget and status follow your team. The adjustment, the shortcut, plugin properties and **Commits as** stay yours.

In a [managed project](/projects/#managed-projects), a task its source knows shows its name with a lock: rename it in the source. Its budget and **Billable** are the source's too, with the same lock. Adjustment and **Commits as** stay yours.

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
| **Merge into…**      | Moves its entries to another task. See below.  |
| **Archive**          | Hides the task from pickers. Its entries stay. |

Tasks are archived, never deleted. Press <kbd>Backspace</kbd> on a focused task to archive it. An Undo toast follows. The **Archived** tab of the task list shows archived tasks, with **Restore**.

## Merge a task into another

In a project that follows a project source, such as a planning tool, a task can arrive twice: once as the task you created before the source knew it, once from the source. A source can also rename a task in a way Ajour sees as one task gone and a new one.

Choose **Merge into…** in the task's actions, on an active or archived task, and pick the task to keep. Ajour moves the task's entries, and its running entry, to that task, then archives the task. The task you keep also gets its shortcut and its favorite star, when it has none of its own. An Undo toast follows.

Entries you already committed are committed again under the new task the next time you [commit your week](/time/commit), so your timesheet tool follows the merge. Entries of submitted weeks stay where they are. A **Local only** task can't be the one you keep: its time never reaches your timesheet tool.

Ajour suggests merges in a quiet line under a task:

- **Renamed from "Design"?** A task that left the source still holds entries, and a new task arrived in the same group.
- **Looks like "Design reviews" from Planner.** A task of your own has a name close to a source task's.

Press **Merge**, or **Not the same** to stop suggesting that pair on this computer. Local only tasks never get a suggestion.

## Import tasks from Excel

Choose **Import tasks…** in the project's properties. Ajour reads the file with the schema picked in **Settings › Projects**:

- With **Ajour default**, it reads task names from column C of the first worksheet, then tells you how many tasks it imported and skipped.
- With a schema plugin, such as [Workday](/plugins/workday), the plugin reads the file. Ajour adds the new tasks and updates the others by name, then tells you how many. A file for another project changes nothing.

### Tasks that were Not known yet

A file that names a task you marked **Not known yet** makes it commit as its own name.

When the file adds tasks and the project still has **Not known yet** tasks it doesn't name, Ajour asks first, such as **1 task is waiting for its Workday task**. For each task, pick the new task it was waiting for, **Still waiting**, or **Local only**. Ajour suggests a new task with a word in common. Press **Import**: a picked task takes the new name, so its time, backlog items and shortcut stay on it, and no twin is added. **Cancel** imports nothing.

To import whole projects with their tasks, see [Import and export](/projects/import-export).

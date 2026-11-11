# Projects

A project is a body of work you record time against, such as a client engagement or your internal work. Projects hold [tasks](/projects/tasks), and every time entry points at a task or a project.

<Shot name="projects-list" alt="The Projects list with tasks, this week's time and budget" />

Press <kbd>G</kbd> then <kbd>P</kbd>, or pick **Projects** in the sidebar's view switcher.

## The Projects list

Each row shows the project, its number of active tasks, the time logged this week and how much of its budget is used. A shared project shows a team mark, and a [managed project](#managed-projects) a link mark. **Active** and **Archived** at the top switch between the two lists.

Drag a row, or press <kbd>Alt</kbd> <kbd>↑</kbd> and <kbd>Alt</kbd> <kbd>↓</kbd>, to reorder the active projects. Right-click a row, or press its **…** button, for **Edit**, **New task** and **Archive**.

## Create a project

Press **New project**.

<Shot name="project-form" alt="The New project dialog with name, code, icon and color" />

| Field            | What it is for                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Full name**    | The project's official name.                                                                                                                                        |
| **Display name** | The name Ajour shows, and the one the Commit page copies. Make it match your timesheet tool. Without one, Ajour uses the full name.                                 |
| **Code**         | A few letters, such as `ATL`. The running entry shows it.                                                                                                           |
| **Color**        | Pick a preset or type a hex color.                                                                                                                                  |
| **Project icon** | One of 67 presets, or upload a favicon (`.png`, `.svg` or `.ico`). Turn on **Keep native colors** to show an upload in its own colors instead of the project color. |

Press **Create project**. The project's page opens.

## The project page

Click a project to open its page.

<Shot name="project-page" alt="A project page with its figures, tasks and properties" />

- **The figures** show time this week and all time. For budgeted tasks, they add the budget, the time used and what remains. Without a budget, they show the number of active tasks.
- **Tasks** lists the project's tasks. See [Tasks](/projects/tasks).
- **Time entries** lists every entry on the project, by day. Click one to open its day.
- **The Budget card**, on a project that comes from a project source, shows the source's budget. See [The Budget card](#the-budget-card).
- **The properties card**, at the side, has the full name, code, color, icon and status. Change them in place. Each change saves on <kbd>Enter</kbd> or when you leave the field, with Undo. <kbd>Esc</kbd> cancels. A shared project also shows its **Team**. See [Shared projects](/projects/shared-projects).

The bottom of the card has **Import tasks…**, **Share with team** when a team plugin is connected, or **Stop sharing** for a shared project, and **Archive**.

Plugins can add their own section to the properties card, such as **Workday** with the project's Workday name and code. Click the section title to open it. An empty row shows its default in grey.

When a plugin commits tasks, such as [Workday (agent)](/plugins/workday-agent), the card has a row named after it, such as **Workday**, set to **Commits**. Choose **Local only** for a project that never goes to your timesheet tool, such as a personal one. An Undo toast follows. Its time stays in Ajour, and its tasks show no **Commits as** choice. The choice stays yours in a shared project.

Click the title to rename the display name.

## The Budget card

A project that comes from a project source, such as your planning tool, has a **Budget** card above its properties. The source's hours come from a report that lags your own entries, so the card shows its figures with the time they are from, and adds what the source can't have yet:

| Line                | What it is                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Budget**          | The project's hours, from the source.                                                                                                                                                                     |
| **Consumed**        | The hours the source counts, as of the time under it.                                                                                                                                                     |
| **Not counted yet** | Your time on the project the source can't have yet: entries you haven't committed, or committed after that time. An entry you changed since its commit counts only the difference, which can be negative. |
| **≈ Remaining**     | An estimate: the source's remaining hours less Not counted yet.                                                                                                                                           |

When the budget is in money, the card shows only the source's status, such as **Over budget**.

When the source knows your own hours, a line under the figures says how many it has for you, and how many you committed before its time. When they differ, press **See the …** to list, task by task, the source's hours next to the entries you committed. An entry missing there usually means a commit never reached your timesheet tool. When the source can't give your hours, the line says why, in its own words.

On such a project, each task's row shows the source's hours for you against the task's budget.

## Archive a project

Choose **Archive** in the project's properties or its actions menu. An Undo toast follows. Its entries stay. Its page shows a notice and its fields are read-only. Find it under **Archived**, and press **Restore** to bring it back.

Ajour never deletes a project, so your past entries always keep their project.

## Managed projects

A plugin with **Managed projects**, connected in **Settings › Plugins**, brings your projects and tasks from the system that holds them, such as your company's planning tool. Those projects are managed: their source keeps them up to date every 15 minutes, and Ajour never writes back to it.

- **"From" and the source's name** sit next to the title, such as **From Example planner**. Rest the pointer on it to see when the project last synced.
- **Full name**, **Code**, **Client** and **Dates** show a lock in the properties card: the source sets them, so they change there, not in Ajour. **Client** and **Dates** show only when the source gives them. Once a project's last day has passed, the card says **Ended on** and the date. The display name, color, icon, favorites and pins stay yours.
- **Open in** and the source's name, at the bottom of the card, opens the project in its source. It shows when the source gives the project a link.
- A task the source knows keeps its source's name: the task editor shows it, its budget and **Billable** with a lock. The adjustment, **Commits as** and the shortcut stay yours. A managed project has no **Import tasks…**: its source adds the tasks.
- Every task of the project is available. The tasks the source assigns to you carry a person icon, in the task menu and on the project's page, and come first in the task menu. Rest the pointer on the icon to read **Assigned to you**.
- When the source marks a project complete, Ajour archives it, so it leaves the task menu. It comes back when the source reopens it. Until then **Restore** says why it can't, such as "Can't restore. Example planner marks this project complete.", and so does a task picker or a backlog item's timelog that names it, or names a task the source closed.
- **Filter and order** in the sidebar lists the clients of your managed projects after the projects. Pick a client to show only the items of its projects. See [Search and filter](/app/sidebar#search-and-filter).

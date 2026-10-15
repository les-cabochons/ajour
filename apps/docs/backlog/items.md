# Backlog items

A backlog item is a piece of planned work. It has a title, a priority, a workflow state, estimates, and optionally a project, a task, a note and subitems.

<Shot name="backlog-item" alt="The page of a backlog item with its estimates, subitems, time entries and properties" />

## Manual and synced items

- A **manual** item is one you create in Ajour. Its source shows as **Ajour**.
- A **synced** item comes from a connector, such as Azure DevOps or Jira. It shows its ID, its source project and its source state, and **Open in Azure DevOps** or **Open in Jira** takes you to it.

Ajour keeps your changes to a synced item. A sync updates what changed in the source, and asks you when both sides changed the same estimate. See [Sync review](/plugins/sync-review).

## The item page

Click an item anywhere to open its page. The page has:

- **The header**, with the title and the item's actions: **Start entry**, **Snooze**, **Settle** and **New entry**. Click the title to rename it.
- **The estimates**: **Original**, **Remaining**, **Completed** and **Logged in Ajour**, with a bar of completed over original. Click an estimate to edit it.
- **Note**, in Markdown. Press **Edit** to change it.
- **Subitems**. Press **Add subitem**, type a name and press <kbd>Enter</kbd>.
- **Time entries** logged on the item, with **Add time entry**.
- **Properties**: state, source state, priority, lifecycle, project, task and source.

Changes on the page save when you press <kbd>Enter</kbd> or leave the field, with an Undo toast.

## Map an item to a task

Set the item's **Project** and **Task** so the time you log on it lands on the right task. Synced items cannot know your tasks, so map them once after they arrive. Starting an item with no task starts an entry with no task, which the Submit page then flags.

## Estimates

| Estimate      | Meaning                                    |
| ------------- | ------------------------------------------ |
| **Original**  | The first estimate of the work.            |
| **Remaining** | What is left. The sidebar shows this one.  |
| **Completed** | What was spent, as recorded in the source. |

**Logged in Ajour** is the sum of your time entries on the item. On a parent, a button next to each estimate resets it to the total of its subitems.

For synced items, connectors write estimate changes back to the source when they sync. See the [Azure DevOps](/plugins/azure-devops) and [Jira](/plugins/jira) pages for which fields they use.

## Subitems

A subitem is one level under its parent. Subitems cannot have subitems. When you close a parent that has open subitems, Ajour asks whether to close them too. Set a default in **Settings › Backlog › Subitems**.

## Actions

Right-click an item, press **…**, or focus it and press <kbd>.</kbd>.

<Shot name="backlog-item-menu" alt="The actions menu of a backlog item" />

| Action                      | What it does                                                         |
| --------------------------- | -------------------------------------------------------------------- |
| **Start entry** or **Stop** | Starts or stops a running entry on the item.                         |
| **New entry…**              | Logs hours on the item.                                              |
| **Edit**                    | Opens the item editor.                                               |
| **Add subitem**             | Creates a subitem.                                                   |
| **Snooze…**                 | Hides the item from the sidebar until a time you pick.               |
| **Pin**                     | Keeps the item at the top of the sidebar.                            |
| **Settle**                  | Takes the item off your plate. See [Settle and snooze](/backlog/settle-and-snooze). |
| **Change source state…**    | Picks the exact source state, when several map to the same workflow state. |
| **Open in …**               | Opens the item in its source tool.                                   |
| **Archive**                 | Archives a synced item.                                              |
| **Delete**                  | Deletes the item and its subitems, with Undo.                        |

## Keep when missing from sync

When a connection syncs on its own, a synced item that no longer comes back from it is archived. This happens, for example, when the item is reassigned to someone else. Turn on **Keep when missing from sync** in the item's properties to keep it in your backlog. Items that reach a done state in the source are archived either way.

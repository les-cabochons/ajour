# Backlog items

A backlog item is a piece of planned work. It has a title, a priority, a workflow state, estimates, and optionally a project, a task, a description and subitems.

<Shot name="backlog-item" alt="The page of a backlog item with its estimates, subitems, time entries and properties" />

## Manual and synced items

- A **manual** item is one you create in Ajour. Its source shows as **Ajour**.
- A **synced** item comes from a backlog plugin, such as Azure DevOps or Jira. It shows its ID, its source project and its source state, and **Open in Azure DevOps** or **Open in Jira** takes you to it.

Ajour keeps your changes to a synced item. A sync updates what changed in the source, and asks you when both sides changed the same estimate. See [Sync review](/plugins/sync-review).

## The item page

Click an item in the sidebar to open its page. On the Backlog page, a click opens the [peek](/backlog/#peek-at-an-item), and a double-click or <kbd>Enter</kbd> opens the page. The page has:

- **The header**, with the title and the item's actions: **Start entry**, **Snooze**, **Settle** and **New entry**. Click the title to rename it.
- **The estimates**: **Original**, **Remaining**, **Completed** and **Logged in Ajour**, with a bar of completed over original. Click an estimate to edit it.
- **Description**, in Markdown. Press **Edit** to change it.
- **Comments**, for an item synced from a tool whose plugin provides them: the newest five, oldest first, with **Show earlier comments** for the rest. A **New** line marks the comments that arrived since you last opened the item. Press **Leave a comment…** at the bottom of the thread to write one in Markdown, and <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>⌘</kbd>+<kbd>Enter</kbd> on macOS) or **Comment** to send it. It goes to the tool at once. If sending fails, the text stays so you can send it again, and an unsent comment stays as a draft on this device until you send it or press **Discard**. Type **@** and a few letters to mention someone, when the tool supports it; pick a person and they show as a chip, and the tool notifies them. On your own comments, **…** offers **Edit** and **Delete** when the tool allows them. A deleted comment disappears at once, and **Undo** in the toast brings it back; the tool only deletes it once the toast closes. Click a reaction to add or remove yours, or use the smiley to add another. Ajour reads comments from the tool each time and never stores them.
- **The card**, at the side: state, source state, priority, lifecycle, project, task and source, then the **Subitems**, with **Add subitem**, and the **Time entries** logged on the item, with **Add time entry**.

Changes on the page save when you press <kbd>Enter</kbd> or leave the field, with an Undo toast.

## Map an item to a task

Set the item's **Project** and **Task** so the time you log on it lands on the right task. Synced items cannot know your tasks, so map them once after they arrive. Starting an item with no task starts an entry with no task, which the Commit page then flags.

## Frontmatter

A description can start with a block of fields between two `---` lines. Ajour reads it and shows its fields in the item's properties instead of the description; **Edit** shows the block.

```md
---
Teamwork: https://acme.teamwork.com/app/tasks/123
Links:
  - https://figma.com/file/hero
timelog:
  project: Acme website
  task: Development
---

The description text.
```

- **Fields** such as `Teamwork` show in the properties, after the item's own. A list, or a field with fields under it, is a section that starts closed; click its name to open it. Ajour remembers the sections you open, on every item.
- **`timelog`** sets the item's **Project** and **Task** when you save it, or when a synced item arrives with one. The project is matched by name, display name or code. A task the project lacks is created, except in a shared project, where Ajour asks first because your team gets the task too. If you pick another project or task afterwards, Ajour keeps your pick.
- While the item's project or task differs from its timelog, an icon follows **Project**. A warning icon means the project or task doesn't exist: click it to create it, and Ajour sets it on the item. A back arrow means you picked something else: click it to go back to the timelog's project and task.

Web links in a description, in its text or its fields, show their full address and ask before they open. Check **Don't ask again** to open them at once, and turn the question back on in **Settings › Backlog › Descriptions**.

This works in synced descriptions too, so you can map items in the source tool once.

## Estimates

| Estimate      | Meaning                                    |
| ------------- | ------------------------------------------ |
| **Original**  | The first estimate of the work.            |
| **Remaining** | What is left. The sidebar shows this one.  |
| **Completed** | What was spent, as recorded in the source. |

**Logged in Ajour** is the sum of your time entries on the item. On a parent, the item editor (**Edit**) has a button next to each estimate that resets it to the total of its subitems.

For synced items, backlog plugins write estimate changes back to the source when they sync. See the [Azure DevOps](/plugins/azure-devops) and [Jira](/plugins/jira) pages for which fields they use.

## Subitems

A subitem is one level under its parent. Subitems cannot have subitems. When you close a parent that has open subitems, Ajour asks whether to close them too. Set a default in **Settings › Backlog › Subitems**.

## Actions

Right-click an item, press **…**, or focus it and press <kbd>.</kbd>.

<Shot name="backlog-item-menu" alt="The actions menu of a backlog item" />

| Action                      | What it does                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- |
| **Start entry** or **Stop** | Starts or stops a running entry on the item.                                        |
| **New entry…**              | Logs hours on the item.                                                             |
| **Edit**                    | Opens the item editor.                                                              |
| **Add subitem**             | Creates a subitem.                                                                  |
| **Snooze…**                 | Hides the item from the sidebar until a time you pick.                              |
| **Pin**                     | Keeps the item at the top of the sidebar.                                           |
| **Settle**                  | Takes the item off your plate. See [Settle and snooze](/backlog/settle-and-snooze). |
| **Change source state…**    | Picks the exact source state, when several map to the same workflow state.          |
| **Open in …**               | Opens the item in its source tool.                                                  |
| **Archive**                 | Archives a synced item.                                                             |
| **Delete**                  | Deletes the item and its subitems, with Undo.                                       |

## Keep when missing from sync

When a connection syncs on its own, a synced item that no longer comes back from it is archived. This happens, for example, when the item is reassigned to someone else. Turn on **Keep when missing from sync** in the item's properties to keep it in your backlog. Items that reach a done state in the source are archived either way.

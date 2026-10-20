# Backlog items

A backlog item is a piece of planned work. It has a title, a priority, a workflow state, estimates, and optionally a project, a task, a description and subitems.

<Shot name="backlog-item" alt="The page of a backlog item with its estimates, subitems, time entries and properties" />

## Manual and synced items

- A **manual** item is one you create in Ajour. Its source shows as **Ajour**.
- A **synced** item comes from a backlog plugin, such as Azure DevOps or Jira. It shows its ID, its source project and its source state, and **Open in Azure DevOps** or **Open in Jira** takes you to it.

A sync updates what changed in the source and keeps your changes to the priority and estimates. A state you picked in Ajour stays until the source changes state, then the [workflow mapping](/backlog/workflow) applies again. When both sides changed the same estimate, Ajour asks you which to keep. See [Sync review](/plugins/sync-review).

## The item page

Click an item in the sidebar to open its page. On the Backlog page, a click opens the [peek](/backlog/#peek-at-an-item), and a double-click or <kbd>Enter</kbd> opens the page. The page has:

- **The top bar**, with the item's project and title. Click the project to open its page. An item without a project shows **Backlog** instead. The item's actions sit on the right: **Start entry** (**Stop** while its entry runs), **Snooze**, **Settle** and **New entry**. A snoozed, settled or archived item shows **Unsnooze**, **Unsettle** or **Restore** instead.
- **The title**, under a link back to the page you came from, such as **Back to Backlog** or **Back to Time**. Click the title to rename it. The line under it shows the item's type and project, its source state with a link to the source, or **Manual item**, and the parent of a subitem.
- **A notice** when the item is snoozed, settled or archived, or came back to your plate, such as **Changed in the source since you settled it**.
- **The estimates**: **Original**, **Remaining**, **Completed** and **Logged in Ajour**, with a bar of completed over original. Click an estimate to edit it.
- **The [description](#description)**, then the [comments](/backlog/comments) of a synced item.
- **The cards**, at the side. The first holds the state, source state, priority, lifecycle, project, task and source, then **When missing** and **Archive** for a synced item, and the fields of the description's [frontmatter](#frontmatter). Under it, **Subitems** and **Time entries** start closed on a summary: a segment per subitem, filled when done (one bar past ten subitems), with the hours left, and how many entries there are with the last day one was logged. Click a card's title to open its list, and click an entry to open its day. A card's **+** adds a subitem or a time entry. Each card stays open or closed on this device. A subitem has no **Subitems** card.

Changes on the page save when you press <kbd>Enter</kbd>, pick a value or leave the field, with an Undo toast. <kbd>Esc</kbd> cancels.

While the page itself has focus, as when it opens, the item's keys work: <kbd>Enter</kbd> renames it, <kbd>S</kbd> starts or stops an entry, <kbd>E</kbd> settles, <kbd>B</kbd> snoozes and <kbd>Backspace</kbd> deletes, with Undo.

## Description

The description says what the work is, in Markdown. Press **Edit** next to **Description** to change it. The editor keeps your Markdown as you type and styles it, such as headings, bold text and links. Press <kbd>⌘</kbd> <kbd>Enter</kbd> or click outside the editor to save, with an Undo toast, or <kbd>Esc</kbd> to cancel.

A synced item's description comes from its source when the item first arrives. When its backlog plugin sends descriptions in full, each sync brings the source's changes too, and keeps yours.

When the plugin also writes descriptions, saving sends your edit to the source at once, with no Undo toast:

- **Editing** starts at once. Ajour checks the source in the background, and if the description changed there since the last sync, a line under the editor says so. Press **Load latest** to start from the source's text, or keep typing: saving merges both.
- **Saving** reads the source again. Changes to other lines than yours are merged, and the editor shows the result. Changes to the same lines write nothing: the description says so, with **Resolve**, which opens [Sync review](/plugins/sync-review#resolve-description-conflicts).
- **A failed save** keeps your text, with the reason and **Retry**.
- **The editor** stops at 64,000 characters, or the source's limit when it is lower. A count shows as you near it.

Otherwise the description is read-only, with **Edit in source**: when the plugin does not write descriptions, when the description was too long for Ajour and shows cut off, or when its formatting, such as an underline, has no Markdown form, so an edit here would erase it. That last one becomes editable when the connection allows it: turn on **Allow lossy conversion** in **Settings › Plugins**. Each save then names what will be lost, with **Save anyway**, **Edit in source** and **Cancel**. A plugin that sends only a short note keeps the older behaviour: the note arrives once, and your edits stay in Ajour.

Web links in a description, in its text or its [frontmatter](#frontmatter), show their full address and ask before they open. Check **Don't ask again** to open them at once, and turn the question back on in **Settings › Backlog › Descriptions**.

## Map an item to a task

Set the item's **Project** and **Task** so the time you log on it lands on the right task. Synced items cannot know your tasks, so map them once after they arrive, or name them in the description's [timelog](#frontmatter). Starting an item with no task starts an entry with no task, which the Commit page then flags.

## Frontmatter

A description can start with a block of fields between two `---` lines. Ajour reads it and shows its fields in the item's properties instead of the description. **Edit** shows the block.

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
- **`timelog`** sets the item's **Project** and **Task** when you save it, or when a synced item arrives with one. The project is matched by name, display name or code. A task the project lacks is created, and an archived one is restored, except in a shared project: your team would get the task too, so Ajour leaves it to you. If you pick another project or task afterwards, Ajour keeps your pick.
- While the item's project or task differs from its timelog, an icon follows **Project**. A warning icon means the project or task doesn't exist or is archived: click it to create or restore it, and Ajour sets it on the item. A back arrow means you picked something else: click it to go back to the timelog's project and task.

This works in synced descriptions too, so you can map items in the source tool before they reach Ajour.

## Estimates

| Estimate      | Meaning                                    |
| ------------- | ------------------------------------------ |
| **Original**  | The first estimate of the work.            |
| **Remaining** | What is left. The sidebar shows this one.  |
| **Completed** | What was spent, as recorded in the source. |

**Logged in Ajour** is the sum of your time entries on the item. An estimate that changed both in Ajour and in the source shows **Conflict** until you choose in [Sync review](/plugins/sync-review). On a parent, the item editor on the Backlog page has a button next to each estimate that resets it to the total of its subitems.

For synced items, backlog plugins write estimate changes back to the source when they sync. See the [Azure DevOps](/plugins/azure-devops) and [Jira](/plugins/jira) pages for which fields they use.

## Subitems

A subitem is one level under its parent. Subitems cannot have subitems. When you close a parent that has open subitems, Ajour asks whether to close them too. Set a default in **Settings › Backlog › Subitems**.

To add subitems on the item page, press **+** on the **Subitems** card, type a name and press <kbd>Enter</kbd>. Each subitem takes the parent's project and task, and the field stays open for the next one. <kbd>Esc</kbd> closes it.

## Actions

Right-click an item, press **…**, or focus it and press <kbd>.</kbd>. Lines split the menu into groups of related actions. An action that doesn't apply right now stays in the menu, greyed out. In the desktop app, the right-click menu is your system's own menu.

<Shot name="backlog-item-menu" alt="The actions menu of a backlog item" />

| Action                      | What it does                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Start entry** or **Stop** | Starts or stops a running entry on the item.                                                                                                                                                                     |
| **New entry…**              | Logs hours on the item.                                                                                                                                                                                          |
| **Edit**                    | Opens the item editor on the Backlog page. Elsewhere, opens the item's page to rename it.                                                                                                                        |
| **Add subitem**             | Creates a subitem.                                                                                                                                                                                               |
| **Snooze…**                 | Hides the item from the sidebar until a time you pick. A snoozed item shows **Unsnooze**.                                                                                                                        |
| **Pin**                     | Keeps the item at the top of the sidebar. A pinned item shows **Unpin**.                                                                                                                                         |
| **Settle…**                 | Takes the item off your plate. It reads **Settle** when a settle rule skips the dialog. A settled item shows **Unsettle**, and an archived one **Restore**. See [Settle and snooze](/backlog/settle-and-snooze). |
| **Change source state…**    | Picks the exact source state, when several map to the same workflow state.                                                                                                                                       |
| **Open in …**               | Opens the item in its source tool.                                                                                                                                                                               |
| **Archive**                 | Archives a synced item in Ajour. The source tool keeps it as it is.                                                                                                                                              |
| **Delete**                  | Deletes the item and its subitems, with Undo.                                                                                                                                                                    |

## Keep when missing from sync

When a connection syncs on its own, a synced item that no longer comes back from it is archived. This happens, for example, when the item is reassigned to someone else. Set **When missing** to **Keep** in the item's properties to keep it in your backlog. Items that reach a done state in the source are archived either way.

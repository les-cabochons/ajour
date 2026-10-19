# Commit your week

Committing copies your week's changes into your company's timesheet tool, such as Workday. Ajour does not connect to that tool. It lists what changed since your last commit, and remembers what you committed. When the whole week is in your timesheet tool, you submit it, and Ajour keeps it as it is. A plugin can add a button that has an agent apply the changes for you, see [Commit with an agent](#commit-with-an-agent).

<Shot name="commit-week" alt="The Commit week page" />

## Open the page

Click the **Commit** button, a calendar with a check mark, at the bottom right of the sidebar. While the sidebar is hidden on a Time page, it sits at the left of the title bar. In a [narrow window](/app/narrow-windows), it sits at the end of the toggle at the bottom left. It opens the Commit page for the week on screen: the week of the day you are on, or the last day you picked on the Time page.

When your saved time reaches the week's target, Ajour asks **Week complete**, such as "You logged 37:30 of 37:30 for the week of Oct 12 to 18. Commit and lock it now?". Press **Commit** to open the Commit page, or **Later** to close the question. Ajour asks once per week, whatever you answer. A running entry counts once you stop it. The target is the sum of your **Time capacity** in [Settings](/app/settings), and a week with no capacity never asks. A [submitted week](#submit-the-week) never asks either.

## Review the week

The top of the page shows the week total against your target, with a progress bar. Ajour warns you about:

- Days under their capacity target, such as `Tue 6 has 6:30 of 8:00`.
- Entries with no task.

## Changes

Under **Changes**, each entry that changed since your last commit has a row with a symbol:

| Symbol | Change      | Meaning                                                                                                                                                              |
| ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plus   | **Added**   | An entry you never committed.                                                                                                                                        |
| Pencil | **Updated** | A committed entry whose day, project, task, hours or note changed, or that you marked as not committed. The row shows the old and new values, such as `1:00 → 1:30`. |
| Minus  | **Deleted** | A committed entry you deleted since.                                                                                                                                 |

An entry you edit back to its committed values has no change. A week with no changes says "Everything is committed."

Each change has a checkbox, checked by default. Uncheck a change to leave it out of this commit. It stays on the page, and is checked again the next time you open the page.

Click the **Changes** heading to hide the list, and click it again to show it. **Mark as committed** stays below the heading. The list is shown again each time you open the page.

## Mark as committed

When the checked changes are in your timesheet tool, press **Mark as committed**. A toast offers **Undo**. The entry editor shows a **Committed** chip on each committed entry.

## Mark as not committed

If someone changed an entry in your timesheet tool after you committed it, right-click the entry and choose **Mark as not committed**. A toast offers **Undo**. The entry shows as **Updated** on the Commit page, so your next commit writes Ajour's values over the timesheet tool's. With the Workday agent, the agent finds the Workday entry by the ID in its comment, or by its hours on that day, and edits it. When it cannot tell which entry it is, it asks you.

Only committed entries have this action. An entry you changed since its last commit is already on the Commit page.

To mark several entries at once, [select them](./entries.md#select-copy-and-paste-entries) on the Day list or the Week Days cards, then right-click one of them. Ajour marks every committed entry in the selection, with one Undo.

## Submit the week

When every change is committed, press **Submit week**. When the week is behind its targets, or over them, Ajour asks first, such as **Submit a week under pace?** with **Review** and **Submit anyway**. **Pace tolerance** in [Settings](/app/settings) sets how far off the week may be, and turning off **Under-target submit warning** skips the question for a week behind its targets. A toast offers **Undo**.

**Submit week** is greyed out with **Commit your changes first** while a change is not committed, and with **Stop the running entry first** while an entry runs in the week.

A submitted week shows **Submitted** with a lock on its Commit page and in the Week view. Its entries stay as they are: you cannot add, edit, move, delete or paste entries on its days, and no entry can start on them. Greyed-out actions say why, such as `The week of Oct 5 is submitted. Reopen it to change it.` Agents get the same answer.

## Reopen a week

Press **Reopen week** on the week's Commit page. A toast offers **Undo**. The entries can change again, and each change shows on the Commit page as usual.

## Copy the lines

Under **Lines**, the whole week is grouped into lines with the project, the task, the hours and the comments. Click a value to copy it, then paste it in your timesheet tool.

- **Project and task** are one value, such as `CA004 Tech & Design / 07 Run`. It copies both with a space between them, such as `CA004 Tech & Design 07 Run`, which you can paste in your timesheet tool's search box. A line with no task copies the project alone.
- **Hours** copy as decimals with a comma, such as `5,00` or `6,50`, which Workday expects. The page shows them as clock time.
- **Comments** are the notes of the line's entries, joined with a vertical bar, such as `Standup | Code review`.

**Group by** changes how entries become lines:

| Option           | One line per             |
| ---------------- | ------------------------ |
| **Day and task** | task and day (default)   |
| **Day**          | day                      |
| **Task**         | task, for the whole week |

Lines show each project's full name. When a plugin adds project properties, such as [Workday (agent)](/plugins/workday-agent), a **Names** switch sits next to **Group by**. Choose **Workday** to show the project's Workday name instead, which you can set in the project's **Workday** section. Ajour remembers your choice.

## Commit with an agent

With a plugin such as [Workday (agent)](/plugins/workday-agent), a button such as **Commit to Workday** sits next to **Mark as committed**. It starts an agent that applies the checked changes in your timesheet tool, one entry per change, and marks each one as committed as soon as the tool saved it. The button is greyed out while something is missing; hover it to see what, such as `Fill in Workday timesheet URL in Settings › Plugins › Workday (agent)`.

A plugin can also replace **Submit week** with its own button, such as **Check Workday and submit**, which checks the week in the timesheet tool before it submits it in Ajour.

A link such as **Open the week in Workday**, under the week summary, opens the week in your browser.

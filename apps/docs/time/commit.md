# Commit your week

Committing copies your week's changes into your company's timesheet tool, such as Workday. Ajour does not connect to that tool. It lists what changed since your last commit, and remembers what you committed. A plugin can add a button that has an agent apply the changes for you, see [Commit with an agent](#commit-with-an-agent).

<Shot name="commit-week" alt="The Commit week page" />

## Open the page

Click the totals at the top right, such as `Today 3:47`, and press **Commit week**. This works on every page and at every window size.

## Review the week

The top of the page shows the week total against your target, with a progress bar. Ajour warns you about:

- Days under their capacity target, such as `Tue 6 has 6:30 of 8:00`.
- Entries with no task.

## Changes

Under **Changes**, each entry that changed since your last commit has a row with a symbol:

| Symbol | Change      | Meaning                                                                                                                         |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Plus   | **Added**   | An entry you never committed.                                                                                                   |
| Pencil | **Updated** | A committed entry whose day, project, task, hours or note changed. The row shows the old and new values, such as `1:00 → 1:30`. |
| Minus  | **Deleted** | A committed entry you deleted since.                                                                                            |

An entry you edit back to its committed values has no change. A week with no changes says "Everything is committed."

Each change has a checkbox, checked by default. Uncheck a change to leave it out of this commit. It stays on the page, and is checked again the next time you open the page.

## Mark as committed

When the checked changes are in your timesheet tool, press **Mark as committed**. A toast offers **Undo**. The entry editor shows a **Committed** chip on each committed entry.

## Mark as not committed

If someone changed an entry in your timesheet tool after you committed it, right-click the entry and choose **Mark as not committed**. The entry shows as **Added** on the Commit page, so your next commit writes it again. With the Workday agent, Ajour finds the existing Workday entry by its ID and edits it, so you do not get a second entry.

Only committed entries have this action. An entry you changed since its last commit is already on the Commit page.

## Copy the lines

Under **Lines**, the whole week is grouped into lines with the project, the task, the hours and the comments. Click a value to copy it, then paste it in your timesheet tool.

- **Hours** copy as decimals, such as `5.00`, which most timesheet tools expect. The page shows them as clock time.
- **Comments** are the notes of the line's entries, joined with a vertical bar, such as `Standup | Code review`.

**Group by** changes how entries become lines:

| Option           | One line per             |
| ---------------- | ------------------------ |
| **Day and task** | task and day (default)   |
| **Day**          | day                      |
| **Task**         | task, for the whole week |

## Commit with an agent

With a plugin such as [Workday (agent)](/plugins/workday-agent), a button such as **Commit to Workday** sits next to **Mark as committed**. It starts an agent that applies the checked changes in your timesheet tool, one entry per change, and marks each one as committed as soon as the tool saved it. The button is greyed out while something is missing; hover it to see what, such as `Fill in Workday timesheet URL in Settings › Plugins › Workday (agent)`.

A link such as **Open the week in Workday**, under the week summary, opens the week in your browser.

# Backlog

The backlog holds the work you plan to spend time on. Each backlog item can point at a project and task, so starting it logs time in the right place. Items come from you, or from a backlog plugin such as [Azure DevOps](/plugins/azure-devops) or [Jira](/plugins/jira).

<Shot name="backlog-list" alt="The Backlog page grouped by workflow state" />

Press <kbd>G</kbd> then <kbd>B</kbd> to open the Backlog page. The sidebar also lists your active items on every page. See [Sidebar](/app/sidebar).

## Overview

The Backlog page shows items grouped by [workflow state](/backlog/workflow) by default. Each row has:

- The priority and the item's ID in its source tool, such as `48213` or `HRB-412`.
- The workflow state. Click it to change the state.
- The title. Subitems show their parent after the title, and parents show how many subitems are done, such as `1/2`.
- Markers such as **Running**, **Settled**, a clock for snoozed items, or a warning when an estimate needs review.
- The project and the remaining estimate.

## List and board

Switch between the list and the board with the buttons at the top right.

<Shot name="backlog-board" alt="The Backlog as a board, one column per workflow state" />

On the board, each workflow state is a column. Drag a card to another column to change its state, or press <kbd>Alt</kbd> <kbd>←</kbd> and <kbd>Alt</kbd> <kbd>→</kbd>. The board can also split into swimlanes by project. See [Display options](/backlog/display-options).

## Create an item

Press the **+** next to a group or column name to create an item in that group. With **None** grouping, use the **New backlog item** row at the end of the list. Give it a title, then optionally a priority, a workflow state, a project and task, a description and estimates. See [Backlog items](/backlog/items).

## Filter the backlog

Press **Filter** and pick a property, then a value. You can filter by state, priority, project, task, source project, connection, type, whether it has an estimate, and whether it is running. Each filter shows as a chip. Remove one with its **×**, or all of them with **Clear filters**.

<Shot name="backlog-filter" alt="The Filter popover" />

## Peek at an item

Click a row, or focus it and press <kbd>Space</kbd>, to open the peek: the item's estimates, properties, description and subitems in a side panel, next to the list. Press **Edit** to edit the item in the same panel. Press <kbd>Space</kbd> again, or <kbd>Esc</kbd>, to close it. Double-click a row, or press **Open page** in the peek, to go to the item's page, where its [comments](/backlog/comments) are.

<Shot name="backlog-peek" alt="The peek next to the backlog list" />

## Archive

Done items are archived. To see them, press **Filter**, choose **State**, then **Archived**. Open an archived item and press **Restore** to put it back in your backlog.

## Unmapped source states

When a backlog plugin reports a state that is not mapped to one of your workflow states, the filter bar shows a link such as `4 unmapped source states`. It opens **Settings › Workflow**, where you map them. See [Workflow states](/backlog/workflow#map-source-states).

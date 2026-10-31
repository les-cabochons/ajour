# Sidebar

The sidebar shows what is on your plate on every page: the running entry, your active backlog items and the pull requests that need you.

<Shot name="sidebar" alt="The sidebar with the view switcher, the running entry and the backlog items" />

Press <kbd>⌘</kbd> <kbd>B</kbd> to show or hide it.

## Overview

From top to bottom, the sidebar has:

- **The view switcher**, to move between Time, Backlog, Pull requests and Projects.
- **Search**, **Filter and order**, and **+** for a new backlog item.
- **The running entry**, or **Start** when nothing runs, with **+** for a new time entry. See [Running entries](/time/running-entries).
- **Your work list**: active backlog items, with pinned items first.
- **Pull requests** that need you, when a code host is connected.
- **Snoozed** and **Settled** sections, collapsed by default.
- **Settings** and **Commit** at the bottom left. **Commit** opens the [Commit page](/time/commit) for the week on screen.
- **Check for updates** at the bottom right, in the desktop app. See [Application updates](#application-updates).

## Switch views

Click the view name at the top to switch between **Time**, **Backlog**, **Pull requests** and **Projects**. Each shows a count: today's total, the number of backlog items, and the pull requests on your plate.

<Shot name="sidebar-view-switcher" alt="The view switcher menu with counts" />

## Search and filter

Press the search icon and type. Every word must appear in the item's title or its project's name or code. A pull request matches on its title and repository. Case and accents do not matter. Press <kbd>Esc</kbd> to clear the search.

Press **Filter and order** to show one project's items only. Ajour remembers the filter on this device. Search and filter apply to the sidebar only, not to the Backlog page.

The same menu switches the order between **Custom order** and **Priority order**. The sidebar and the Backlog page share one order. With **Custom order**, drag items in the sidebar, or press <kbd>Alt</kbd> <kbd>↑</kbd> and <kbd>Alt</kbd> <kbd>↓</kbd>, to reorder them. Pinned items reorder among themselves, and subitems stay under their parent. While you drag, the item follows the pointer and the list opens a space where it will land. Press <kbd>Escape</kbd> to put it back.

With **Priority order**, the same moves reorder an item within its priority level. While you drag, a label shows above each level, Urgent to No priority. Drop the item among another level's items, or on an empty level's label, to give it that level. **Undo** puts back both its level and its place. For an item from Azure DevOps or another tool, the new level goes to the tool once the Undo toast closes.

## Work with an item

Hover an item for **Start entry**, **Snooze…** and **Settle**. Click it to open its page. Right-click it, or focus it and press <kbd>.</kbd>, for every action. See [Backlog items](/backlog/items#actions).

A dot on an item means it came back on its own, from a snooze or a change in its source, and you have not opened it yet. Click the dot to clear it.

## Hover card

Rest the mouse on an item for a moment to see a card beside the sidebar with what the row has no room for:

- The whole title.
- Where the item comes from: its tool's logo, the organization and project, and its ID, such as `48190` or `PAY-12`. A manual item has none.
- On a subitem, its parent.
- The subitems, open ones first, with how many are done, such as `1/2`. Eight show, then a count of the rest.
- The pull requests whose title names the item, open ones first. Five show, then a count of the rest. A key such as `PAY-12` counts from any repository. A number such as `#1234` counts only from the same GitHub repository or Azure DevOps organization. Only pull requests on the [Pull requests](/pull-requests/) page count.

<Shot name="sidebar-hover-card" alt="The hover card of a backlog item beside the sidebar, with its source and subitems" />

Once the card shows, moving to another item moves it there. You can move the mouse onto the card. Click a subitem or a pull request to open it in Ajour. When it has a link to its tool, <kbd>⌘</kbd>-click it to open it there instead. Pressing in the list, scrolling, <kbd>Esc</kbd>, or leaving the item and the card closes it.

The card opens with a mouse only, and never takes focus. From the keyboard, the [item page](/backlog/items) shows the source, the parent and the subitems.

## Application updates

In the desktop app, the arrow at the bottom right, **Check for updates**, checks for a new version of Ajour. When one is available, the arrow stands out and its tooltip names the version. Click it then to update. While it works, it spins, and its tooltip shows the progress. See [Updates](/start/install#updates).

## Density and width

Choose **Comfortable** or **Compact** rows in **Settings › General › Sidebar**. Comfortable rows show the project, the title, the state and the remaining estimate. Compact rows show the title only, in a narrower sidebar. On macOS, **View › Compact or comfortable sidebar** in the menu bar switches it too.

Drag the sidebar's edge to resize it, between 200 and 400 pixels. Double-click the edge to reset it. Dragging it well past the 200 pixel minimum hides the sidebar.

## Smaller windows

The sidebar stays beside the page at every width down to 768 pixels, shown or hidden as you chose. Below 768 pixels, Ajour switches to the [narrow layout](/app/narrow-windows), which has no sidebar.

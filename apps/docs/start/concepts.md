# Concepts

Ajour has a few objects, and each one has one job. This page names them and shows how they connect. The rest of the docs use these words with these meanings.

## Time

**Project**
: A body of work you record time against, such as a client engagement or your internal work. A project has a full name, a short display name, a code, a color and an icon. It is active or archived. Ajour never deletes a project.

**Task**
: A kind of work inside one project, such as `Development` or `Meetings`. Every time entry points at a task, or at a project with no task. A task can be billable, have a budget, and hold a number shortcut from <kbd>1</kbd> to <kbd>0</kbd>.

**Time entry**
: Time spent on a task on one day, with an optional note. An entry is **running**, **saved** or **submitted**. Editing a submitted entry makes it saved again, so you know to submit it again.

**Running entry**
: The entry that is counting now. At most one entry runs at a time, and it is always on today. Ajour has no separate "timer": you start, switch and stop entries.

**Timesheet**
: Your entries for one week, submitted together. Ajour does not send your timesheet anywhere. You copy it into your company's tool and mark the entries as submitted.

**Capacity**
: How many hours you plan to work each weekday. Ajour compares each day and week against it, and can warn you when you go over or submit under it.

## Backlog

**Backlog item**
: A piece of planned work, such as a bug or a user story. A backlog item can point at a project and task, so starting it logs time in the right place. An item is **manual**, created in Ajour, or **synced** from a connector such as Azure DevOps or Jira.

**Subitem**
: A backlog item one level under another. Subitems cannot have subitems.

**Workflow state**
: A step in your workflow, such as `To do`, `In progress`, `In review` or `Done`. You choose the states and their order. A state can be marked done. Moving an item into a done state archives it.

**Source state**
: The state an item has in its source tool, such as Azure DevOps `Active`. Each source state maps to one of your workflow states.

**Priority**
: One of `Urgent`, `High`, `Medium` or `Low`, or no priority. Connectors translate their tool's priorities to these four levels.

**Lifecycle**
: Where an item stands for you: **active** (on your plate), **settled** (nothing to do for now, waiting on someone else) or **archived** (done).

**Settle**
: Take an item off your plate. A manual item is archived. A synced item becomes settled, and Ajour can write a new state or priority to its source. Unsettle puts it back on your plate.

**Snooze**
: Hide an item from the sidebar until a time you choose. Snoozing is local and never changes the source tool.

## Plugins

**Plugin**
: An installable extension. Each plugin has one or more capabilities.

**Connector**
: A plugin capability that syncs backlog items and their estimates with a tool such as Azure DevOps or Jira.

**Code host**
: A plugin capability that lists your pull requests from a tool such as GitHub.

**Schema**
: A plugin capability that maps projects and tasks to a file layout, such as the one Workday imports.

**Connection**
: One account or site a plugin talks to, with its own credentials and settings. A plugin can have several connections, for example one per client.

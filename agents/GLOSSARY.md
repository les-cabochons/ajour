# Ajour

Ajour records the time a person spends on project tasks, one workday at a time, and keeps those records on their own machine.

## Language

### Work structure

**Project**:
A body of work that time is recorded against, such as a client engagement.
_Avoid_: Client, account

**Task**:
A unit of work inside one project. A task always belongs to exactly one project.
_Avoid_: Project task (in user-facing text), activity

**Pinned task**:
A task the user reaches with a number key from 1 to 0.
_Avoid_: Favorite, shortcut task

**Backlog item**:
A piece of planned work in the user's backlog, optionally mapped to a project and task.
_Avoid_: Task, work item, issue, to-do

**Subitem**:
A backlog item nested one level under another backlog item.
_Avoid_: Subtask, child item

**Settle**:
To record that the user has nothing left to do on a backlog item for now. A manual item becomes archived. A synced item becomes settled, and the user can change its state or priority in its source tool at the same time.
_Avoid_: Complete, close, finish, resolve

**Settled**:
The state of a synced backlog item that waits on someone or something else, such as another person, a client's answer, QA or a deployment.
_Avoid_: Waiting, blocked, on hold (as the Ajour state)

**Source project**:
The project in a connector's source tool that a synced backlog item belongs to. It is separate from an Ajour project.
_Avoid_: Remote project, connector project

**Settle rule**:
How settling behaves for the backlog items of one source project: ask each time, or apply a fixed change.
_Avoid_: Settle preset, settle config

**Archived**:
The state of a backlog item that is done. An archived item rarely comes back.
_Avoid_: Closed, completed, deleted

**Unsettle**:
To put a settled backlog item back on the user's plate.
_Avoid_: Reopen, restore (for a settled item)

**Snooze**:
To hide a backlog item from the sidebar until a chosen moment, after which it returns on its own. A snoozed item stays active, and its connector's source tool never learns about it.
_Avoid_: Defer, postpone, hide

**Returned**:
The state of a backlog item that came back to the sidebar on its own, because its snooze ended or its source tool changed it after it was settled, and that the user has not opened since.
_Avoid_: Unread, new, woken

### Time entries

**Time entry**:
Time spent on a task on one day, with an optional note.
_Avoid_: Log, time log, session, record

**Running**:
The state of the one time entry the clock is currently counting. At most one time entry is running, and it is always on today's date.
_Avoid_: Open, active, timer (as a separate thing the user sees)

**Saved**:
The state of a time entry that is neither running nor submitted.
_Avoid_: Closed, stopped, committed

**Submitted**:
The state of a time entry included in a submitted timesheet. Editing it returns it to saved.
_Avoid_: Locked, approved, sent

**Timesheet**:
One person's time entries for one week, submitted together.
_Avoid_: Time report, time card

### Time entry actions

**Continue**:
Count more time for a time entry's work. On today's entry it resumes that entry. On another day's entry it starts a new running entry today with the same task and note.
_Avoid_: Restart, resume (as the user-facing label)

**Discard**:
Throw away the time counted by a running entry since it last started.
_Avoid_: Cancel, delete (for a running entry)

### Extensions

**Plugin**:
An installable extension of Ajour. A plugin is either a connector or a schema.
_Avoid_: Extension, add-on, integration

**Connector**:
A plugin that syncs backlog items and estimates with an external tool, such as Azure DevOps or Jira.
_Avoid_: Integration, sync plugin

**Schema**:
A plugin that defines how projects and tasks map to an external file layout, such as Workday.
_Avoid_: Data shape, project data shape (in user-facing text)

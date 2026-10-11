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

**Backlog item**:
A piece of planned work in the user's backlog, optionally mapped to a project and task.
_Avoid_: Task, work item, issue, to-do

**Subitem**:
A backlog item nested one level under another backlog item.
_Avoid_: Subtask, child item

### Time entries

**Time entry**:
Time spent on a task on one day, with an optional note.
_Avoid_: Log, time log, session, record

**Running**:
The state of the one time entry the clock is currently counting. At most one time entry is running.
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

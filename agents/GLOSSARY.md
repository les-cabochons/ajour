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

**Workflow**:
The ordered set of workflow states the user defines for their backlog.
_Avoid_: Board, process, pipeline

**Workflow state**:
One step of the workflow, such as In progress or In review, that a backlog item is at.
_Avoid_: Backlog status, column, status, stage

**Done state**:
A workflow state that closes the backlog items moved into it: they become archived. Moving an item out of a done state makes it active again. No other workflow state changes whether an item is active, settled or archived.
_Avoid_: Completed, closed column, final state

**Source state**:
The state a synced backlog item has in its source tool. Each source state maps to one workflow state.
_Avoid_: Remote status, source status

**Settle**:
To record that the user has nothing left to do on a backlog item or pull request for now. A manual backlog item becomes archived. A synced backlog item or a pull request becomes settled. For a synced backlog item, the user can change its state or priority in its source tool at the same time.
_Avoid_: Complete, close, finish, resolve

**Settled**:
The state of a synced backlog item or pull request that waits on someone or something else, such as another person, a client's answer, QA, a deployment or a reviewer.
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
To put a settled backlog item or pull request back on the user's plate. Ajour unsettles a pull request on its own when someone asks the user to act on it.
_Avoid_: Reopen, restore (for a settled item)

**Snooze**:
To hide a backlog item or pull request from the sidebar until a chosen moment, after which it returns on its own. A snoozed item stays active, and its source tool never learns about it.
_Avoid_: Defer, postpone, hide

**Returned**:
The state of a backlog item or pull request that came back to the sidebar on its own, because its snooze ended or something unsettled it, and that the user has not opened since.
_Avoid_: Unread, new, woken

### Code review

**Pull request**:
A proposed code change in a code host, such as GitHub or Azure DevOps, that the user authored or was asked to review. It is separate from a backlog item.
_Avoid_: PR (in user-facing text), merge request, code review, review item

**Repository rule**:
The project and task that time on pull requests from one repository is recorded against.
_Avoid_: Repo mapping, review rule

**Draft review**:
The user's unsent comments on one pull request, kept by Ajour until the user submits them together as a review.
_Avoid_: Pending review, unsent comments

### Time entries

**Time entry**:
Time spent on a task on one day, with an optional note.
_Avoid_: Log, time log, session, record

**Running**:
The state of the one time entry the clock is currently counting. At most one time entry is running, and it is always on today's date.
_Avoid_: Open, active, timer (as a separate thing the user sees)

**Saved**:
The state of a time entry that is not running.
_Avoid_: Closed, stopped

**Committed**:
A saved time entry whose committed copy matches it: the external timesheet holds it as it is in Ajour. Editing it makes an updated change.
_Avoid_: Submitted, synced, sent

**Committed copy**:
The values of a time entry as it was last committed: its day, project, task, note and duration.
_Avoid_: Snapshot, fingerprint

**Change**:
A time entry that differs from its committed copy: added (never committed), updated (its copy differs) or deleted (committed, then deleted, kept as a tombstone).
_Avoid_: Diff, delta, dirty entry

**Timesheet**:
One person's time entries for one week, committed to an external timesheet tool.
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
An installable extension of Ajour that provides one or more capabilities: connector, schema or code host. When a plugin provides both a connector and a code host, the user turns each on and off separately, as Work items and Pull requests.
_Avoid_: Extension, add-on, integration

**Connector**:
A plugin capability that syncs backlog items and estimates with an external tool, such as Azure DevOps, Jira or GitHub issues.
_Avoid_: Integration, sync plugin

**Schema**:
A plugin capability that defines how projects and tasks map to an external file layout, such as Workday.

**Code host**:
A plugin capability that provides the user's pull requests from a tool such as GitHub or Azure DevOps, and carries out the user's reviews, comments and merges there.
_Avoid_: Git provider, PR plugin, forge
_Avoid_: Data shape, project data shape (in user-facing text)

### Agents

**Agent**:
A program driven by an LLM that uses Ajour through MCP, such as Claude Code or Codex.

**Agent client**:
One configured connection for an agent, with its own name and token, such as "Claude Code on this Mac".

**Agent session**:
A stretch of work an agent announces, with a title, a deadline it extends, progress updates and an outcome. A runner-started session belongs to one Agent run.
_Avoid_: Transaction, job

**Question**:
Something an agent asks the user during an agent session. It waits until the user answers.

**Agent task**:
A task a plugin declares for an agent, such as "Enter in Workday": a prompt, its settings and where its button shows. No plugin code runs.

**Agent run**:
One agent task Ajour started: a coding agent CLI with Ajour's and the task's prompts, its own agent client and agent session. Ajour ends the session and revokes the client when the CLI exits.

**Agent indicator**:
The corner control that shows whether agents are idle, active, waiting for the user, failed or in error.

**Agent panel**:
The chat the agent indicator opens, with the agent sessions, their questions and the activity list.

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
_Avoid_: Shortcut task

**Favorite**:
A task or project the user starred so it shows first in the task menu. Unlike a pinned task it takes no number key, and a task can be both.
_Avoid_: Bookmark, starred item

**Shared project**:
A project that belongs to exactly one team. Its name, code, status, color, icon, tasks and task budgets follow the team; pinned slots, favorites, plugin properties, order and the budget adjustment stay personal.
_Avoid_: Synced project, remote project, team project (in user-facing text)

**Local project**:
A project that belongs to no team and no project source.
_Avoid_: Private project, unshared project

**Managed project**:
A project that a project source brought. Its full name, code, client, dates, tasks and budget follow the source and are locked, except that the user may type their own budget over a task's; its display name, color, icon, favorites, pins and plugin properties stay personal. A project is managed or shared, never both. See ADR 0016.
_Avoid_: Synced project, imported project, source project (that is a backlog item's project in its source tool)

**Not counted yet**:
The user's time on a managed project, or on one of its tasks, that the project source cannot have yet: entries not committed, or committed after the time the source's hours are from. For a stale entry, only the difference from its committed copy counts, which can be negative when time moved off the project. Ajour computes it and never stores it.
_Avoid_: Pending hours, uncommitted (alone), lag, conflict

**Merge into**:
To move every time entry of a task to another task of the same managed project, mark the committed ones for re-commit under the new task, and archive the task. Entries of submitted weeks stay where they were submitted.
_Avoid_: Combine, deduplicate, link (for tasks)

**Commits as**:
What a task's time goes to the timesheet tool as: its own name, another task of the project, Not known yet, or Local only.
_Avoid_: Mapping (for the whole choice), export target

**Not known yet**:
A temporary task waiting for its timesheet task, whose name the user doesn't know yet. Its time is kept off the commit until the user picks what it commits as.
_Avoid_: Pending task, placeholder

**Local only**:
A task or project whose time never goes to the timesheet tool. Not the same as a local project, which belongs to no team: a shared project can be local only, and a local project commits by default.
_Avoid_: Not committed (that is an entry's state), private, excluded

**Share**:
To give a local project to a team, linking it to the team project of the same name or creating one. Unsharing makes it local again on this machine only.
_Avoid_: Publish, upload, sync (for the action)

**Backlog item**:
A piece of planned work in the user's backlog, optionally mapped to a project and task.
_Avoid_: Task, work item, issue, to-do

**Description**:
The text that explains what a backlog item is about. A synced backlog item's description comes from its source tool.
_Avoid_: Note (for a backlog item), body, details

**Frontmatter**:
A block of fields at the very start of a description, between two `---` lines, through which the description sends data to Ajour. Its timelog sets the backlog item's project and task; its other fields show in the item's properties.
_Avoid_: Metadata, header, properties (for the block)

**Timelog**:
The part of a description's frontmatter that names the backlog item's project and task, as `timelog:` with `project:` and `task:` under it.
_Avoid_: Time log (that word means a time entry, which Ajour avoids)

**Comment**:
A message someone posted on a synced backlog item or a pull request. It lives in the source tool or code host, and Ajour shows it there without keeping its text. Manual backlog items have no comments.
_Avoid_: Note, discussion, message

**Mention**:
A reference to a person inside a description or comment that notifies them in the source tool.
_Avoid_: Tag, ping

**Lossy conversion**:
Turning a description or comment from its source tool's format into Markdown in a way that drops something the source can hold, such as a colour or a Jira panel. Ajour writes such text back only when the user has allowed lossy conversion and confirms the loss.
_Avoid_: Downgrade, simplification

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

**Item type**:
The kind a synced backlog item has in its source tool, such as Task or Bug. A connection can let an item type use other source fields than its own, and its plugin can describe each type's icon and fields.
_Avoid_: Work item type, source type

**Settle**:
To record that the user has nothing left to do on a backlog item or pull request for now. A manual backlog item becomes archived. A synced backlog item or a pull request becomes settled. For a synced backlog item, the user can change its state, priority or assignee in its source tool at the same time.
_Avoid_: Complete, close, finish, resolve

**Settled**:
The state of a synced backlog item or pull request that waits on someone or something else, such as another person, a client's answer, QA, a deployment or a reviewer.
_Avoid_: Waiting, blocked, on hold (as the Ajour state)

**Assignee**:
The person a synced backlog item is assigned to in its source tool, or no one. Settling can hand the item to another assignee.
_Avoid_: Owner, assigned to (as a noun)

**Source project**:
The project in the source tool that a synced backlog item belongs to. It is separate from an Ajour project.
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

**Deck**:
The view that lists the user's pull requests and opens each one for review. The name is shared with Review Deck, the Azure DevOps extension.
_Avoid_: Pull requests page, PR hub, inbox

**Guide**:
A pull request's changes split into concerns, in reading order, each with a title and a one-line rationale.
_Avoid_: AI review, walkthrough, guided view

**Concern**:
One group of hunks in a guide that change the same thing.
_Avoid_: Group, cluster, section

**Summary**:
What Deck shows in place of a pull request's description: the problem it fixes, written from its linked ticket, the kinds of change, breaking changes, risky areas, test coverage and leftovers.
_Avoid_: Description, overview, AI summary

**Ask**:
A question to the agent asked in place, anchored to selected lines, a concern or a summary line. Its answer streams in below the anchor.
_Avoid_: Prompt, chat message, query

**Version**:
One push of a pull request on GitHub, or one iteration on Azure DevOps, with its commits.
_Avoid_: Iteration (outside Azure DevOps), revision, update

**Stack**:
Pull requests that build on each other: each one targets the branch of the one below it, down to a trunk branch.
_Avoid_: Chain, series, train

**Layer**:
One pull request in a stack.
_Avoid_: Level, step, child pull request

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
_Avoid_: Snapshot, fingerprint, synced copy (that is a time sync's)

**Synced copy**:
The values of a time entry that Ajour and the other system of a time sync last agreed on: its day, minutes, whether it runs, project and task. It is not the committed copy: the timesheet tool learns of an entry only through a commit. When a later change there can't be taken, such as a move to a project the connection doesn't manage, the synced copy holds back Ajour's older values, which aren't sent while the entry keeps them. See ADR 0018.
_Avoid_: Committed copy, remote copy, mirror

**Non-working day**:
A weekday whose Time capacity is zero, Saturday and Sunday by default. Ajour records no new time on it, and its time stays out of the commit until the user moves it to a working day. When no weekday has capacity, no day is non-working.
_Avoid_: Weekend (for the rule), day off, holiday

**Submitted week**:
A week the user locked after committing every change: its entries are read-only, for agents too, until the user reopens it. The code calls it a locked week.
_Avoid_: Closed week, finalized week, frozen week

**Change**:
A time entry that differs from its committed copy: added (never committed), updated (its copy differs) or deleted (committed, then deleted, kept as a tombstone).
_Avoid_: Diff, delta, dirty entry

**Timesheet**:
One person's time entries for one week, committed to an external timesheet tool.
_Avoid_: Time report, time card

**Calendar event**:
One occurrence of an event in the user's calendar, as a calendar plugin reports it: when it starts and ends, its title and the user's reply. Ajour fetches events per week and never stores them (ADR 0005).
_Avoid_: Meeting (in code; the UI may say meeting), appointment

**Suggestion**:
A calendar event shown on its day in the Time view for the user to add as a time entry or dismiss. Nothing becomes an entry until the user adds it.
_Avoid_: Proposed entry, draft entry, pending entry

**Event rule**:
What Ajour remembers about one recurring calendar event: the project and task to fill in for every occurrence, or that every occurrence is hidden. The same thing as a repository rule, for a meeting series.
_Avoid_: Rule, series, occurrence (in user-facing text; say "remembered meeting" and "hidden meeting")

**Selection**:
The time entries, on the Day list or the Week Days cards, that a selection-wide action applies to. At most one of the two views holds a selection at a time.
_Avoid_: Multi-select, bulk selection, checked entries

**Focused entry**:
The one time entry that has keyboard focus. Single-subject actions such as Edit, Continue and Stop apply to it, even inside a selection.
_Avoid_: Active entry, current entry, highlighted entry

**Anchor**:
The entry a Shift+click or Shift+arrow range starts from: the last entry selected without Shift.
_Avoid_: Pivot, range start

### Time entry actions

**Continue**:
Count more time for a time entry's work. On today's entry it resumes that entry. On another day's entry it starts a new running entry today with the same task and note.
_Avoid_: Restart, resume (as the user-facing label)

**Discard**:
Throw away the time counted by a running entry since it last started.
_Avoid_: Cancel, delete (for a running entry)

### Extensions

**Plugin**:
An installable extension of Ajour that provides one or more capabilities: backlog, schema, code host, calendar, team, project source, time sync or sign-in. When a plugin provides more than one of backlog, code host, calendar, team, project source and time sync, the user turns each on and off separately, as Backlog items, Pull requests, Calendar events, Projects, Managed projects and Time entries.
_Avoid_: Extension, add-on, integration, connector

**Plugin source**:
A git repository with an `ajour.json` that lists plugins, their versions and the hashes of their files. The user keeps a list of them; the official one is there by default. See ADR 0012.
_Avoid_: Catalog, index, store, marketplace

**Signed plugin**:
A plugin installed from a plugin source whose `ajour.json` signature verified with the key the user approved or an official key. Any other plugin is **unsigned**, including one installed from a file.
_Avoid_: Verified, trusted, official plugin

**Connection**:
One place a plugin talks to, such as an Azure DevOps organisation or a Jira site, with its own settings. Its credentials are either its own or an account it may use through a grant. A plugin can have several connections.
_Avoid_: Integration, instance, account (for a connection)

**Team**:
A group of people who share one set of projects and tasks through a team plugin. A workspace can connect to several teams.
_Avoid_: Backend, server, workspace, organization

**Project source**:
A plugin capability that provides a read-only snapshot of the user's projects, tasks, assignments and budgets from a system that holds the truth about them. Ajour never writes to it, and names it by the label the plugin gives.
_Avoid_: The product's name (such as Chronops) in Ajour, project sync, project connector, team (that capability syncs both ways)

**Time sync**:
A plugin capability that keeps a live copy of the user's time entries in another system, both ways, on the projects its project source manages. It is not a commit: the timesheet tool gets a week only through Commit. Its switch, Time entries, starts off. See ADR 0018.
_Avoid_: The product's name in Ajour, time push, live commit, sync (alone)

**Check** (time sync):
A time sync round that sends the cursor of the plugin's last full answer and no changes, while nothing the rules read changed in Ajour since. A plugin whose other system keeps a change marker, a version that moves on every time entry write there, answers it unchanged without listing. Ajour asks every 5 seconds while its window shows. See ADR 0021.
_Avoid_: Poll, ping, heartbeat

**Backlog** (capability):
A plugin capability that syncs backlog items, with their descriptions, estimates and comments, between Ajour and a source tool such as Azure DevOps, Jira or GitHub issues. Say "backlog capability" wherever the user's backlog could be meant.
_Avoid_: Connector, integration, sync plugin

**Schema**:
A plugin capability that defines how projects and tasks map to an external file layout, such as Workday.
_Avoid_: Data shape, project data shape (in user-facing text)

**Code host**:
A plugin capability that provides the user's pull requests from a tool such as GitHub or Azure DevOps, and carries out the user's reviews, comments and merges there.
_Avoid_: Git provider, PR plugin, forge

**Calendar**:
A plugin capability that provides the user's calendar events for a date range, from a tool such as Google Calendar, Outlook or Exchange. Read-only.
_Avoid_: Calendar sync, calendar integration

**Sign-in** (capability):
A plugin capability that offers sign-in with a service such as Microsoft or Google. The plugin only declares the service; Ajour runs the sign-in and holds the accounts.
_Avoid_: Authentication, SSO, identity provider, account (for the capability)

**Account**:
One person's sign-in with a service such as Microsoft or Google, which Ajour holds for them. Plugins use an account only through a grant.
_Avoid_: Login, identity, credential, token, session

**Vault**:
Where Ajour keeps the secrets you give it, such as tokens, secret addresses and accounts, protected by the operating system. No plugin can read it, except through a command it was allowed to start, and Ajour never shows a stored value.
_Avoid_: Keychain, password manager, secret store

**Token**:
A secret you paste into a connection, such as an API token or a personal access token, that lets a plugin reach a service without a sign-in. It belongs to that one connection.
_Avoid_: Key, password, PAT (in user-facing text)

**Grant**:
The user's approval for one plugin to use one account, for what that plugin says it needs, such as reading work items. The user approves it once, and is asked again only when the plugin asks for more.
_Avoid_: Share, authorization, token (in user-facing text, say "Used by" and "Allow")

**Access**:
What a plugin declares it will reach: its hosts and endpoints, the accounts it wants to use, the commands it starts, and its agent prompts. The user approves it at install, and again whenever an update widens it.
_Avoid_: Permissions, scopes, capabilities (a capability is what a plugin provides, not what it reaches)

**Access choice**:
Something one connection may do that the user turns on for that connection, such as "Edit work items", which unlocks part of a plugin's access and names the token scope it needs. Every access choice starts off, except one the plugin marks as always on.
_Avoid_: Permission, scope, toggle, feature flag

**Handoff**:
A coding tool's thread linked to one backlog item, with its tool, repository folder and current state, the worktree it runs in when Ajour started it in one, and the connection it runs through when its tool uses one. Removing a handoff from the item leaves the thread in the tool. A thread the user started on their own becomes a handoff when its title names the item's key in brackets and the user links it from the item's Handoffs card; until then it is a found thread.
_Avoid_: Agent run, agent session, job

**Close** (handoff):
Ask a handoff's tool to stop the thread's work and close the thread, then remove the handoff from the item. A tool that closes threads either keeps the conversation, where the user can reopen it (Close in <tool>), or deletes it for good (Delete in <tool>, which asks first). Remove from item, by contrast, leaves the thread in the tool.
_Avoid_: Archive (one tool's way to close), settle (that is a backlog item's), kill

**Started** (handoff state):
The state of a handoff whose tool can start a thread but doesn't report its state, such as Copilot CLI. Ajour never checks it again; the user opens the thread in the tool to follow it. The other common states are Working, Needs you, Ready, Done, Failed, Gone and Unknown, which the tool reports.
_Avoid_: Running, launched, sent

**Tool feature**:
What a handoff tool supports, as it declares it: Starts threads (every tool), Follows state (`followsState`), Finds threads (`listsThreads`), Updates within seconds (`hooks`, only for a tool that follows state), Closes threads or Deletes threads (`closesThreads`), and Makes its own worktree (`ownWorktree`), for which Ajour makes none: Start in decides whether the tool makes one, by the branch and the source branch Ajour sends it. Ajour uses only a tool's features, as the tool declares them now.
_Avoid_: Capability (that is the plugin's), ability

**Tool switch**:
Whether Ajour uses one handoff tool on this computer, turned on or off on its plugin's page. Every tool starts off. Only a tool that is on takes new hand offs, is detected and offers found threads; a tool turned off keeps its handoffs, which still refresh and open. With no tool on, the Hand off button reads Choose your tools.
_Avoid_: Enabled tool, tool activation (activation is the plugin's), preference

**Hand off**:
To start a thread for a backlog item in a coding tool, from the item's page, its row menu or the command palette. The verb is two words ("Hand off to T3 Code"); the thing it makes is a handoff.
_Avoid_: Send to agent, delegate, dispatch

**Handoff hook**:
The address a coding tool posts to when its thread stops, needs the user or ends, so Ajour refreshes that handoff at once instead of at its next check. Each handoff has its own, on this computer only; a post says only "look again", never what the state is (ADR 0020).
_Avoid_: Webhook, callback, push

**Worktree**:
A git worktree Ajour made for one backlog item inside a repository folder, at `.ajour/worktrees/aj-<item key>`, with the branch Ajour created for it. An item without a key gets `aj-` and the first 8 characters of its own id. A hand off starts in it, so two items of one project don't edit the same checkout, and a later hand off of the item starts in its newest one. Ajour keeps the list on this computer only. A worktree a tool makes for itself is not one: Ajour doesn't list it (ADR 0022).
_Avoid_: Checkout, copy, clone, workspace

**Start in**:
Where a hand off runs: the main folder, a new worktree, or a worktree the item already has. Settings › Worktrees holds the default for this computer, Main folder, New worktree or Ask each time, with New worktree on a fresh install, and it never syncs. A project can override the default on this computer, on its page. The user can choose it for one hand off in the hand-off sheet, the Start in dialog and Review prompt. A tool that makes its own worktree follows it too: under New worktree it makes one, and a worktree the item has counts as New worktree for it.
_Avoid_: Location, target, destination, mode

**Main folder**:
The repository folder itself, as the place a hand off starts in when it gets no worktree. A hand off also starts there when the folder isn't a git checkout and when the computer has no git. Ajour creates no branch there: the tool works on what is checked out, or makes its own worktree from the branch name it is sent. A tool that makes its own worktree always starts from it, and makes none when Start in says Main folder.
_Avoid_: Root, base folder, main worktree, repository root

**Clean up**:
Ajour removing worktrees by itself, by two rules of Settings › Worktrees: those of finished items, a number of days after the item became done, settled or archived, and unused ones, a number of days after the last hand off or thread change. It keeps a worktree with uncommitted or untracked files, a thread that is Working or Needs you, or a change in the last hour, and it never deletes a branch. The window starts each round, at launch, once an hour and from Clean up now.
_Avoid_: Garbage collection, purge, prune, sweep

**Source branch**:
The branch a new worktree's branch starts from, such as `origin/main`. The user picks it for one hand off in the branch finder. Without a pick it is the one last picked for that repository folder on this computer, else the remote's default branch, else the branch checked out in the main folder. The new branch never tracks it. A tool that makes its own worktree receives it with the branch name.
_Avoid_: Parent branch, upstream, origin branch

**Process broker**:
The part of Ajour that starts a process for a plugin, such as `t3 thread start`, after checking the plugin's access, its gates and its command mode. A plugin never starts a process itself (ADR 0019).
_Avoid_: Shell, launcher, runner (the agent runner is something else)

**Declared command**:
A command a plugin names in its manifest, with the shape of each argument. The user approves it with the plugin's access.
_Avoid_: Allowed command, whitelisted command

**Command mode**:
What a plugin may do with a command it didn't declare: Always ask, Auto (runs commands Ajour knows are read-only, asks for anything else) or Accept everything. Only the user changes it.
_Avoid_: Yolo (in user-facing text), trust level, permission mode

**Command review**:
The checks Ajour runs on a command a plugin didn't declare: a fixed set of rules, then the command reviewer if the user downloaded it. The rules mark a command safe only from a short allowlist of read-only commands; anything else is risky. A review can only make Ajour ask or refuse, never let a command through.
_Avoid_: Scan, vetting, approval

**Command reviewer**:
A small model Ajour can download, on the user's request, to mark commands risky that no rule names. It runs on the user's computer.
_Avoid_: AI check, classifier (in user-facing text), guard

**Held change**:
A change to a synced item that its connection refused because its access choices don't include editing work items, such as a settle, an estimate, a description or a comment. Ajour keeps it on this computer, as the user left it, and sends it only when the user approves it in Sync review. Turning editing on is not that approval.
_Avoid_: Queued write, pending change (a pending write still goes on its own), draft

### Agents

**Agent**:
A program driven by an LLM that uses Ajour through MCP, such as Claude Code or Codex.

**Agent client**:
One configured connection for an agent, with its own name and token, such as "Claude Code on this Mac".

**MCP endpoint**:
The one address on the user's machine through which agents reach Ajour. It is off until the user turns MCP on, and it answers only agent clients.
_Avoid_: MCP server (in user-facing text), API

**Agent tool**:
One operation an agent can call through the MCP endpoint, such as listing time entries or starting a time entry. An agent tool does exactly what the same action does in Ajour, with Undo.
_Avoid_: Command, function, action (for the MCP operation)

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

**Repository folder**:
A folder on this computer that the user associates with an Ajour project. A project can have several. Its stable id resolves to an absolute path in the local API. Paths and the last-used choice never sync with a team. Removing it forgets the association and its worktrees, and leaves files in place.

_Avoid_: clone, working directory or repository path for the saved association. A repository folder does not promise that Git is initialized there.

**Remembered command approval**:
A user's permission to repeat one exact executable name, argument list and repository folder id for a plugin. It also covers the same command in one of that folder's worktrees. It ends when the plugin's version, package, signature or development directory changes. The user can remove it on the Access tab.

# Workflow states

Workflow states are the steps your backlog items go through. Ajour starts with four: `To do`, `In progress`, `In review` and `Done`. Change them in **Settings › Workflow**.

<Shot name="settings-workflow" alt="Settings › Workflow with the workflow states and the source states" />

## Edit your workflow

- **Add a state.** Type a name in **Add a workflow state**, pick a color, and press **Add state**.
- **Rename a state.** Click its name.
- **Reorder states.** Use the up and down arrows. The order is the order of the groups and board columns.
- **Mark a state done.** Turn on **Done**. Moving an item into a done state archives it, and moving it out makes it active again. You can have several done states, and at least one is required.
- **Remove a state.** Press its **Remove** button. An Undo toast shows.

## Map source states

Each connector has its own states, such as Azure DevOps `New`, `Active` and `Resolved`, or Jira `To Do` and `In Progress`. Ajour maps each source state to one of your workflow states, so synced items land in the right group.

Ajour maps a source state on its own when:

- Its name matches a workflow state, ignoring case.
- The connector says it is a done state. It maps to your first done state.

Map the others under **Source states**. Mappings apply to every source project of a connection by default. To map one project differently, change it under that project. Choose **No state (not mapped)** to leave a source state out.

Press **Refresh source states** after a sync if a new state is missing, or **Load all states** to fetch every state of a project.

## What moving an item writes

When you move a synced item to another workflow state, Ajour can write the matching state to its source. For each workflow state, choose what a move writes:

- **A source state**, such as `Active`.
- **Ask**, to pick the source state each time.
- **Don't write**, to change the state in Ajour only.

Like settling, the write waits until the Undo toast closes. See [Settle and snooze](/backlog/settle-and-snooze).

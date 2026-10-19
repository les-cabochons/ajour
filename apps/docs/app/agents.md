# Agents and MCP

Ajour can let an AI agent, such as Claude Code or Codex, read and change your time entries, running entry and backlog. It does this through MCP, the Model Context Protocol. For example, an agent can start an entry on the item it works on, or prepare your week's timesheet lines.

<Shot name="settings-mcp" alt="Settings › MCP with one agent client" />

::: warning Your data goes to the agent's model provider
When an agent uses Ajour, it sends what it reads, notes included, to its model provider. MCP is off until you turn it on.
:::

## Turn on MCP

1. Open **Settings › MCP** and turn on **Allow agents**.
2. Under **Clients**, type a name such as `Claude Code on this Mac` and press **Add client**.
3. Copy the token now. Ajour shows it once, and keeps only a hash of it.
4. Copy the setup command for your agent. For Claude Code:

   ```sh
   claude mcp add --scope user --transport http ajour \
     http://127.0.0.1:8787/mcp/ajour \
     --header "Authorization: Bearer <token>"
   ```

   For Codex, Ajour shows the block to add to `~/.codex/config.toml`.

Create one client per agent, so you can revoke one without the others. **Revoke** cuts a client off at once. Turning **Allow agents** off disconnects every agent.

## What agents can do

| Kind         | Tools                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read         | The running entry, time entries, projects, backlog items, the week's changes since its last commit, and whether the week is submitted, with its committed hours and pace. |
| Time         | Start, stop and edit the running entry. Create, edit, move and duplicate entries. Mark changes as committed, and submit a week.                                           |
| Backlog      | Create, edit and move items. Settle and unsettle, snooze and unsnooze, archive and restore them.                                                                          |
| Comments     | Read a synced item's comments, and post one, only where you allow it. See below.                                                                                          |
| Conversation | Report what they are doing, and ask you a question.                                                                                                                       |

Agents cannot delete anything. Their changes go through the same actions as yours, with the same Undo toast.

A submitted week is read-only for agents too: Ajour refuses their writes to it with the reason.

### Comments

A synced item's [comments](/backlog/comments) are other people's words, often a client's, so agents get none of them until you allow it. Set **Agent access to comments** on each connection, in **Settings › Plugins**:

- **None**, the default: agents can't read or post comments on the connection's items.
- **Read**: agents can read the comments. What they read goes to their model provider, like the rest of your data.
- **Read and post**: agents can also post a comment, or settle an item with one. The comment waits for its Undo toast, such as **Claude Code on this Mac: Commented on a backlog item**, and goes to the source when the toast closes. **Undo** cancels it. If you take back the access before it goes, or the source refuses it, Ajour keeps it as a draft on the item. A comment on an item you deleted goes with it.

The connection's row shows **Agents read comments** or **Agents read and post comments** while you allow it.

## Agent tasks

A plugin can also ask Ajour to start an agent for a task, such as [Workday (agent)](/plugins/workday-agent), which enters your week in Workday. Ajour runs the agent with its own instructions only: your own skills, settings, plugins and MCP servers stay out. The agent gets your Ajour data and a Chrome window, and nothing else: no shell and no files.

In **Settings › Agents**, pick:

- **Agent**: Claude Code, Codex or OpenCode. Ajour shows the version of each one installed on this computer, and greys out the others.
- **Browser**: **Ajour's Chrome window** opens Chrome with a profile only Ajour uses. **My Chrome** uses your own Chrome profile through Playwright's Chrome extension, with every site you are signed in to.
- **Model**: leave it empty for the agent's default model.

A plugin's task settings are on its page in **Settings › Plugins**, once for all its tasks. One task runs at a time. Its session shows in the agent panel with **Stop**.

## Watch your agents

While MCP is on, an indicator at the bottom right of the window shows what agents are doing: **Working**, **Needs input** when one asks you a question, or **Error**, **Failed** or **Stalled** when something goes wrong. **Agents idle** shows as a dot until you point at it. Click the indicator for the agent panel, with each session's activity and a field to answer questions.

## Limits

- MCP works only while the Ajour window is open. With the window closed, agents get the message "Open the Ajour window to use this tool."
- Ajour listens on `127.0.0.1` only, so agents must run on the same machine.
- Browser pages cannot call the MCP endpoint.

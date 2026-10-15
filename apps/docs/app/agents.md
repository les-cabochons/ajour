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

| Kind          | Tools                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Read          | The running entry, time entries, projects, backlog items, and the week's submit lines.                  |
| Time          | Start, stop and edit the running entry. Create, edit, move and duplicate entries. Mark entries as submitted. |
| Backlog       | Create, edit and move items. Settle, snooze, archive and restore them.                                  |
| Conversation  | Report what they are doing, and ask you a question.                                                      |

Agents cannot delete anything. Their changes go through the same actions as yours, with the same Undo toast.

## Watch your agents

While MCP is on, an indicator at the bottom right shows what agents are doing: **Agents idle**, **Working**, or **Needs input** when one asks you a question. Click it for the agent panel, with each session's activity and a field to answer questions.

## Limits

- MCP works only while the Ajour window is open. With the window closed, agents get the message "Open the Ajour window to use this tool."
- Ajour listens on `127.0.0.1` only, so agents must run on the same machine.
- Browser pages cannot call the MCP endpoint.

# MCP sends local data to the client's model, by opt-in per client

Ajour exposes an MCP server so agents such as Claude Code and Codex can read and change timers, time entries and backlog items. An agent's model runs at its provider, so every tool result, including entry notes, project names and backlog titles, leaves the machine. MCP is off by default. Turning it on and creating a named client with its own token are the explicit opt-in the local-first boundary requires. Ajour itself still sends nothing. The user chooses which agent receives the data.

The renderer runs every data tool through the object action sets and domain transitions, so an agent can do exactly what the UI allows, with Undo. The API holds tokens, sessions and questions, never the store.

## Considered options

- **Filter private fields out of tool results.** Rejected. Notes are what the Workday flow copies as comments, and an agent that cannot see notes cannot edit them correctly.
- **No token, loopback only.** Rejected. The `/mcp` endpoint takes no browser Origin, but a token is what keeps a web page from calling it, and it names which agent made each call and lets the user revoke one agent.
- **Ajour data tools as an installable plugin.** Rejected. A plugin would need a new host API with write access to the store and per-plugin permissions. Plugins add tools and prompts on the same MCP endpoint instead (spec B).

## Consequences

- Settings > MCP states that connected agents can read and change time entries and the backlog, and that their model provider receives that data.
- Tokens are stored hashed and can be revoked per client. They block web pages, give per-client attribution in the agent panel and Undo toasts, and let the user cut off one agent.
- `/api` answers only Ajour's window, through a per-launch token that main adds to the window's requests. Turning MCP on and creating, revoking and turning on agent clients go through `/api`, so no other local program can mint itself a client.
- `/mcp` answers only agent clients, each with its own bearer token.
- Malware running as the user stays out of scope: it can already read Ajour's data on disk. The tokens keep other local programs and web pages out, without claiming more.
- MCP works only while the Ajour window is open, because the renderer owns the data.

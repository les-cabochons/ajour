# Deck's agent tasks don't require MCP to be on

This amends [ADR 0004](0004-mcp-sends-local-data-to-the-clients-model.md) for Ajour's own agent tasks only. Everything else there stands.

ADR 0004 made turning MCP on, and creating a named client, the user's opt-in to sending local data to an agent's model provider. An agent client reaches the user's timers, time entries, projects and backlog, so every agent run needed MCP on, plugin tasks included. Deck's agent tasks are different (#597, #643, #774). Explaining a selection, giving more detail on a concern, regrouping the guide and the chat are core tasks of the agent runner, `deck.ask`, `deck.guide` and `deck.chat`, and they run as turns of one conversation about one pull request at one head. The conversation's agent client is bound to that pull request and head (`StoredMcpClient.pullRequest`, #778). It lists none of the user's data tools and no session tool, and Ajour refuses a call to any of them as `outside_pull_request`, whatever the CLI is told. What it can reach is the pull request's own content, and Deck asks for each repository's consent before the first turn sends any of it (#791).

So a core task's turn runs with MCP off. While MCP is off, the MCP endpoint still answers only a client bound to a pull request; it stays absent for everyone else, as before, and refuses a browser. Plugin tasks still require MCP to be on, since their clients reach the user's data.

## Considered options

- **Keep requiring MCP for every run.** Rejected. Turning MCP on would give every agent client the user creates the user's whole timesheet and backlog, only so that Deck can explain a hunk. The opt-in would then mean more than the user asked for.
- **A second endpoint for Deck's tools.** Rejected. Both endpoints would need the same token checks, scoping and events. One endpoint with a client bound to a pull request keeps one set of rules, and the binding is what the server enforces.
- **Treat the repository consent as an MCP switch per repository.** Rejected. Consent says what may leave the machine for one repository's pull requests, not which agent clients exist. The conversation's client is Ajour's own: it is created for one conversation and revoked when it closes.

## Consequences

- With MCP off, `/mcp/ajour` authenticates a request before it answers. A missing, unknown or unbound token, or any request with an Origin, still gets the 404 it got before, so the endpoint stays absent for them.
- A conversation's client never shows the user's data, whichever tools later tickets add for Deck: they are registered only for a client bound to a pull request, and act on that binding only.
- The conversation's client is created when its first process starts and revoked when the conversation closes, whether a turn for another pull request replaced it, it went idle, it failed or Ajour quit. A revoked conversation client is no error for the agent panel.
- The CLI keeps the provider's own conversation, so a later turn can resume it: Claude Code's session and Codex's thread are persisted by each CLI in the user's profile, as their own sessions are. Ajour remembers only the provider's ID, in memory.
- Turn events reach the window on the event stream that needs no MCP (`/api/handoffs/bridge`). They carry the answer's text, which the page shows, and wide events for turns never do (ADR 0011).
- Settings > MCP keeps describing what MCP clients reach. Deck's consent dialog, not MCP, tells the user what a Deck turn sends.

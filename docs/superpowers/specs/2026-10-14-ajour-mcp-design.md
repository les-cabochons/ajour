# Ajour MCP: data tools, agent sessions and the agent indicator

- Date: 2026-10-14
- Status: Implemented. Plan: docs/superpowers/plans/2026-10-14-ajour-mcp.md
- Scope: MCP endpoint in the local API, client tokens, Ajour data tools, agent sessions, questions, the agent indicator and panel
- Decisions: [ADR 0004](../../../agents/adr/0004-mcp-sends-local-data-to-the-clients-model.md)
- Follow-up: spec B, the agent runner and the Workday plugin (see "Later")

## Summary

Ajour exposes an MCP server through its local API. An agent such as Claude Code or Codex connects with a token the user created in Settings, then reads and changes Ajour's data: the running timer, time entries, projects and tasks, and backlog items. Every write goes through the same object action sets and domain transitions as the UI and shows the Undo toast, labeled with the client's name.

An agent can open a **session** to say what it is doing and how long it expects to take, send progress, and ask the user a question. A small **agent indicator** sits in the bottom right corner whenever MCP is on. Its color says whether agents are idle, active, waiting for the user, failed or hit an error. Clicking it opens the **agent panel**, a generic chat that later LLM plugins reuse.

This spec is the first of two. Spec B adds the agent runner, where Ajour starts Claude Code or Codex itself, and the Workday plugin that enters a week into Workday through it.

## Goals

- Let the user's own agents read and change timers, entries and backlog items with the same rules as the UI.
- Let any agent tell the user what it is doing and ask a question without the user watching a terminal.
- Show agent activity in one place that stays out of the way until something needs the user.
- Keep MCP off by default and invisible when off.

## Non-Goals

- Starting agents from Ajour. That is spec B.
- MCP tools or prompts from plugins. Spec B adds the `mcp` plugin capability and its routes.
- Delete and Discard, editing projects and tasks, settings, connector sync, pull requests and import review.
- Rolling back a session's writes. Each write keeps its own Undo.
- Using MCP while the Ajour window is closed.
- Remote access. MCP listens on loopback only, like the rest of the local API.

## Terms

These go into `agents/GLOSSARY.md` under a new "Agents" section.

- **Agent**: a program driven by an LLM that uses Ajour through MCP, such as Claude Code or Codex.
- **Agent client**: one configured connection for an agent, with its own name and token, such as "Claude Code on this Mac".
- **Agent session**: a stretch of work an agent announces, with a title, a deadline it extends, progress updates and an outcome. _Avoid_: transaction, run, job.
- **Question**: something an agent asks the user during a session. It waits until the user answers.
- **Agent indicator** and **agent panel**: the corner control and the chat it opens.

## Architecture

```text
agent ──MCP over HTTP──▶ local API /mcp/ajour ──event stream──▶ renderer
                         (auth, sessions,      ◀──POST result──  (action sets,
                          questions, activity)                    transitions, Undo)
```

The renderer owns all data in browser storage. Plugins and the API never get the store, and this spec keeps that rule. The API holds what must outlive a single tool call: client tokens, sessions, questions and the activity list. The renderer runs every data tool.

### MCP endpoint

- The local API serves MCP over Streamable HTTP at `/mcp/ajour`, using `@modelcontextprotocol/sdk`. Spec B adds `/mcp/plugins/<pluginId>` on the same server and with the same tokens.
- When MCP is off, every `/mcp/*` path answers 404 and the API advertises nothing.
- The API keeps its loopback binding and Host check.

### Authentication

- Each request carries `Authorization: Bearer <token>`. A missing, unknown or revoked token gets 401.
- Requests to `/mcp/*` that carry an `Origin` header get 403. Agents are not browsers, so this blocks web pages from reaching MCP even with a leaked token.
- Settings > MCP creates a client with a name and shows its token once, with ready-to-paste config for Claude Code and Codex. The API stores the SHA-256 hash of the token, the name, the creation time and the last use, in `app-api-state.json`. Revoking a client keeps its record with a `revokedAt` time and the token stops working, so the 401 error can name the client.
- The MCP on/off flag lives in the same file, so the API knows it without a renderer.
- The toggle and the client management routes live under `/api/mcp/settings` and `/api/mcp/clients` and use the existing origin allowlist, like the rest of `/api`.

### Bridge to the renderer

- The renderer opens `GET /api/mcp/bridge`, an event stream behind the existing origin allowlist. The API sends tool calls on it and posts state changes for the indicator: sessions, questions, activity and errors.
- The renderer runs a tool call and answers with `POST /api/mcp/bridge/results`, keyed by request ID.
- One bridge is active at a time. A new connection replaces the old one, so a reload does not leave two writers.
- The renderer runs tool calls one at a time, in arrival order.
- With no bridge connected, a data tool fails with "Open the Ajour window to use this tool." A tool call that gets no result within 10 seconds fails with "Ajour did not answer in time." Both count as errors for the indicator.
- Session tools run in the API alone and work without a bridge, so an agent can still report and end its session.

### Code layout

- `packages/shared/agent-tools.ts`, a new entry point: zod input and output schemas for every tool, the bridge messages, and the session and question shapes. The API uses them to advertise and validate tools, the renderer to validate calls again.
- `apps/api/src/mcp-server.ts`: the MCP transport, authentication and the tool table.
- `apps/api/src/mcp-clients.ts`: token creation, hashing, lookup and revocation on top of `AppApiStorage`.
- `apps/api/src/agent-sessions.ts`: the session and question rules, with an injected clock, and the in-memory activity list.
- `apps/web/src/lib/mcp-bridge.ts`: the event stream connection, reconnection and result posting.
- `apps/web/src/features/agents/agent-tool-runner.ts`, with `agent-write-tools.ts` and `agent-work-item-tools.ts`: runs each data tool against `localStore`. It looks the object up, checks its action set from `domain/actions/object-actions.ts`, calls the existing store command and returns the result with the Undo token. It adds no lifecycle rules of its own. It lives in `features` because it needs `canWriteToSource` from `features/backlog`.
- `apps/web/src/features/agents/`: the indicator, the generic `agent-panel.tsx` (it takes the snapshot and callbacks as props), `agent-panel-host.tsx` that wires the panel to the bridge, the question toast, and the wiring that shows the Undo toast for agent writes.
- `apps/web/src/features/settings/settings-mcp-page.tsx`: the toggle and the client list, at `/settings/mcp`.

## Tools

Tools take and return Ajour IDs. List tools return the IDs that write tools need. A refused write returns an MCP error result (`isError: true`) with the action set's disabled reason, such as "Stop the running entry first".

### Read

- `get_running_timer`
- `list_time_entries`: a date range. Each entry has its state: saved, submitted or running.
- `list_projects`: active projects and their tasks.
- `list_work_items`: filters by workflow state, project or text. The `sidebar` filter returns the sidebar work list, in the sidebar's order.
- `get_work_item`
- `get_submit_lines`: a week and a group-by option. Returns the Submit page's lines, totals and warnings from `domain/time/timesheet-submission.ts`.

### Write

Each write checks the object's action set before it runs.

- Timer: `start_timer` (on a project, a task or a work item, with a note), `stop_timer`, `edit_running_entry`.
- Entries: `create_entry`, `edit_entry`, `move_entry`, `duplicate_entry`, `mark_entries_submitted`. Editing a submitted entry marks it as not submitted, as in the UI.
- Work items: `create_work_item`, `edit_work_item` (title, note, priority, estimate, project and task), `move_work_item` (workflow state), `settle_work_item`, `unsettle_work_item`, `snooze_work_item`, `unsnooze_work_item`, `archive_work_item`, `restore_work_item`.

A settle or a move on a synced item writes to its source after the Undo window, as ADR 0001 says. Agent writes follow the same rule. Where the UI opens the settle dialog or the source state dialog, the tool reads a `sourceState` input instead, and refuses with the list of source states when it is missing.

### Session

- `begin_session`: a title and an estimate in minutes. Returns a session ID and a deadline.
- `update_session`: a session ID, a short message, and optional extra minutes.
- `end_session`: a session ID, an outcome (done, failed or cancelled) and a summary.
- `ask`: a question, an optional list of choices and an optional session ID. Returns a question ID at once.
- `wait_for_answer`: a question ID. Holds the call up to 50 seconds and returns the answer, or "still waiting". Some clients cut off a tool call after about a minute, so `ask` never blocks.

The tool descriptions tell the agent to open a session for any work longer than a minute, to send an update at least every few minutes, to extend the deadline before it passes, to ask only when it cannot go on otherwise, and to always end the session.

## Sessions and questions

- The deadline is the estimate plus 25%, at least 2 minutes and at most 4 hours. `update_session` with extra minutes moves it by the same rule.
- A session past its deadline becomes **stalled**. Any later call on it makes it active again with a fresh deadline from the update.
- An open question pauses its session's deadline. The answer resumes it with the time that was left.
- A question stays open until the user answers or the session ends. Ending the session withdraws it.
- Sessions, questions and the activity list live in API memory. Restarting Ajour clears them. Tokens survive.
- The activity list keeps the last 200 events: tool, client, session, outcome and the object's ID and title. It does not keep notes or tool inputs.

## Agent indicator and panel

The indicator is in the bottom right corner whenever MCP is on, and absent when MCP is off. It shows one state, the most urgent across all sessions:

1. **Needs input**: an open question. A toast also shows when a question arrives, with an "Answer" action that opens the panel.
2. **Error**: the bridge cannot reach the API now, or a bridge failure, a timed-out tool call or a rejected token happened since the panel was last opened.
3. **Failed**: a session is stalled now, or a session ended as failed since the panel was last opened.
4. **Active**: at least one session is active.
5. **Idle**: MCP is on and nothing is running.

Each state has its own color from the semantic tokens and a short label, so color is never the only signal. Opening the panel clears the past errors and failures. A stalled session or a lost API connection keeps its state until it recovers.

The panel is a sidebar in a wide window and an overlay in a narrow one. It lists sessions with their title, client, state and time left. Selecting one shows its updates and questions as a chat, and the user answers there, by choice or free text. A separate tab shows the activity list and errors. The panel takes sessions as generic data, so later LLM plugins can reuse it without knowing about MCP.

An agent write shows the usual Undo toast titled "<Client name>: <action>". The store keeps only the last action's Undo, so an agent write closes the user's pending Undo toast, as any newer action does today.

## Privacy

MCP sends entry notes, project names and backlog titles to whatever model the client uses, so it is an external sink. ADR 0004 records the decision. Turning MCP on and creating a client are the explicit opt-in that `architecture.md` asks for. Settings > MCP says plainly that connected agents can read and change time entries and the backlog, and that their model provider receives that data. `architecture.md` gets a short "MCP" section under Runtime Surfaces.

## Logging

The API emits one wide event per MCP request, `mcp.request`, with the client ID, session ID, tool, outcome, duration and bridge round trip. It never logs tool inputs, answers or notes. Session ends emit `mcp.session_ended` with outcome, duration, update count and question count.

## Errors

- No bridge, a timed-out bridge, an invalid input and a refused action all return an MCP error result with a sentence the agent can act on.
- A token that stops working mid-session gets 401. Ajour shows the rejection as an error in the indicator, with the client's name.
- If the renderer reloads during a tool call, the API times the call out after 10 seconds. The agent sees "Ajour did not answer in time" and can retry. A retried write can apply twice, as with any timeout. The activity list shows both.

## Testing

- `agent-sessions` unit tests with an injected clock cover the deadline margin and limits, stall and revival, the pause while a question is open, and withdrawal on end.
- API tests cover 401 without a token or with a revoked one, 403 with an `Origin` header, 404 when MCP is off, the error without a bridge and the bridge timeout.
- `agent-tool-runner` tests in the web app run each write tool against a real `localStore` and check one refusal from the action sets per object kind, such as moving a running entry.
- One acceptance feature, `agent-mcp.feature`, uses the SDK's MCP client against the real API and web app:
  - An agent starts a timer. The timer runs, and the Undo toast names the client.
  - An agent asks a question. The indicator shows Needs input, the user answers in the panel, and `wait_for_answer` returns the answer.
  - MCP is off. The indicator is absent and `/mcp/ajour` answers 404.

## Slices

1. MCP endpoint, the toggle, client tokens, Settings > MCP, the bridge and the read tools.
2. Write tools and the Undo toast for agent writes.
3. Sessions, questions, the indicator and the panel.

## Later

Spec B covers:

- The agent runner: Ajour starts Claude Code or Codex headless with a clean configuration and the Playwright MCP for the browser. The runner ends the session when the process exits.
- Runner tokens: for each run, the runner creates an MCP client, keeps its token in memory and passes it to the agent in the `AJOUR_MCP_TOKEN` environment variable. The MCP server config goes on the command line. No config file holds the token. The runner revokes the client when the process exits. The ready-to-paste config in Settings > MCP stays for agents the user starts.
- The `mcp` plugin capability: plugin tools and prompts at `/mcp/plugins/<pluginId>`, each call in a stateless worker. Waiting stays in the API.
- The Workday plugin: a prompt that fills the week's timesheet from `get_submit_lines`, opens Workday in the user's browser and lets the browser handle sign-in. The user still clicks Submit in Workday, then confirms in Ajour, which marks the entries as submitted.
- An "Enter in Workday" action on the Submit page, after `feat/ui-time` merges.

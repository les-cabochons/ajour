# Ajour agent runner and the Workday task

- Status: Slices 1 and 2 implemented
- Date: 2026-10-15
- Builds on: `2026-10-14-ajour-mcp-design.md` (spec A, merged in PR #126)

## Summary

Ajour starts a coding agent CLI, Claude Code, Codex or OpenCode, to do one task from a plugin. The first task is "Enter in Workday": the agent reads the week's lines from Ajour, enters them in the Workday timesheet in a Chrome window, marks each line as it goes, checks the totals at the end, and reports in the agent panel. It never signs in for the user. It asks the user only when it cannot go on, or when the week's hours look wrong.

Spec A gave agents the MCP endpoint, the data tools, sessions, questions, the indicator and the panel. This spec adds:

- the agent runner in the local API, with one adapter per CLI;
- the `agentTask` plugin capability: a prompt and settings, with no plugin code;
- the Workday plugin, `les-cabochons/ajp-workday-agent`. The name says "agent" because a Workday plugin that uses the Workday API may come later. `les-cabochons/ajp-workday` stays the project data shape plugin;
- three Ajour data changes for the task: `mark_entries_not_submitted`, a stable line ID, and a pace check.

## Goals

- One click on the Submit page enters the week in Workday, with no question when nothing is wrong.
- When it breaks, the panel says where and why, and a rerun picks up only the lines still missing.
- The agent runs clean: none of the user's own skills, instructions, plugins or MCP servers change how it behaves.
- The MCP token never sits in a file or in a command's arguments.

## Non-goals

- Signing in to Workday. The browser handles sign-in; the user signs in when Workday asks.
- Plugin MCP tools at `/mcp/plugins/<pluginId>`. The Workday task needs only a prompt. A later spec can add tools if a task needs custom code.
- Driving Firefox or Zen. Playwright cannot attach to a running Firefox, and the Firefox options need a launch flag on the user's daily browser.
- A stored mapping from Ajour tasks to Workday tasks. Ajour projects and tasks mirror Workday's by design, so the agent matches by name.
- Running agents from a web-only Ajour with no local API.

## Decisions

| Question         | Decision                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser          | Default: Playwright drives the installed Google Chrome with a dedicated profile Ajour owns. The user signs in to Workday there once, and again when the company's SSO session expires. Setting: "My Chrome" through Playwright's extension mode. No Chromium fallback: a missing Chrome stops the run with "Install Google Chrome". |
| Browser lifetime | Each CLI starts Playwright MCP itself, so Chrome closes when the agent finishes. Workday keeps entered hours; there is no Submit step for the user.                                                                                                                                                                                 |
| Agents           | Claude Code, Codex and OpenCode, picked in Settings.                                                                                                                                                                                                                                                                                |
| Runner location  | The local API. It already owns MCP clients, tokens and sessions.                                                                                                                                                                                                                                                                    |
| Plugin shape     | A prompt-only `agentTask` capability. No plugin code runs.                                                                                                                                                                                                                                                                          |
| Matching         | By project name or project code, and task name.                                                                                                                                                                                                                                                                                     |
| Marking          | The agent marks each line's entries submitted right after entering it, and unmarks them when a line fails. Ajour's "submitted" means "in the external timesheet".                                                                                                                                                                   |
| Pace             | Ajour computes it. The agent asks only when the week is off pace.                                                                                                                                                                                                                                                                   |

## Architecture

```
Submit page ──"Enter in Workday"──▶ POST /api/agent-runs { pluginId, taskId, weekOf }
                                      │
                    API: agent runner │ 1. create an MCP client, token in memory
                                      │ 2. begin a session for the run
                                      │ 3. fill the runner prompt and the plugin prompt
                                      │ 4. spawn the adapter's command in an empty temp folder,
                                      │    env AJOUR_MCP_TOKEN, MCP config for ajour and playwright
                                      │ 5. read the CLI's JSON events
                                      ▼ 6. on exit: end the session, revoke the client, delete the folder
                 agent ──MCP──▶ /mcp/ajour (spec A tools, plus mark_entries_not_submitted)
                 agent ──MCP──▶ Playwright MCP, bundled and pinned ──▶ Chrome
```

Code layout:

- `apps/api/src/agent-runner/runner.ts`: runs, their lifecycle, one run at a time.
- `apps/api/src/agent-runner/adapters/{claude-code,codex,opencode}.ts`: detect, build the command, read events.
- `apps/api/src/agent-runner/cli-path.ts`: the login shell's PATH.
- `apps/api/src/agent-runner/prompts.ts`: the runner prompt and slot filling.
- `apps/api/src/plugin-package.ts`: reads and validates `agentTask` prompts when a plugin loads.
- `apps/api/src/plugin-host.ts`: `readAgentTaskPrompt` returns a task's prompt file.
- `apps/api/src/agent-runner/runner.ts`: lists the tasks of enabled plugins, with their blockers.
- `apps/api/src/storage.ts`: keeps the task setting values.
- `packages/shared/agent-runs.ts`: the run, settings and route contracts.

## Agent tasks in plugins

A plugin declares tasks under a new `agentTask` capability:

```json
"capabilities": {
  "agentTask": {
    "tasks": [{
      "id": "enter-week",
      "label": "Enter in Workday",
      "placement": "submit-week",
      "prompt": "prompts/enter-week.md",
      "estimateMinutes": 10,
      "weekLink": "{{settings.timesheetUrl}}?date={{weekOf}}",
      "settings": [
        { "id": "timesheetUrl", "label": "Workday timesheet URL", "type": "url", "required": true }
      ]
    }]
  }
}
```

- `placement`: `submit-week` is the only value in this spec. The Submit page shows the task's button for the week on screen. The button is disabled until the required settings are filled, an agent is picked, and no run is going.
- `prompt`: a Markdown file inside the plugin folder. The host only reads it. It follows the manifest file rules: a regular file in the canonical plugin folder, no symbolic links, at most 64 KB.
- Slots: `{{weekOf}}` (ISO date of the week's Monday), `{{sessionId}}` and `{{settings.<id>}}`, where `<id>` is a settings field's `id`. A slot Ajour does not know is an install error, not a blank.
- `weekLink`: a URL template with the same slots. It must give an `https:` URL after filling. The plugin owns its shape, since only it knows the external tool.
- `settings`: the existing connector field schema. Values are plain, not secrets, and live in the API's storage under the plugin ID and task ID. The plugin's page on Settings > Plugins renders them under a Tasks section, with the connector settings field UI, next to where connector plugins keep their connections. It shows no connection form for a plugin without `connector` or `codeHost`. Settings > Agents keeps only the agent, browser and model.
- A plugin that declares only `agentTask` has no `entrypoint` and no `connectionFields`. The manifest schema makes both optional in that case and keeps them required for `connector` and `codeHost`. Such a plugin has no connections and no workers.
- Install, activation, the master gate and uninstall work as for connectors, with the same `.ajour-connector` archive. Renaming the archive format waits.

## The runner

### Runs

- One run at a time. `POST /api/agent-runs` answers 409 while a run is going.
- Before spawning, the runner checks: MCP is on, the picked CLI is installed, the task's required settings are set, and in the default browser mode, Google Chrome is installed. Each failure is a 400 with a sentence the Submit page shows.
- The runner creates the MCP client named "<Task label> run", keeps its token in memory, and begins the session itself, titled with the task label and the week, with the task's `estimateMinutes`. The panel shows the run even if the agent never calls `begin_session`. The prompt gives the agent the session ID.
- Routes: `POST /api/agent-runs` starts a run and returns its ID and session ID. `POST /api/agent-runs/:id/stop` stops it. `GET /api/agent-runs/current` returns the run or null. All three sit behind the existing origin allowlist.
- A runner session carries `runId` and a `link` ("Open the week in <plugin name>", the filled `weekLink`). In the panel, it shows Stop instead of Dismiss while open, and the link once it ends.

### Prompts

The runner sends two layers, in this order:

1. The runner prompt, owned by Ajour:
   - Use session `{{sessionId}}`. Send `update_session` at least every few minutes, and end it with a summary.
   - Ask only when you cannot go on. Offer choices.
   - Never type a password, a code or any credential. When a sign-in page shows, ask the user to sign in in the Chrome window, with the choices Done and Stop.
   - Mark each line's entries as submitted right after the external tool saved it. When a line fails, mark the entries you marked for it as not submitted.
2. The task prompt from the plugin, with its slots filled.

### Adapters

Each adapter detects its CLI and reads its version, builds the command, its arguments and its environment, and turns the CLI's JSON events into runner events: started, MCP server failed, finished with a final message, failed.

What each adapter must do, whatever the flags turn out to be:

- Run non-interactively with the prompt.
- Load only the two MCP servers Ajour gives it.
- Ignore the user's own settings, skills, plugins, hooks and instruction files.
- Keep the user's own login: subscription or API key.
- Allow only the MCP tools: no shell, no file edits, no web search.
- Take the token from `AJOUR_MCP_TOKEN`, never from a file or the arguments.
- Use the model from Settings, or the CLI's default when empty.

Flags found in the CLIs' documentation, to confirm in the smoke tests:

- Claude Code: `-p`, `--append-system-prompt-file`, `--mcp-config` with `--strict-mcp-config`, `--setting-sources`, `--disable-slash-commands`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `--tools ""` with `--allowedTools` for the two servers, `--permission-mode dontAsk`, `--output-format stream-json --verbose`, `--model`. Not `--bare`: it drops subscription login. Open: whether `${AJOUR_MCP_TOKEN}` expands in `--mcp-config`. Fallback: `headersHelper`.
- Codex: `codex exec`, `-c developer_instructions=…`, `-c mcp_servers.ajour.url=…` with `bearer_token_env_var="AJOUR_MCP_TOKEN"`, `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `-s read-only`, `approval_policy="never"`, `--json`, `-m`. Open: headless runs reported to cancel MCP tool calls (openai/codex#24135), and no documented switch for user skills or the global `AGENTS.md`.
- OpenCode: `opencode run --agent ajour`, `OPENCODE_CONFIG_CONTENT` with `{env:AJOUR_MCP_TOKEN}` in the header, `permission` that denies everything but the two servers, `--pure`, `--format json`, `-m`. Open: config always merges with the user's global config. Candidate: a temporary `XDG_CONFIG_HOME`, which keeps auth in `~/.local/share/opencode`.

An adapter ships only after its smoke test passes. A CLI whose smoke test fails stays out of the agent list, with the reason in this spec.

### Environment

- PATH: an app started from the Dock does not get the shell's PATH. The API reads the login shell's PATH once (`$SHELL -ilc 'printf %s "$PATH"'`, with a 5 second timeout) and uses it to find and start the CLIs. On Windows it uses the process PATH.
- Working folder: an empty temporary folder per run, so no project instruction file is read. The runner deletes it when the run ends.
- Playwright MCP: a dependency of the API, pinned, started through the app's own Node (Electron with `ELECTRON_RUN_AS_NODE=1` in the desktop build). Never `npx @latest`.
  - Default mode: `--browser chrome --user-data-dir <app data>/agent-browser-profile`, headed, so the user can sign in.
  - "My Chrome" mode: `--extension`.

### How a run ends

| Event                                                 | Session outcome                                                                   | Process         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- | --------------- |
| The agent ends its session                            | The agent's outcome                                                               | Exits by itself |
| Exit 0 without `end_session`                          | Done, with the CLI's final message as the summary                                 | Exited          |
| Non-zero exit, or the CLI reports a failed MCP server | Failed, with the last 20 lines of the CLI's error output as an error in the panel | Exited          |
| The user presses Stop                                 | Cancelled                                                                         | Killed          |
| The session stays stalled for 10 minutes              | Failed: "The agent stopped answering"                                             | Killed          |
| Ajour quits                                           | No outcome: sessions live in memory                                               | Killed          |

In every case the runner revokes the MCP client and deletes the folder. The error output lines stay in memory and are never logged.

## The Workday run

The plugin prompt drives these steps. Ajour's tools make the steps that need arithmetic or matching deterministic.

1. Read `get_submit_lines` for the week, grouped by day and task, unsubmitted only. Nothing to enter: end the session as done, "Nothing to enter".
2. Check `pace`. On pace: say nothing. Off pace: ask before entering, for example "You have 41.5 h this week, 4 over 37.5. Enter anyway?", with the choices Enter and Stop.
3. Open `timesheetUrl` and go to the week. A sign-in page: ask, as the runner prompt says.
4. For each line:
   - Find the project by name or code, and the task by name.
   - Look for an entry on that day and task whose comment ends with the line's ID. Found: it is already entered, so mark it and go on.
   - An entry that looks the same but has no ID or another one: ask, with the choices "Same entry, mark it", "Different, add mine" and "Skip".
   - Otherwise enter the hours and the line's comment followed by " · <lineId>", save, then call `mark_entries_submitted` with the line's entry IDs.
   - Task not found: ask only when Workday offers a short list of close matches. Otherwise skip the line, call `mark_entries_not_submitted` on any of its entries marked too early, and go on.
5. Final review: read the week's totals per day in Workday and compare them with Ajour's lines for the whole week, including lines submitted in earlier runs.
   - All match: end the session as done, with a summary such as "Entered 9 lines. Skipped 1: Acme · Support not found in Workday."
   - Differences: list them, for example "Tue: Ajour 7.5 h, Workday 8 h (Acme · Build)", and ask, with the choices "Update Workday", "I'll fix Ajour" and "Leave it". Update Workday: fix Workday, then review again. The other two: end the session with the differences in the summary.

The panel shows "Open the week in Workday" on a session from this task once it ends.

## Ajour data changes

### `mark_entries_not_submitted`

- A new MCP write tool and store operation: it clears `submittedAt` on saved entries. A running entry is refused, as for `mark_entries_submitted`.
- One undoable action, with the Undo toast "<client>: Marked N entries as not submitted".
- Today the only way back to saved is editing the entry, so this is new in the store. The UI gets no new action in this spec.

### Line IDs

- Each line from `get_submit_lines` gets `lineId`: `ajour:` plus the 32-bit FNV-1a hash of its sorted entry IDs, in 8 hex characters. It is synchronous, unlike Web Crypto's SHA-256, which the read tools cannot await. It only tells lines apart within a week, so it needs no cryptographic strength.
- The same entries give the same ID across runs. Entries added to a line change its ID, which is what the review step needs: the old Workday entry no longer matches the new line.

### Pace

`get_submit_lines` adds a `pace` block, computed in `domain/time`:

- `loggedHours`: the week's total in Ajour.
- `targetHours`: the week's total from `weeklyCapacityTargets`.
- `expectedHours`: the target prorated by the workdays already past, today included. Workdays are the days with a target above zero.
- `status`:
  - `over` when `loggedHours` is above `targetHours`, whatever the tolerance;
  - otherwise `over` or `under` when `loggedHours` differs from `expectedHours` by more than the tolerance;
  - otherwise `on-pace`.
- Tolerance: a new user preference, `paceTolerancePercent`, default 20. It sits in Settings next to the weekly capacity targets.

## Settings

Settings > Agents:

- Agent: Claude Code, Codex or OpenCode. Installed CLIs show their version. Missing ones are greyed out with an install hint. A CLI without a shipped adapter does not show.
- Browser: "Ajour's Chrome window" (default) or "My Chrome", with a link to Playwright's extension.
- Model: optional text. Empty means the CLI's default.

These live in the API's storage, next to the MCP settings.

## Logging

One `agent.run` wide event per run: plugin ID, task ID, CLI, CLI version, browser mode, duration, outcome, exit code, and the number of tool calls. Never the prompt, the week's lines, Workday content or the error output. The MCP calls keep their own `mcp.request` events from spec A, now with the run's session ID.

## Security

- The token lives in the API's memory and in the CLI's environment. The runner revokes it when the run ends.
- The agent sees only Ajour's MCP tools and the browser. The default browser profile holds only Workday's session.
- "My Chrome" mode gives the agent the user's whole Chrome profile. Settings says so next to the option.
- Prompt files are read, never run. A plugin that declares only `agentTask` runs no code.
- ADR 0004 still applies: the agent's model provider sees the week's lines and Workday's pages.

## Testing

- Smoke tests, by hand, recorded in this spec: one script per CLI against a running Ajour with a test task that calls one Ajour tool and opens one page in Chrome. They answer:
  - Token expansion works.
  - The user's skills and config stay out.
  - MCP tool calls run headless (Codex).
  - Config isolation works (OpenCode).
  - Workday keeps entries when Chrome closes.
  - The week link takes a date.
- API unit tests:
  - Each adapter builds its command and environment, never puts the token in the arguments, and reads its CLI's events. A fake CLI script stands in for the real CLIs.
  - The runner covers each row of "How a run ends", refuses a second run, and always revokes the client and deletes the folder.
  - Agent task manifests: slot filling, an unknown slot rejected, the 64 KB cap, `weekLink` that must give `https:`.
- Web unit tests:
  - Pace: on pace, under, over, over the week's target, a partial week, the tolerance.
  - The line ID stays the same across calls and changes when a line gains an entry.
  - `mark_entries_not_submitted`, with Undo, and refused for a running entry.
- Acceptance, with the API stubbed as in the other features:
  - Settings > Agents lists the installed agents.
  - The Submit page shows "Enter in Workday" and the week link, and starting a run shows its session in the panel with Stop.
- Not automated: a real Workday run. The user does one before the plugin's first release.

## Slices

1. Smoke tests, and this spec updated with what they found.
2. Ajour: agent tasks in manifests, task settings, the runner with the Claude Code adapter, Settings > Agents, the Submit page button and week link, `mark_entries_not_submitted`, line IDs and pace.
3. The Codex and OpenCode adapters, each after its smoke test passes.
4. `les-cabochons/ajp-workday-agent`: the manifest, the prompt and its release archive. Done 2026-10-15; a real Workday run is still pending.

## Smoke test results

Claude Code 2.1.293, run by Alex on 2026-10-15 against the installed Ajour (spec A build):

- Pass: `${AJOUR_MCP_TOKEN}` in the `--mcp-config` file expands from the environment. The `ajour` server connected and `get_running_timer` answered. No `headersHelper` fallback is needed.
- Pass: Chrome opened with the dedicated profile and the agent read "Example Domain". Chrome shows a banner about an unsupported command-line flag that Playwright passes; it is cosmetic.
- Pass: the tool list holds only `mcp__ajour__*` and `mcp__playwright__*` tools. No built-in tool (shell, files, search) is exposed with `--tools ""`.
- Pass: `skills` and `slash_commands` are empty. Only Claude Code's own built-in plugins load.
- Pass: `apiKeySource` is `none`: the run used the subscription login.
- Pass: the run ended with a `result` event, subtype `success`.
- Note: Playwright MCP writes page snapshots to `.playwright-mcp/` in the working folder, which the runner deletes after the run.
- Note: Playwright MCP exposes `browser_evaluate` and `browser_run_code_unsafe`, which run JavaScript in the page. Acceptable for now; Playwright MCP's capability flags could narrow this later.
- Not checked: `ps` during the run. The token is only in the environment by construction.

Codex 0.161.0, checked on 2026-10-15 with `just agent-codex-smoke`:

- Pass: the installed ChatGPT login works with `--ignore-user-config`, `--ignore-rules`, `--ephemeral` and `--no-daemon`.
- Pass: the actual adapter authenticates a temporary HTTP MCP client through `AJOUR_MCP_TOKEN`, calls its fixture tool and opens `about:blank` through the bundled Playwright MCP. No Ajour workspace data or Workday page participates in this check.
- Pass: an `AGENTS.md` planted in the run directory is ignored. The adapter sets `project_doc_max_bytes=0`, disables bundled skill instructions and uses `features.skip_host_skill_discovery`. That last switch is under development in this tested CLI version.
- Pass: a deliberate `apply_patch` write in the disposable directory is refused by the read-only sandbox. Shell tools are disabled. Codex still exposes some built-in helper tools; it does not offer a complete equivalent to Claude Code's tool allowlist.
- Required: both servers use `required=true` and `default_tools_approval_mode="approve"`. With `auto`, headless calls fail with "MCP tool call requires approval, but approval policy is never".
- The task prompt is loaded from `model_instructions_file`. User MCP servers, plugins, hooks and memory are disabled. The session token is not written to a file or an argument.

OpenCode: not run yet. Workday checks: not run yet.

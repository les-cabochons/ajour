# Agent CLI smoke tests

These scripts check, against a running Ajour, that each CLI can run clean for the agent runner. Run them by hand. They do not run in CI.

## Setup

1. Start Ajour from this branch (`just desktop-start`) and turn on Settings > MCP.
2. Add a client named "Smoke test" and export its token: `export AJOUR_MCP_TOKEN=ajour_...`.
3. `just install`, so `@playwright/mcp` is in the root `node_modules` (the workspace uses a hoisted linker).

## Run

```sh
bash qa/agents/smoke-claude-code.sh
bash qa/agents/smoke-codex.sh
bash qa/agents/smoke-opencode.sh
```

Each run writes `qa/agents/<cli>.out.jsonl` (git-ignored) and prints the exit code.

## Check, per CLI

- [ ] The report shows the timer result: the Ajour token worked.
- [ ] Chrome opened in a separate window and the report shows "Example Domain".
- [ ] The tool list holds only `ajour` and `playwright` tools. No shell, file or web search tool.
- [ ] The report lists no skill, slash command or instruction file of yours.
- [ ] `ps` during the run shows no `ajour_` token in any argument.
- [ ] The exit code is 0.

## Workday checks (once, by hand)

- [ ] In the Chrome window from the smoke test, sign in to Workday and enter one hour on any task. Close Chrome. Open Workday in your normal browser: the hour is still there. Delete it.
- [ ] Find a timesheet URL that opens a given week. Note its shape for the `weekLink` template.

## Record

Write what you found in the spec, section "Smoke test results": per CLI, pass or fail per check, the CLI version, and any flag that had to change.

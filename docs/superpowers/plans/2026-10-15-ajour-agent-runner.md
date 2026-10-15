# Ajour agent runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajour starts Claude Code headless, with an Ajour prompt plus a plugin's task prompt, the Ajour MCP and a bundled Playwright MCP, to run a plugin's agent task such as "Enter in Workday".

**Architecture:** The local API gains an agent runner (`apps/api/src/agent-runner/`) that creates a per-run MCP client, begins a session, spawns the CLI through an adapter in an empty temp folder, reads its JSON events, and ends the session and revokes the client on exit. Plugins gain a prompt-only `agentTask` capability. The web app gains Settings > Agents, an "Enter in Workday" button and week link on the Submit page, Stop and a link on runner sessions, `mark_entries_not_submitted`, line IDs and a pace check in `get_submit_lines`.

**Tech Stack:** Node 22 with `--experimental-strip-types` (API), zod 3.25 (shared), `@modelcontextprotocol/sdk` 1.32, `@playwright/mcp` (new, pinned), React 19 + TanStack Router (web), Vitest, playwright-bdd (acceptance), Electron (desktop).

**Spec:** `docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md`. This plan covers the spec's slices 1 and 2. Slice 3 (Codex and OpenCode adapters) and slice 4 (`les-cabochons/ajp-workday`) get their own plans after the smoke tests.

## Global Constraints

- The MCP token never appears in a file or in a command's arguments. It travels only in the `AJOUR_MCP_TOKEN` environment variable.
- One run at a time. A second `POST /api/agent-runs` answers 409.
- Prompt files: regular file inside the canonical plugin folder, no symbolic links, at most 64 KB (65,536 bytes).
- Known slots only: `{{weekOf}}`, `{{sessionId}}`, `{{settings.<id>}}`. An unknown slot is an install error.
- `weekLink` must give an `https:` URL after filling. Otherwise Ajour shows no link.
- Pace tolerance default: 20 percent. Over the week's target always counts as `over`.
- Stalled for 10 minutes kills the run. The runner keeps the last 20 lines of error output, in memory only.
- `agent.run` wide event: plugin ID, task ID, CLI, CLI version, browser mode, duration, outcome, exit code, tool call count. Never prompt text, lines, Workday content or error output.
- Default browser mode: `--browser chrome --user-data-dir <data folder>/agent-browser-profile`, headed. No Chromium fallback: missing Chrome is a 400 "Install Google Chrome to run agent tasks."
- Never `npx @latest`. `@playwright/mcp` is an exact-pinned dependency of `apps/api`.
- Do not pass `--bare` to Claude Code: it drops subscription login.
- API code runs under Node type stripping: no enums, no namespaces, no constructor parameter properties (`erasableSyntaxOnly` enforces it).
- Domain code (`apps/web/src/domain`) never imports from `lib`.
- Writing style for every comment, doc, commit and UI string: plain words, no em dashes, sentence case. Conventional commits, ending with the attribution line the session gives.
- QA ports: 4173 is often taken by another worktree. Run acceptance through a temporary config on port 4187 (see Task 12) and `AJOUR_QA_PORT=4188 just ui-perf`.

## Review Focus

1. **A plugin with only `agentTask` and no entrypoint** must not read as "unavailable", must not show a connection form, and must not crash any code that reads `entrypoint` or `connectionFields`. Pinned in Task 2 (API) and Task 3 (web).
2. **The agent never ends its session and the CLI exits 0, or the CLI dies.** The session must still end, the client must be revoked and the temp folder removed. Pinned in Task 9 ("ends the session as done when the agent exits 0 without ending it", "revokes the client and removes the folder on every exit").
3. **Ajour quits mid-run.** The child process must be killed and the client revoked before the API stops. Pinned in Task 9 ("shutdown kills the process and revokes the client").
4. **A week with a day target of 0 (weekend) or a run on Sunday.** Pace must prorate by workdays with a target above zero, today included, and never divide by zero. Pinned in Task 6 ("a week with no targets is on pace", "counts today as past").
5. **The token leaking into argv or a file.** Every adapter test asserts the token value appears in neither `args` nor any written file. Pinned in Task 8 ("never puts the token in the arguments or the files").

---

### Task 1: Smoke test scripts (human gate)

The adapter flags in Task 8 come from documentation and must be confirmed against the real CLIs before the runner is built on them. This task writes the scripts. Alex runs them. Their results go into the spec.

**Files:**

- Create: `qa/agents/README.md`
- Create: `qa/agents/smoke-claude-code.sh`
- Create: `qa/agents/smoke-codex.sh`
- Create: `qa/agents/smoke-opencode.sh`
- Create: `qa/agents/smoke-prompt.md`

**Interfaces:**

- Consumes: a running Ajour (spec A) with MCP on, and a token from Settings > MCP in `AJOUR_MCP_TOKEN`.
- Produces: a "Smoke test results" section in the spec that Task 8 reads.

- [ ] **Step 1: Write the shared smoke prompt**

`qa/agents/smoke-prompt.md`:

```markdown
You are running a smoke test for Ajour. Do exactly this, then stop:

1. Call the `get_running_timer` tool of the `ajour` MCP server and note its result.
2. With the `playwright` MCP server, open https://example.com and read the page title.
3. List every tool you can call, grouped by server, and list any skills, slash commands or instruction files you were given.
4. Reply with one short report: the timer result, the page title, the tool list, and the skills or instructions list.

Do not run shell commands. Do not edit files.
```

- [ ] **Step 2: Write the Claude Code script**

`qa/agents/smoke-claude-code.sh`:

```bash
#!/usr/bin/env bash
# Smoke test for the Claude Code adapter. Mirrors the flags in
# apps/api/src/agent-runner/adapters/claude-code.ts. Needs AJOUR_MCP_TOKEN.
set -euo pipefail
: "${AJOUR_MCP_TOKEN:?Create a client in Settings > MCP and export AJOUR_MCP_TOKEN}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
profile="${TMPDIR:-/tmp}/ajour-smoke-profile"
pw_cli="$(node -p "require.resolve('@playwright/mcp/cli.js', { paths: ['$repo/apps/api'] })")"

# The token is referenced, never written: the file holds ${AJOUR_MCP_TOKEN}.
cat > "$work/mcp.json" <<JSON
{
  "mcpServers": {
    "ajour": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp/ajour",
      "headers": { "Authorization": "Bearer \${AJOUR_MCP_TOKEN}" }
    },
    "playwright": {
      "type": "stdio",
      "command": "node",
      "args": ["$pw_cli", "--browser", "chrome", "--user-data-dir", "$profile"]
    }
  }
}
JSON
cp "$here/smoke-prompt.md" "$work/prompt.md"

cd "$work"
CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 \
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
ENABLE_CLAUDEAI_MCP_SERVERS=false \
claude -p "Do the task in your instructions now." \
  --append-system-prompt-file "$work/prompt.md" \
  --mcp-config "$work/mcp.json" \
  --strict-mcp-config \
  --setting-sources "" \
  --disable-slash-commands \
  --tools "" \
  --allowedTools "mcp__ajour" "mcp__playwright" \
  --permission-mode dontAsk \
  --output-format stream-json --verbose \
  | tee "$here/claude-code.out.jsonl"
echo "exit code: ${PIPESTATUS[0]}"
```

- [ ] **Step 3: Write the Codex script**

`qa/agents/smoke-codex.sh`:

```bash
#!/usr/bin/env bash
# Smoke test for a future Codex adapter. Needs AJOUR_MCP_TOKEN.
set -euo pipefail
: "${AJOUR_MCP_TOKEN:?Create a client in Settings > MCP and export AJOUR_MCP_TOKEN}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
profile="${TMPDIR:-/tmp}/ajour-smoke-profile"
pw_cli="$(node -p "require.resolve('@playwright/mcp/cli.js', { paths: ['$repo/apps/api'] })")"
prompt="$(cat "$here/smoke-prompt.md")"

cd "$work"
codex exec "Do the task in your instructions now." \
  --ignore-user-config --ignore-rules --ephemeral --skip-git-repo-check \
  -s read-only \
  -c approval_policy="never" \
  -c developer_instructions="$prompt" \
  -c 'mcp_servers.ajour.url="http://127.0.0.1:8787/mcp/ajour"' \
  -c 'mcp_servers.ajour.bearer_token_env_var="AJOUR_MCP_TOKEN"' \
  -c 'mcp_servers.playwright.command="node"' \
  -c "mcp_servers.playwright.args=[\"$pw_cli\",\"--browser\",\"chrome\",\"--user-data-dir\",\"$profile\"]" \
  --json \
  | tee "$here/codex.out.jsonl"
echo "exit code: ${PIPESTATUS[0]}"
```

- [ ] **Step 4: Write the OpenCode script**

`qa/agents/smoke-opencode.sh`:

```bash
#!/usr/bin/env bash
# Smoke test for a future OpenCode adapter. Needs AJOUR_MCP_TOKEN.
set -euo pipefail
: "${AJOUR_MCP_TOKEN:?Create a client in Settings > MCP and export AJOUR_MCP_TOKEN}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
config_home="$(mktemp -d)"
trap 'rm -rf "$work" "$config_home"' EXIT
profile="${TMPDIR:-/tmp}/ajour-smoke-profile"
pw_cli="$(node -p "require.resolve('@playwright/mcp/cli.js', { paths: ['$repo/apps/api'] })")"
prompt_json="$(node -p "JSON.stringify(require('fs').readFileSync('$here/smoke-prompt.md', 'utf8'))")"

cd "$work"
XDG_CONFIG_HOME="$config_home" \
OPENCODE_DISABLE_PROJECT_CONFIG=1 \
OPENCODE_DISABLE_EXTERNAL_SKILLS=1 \
OPENCODE_DISABLE_CLAUDE_CODE=1 \
OPENCODE_CONFIG_CONTENT="{
  \"agent\": { \"ajour\": { \"prompt\": $prompt_json } },
  \"permission\": { \"*\": \"deny\", \"ajour_*\": \"allow\", \"playwright_*\": \"allow\" },
  \"mcp\": {
    \"ajour\": { \"type\": \"remote\", \"url\": \"http://127.0.0.1:8787/mcp/ajour\", \"oauth\": false,
      \"headers\": { \"Authorization\": \"Bearer {env:AJOUR_MCP_TOKEN}\" } },
    \"playwright\": { \"type\": \"local\",
      \"command\": [\"node\", \"$pw_cli\", \"--browser\", \"chrome\", \"--user-data-dir\", \"$profile\"] }
  }
}" \
opencode run "Do the task in your instructions now." --agent ajour --pure --format json \
  | tee "$here/opencode.out.jsonl"
echo "exit code: ${PIPESTATUS[0]}"
```

- [ ] **Step 5: Write the README with the checklist**

`qa/agents/README.md`:

````markdown
# Agent CLI smoke tests

These scripts check, against a running Ajour, that each CLI can run clean for the agent runner. Run them by hand. They do not run in CI.

## Setup

1. Start Ajour from this branch (`just desktop-start`) and turn on Settings > MCP.
2. Add a client named "Smoke test" and export its token: `export AJOUR_MCP_TOKEN=ajour_...`.
3. `just install`, so `@playwright/mcp` is in `apps/api/node_modules`.

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
````

- [ ] **Step 6: Git-ignore the outputs and make the scripts executable**

Append to `.gitignore`:

```
qa/agents/*.out.jsonl
```

Run: `chmod +x qa/agents/*.sh`

- [ ] **Step 7: Add a results section to the spec**

Append to `docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md`:

```markdown
## Smoke test results

Not run yet. See `qa/agents/README.md`.
```

- [ ] **Step 8: Commit**

```bash
git add qa/agents .gitignore docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md
git commit -m "test(agents): add smoke tests for the agent CLIs"
```

- [ ] **Step 9: Human gate**

Stop and ask Alex to run `qa/agents/README.md` with Claude Code at least, and to record the results in the spec. Task 8 reads them. Tasks 2 to 7 do not depend on the results and may proceed meanwhile. Do not start Task 8 until the Claude Code results are recorded.

---

### Task 2: `agentTask` in plugin manifests (shared and API)

**Files:**

- Modify: `packages/shared/connectors.ts:127-171` (capabilities and manifest schemas), `:196-206` (overview plugin schema)
- Modify: `packages/shared/plugin-catalog.ts:15` (catalog capability enum)
- Create: `packages/shared/agent-task-templates.ts`
- Modify: `packages/shared/package.json` (export the new entry point if the package lists entry points)
- Modify: `apps/api/src/plugin-package.ts:32-36,180-247`
- Modify: `apps/api/src/plugin-host.ts:320-335` and add `readAgentTaskPrompt`
- Modify: `apps/api/src/storage.ts:625-631` (enabled check)
- Modify: `apps/api/src/connection-values.ts:26`
- Test: `packages/shared/tests/agent-task-templates.test.ts`, `packages/shared/tests/connectors.test.ts` (create if absent), `apps/api/src/plugin-host.test.ts`

**Interfaces:**

- Produces:
  - `agentTaskSchema`, `type AgentTask` and `pluginHasAgentTasks(manifest): boolean` from `@ajour/shared` (connectors.ts).
  - `AGENT_TASK_SLOTS`, `listTemplateSlots(template: string): string[]`, `fillTemplate(template: string, values: Record<string, string>): string`, `class UnknownSlotError extends Error` from `packages/shared/agent-task-templates.ts`.
  - `ResolvedConnectorPlugin.entrypointPath?: string` (optional now).
  - `ConnectorPluginManager.readAgentTaskPrompt(pluginId: string, taskId: string): Promise<string>`.
  - Manifest: `entrypoint?: string`, `connectionFields: ConnectorField[]` (defaults to `[]`).

- [ ] **Step 1: Write the template tests**

`packages/shared/tests/agent-task-templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  fillTemplate,
  listTemplateSlots,
  UnknownSlotError,
} from "../agent-task-templates.ts";

describe("agent task templates", () => {
  it("lists each slot once, in order", () => {
    expect(
      listTemplateSlots("{{weekOf}} {{settings.timesheetUrl}} {{weekOf}}"),
    ).toEqual(["weekOf", "settings.timesheetUrl"]);
  });

  it("fills known slots and leaves other braces alone", () => {
    expect(
      fillTemplate("Week {{weekOf}} at {{settings.url}} {not a slot}", {
        weekOf: "2026-10-12",
        "settings.url": "https://wd.example/t",
      }),
    ).toBe("Week 2026-10-12 at https://wd.example/t {not a slot}");
  });

  it("refuses a slot it has no value for", () => {
    expect(() => fillTemplate("{{settings.missing}}", {})).toThrow(
      UnknownSlotError,
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @ajour/shared exec vitest run tests/agent-task-templates.test.ts`
Expected: FAIL, cannot find `../agent-task-templates.ts`.

- [ ] **Step 3: Write the template module**

`packages/shared/agent-task-templates.ts`:

```ts
/**
 * Slots in agent task prompts and week links: `{{weekOf}}`, `{{sessionId}}`
 * and `{{settings.<id>}}`. Ajour fills them; a slot it has no value for is
 * an error, never a blank.
 */

const SLOT_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/g;

/** The slots every task may use. Settings slots depend on the task. */
export const AGENT_TASK_SLOTS = ["weekOf", "sessionId"] as const;

export class UnknownSlotError extends Error {
  readonly slot: string;

  constructor(slot: string) {
    super(`The template uses {{${slot}}}, which Ajour does not fill.`);
    this.name = "UnknownSlotError";
    this.slot = slot;
  }
}

/** Each slot name once, in the order it first appears. */
export function listTemplateSlots(template: string): string[] {
  return [...new Set([...template.matchAll(SLOT_PATTERN)].map((m) => m[1]!))];
}

/** Replaces every slot. Throws UnknownSlotError for a slot without a value. */
export function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(SLOT_PATTERN, (_match, slot: string) => {
    const value = values[slot];
    if (value === undefined) throw new UnknownSlotError(slot);
    return value;
  });
}

/** The slots a task may use: the fixed ones and one per settings field. */
export function allowedTaskSlots(settingIds: readonly string[]): Set<string> {
  return new Set([
    ...AGENT_TASK_SLOTS,
    ...settingIds.map((id) => `settings.${id}`),
  ]);
}
```

Check how `packages/shared/package.json` exposes entry points (`exports` map or root files). If it lists them, add `"./agent-task-templates": "./agent-task-templates.ts"` the same way `./agent-tools` is listed.

- [ ] **Step 4: Run the template tests**

Run: `pnpm --filter @ajour/shared exec vitest run tests/agent-task-templates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the manifest schema tests**

Add to `packages/shared/tests/connectors.test.ts` (create the file with these imports if it does not exist):

```ts
import { describe, expect, it } from "vitest";
import { connectorPluginManifestSchema } from "../connectors.ts";

const base = {
  id: "ajp-workday",
  version: "1.0.0",
  apiVersion: 3,
  displayName: "Workday",
  iconSvg: "<svg/>",
};
const task = {
  id: "enter-week",
  label: "Enter in Workday",
  placement: "submit-week",
  prompt: "prompts/enter-week.md",
  estimateMinutes: 10,
  weekLink: "{{settings.timesheetUrl}}?date={{weekOf}}",
  settings: [
    {
      id: "timesheetUrl",
      label: "Workday timesheet URL",
      type: "url",
      required: true,
    },
  ],
};

describe("plugin manifest capabilities", () => {
  it("accepts a plugin with only agent tasks, without entrypoint or connection fields", () => {
    const manifest = connectorPluginManifestSchema.parse({
      ...base,
      capabilities: { agentTask: { tasks: [task] } },
    });
    expect(manifest.entrypoint).toBeUndefined();
    expect(manifest.connectionFields).toEqual([]);
  });

  it("still requires an entrypoint and connection fields for a connector", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...base,
        capabilities: { connector: {} },
      }),
    ).toThrow(/entrypoint/);
  });

  it("refuses a week link or prompt slot that is not known", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...base,
        capabilities: {
          agentTask: { tasks: [{ ...task, weekLink: "{{settings.nope}}" }] },
        },
      }),
    ).toThrow(/settings.nope/);
  });

  it("refuses a plugin with no capability", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({ ...base, capabilities: {} }),
    ).toThrow();
  });
});
```

Use the real `CONNECTOR_PLUGIN_API_VERSION` value for `apiVersion` if the schema checks it: read it from `connectors.ts` and replace `3`.

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm --filter @ajour/shared exec vitest run tests/connectors.test.ts`
Expected: FAIL on the first test (`agentTask` unknown, `entrypoint` required).

- [ ] **Step 7: Change the schemas**

In `packages/shared/connectors.ts`, add above `connectorPluginCapabilitiesSchema`:

```ts
/**
 * A task an agent runs for the plugin, from a prompt file. No plugin code
 * runs. See docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md.
 */
export const agentTaskSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    label: z.string().trim().min(1).max(60),
    /** Where Ajour shows the task's button. */
    placement: z.literal("submit-week"),
    /** A Markdown file inside the plugin folder, at most 64 KB. */
    prompt: z.string().trim().min(1).max(240),
    estimateMinutes: z.number().int().min(1).max(240),
    /** URL template for the week in the external tool. Must give https. */
    weekLink: z.string().trim().min(1).max(500).optional(),
    settings: z.array(connectorFieldSchema).max(20).default([]),
  })
  .superRefine((task, context) => {
    if (!task.weekLink) return;
    const allowed = allowedTaskSlots(task.settings.map((field) => field.id));
    for (const slot of listTemplateSlots(task.weekLink)) {
      if (!allowed.has(slot)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["weekLink"],
          message: `The week link uses {{${slot}}}, which Ajour does not fill.`,
        });
      }
    }
  });
export type AgentTask = z.infer<typeof agentTaskSchema>;
```

with `import { allowedTaskSlots, listTemplateSlots } from "./agent-task-templates.ts";` at the top (match the file's existing relative import style).

Replace `connectorPluginCapabilitiesSchema` with:

```ts
export const connectorPluginCapabilitiesSchema = z
  .object({
    connector: z
      .object({
        settle: z.boolean().optional(),
      })
      .optional(),
    codeHost: z.object({}).optional(),
    agentTask: z
      .object({ tasks: z.array(agentTaskSchema).min(1).max(10) })
      .optional(),
  })
  .refine(
    (capabilities) =>
      capabilities.connector !== undefined ||
      capabilities.codeHost !== undefined ||
      capabilities.agentTask !== undefined,
    "A plugin must declare at least one capability: connector, codeHost or agentTask.",
  );
```

Add next to `pluginHasCodeHost`:

```ts
export function pluginHasAgentTasks(manifest: {
  capabilities: ConnectorPluginCapabilities;
}) {
  return manifest.capabilities.agentTask !== undefined;
}

/** Whether the plugin runs code: it syncs items or serves pull requests. */
export function pluginRunsCode(manifest: {
  capabilities: ConnectorPluginCapabilities;
}) {
  return pluginHasConnector(manifest) || pluginHasCodeHost(manifest);
}
```

Change the manifest schema's two fields and add the rule:

```ts
export const connectorPluginManifestSchema = z
  .object({
    id: connectorPluginIdSchema,
    version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    apiVersion: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    iconSvg: z.string().min(1).max(20000),
    /** Absent for a plugin that only declares agent tasks: it runs no code. */
    entrypoint: z.string().trim().min(1).max(240).optional(),
    connectionFields: z.array(connectorFieldSchema).max(50).default([]),
    capabilities: connectorPluginCapabilitiesSchema,
  })
  .superRefine((manifest, context) => {
    const runsCode =
      manifest.capabilities.connector !== undefined ||
      manifest.capabilities.codeHost !== undefined;
    if (runsCode && !manifest.entrypoint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entrypoint"],
        message: "A connector or code host plugin needs an entrypoint.",
      });
    }
    if (runsCode && manifest.connectionFields.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connectionFields"],
        message: "A connector or code host plugin needs connection fields.",
      });
    }
  });
```

`connectorPluginManifestSchema` is now a `ZodEffects`, so `.extend` no longer exists on it. Change the overview schema at `:204` to build from the inner object. Extract the object first:

```ts
const connectorPluginManifestObjectSchema = z.object({/* the fields above */});
export const connectorPluginManifestSchema =
  connectorPluginManifestObjectSchema.superRefine(/* the rule above */);
```

and:

```ts
/**
 * A plugin as the overview reports it. Saved connections can outlive their
 * plugin (uninstalled, or rejected for another plugin API version), so the
 * API fills the gap with a placeholder, and `unavailableReason` tells the
 * user why. An unavailable plugin is the one with `unavailableReason`; an
 * absent entrypoint only means the plugin runs no code.
 */
const connectorOverviewPluginSchema =
  connectorPluginManifestObjectSchema.extend({
    entrypoint: z.string().trim().max(240).optional(),
    unavailableReason: z.string().max(1000).optional(),
  });
```

In `packages/shared/plugin-catalog.ts:15`, add `"agentTask"` to `pluginCatalogCapabilitySchema`.

- [ ] **Step 8: Run the shared tests**

Run: `pnpm --filter @ajour/shared exec vitest run`
Expected: PASS.

- [ ] **Step 9: Write the API tests for an agent-task plugin**

In `apps/api/src/plugin-host.test.ts`, find the helper that writes a development plugin folder (search for `plugin.json` writes) and add a test that writes:

- `plugin.json` with `{ id: "ajp-test", version: "1.0.0", apiVersion: CONNECTOR_PLUGIN_API_VERSION, displayName: "Test tasks", iconSvg: "<svg/>", capabilities: { agentTask: { tasks: [{ id: "enter-week", label: "Enter", placement: "submit-week", prompt: "prompts/enter-week.md", estimateMinutes: 5, settings: [{ id: "url", label: "URL", type: "url", required: true }] }] } } }` and no `entrypoint`;
- `prompts/enter-week.md` with `Enter week {{weekOf}} at {{settings.url}} in session {{sessionId}}.`

Tests:

```ts
it("loads a plugin that only declares agent tasks and reads its prompt", async () => {
  const manager = createManagerWithDevelopmentPlugin(agentTaskPluginFiles());
  const plugins = await manager.listPlugins();
  expect(plugins.map((plugin) => plugin.id)).toContain("ajp-test");
  await expect(
    manager.readAgentTaskPrompt("ajp-test", "enter-week"),
  ).resolves.toBe(
    "Enter week {{weekOf}} at {{settings.url}} in session {{sessionId}}.",
  );
});

it("marks an agent task plugin unavailable when its prompt uses an unknown slot", async () => {
  const manager = createManagerWithDevelopmentPlugin(
    agentTaskPluginFiles({ prompt: "Hi {{settings.nope}}" }),
  );
  const { plugins, unavailable } = await manager.inspectPlugins();
  expect(plugins.map((plugin) => plugin.id)).not.toContain("ajp-test");
  expect(JSON.stringify(unavailable)).toContain("settings.nope");
});

it("refuses a prompt over 64 KB", async () => {
  const manager = createManagerWithDevelopmentPlugin(
    agentTaskPluginFiles({ prompt: "x".repeat(65_537) }),
  );
  const { plugins } = await manager.inspectPlugins();
  expect(plugins.map((plugin) => plugin.id)).not.toContain("ajp-test");
});

it("refuses to run code for a plugin without an entrypoint", async () => {
  const manager = createManagerWithDevelopmentPlugin(agentTaskPluginFiles());
  await expect(
    manager.validateConnection("ajp-test", {} as never),
  ).rejects.toThrow(/does not sync backlog items|runs no code/);
});
```

Write `agentTaskPluginFiles(overrides?: { prompt?: string })` and `createManagerWithDevelopmentPlugin(files)` next to the existing helpers, reusing how the file already builds a temp plugin folder and a `ConnectorPluginManager` with `allowDevelopmentPlugins: true`. If invalid plugins surface in `unavailable` only for API-version mismatches, adapt the second test to assert the plugin is absent from `plugins`, and assert the reason through whatever error log or list discovery uses.

- [ ] **Step 10: Run them to see them fail**

Run: `pnpm --filter @ajour/api exec vitest run src/plugin-host.test.ts`
Expected: FAIL (`readAgentTaskPrompt` missing, entrypoint required).

- [ ] **Step 11: Change plugin reading**

In `apps/api/src/plugin-package.ts`:

1. `ResolvedConnectorPlugin` becomes `{ manifest; directory; /** Absent for a plugin that runs no code. */ entrypointPath?: string; source }`.
2. Add after `assertRegularPluginFile`:

```ts
/** The largest agent task prompt Ajour reads, in bytes. */
export const MAX_AGENT_TASK_PROMPT_BYTES = 64 * 1024;

/**
 * Resolves an agent task's prompt file like an entrypoint: relative, inside
 * the plugin folder, a regular file, no symbolic links, and at most 64 KB.
 */
export async function readAgentTaskPromptFile(
  directory: string,
  canonicalDirectory: string,
  manifest: ConnectorPluginManifest,
  task: AgentTask,
): Promise<string> {
  if (path.isAbsolute(task.prompt)) {
    throw new Error(
      `Plugin "${manifest.id}" task "${task.id}" prompt must be relative.`,
    );
  }
  const promptPath = path.resolve(directory, task.prompt);
  if (!isPathInside(directory, promptPath)) {
    throw new Error(
      `Plugin "${manifest.id}" task "${task.id}" prompt leaves its plugin directory.`,
    );
  }
  await assertRegularPluginFile(
    directory,
    canonicalDirectory,
    promptPath,
    `Plugin "${manifest.id}" task "${task.id}" prompt`,
  );
  const { size } = await stat(promptPath);
  if (size > MAX_AGENT_TASK_PROMPT_BYTES) {
    throw new Error(
      `Plugin "${manifest.id}" task "${task.id}" prompt is over 64 KB.`,
    );
  }
  const prompt = await readFile(promptPath, "utf8");
  const allowed = allowedTaskSlots(task.settings.map((field) => field.id));
  for (const slot of listTemplateSlots(prompt)) {
    if (!allowed.has(slot)) {
      throw new Error(
        `Plugin "${manifest.id}" task "${task.id}" prompt uses {{${slot}}}, which Ajour does not fill.`,
      );
    }
  }
  return prompt;
}
```

Import `stat` and `readFile` from `node:fs/promises` (merge with the existing import), `AgentTask` from connectors, and `allowedTaskSlots`, `listTemplateSlots` from `../../../packages/shared/agent-task-templates.ts`.

3. In `readConnectorPlugin`, resolve the entrypoint only when the manifest has one, and read every task prompt once to validate it:

```ts
let entrypointPath: string | undefined;
if (manifest.entrypoint) {
  entrypointPath = resolveConnectorPluginEntrypoint(directory, manifest);
  await assertRegularPluginFile(
    directory,
    canonicalPluginDirectory,
    entrypointPath,
    `Connector plugin "${manifest.id}" entrypoint`,
  );
}
for (const task of manifest.capabilities.agentTask?.tasks ?? []) {
  await readAgentTaskPromptFile(
    directory,
    canonicalPluginDirectory,
    manifest,
    task,
  );
}
```

`resolveConnectorPluginEntrypoint` reads `manifest.entrypoint!` now; add a guard at its top: `if (!manifest.entrypoint) throw new Error(\`Plugin "${manifest.id}" runs no code.\`);`.

- [ ] **Step 12: Guard code runs and add the prompt reader**

In `apps/api/src/plugin-host.ts` `invokePlugin` (`:330`):

```ts
if (!plugin.entrypointPath) {
  throw new Error(`Plugin "${pluginId}" runs no code.`);
}
```

before building `workerData`, and use `plugin.entrypointPath` after the guard.

Add a public method after `hasCapability`:

```ts
/** An agent task's prompt, read fresh from the plugin folder. */
async readAgentTaskPrompt(pluginId: string, taskId: string): Promise<string> {
  this.assertRunning();
  const plugin = await this.getPlugin(pluginId);
  const task = plugin.manifest.capabilities.agentTask?.tasks.find(
    (candidate) => candidate.id === taskId,
  );
  if (!task) {
    throw new Error(`Plugin "${pluginId}" has no agent task "${taskId}".`);
  }
  return await readAgentTaskPromptFile(
    plugin.directory,
    await realpath(plugin.directory),
    plugin.manifest,
    task,
  );
}
```

Import `realpath` from `node:fs/promises` and `readAgentTaskPromptFile` from `./plugin-package.ts`.

- [ ] **Step 13: Make availability independent of the entrypoint**

`apps/api/src/storage.ts:625-631`, the `enabled` of each connection group becomes:

```ts
enabled:
  state.pluginsEnabled &&
  plugin.unavailableReason === undefined &&
  !state.disabledPluginIds.includes(plugin.id),
```

`:606` keeps setting `unavailableReason`; drop the `entrypoint: ""` there (the field is optional). `createMissingPluginManifest` keeps its `unavailableReason` and can drop `entrypoint: ""`.

`apps/api/src/connection-values.ts:26` and `storage.ts:293` read `plugin.connectionFields`, which is now `[]` by default: no change needed. Run `pnpm --filter @ajour/api exec tsc --noEmit -p .` and fix any remaining `entrypoint` type error the same way: an absent entrypoint means "runs no code", `unavailableReason` means "unavailable".

- [ ] **Step 14: Run the API tests and typecheck**

Run: `pnpm --filter @ajour/api exec vitest run && just typecheck`
Expected: API tests PASS. Typecheck may fail in `apps/web` on `entrypoint.length`: Task 3 fixes those. If it fails only there, continue.

- [ ] **Step 15: Commit**

```bash
git add packages/shared apps/api/src
git commit -m "feat(plugins): declare agent tasks in plugin manifests"
```

---

### Task 3: Agent-task plugins in the web app

**Files:**

- Modify: `apps/web/src/features/settings/settings-connectors-page.tsx:215,619,681-924`
- Modify: `apps/web/src/domain/pull-requests/pull-request-lifecycle.ts:51-55`
- Modify: `apps/web/src/features/settings/plugin-settings-workflow.ts:92-120`
- Modify: `apps/web/src/features/settings/plugin-catalog-ui.tsx:22,36-40`
- Test: `apps/web/src/features/settings/plugin-settings-workflow.test.ts` (existing; add cases)

**Interfaces:**

- Consumes: `pluginRunsCode`, `pluginHasAgentTasks`, optional `entrypoint`, `unavailableReason` from Task 2.
- Produces: an agent-task plugin listed on Settings > Plugins with its activation toggle and a "Tasks" section, without a connection form.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/features/settings/plugin-settings-workflow.test.ts`, add (adapt to the file's existing fixtures for an overview group):

```ts
it("lists an agent task plugin with the agentTask capability", () => {
  const entries = reconcileForTest({
    connectionGroups: [
      {
        plugin: {
          id: "ajp-workday",
          version: "1.0.0",
          apiVersion: 3,
          displayName: "Workday",
          iconSvg: "<svg/>",
          connectionFields: [],
          capabilities: {
            agentTask: {
              tasks: [
                {
                  id: "enter-week",
                  label: "Enter in Workday",
                  placement: "submit-week",
                  prompt: "prompts/enter-week.md",
                  estimateMinutes: 10,
                  settings: [],
                },
              ],
            },
          },
        },
        enabled: true,
        connections: [],
      },
    ],
  });
  expect(entries[0]!.catalog.capabilities).toEqual(["agentTask"]);
  expect(entries[0]!.catalog.features).toEqual(["agent-task"]);
});
```

`reconcileForTest` stands for however the existing tests reach `reconcileEntries` (it may be exported for tests, or reached through the workflow's snapshot). Use the existing route.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @ajour/web exec vitest run src/features/settings/plugin-settings-workflow.test.ts`
Expected: FAIL, capabilities is `[]`.

- [ ] **Step 3: Add the capability to the local catalog entry**

In `plugin-settings-workflow.ts` `localCatalogEntry`, the capability list becomes:

```ts
const capabilities: PluginCatalogCapability[] =
  "projectDataShape" in plugin.capabilities
    ? ["schema"]
    : [
        ...(plugin.capabilities.connector ? (["connector"] as const) : []),
        ...(plugin.capabilities.codeHost ? (["codeHost"] as const) : []),
        ...(plugin.capabilities.agentTask ? (["agentTask"] as const) : []),
      ];
const features = capabilities.map((capability) =>
  capability === "connector"
    ? "work-item-sync"
    : capability === "codeHost"
      ? "pull-requests"
      : capability === "agentTask"
        ? "agent-task"
        : "project-data-shape",
);
```

and the `tags` mapping adds `capability === "agentTask" ? "agent-task"` in the same chain.

In `plugin-catalog-ui.tsx`, add `agentTask` to `capabilityLabels` (`"Agent tasks"`) and `capabilityFlows` (`"Runs a coding agent for a task, from a prompt. Runs no plugin code."`), matching the shape of the existing entries. The `Record` types make TypeScript list the spots.

- [ ] **Step 4: Replace the empty-entrypoint checks**

- `settings-connectors-page.tsx:215` and `:619`: replace `plugin.entrypoint.length === 0` with `plugin.unavailableReason !== undefined`.
- `pull-request-lifecycle.ts:51-55`: replace `group.plugin.entrypoint.length > 0` with `group.plugin.unavailableReason === undefined`.

- [ ] **Step 5: Show tasks instead of a connection form**

In `renderConnectorDetail`, wrap the Configuration section (`:681` to its closing `</section>` at `:924`) so it renders only when `pluginRunsCode(group.plugin)`. Otherwise render:

```tsx
<section className="settings-section">
  <h2 className="settings-section-title">Tasks</h2>
  <p className="settings-section-desc">
    An agent runs these tasks from a prompt. Pick the agent and fill in each
    task's settings in{" "}
    <Link to="/settings/agents" className="underline">
      Settings &gt; Agents
    </Link>
    .
  </p>
  <AppPanel>
    {group.plugin.capabilities.agentTask?.tasks.map((task) => (
      <SettingRow key={task.id} label={task.label} />
    ))}
  </AppPanel>
</section>
```

Import `pluginRunsCode` from `@ajour/shared`, `Link` from `@tanstack/react-router` and `AppPanel`, `SettingRow` from `@/components/app-surface` if the file does not already. The route `/settings/agents` arrives in Task 10; TanStack's typed `to` will fail typecheck until then. If that blocks this commit, use `to={"/settings/agents" as never}` with a comment `// Route added with Settings > Agents.` and remove the cast in Task 10.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @ajour/web exec vitest run src/features/settings && just typecheck`
Expected: PASS, no `entrypoint` errors left.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(plugins): show agent task plugins without a connection form"
```

---

### Task 4: `mark_entries_not_submitted`

**Files:**

- Modify: `apps/web/src/domain/time/timesheet-entry.ts` (after `markTimesheetEntriesSubmitted`, about `:384`)
- Modify: `apps/web/src/lib/local-store.ts:84,1710`
- Modify: `packages/shared/agent-tools.ts` (write input and output schemas)
- Modify: `apps/web/src/features/agents/agent-write-tools.ts:181,416-437`
- Modify: `apps/api/src/mcp-server.ts` (`TOOL_DESCRIPTIONS`)
- Test: `apps/web/src/domain/time/timesheet-entry.test.ts`, `apps/web/src/features/agents/agent-tool-runner.test.ts`

**Interfaces:**

- Produces: `markTimesheetEntriesNotSubmitted(state, entryIds): LocalAppState` (domain), `localStore.markTimesheetEntriesNotSubmitted(entryIds: string[])`, MCP tool `mark_entries_not_submitted` with input `{ entryIds: string[] }` (1 to 500) and output `{ unmarked: number }`.

- [ ] **Step 1: Write the domain test**

In `apps/web/src/domain/time/timesheet-entry.test.ts`, add (reuse the file's state and entry builders):

```ts
describe("markTimesheetEntriesNotSubmitted", () => {
  it("returns submitted entries to saved and keeps their old submission time", () => {
    const state = stateWithEntries([
      entry({ _id: "a", submittedAt: 100, submittedFingerprint: "f" }),
      entry({ _id: "b" }),
    ]);
    const next = markTimesheetEntriesNotSubmitted(state, ["a", "b"]);
    expect(
      next.timesheetEntries.find((item) => item._id === "a"),
    ).toMatchObject({
      submittedAt: undefined,
      submittedFingerprint: undefined,
      previousSubmittedAt: 100,
    });
    expect(next.timesheetEntries.find((item) => item._id === "b")).toEqual(
      state.timesheetEntries.find((item) => item._id === "b"),
    );
  });

  it("returns the same state when nothing was submitted", () => {
    const state = stateWithEntries([entry({ _id: "b" })]);
    expect(markTimesheetEntriesNotSubmitted(state, ["b"])).toBe(state);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @ajour/web exec vitest run src/domain/time/timesheet-entry.test.ts`
Expected: FAIL, `markTimesheetEntriesNotSubmitted` is not exported.

- [ ] **Step 3: Write the transition**

In `timesheet-entry.ts`, after `markTimesheetEntriesSubmitted`:

```ts
/**
 * Returns submitted entries to saved, for example when an agent could not
 * enter them in the external timesheet. Keeps the old submission time in
 * `previousSubmittedAt`, as an edit does. Saved entries are left alone.
 */
export function markTimesheetEntriesNotSubmitted(
  state: LocalAppState,
  entryIds: string[],
): LocalAppState {
  const selectedIds = new Set(entryIds);
  let changed = false;
  const timesheetEntries = state.timesheetEntries.map((entry) => {
    if (!selectedIds.has(entry._id) || entry.submittedAt === undefined) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      submittedAt: undefined,
      submittedFingerprint: undefined,
      previousSubmittedAt: entry.submittedAt,
    };
  });
  return changed ? { ...state, timesheetEntries } : state;
}
```

- [ ] **Step 4: Run the domain test**

Run: `pnpm --filter @ajour/web exec vitest run src/domain/time/timesheet-entry.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the store method and the tool contract**

`local-store.ts`: import `markTimesheetEntriesNotSubmitted as applyMarkTimesheetEntriesNotSubmitted` next to `:84`, and after `markTimesheetEntriesSubmitted`:

```ts
/** Returns entries to saved. See `markTimesheetEntriesNotSubmitted`. */
markTimesheetEntriesNotSubmitted(entryIds: string[]) {
  if (entryIds.length === 0) return;
  updateState((state) =>
    applyMarkTimesheetEntriesNotSubmitted(state, entryIds),
  );
},
```

`packages/shared/agent-tools.ts`: in `writeToolInputSchemas` after `mark_entries_submitted`:

```ts
mark_entries_not_submitted: z.object({
  entryIds: z.array(z.string()).min(1).max(500),
}),
```

and in `dataToolOutputSchemas`:

```ts
mark_entries_not_submitted: z.object({ unmarked: z.number() }),
```

`apps/api/src/mcp-server.ts` `TOOL_DESCRIPTIONS`, after `mark_entries_submitted`:

```ts
mark_entries_not_submitted:
  "Returns entries to saved, for lines that failed in the external timesheet. Undo the marks you made for a line you could not enter.",
```

- [ ] **Step 6: Write the runner test**

In `agent-tool-runner.test.ts`, in the entry tools `describe`:

```ts
it("marks entries as not submitted, with Undo", async () => {
  const { call, localStore, project, task } = await setup();
  localStore.saveManualTimeEntry({
    localDate: "2026-10-13",
    projectId: project._id,
    taskId: task("Build")._id,
    durationMs: 30 * 60_000,
  });
  const entryId = localStore.snapshot().timesheetEntries[0]!._id;
  await call("mark_entries_submitted", { entryIds: [entryId] });

  expect(
    await call("mark_entries_not_submitted", { entryIds: [entryId] }),
  ).toMatchObject({ ok: true, output: { unmarked: 1 } });
  expect(
    localStore.snapshot().timesheetEntries[0]!.submittedAt,
  ).toBeUndefined();
  expect(offerUndo.mock.calls.at(-1)![1].title).toBe(
    "Claude Code: Marked 1 entry as not submitted",
  );
});

it("refuses to unmark the running entry", async () => {
  const { call, localStore, project } = await setup();
  await call("start_timer", { projectId: project._id });
  await call("stop_timer");
  await call("mark_entries_submitted", {
    entryIds: [localStore.snapshot().timesheetEntries[0]!._id],
  });
  const entryId = localStore.snapshot().timesheetEntries[0]!._id;
  localStore.continueTimesheetEntry(entryId);

  expect(
    await call("mark_entries_not_submitted", { entryIds: [entryId] }),
  ).toMatchObject({ ok: false, error: "Stop the running entry first" });
});
```

If `continueTimesheetEntry` does not make that entry the running one in this setup, build a running entry the way the file's existing "running" tests do.

- [ ] **Step 7: Run it to see it fail**

Run: `pnpm --filter @ajour/web exec vitest run src/features/agents/agent-tool-runner.test.ts`
Expected: FAIL, the tool is not handled.

- [ ] **Step 8: Add the tool case**

`agent-write-tools.ts`: add `"mark_entries_not_submitted"` to `ENTRY_WRITE_TOOLS`, and a case after `mark_entries_submitted`:

```ts
case "mark_entries_not_submitted": {
  const input =
    writeToolInputSchemas.mark_entries_not_submitted.parse(rawInput);
  for (const entryId of input.entryIds) {
    const entry = requireEntry(state, entryId);
    if (isEntryRunning(state, entry)) {
      throw new AgentToolRefusal("Stop the running entry first");
    }
  }
  const { undoToken } = localStore.runWithUndo(() =>
    localStore.markTimesheetEntriesNotSubmitted(input.entryIds),
  );
  const count = input.entryIds.length;
  const noun = count === 1 ? "entry" : "entries";
  return {
    output: { unmarked: count },
    undoToken,
    action: `Marked ${count} ${noun} as not submitted`,
    objectId: input.entryIds[0]!,
    objectTitle: `${count} ${noun}`,
    undoSubject: "entry",
  };
}
```

- [ ] **Step 9: Run tests and typecheck**

Run: `pnpm --filter @ajour/web exec vitest run src/features/agents src/domain/time && pnpm --filter @ajour/api exec vitest run src/mcp-server.test.ts && just typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/shared apps/web/src apps/api/src
git commit -m "feat(mcp): let agents mark entries as not submitted"
```

---

### Task 5: Line IDs and project codes in `get_submit_lines`

**Files:**

- Create: `apps/web/src/domain/agents/submit-line-id.ts`
- Modify: `apps/web/src/domain/agents/agent-read-model.ts:249-297` (`getSubmitLinesForAgent`)
- Modify: `apps/web/src/domain/time/timesheet-submission.ts:34` (add `projectCode` to `SubmitLine` where the line is built from its project)
- Modify: `packages/shared/agent-tools.ts:325-347` (output schema)
- Test: `apps/web/src/domain/agents/submit-line-id.test.ts`, `apps/web/src/domain/agents/agent-read-model.test.ts`

**Interfaces:**

- Produces: `submitLineId(entryIds: readonly string[]): string` returning `ajour:` plus 8 hex characters; lines in `get_submit_lines` gain `lineId: string` and `projectCode?: string`.

- [ ] **Step 1: Write the ID tests**

`apps/web/src/domain/agents/submit-line-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { submitLineId } from "@/domain/agents/submit-line-id";

describe("submitLineId", () => {
  it("is stable for the same entries in any order", () => {
    expect(submitLineId(["b", "a"])).toBe(submitLineId(["a", "b"]));
  });

  it("changes when the line gains an entry", () => {
    expect(submitLineId(["a", "b", "c"])).not.toBe(submitLineId(["a", "b"]));
  });

  it("reads ajour: and 8 hex characters", () => {
    expect(submitLineId(["a"])).toMatch(/^ajour:[0-9a-f]{8}$/);
  });

  it("matches a known FNV-1a value", () => {
    // FNV-1a 32-bit of "a" is 0xe40c292c.
    expect(submitLineId(["a"])).toBe("ajour:e40c292c");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @ajour/web exec vitest run src/domain/agents/submit-line-id.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the ID helper**

`apps/web/src/domain/agents/submit-line-id.ts`:

```ts
/**
 * A short stable ID for a Submit line, from its entry IDs. The agent writes
 * it at the end of the external timesheet's comment, so a rerun can tell its
 * own entries from the user's. It only tells lines apart within a week, so a
 * 32-bit FNV-1a hash is enough. Web Crypto's SHA-256 would need an await the
 * read tools cannot make.
 */
export function submitLineId(entryIds: readonly string[]): string {
  const text = [...entryIds].sort().join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ajour:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
```

- [ ] **Step 4: Run the ID tests**

Run: `pnpm --filter @ajour/web exec vitest run src/domain/agents/submit-line-id.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the read model test**

In `agent-read-model.test.ts`, extend the existing `getSubmitLinesForAgent` test (or add one using its state builder, with a project that has `code: "ACME-1"`):

```ts
it("gives each submit line a stable ID and its project code", () => {
  const result = getSubmitLinesForAgent(stateWithCodedProject(), {
    weekDates: WEEK,
    groupBy: "day-task",
    onlyUnsubmitted: true,
    today: WEEK[2]!,
  });
  const line = result.sections[0]!.lines[0]!;
  expect(line.lineId).toBe(submitLineId(line.entryIds));
  expect(line.projectCode).toBe("ACME-1");
});
```

`today` is added in Task 6; until then pass it and let TypeScript complain only if Task 6 lands later. Run Task 5 and Task 6 in order.

- [ ] **Step 6: Add the fields**

`timesheet-submission.ts` `SubmitLine`: add `projectCode?: string`, set from the project where `projectName` is set (`project.code`).

`agent-read-model.ts` line mapping in `getSubmitLinesForAgent`:

```ts
lines: section.lines.map((line) => ({
  lineId: submitLineId(line.entryIds),
  ...(line.projectName ? { projectName: line.projectName } : {}),
  ...(line.projectCode ? { projectCode: line.projectCode } : {}),
  ...(line.taskName ? { taskName: line.taskName } : {}),
  hours: toHours(line.durationMs),
  comments: line.comments,
  entryIds: line.entryIds,
  unsubmittedEntryIds: line.unsubmittedEntryIds,
})),
```

`agent-tools.ts` line schema in `get_submit_lines`:

```ts
z.object({
  /** "ajour:" and 8 hex characters. Stable for the same entries. */
  lineId: z.string(),
  projectName: z.string().optional(),
  projectCode: z.string().optional(),
  taskName: z.string().optional(),
  hours: z.number(),
  comments: z.string(),
  entryIds: z.array(z.string()),
  unsubmittedEntryIds: z.array(z.string()),
}),
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @ajour/web exec vitest run src/domain src/features/agents`
Expected: PASS once Task 6's `today` lands; if running Task 5 alone, temporarily drop `today` from the test call.

- [ ] **Step 8: Commit**

```bash
git add packages/shared apps/web/src
git commit -m "feat(mcp): give submit lines a stable ID and their project code"
```

---

### Task 6: Pace check and its tolerance setting

**Files:**

- Create: `apps/web/src/domain/time/week-pace.ts`
- Modify: `apps/web/src/domain/local-state.ts:204` (`UserPreferences`)
- Modify: `apps/web/src/lib/local-store.ts:452-514` (normalize)
- Modify: `apps/web/src/domain/agents/agent-read-model.ts` (`getSubmitLinesForAgent` gains `today`, `paceTolerancePercent` and returns `pace`)
- Modify: `apps/web/src/features/agents/agent-tool-runner.ts:83` (pass `today` and tolerance)
- Modify: `packages/shared/agent-tools.ts` (`get_submit_lines` output adds `pace`)
- Modify: `apps/web/src/features/settings/settings-general-page.tsx:351-366`
- Modify: `apps/api/src/mcp-server.ts` (`get_submit_lines` description)
- Test: `apps/web/src/domain/time/week-pace.test.ts`

**Interfaces:**

- Produces:
  - `type WeekPaceStatus = "on-pace" | "under" | "over"`
  - `computeWeekPace(input: { weekDates: string[]; today: string; capacityTargets: WeeklyCapacityTargets; loggedMs: number; tolerancePercent: number }): { loggedHours: number; targetHours: number; expectedHours: number; status: WeekPaceStatus }`
  - `DEFAULT_PACE_TOLERANCE_PERCENT = 20`, `getPaceTolerancePercent(preferences: UserPreferences): number`
  - `UserPreferences.paceTolerancePercent?: number`

- [ ] **Step 1: Write the pace tests**

`apps/web/src/domain/time/week-pace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeWeekPace } from "@/domain/time/week-pace";
import type { WeeklyCapacityTargets } from "@/domain/local-state";

const HOUR = 3_600_000;
const WEEK = [
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
];
const TARGETS: WeeklyCapacityTargets = {
  monday: 7.5 * HOUR,
  tuesday: 7.5 * HOUR,
  wednesday: 7.5 * HOUR,
  thursday: 7.5 * HOUR,
  friday: 7.5 * HOUR,
  saturday: 0,
  sunday: 0,
};
const pace = (today: string, loggedHours: number, tolerancePercent = 20) =>
  computeWeekPace({
    weekDates: WEEK,
    today,
    capacityTargets: TARGETS,
    loggedMs: loggedHours * HOUR,
    tolerancePercent,
  });

describe("computeWeekPace", () => {
  it("is on pace at the end of a full week on target", () => {
    expect(pace("2026-10-16", 37.5)).toEqual({
      loggedHours: 37.5,
      targetHours: 37.5,
      expectedHours: 37.5,
      status: "on-pace",
    });
  });

  it("counts today as past, so Wednesday expects three days", () => {
    expect(pace("2026-10-14", 22.5).expectedHours).toBe(22.5);
  });

  it("stays quiet for a front-loaded week within the tolerance", () => {
    // Wednesday expects 22.5 h; 26 h is 15.6% ahead.
    expect(pace("2026-10-14", 26).status).toBe("on-pace");
  });

  it("is over when ahead of pace past the tolerance", () => {
    expect(pace("2026-10-14", 28).status).toBe("over");
  });

  it("is over above the week's target whatever the tolerance", () => {
    expect(pace("2026-10-16", 38, 50).status).toBe("over");
  });

  it("is under when behind pace past the tolerance", () => {
    expect(pace("2026-10-16", 28).status).toBe("under");
  });

  it("expects the whole week on the weekend", () => {
    expect(pace("2026-10-18", 37.5).expectedHours).toBe(37.5);
  });

  it("is on pace for a week with no targets", () => {
    const result = computeWeekPace({
      weekDates: WEEK,
      today: "2026-10-14",
      capacityTargets: {
        ...TARGETS,
        monday: 0,
        tuesday: 0,
        wednesday: 0,
        thursday: 0,
        friday: 0,
      },
      loggedMs: 0,
      tolerancePercent: 20,
    });
    expect(result).toMatchObject({
      targetHours: 0,
      expectedHours: 0,
      status: "on-pace",
    });
  });

  it("expects nothing before the week starts", () => {
    expect(pace("2026-10-11", 0)).toMatchObject({
      expectedHours: 0,
      status: "on-pace",
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @ajour/web exec vitest run src/domain/time/week-pace.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the pace module**

`apps/web/src/domain/time/week-pace.ts`:

```ts
import type {
  UserPreferences,
  WeeklyCapacityTargets,
} from "@/domain/local-state";

/**
 * Whether the week's logged time keeps pace with its capacity targets. The
 * agent asks the user before entering a week that is not on pace, so the
 * arithmetic lives here, in tested code, not in a prompt.
 */

export type WeekPaceStatus = "on-pace" | "under" | "over";

export const DEFAULT_PACE_TOLERANCE_PERCENT = 20;

const HOUR = 3_600_000;
const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const satisfies readonly (keyof WeeklyCapacityTargets)[];

export function getPaceTolerancePercent(preferences: UserPreferences) {
  return preferences.paceTolerancePercent ?? DEFAULT_PACE_TOLERANCE_PERCENT;
}

const toHours = (ms: number) => Math.round((ms / HOUR) * 100) / 100;

/**
 * `weekDates` runs Monday to Sunday. Days up to and including `today` count
 * as past, and only days with a target count as workdays, so the expected
 * hours are the targets of the past days. Over the week's target is always
 * `over`. Otherwise more than `tolerancePercent` away from the expected
 * hours is `over` or `under`.
 */
export function computeWeekPace({
  weekDates,
  today,
  capacityTargets,
  loggedMs,
  tolerancePercent,
}: {
  weekDates: string[];
  today: string;
  capacityTargets: WeeklyCapacityTargets;
  loggedMs: number;
  tolerancePercent: number;
}): {
  loggedHours: number;
  targetHours: number;
  expectedHours: number;
  status: WeekPaceStatus;
} {
  let targetMs = 0;
  let expectedMs = 0;
  weekDates.forEach((date, index) => {
    const dayTarget = capacityTargets[DAY_KEYS[index]!];
    targetMs += dayTarget;
    if (date <= today) expectedMs += dayTarget;
  });
  const tolerance = (expectedMs * tolerancePercent) / 100;
  const status: WeekPaceStatus =
    loggedMs > targetMs && targetMs > 0
      ? "over"
      : loggedMs > expectedMs + tolerance
        ? "over"
        : loggedMs < expectedMs - tolerance
          ? "under"
          : "on-pace";
  return {
    loggedHours: toHours(loggedMs),
    targetHours: toHours(targetMs),
    expectedHours: toHours(expectedMs),
    status,
  };
}
```

Check the week with no targets: `targetMs` and `expectedMs` are 0, `loggedMs` 0, tolerance 0, so `on-pace`. With logged time and no targets, the status is `over`: it is more than nothing expected, which is right.

- [ ] **Step 4: Run the pace tests**

Run: `pnpm --filter @ajour/web exec vitest run src/domain/time/week-pace.test.ts`
Expected: PASS (9 tests). The front-loaded case: tolerance is 22.5 × 0.2 = 4.5, so 26 ≤ 27 stays on pace and 28 is over.

- [ ] **Step 5: Add the preference**

`domain/local-state.ts` `UserPreferences`: add

```ts
/** How far the week may run ahead of or behind its targets before an agent asks. Default 20. */
paceTolerancePercent?: number;
```

`lib/local-store.ts` normalize block (`:452-514`): add, modelled on `normalizeCapacityTarget`:

```ts
paceTolerancePercent:
  typeof persisted.paceTolerancePercent === "number" &&
  Number.isFinite(persisted.paceTolerancePercent)
    ? Math.min(100, Math.max(0, Math.round(persisted.paceTolerancePercent)))
    : undefined,
```

Adapt `persisted` to the local name the block uses for the stored preferences.

- [ ] **Step 6: Return pace from `get_submit_lines`**

`agent-read-model.ts` `getSubmitLinesForAgent` gains two inputs, `today: string` and `paceTolerancePercent: number`, and returns:

```ts
pace: computeWeekPace({
  weekDates,
  today,
  capacityTargets: state.userPreferences.weeklyCapacityTargets,
  loggedMs: weekEntries.reduce((total, entry) => total + entry.durationMs, 0),
  tolerancePercent: paceTolerancePercent,
}),
```

`agent-tool-runner.ts:83` passes `today: todayIsoDate()` (from `@/lib/utils`, where `getIsoWeekDates` lives) and `paceTolerancePercent: getPaceTolerancePercent(state.userPreferences)`.

`agent-tools.ts` `get_submit_lines` output adds:

```ts
/** Ajour's pace check. Ask the user before entering a week that is not on-pace. */
pace: z.object({
  loggedHours: z.number(),
  targetHours: z.number(),
  expectedHours: z.number(),
  status: z.enum(["on-pace", "under", "over"]),
}),
```

`mcp-server.ts` `get_submit_lines` description becomes:

```ts
"The week's timesheet lines as the Submit page groups them, with hours, merged comments, warnings, each line's lineId and project code, and Ajour's pace check. `weekOf` is any date in the week.",
```

- [ ] **Step 7: Add the setting**

`settings-general-page.tsx`, after the "Under-target submit warning" row:

```tsx
<SettingRow
  label="Agent pace tolerance"
  labelFor="pace-tolerance"
  description="How far, in percent, the week may run ahead of or behind its targets before an agent asks you. Going over the week's target always asks."
>
  <Input
    id="pace-tolerance"
    type="number"
    min={0}
    max={100}
    step={5}
    className="w-20"
    value={getPaceTolerancePercent(preferences)}
    onChange={(event) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) {
        localStore.setUserPreferences({
          paceTolerancePercent: Math.min(100, Math.max(0, Math.round(value))),
        });
      }
    }}
  />
</SettingRow>
```

Import `Input` from `@/components/ui/input` and `getPaceTolerancePercent` from `@/domain/time/week-pace` if not imported.

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm --filter @ajour/web exec vitest run src/domain src/features/agents src/features/settings && pnpm --filter @ajour/api exec vitest run && just typecheck`
Expected: PASS. The runner tests parse every output with the output schema, so a missing `pace` fails there.

- [ ] **Step 9: Commit**

```bash
git add packages/shared apps/web/src apps/api/src
git commit -m "feat(mcp): add a pace check to get_submit_lines"
```

---

### Task 7: Runner sessions carry a run ID and a link

**Files:**

- Modify: `packages/shared/agent-tools.ts:405` (`agentSessionSchema`)
- Modify: `apps/api/src/agent-sessions.ts:86-102` (`begin`), add `get`
- Modify: `apps/web/src/features/agents/agent-panel.tsx:36,119-200`
- Modify: `apps/web/src/features/agents/agent-panel-host.tsx`
- Modify: `apps/web/src/lib/app-api.ts` (add `stopAgentRun`)
- Test: `apps/api/src/agent-sessions.test.ts`, `apps/web/src/features/agents/agent-panel.test.tsx` (create if absent, else add)

**Interfaces:**

- Produces:
  - `AgentSession.runId?: string`, `AgentSession.link?: { label: string; url: string }`
  - `AgentSessions.begin(client, input, extra?: { runId?: string; link?: { label: string; url: string } })`
  - `AgentSessions.get(sessionId: string): AgentSession | undefined`
  - `AgentPanelProps.onStop(runId: string): Promise<void>`
  - `stopAgentRun(runId: string): Promise<AgentsSnapshot>` in `app-api.ts`, calling `POST /api/agent-runs/:runId/stop` (route lands in Task 9)

- [ ] **Step 1: Write the API test**

In `agent-sessions.test.ts`:

```ts
it("keeps a run ID and a link on a session the runner begins", () => {
  const { sessions } = createSessions();
  const session = sessions.begin(
    claude,
    { title: "Enter in Workday, week of Oct 12", estimateMinutes: 10 },
    {
      runId: "run-1",
      link: { label: "Open the week in Workday", url: "https://wd.example/t" },
    },
  );
  expect(sessions.get(session.id)).toMatchObject({
    runId: "run-1",
    link: { url: "https://wd.example/t" },
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @ajour/api exec vitest run src/agent-sessions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the fields and `get`**

`agent-tools.ts` `agentSessionSchema`, add:

```ts
/** Set when Ajour's runner started the agent. The panel offers Stop. */
runId: z.string().optional(),
/** One link the panel shows once the session ends. */
link: z.object({ label: z.string(), url: z.string().url() }).optional(),
```

`agent-sessions.ts`:

```ts
begin(
  client: AgentClientRef,
  input: { title: string; estimateMinutes: number },
  extra: Pick<AgentSession, "runId" | "link"> = {},
): AgentSession {
  const now = this.now();
  const session: AgentSession = {
    id: this.createId(),
    client,
    title: input.title,
    state: "active",
    startedAt: now,
    deadlineAt: now + sessionWindowMs(input.estimateMinutes),
    messages: [],
    ...(extra.runId ? { runId: extra.runId } : {}),
    ...(extra.link ? { link: extra.link } : {}),
  };
  this.sessions.set(session.id, session);
  this.pruneSessions();
  this.changed();
  return session;
}

/** A session by ID, open or ended, while Ajour still keeps it. */
get(sessionId: string): AgentSession | undefined {
  return this.sessions.get(sessionId);
}
```

- [ ] **Step 4: Run the API test**

Run: `pnpm --filter @ajour/api exec vitest run src/agent-sessions.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the panel tests**

In `apps/web/src/features/agents/agent-panel.test.tsx` (follow the repo's existing component test setup; if the web app tests no components with a DOM, put these two checks into the acceptance feature in Task 12 instead and skip this step):

```tsx
it("offers Stop, not Dismiss, on an open runner session", async () => {
  const onStop = vi.fn(async () => undefined);
  renderPanel(snapshotWith({ runId: "run-1", state: "stalled" }), { onStop });
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(onStop).toHaveBeenCalledWith("run-1");
  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
});

it("shows the session's link once it ends", () => {
  renderPanel(
    snapshotWith({
      runId: "run-1",
      state: "done",
      link: { label: "Open the week in Workday", url: "https://wd.example/t" },
    }),
  );
  expect(
    screen.getByRole("link", { name: "Open the week in Workday" }),
  ).toHaveAttribute("href", "https://wd.example/t");
});
```

- [ ] **Step 6: Update the panel**

`agent-panel.tsx`:

1. `AgentPanelProps` gains `onStop: (runId: string) => Promise<void>;`. Thread it through `AgentPanelTabs` and `AgentPanel` next to `onDismiss`.
2. Generalize `DismissButton` into one button with a label:

```tsx
/** Ends a session from the panel: Dismiss for a lost agent, Stop for a run. */
function EndSessionButton({
  label,
  onEnd,
}: {
  label: "Dismiss" | "Stop";
  onEnd: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const end = async () => {
    setError(null);
    try {
      await onEnd();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => void end()}
      >
        {label}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
```

Keep the existing button's markup details if they differ (copy its classes). Remove `DismissButton`.

3. In `SessionChat`, take `onStop` too, and replace the dismiss block with:

```tsx
const open = session.state === "active" || session.state === "stalled";
const runId = session.runId;
const dismissable =
  !runId && (session.state === "stalled" || questions.length > 0);
// ...
{
  runId && open ? (
    <EndSessionButton label="Stop" onEnd={() => onStop(runId)} />
  ) : dismissable ? (
    <EndSessionButton label="Dismiss" onEnd={() => onDismiss(session.id)} />
  ) : null;
}
{
  !open && session.link ? (
    <a
      href={session.link.url}
      target="_blank"
      rel="noreferrer"
      className="self-start text-sm underline"
    >
      {session.link.label}
    </a>
  ) : null;
}
```

Update the `SessionChat` doc comment: "A runner session shows Stop while open and its link once ended. Other stalled sessions, or ones with an open question, can be dismissed."

In the desktop build, links with `target="_blank"` must open in the default browser. Check how the app opens external links elsewhere (search for `target="_blank"` or a `openExternal` helper in `apps/web/src`) and use the same helper if one exists.

`app-api.ts`, next to `dismissAgentSession`:

```ts
export async function stopAgentRun(runId: string) {
  return appApiRequest(
    `/api/agent-runs/${encodeURIComponent(runId)}/stop`,
    { method: "POST", body: "{}" },
    agentsSnapshotSchema,
  );
}
```

`agent-panel-host.tsx`:

```ts
async function stop(runId: string) {
  setAgentsSnapshot(await stopAgentRun(runId));
}
```

and pass `onStop={stop}`.

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @ajour/web exec vitest run src/features/agents && just typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared apps/api/src apps/web/src
git commit -m "feat(agents): show Stop and a link on runner sessions"
```

---

### Task 8: Runner building blocks and the Claude Code adapter

Read the spec's "Smoke test results" before this task. Where the Claude Code results differ from the flags below, use what the smoke test found and note it in the commit message.

**Files:**

- Create: `packages/shared/agent-runs.ts`
- Create: `apps/api/src/agent-runner/adapter.ts` (types)
- Create: `apps/api/src/agent-runner/adapters/claude-code.ts`
- Create: `apps/api/src/agent-runner/cli-path.ts`
- Create: `apps/api/src/agent-runner/chrome.ts`
- Create: `apps/api/src/agent-runner/playwright-mcp.ts`
- Create: `apps/api/src/agent-runner/prompts.ts`
- Modify: `apps/api/package.json` (add `@playwright/mcp`, exact version)
- Test: `apps/api/src/agent-runner/adapters/claude-code.test.ts`, `apps/api/src/agent-runner/cli-path.test.ts`, `apps/api/src/agent-runner/chrome.test.ts`, `apps/api/src/agent-runner/prompts.test.ts`

**Interfaces:**

- Produces:
  - In `packages/shared/agent-runs.ts`: `agentCliIdSchema` (`"claude-code" | "codex" | "opencode"`), `agentBrowserModeSchema` (`"ajour-chrome" | "my-chrome"`), `agentRunnerSettingsSchema`, `agentRunnerSettingsUpdateSchema`, `agentTaskSettingsUpdateSchema`, `agentCliStatusSchema`, `agentTaskStatusSchema`, `agentRunSchema`, `agentRunnerOverviewSchema`, `agentRunStartRequestSchema`, and their `z.infer` types.
  - `AgentCliAdapter` interface (below), `claudeCodeAdapter: AgentCliAdapter`.
  - `resolveLoginShellPath(): Promise<string>`, `findExecutable(name: string, pathValue: string, platform?: NodeJS.Platform): Promise<string | null>`.
  - `isChromeInstalled(input?: { platform?; env?; exists?; pathValue? }): Promise<boolean>`.
  - `playwrightMcpServer(input: { browserMode: AgentBrowserMode; profileDirectory: string }): StdioServerSpec`.
  - `RUNNER_PROMPT: string`, `buildPrompt(input: { taskPrompt: string; values: Record<string, string> }): string`.

- [ ] **Step 1: Add the shared run contracts**

`packages/shared/agent-runs.ts`:

```ts
import { z } from "zod";
import {
  connectorFieldSchema,
  connectorFieldValuesSchema,
} from "./connectors.ts";
import { isoDateSchema } from "./agent-tools.ts";

/**
 * Contracts for the agent runner: Settings > Agents, the agent tasks
 * plugins declare, and runs. See
 * docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md.
 */

export const agentCliIdSchema = z.enum(["claude-code", "codex", "opencode"]);
export type AgentCliId = z.infer<typeof agentCliIdSchema>;

/** Ajour's own Chrome profile, or the user's Chrome through Playwright's extension. */
export const agentBrowserModeSchema = z.enum(["ajour-chrome", "my-chrome"]);
export type AgentBrowserMode = z.infer<typeof agentBrowserModeSchema>;

export const agentRunnerSettingsSchema = z.object({
  cli: agentCliIdSchema.nullable(),
  browserMode: agentBrowserModeSchema,
  /** Empty means the CLI's default model. */
  model: z.string().trim().max(120),
});
export type AgentRunnerSettings = z.infer<typeof agentRunnerSettingsSchema>;

export const agentRunnerSettingsUpdateSchema =
  agentRunnerSettingsSchema.partial();

export const agentTaskSettingsUpdateSchema = z.object({
  values: connectorFieldValuesSchema,
});

export const agentCliStatusSchema = z.object({
  id: agentCliIdSchema,
  label: z.string(),
  /** False when Ajour has no adapter for it yet. */
  supported: z.boolean(),
  installed: z.boolean(),
  version: z.string().optional(),
});
export type AgentCliStatus = z.infer<typeof agentCliStatusSchema>;

export const agentTaskStatusSchema = z.object({
  pluginId: z.string(),
  pluginName: z.string(),
  taskId: z.string(),
  label: z.string(),
  placement: z.literal("submit-week"),
  estimateMinutes: z.number().int(),
  settings: z.array(connectorFieldSchema),
  values: connectorFieldValuesSchema,
  weekLink: z.string().optional(),
  /** Why the task cannot run now, such as "Fill in Workday timesheet URL". Empty when ready. */
  blockers: z.array(z.string()),
});
export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;

export const agentRunSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  taskId: z.string(),
  weekOf: isoDateSchema,
  sessionId: z.string(),
  startedAt: z.number(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

export const agentRunnerOverviewSchema = z.object({
  settings: agentRunnerSettingsSchema,
  clis: z.array(agentCliStatusSchema),
  tasks: z.array(agentTaskStatusSchema),
  currentRun: agentRunSchema.nullable(),
});
export type AgentRunnerOverview = z.infer<typeof agentRunnerOverviewSchema>;

export const agentRunStartRequestSchema = z.object({
  pluginId: z.string().min(1),
  taskId: z.string().min(1),
  weekOf: isoDateSchema,
});
export type AgentRunStartRequest = z.infer<typeof agentRunStartRequestSchema>;
```

Expose it as an entry point the same way as `agent-tools` in `packages/shared/package.json`, if the package lists entry points.

- [ ] **Step 2: Add the Playwright MCP dependency**

Run: `npm view @playwright/mcp version` and note the version, for example `0.0.41`.
Run: `pnpm --filter @ajour/api add --save-exact @playwright/mcp@<that version>`
Run: `node -e "console.log(require.resolve('@playwright/mcp/cli.js', { paths: ['apps/api'] }))"`
Expected: a path ending in `@playwright/mcp/cli.js`. If the package's `exports` blocks that subpath, resolve `@playwright/mcp/package.json` instead and join its `bin["mcp-server-playwright"]` (Step 6 shows both).

- [ ] **Step 3: Write the adapter types**

`apps/api/src/agent-runner/adapter.ts`:

```ts
import type { AgentCliId } from "../../../../packages/shared/agent-runs.ts";

/** An MCP server the CLI starts as a child process. */
export interface StdioServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** What an adapter needs to build one run's command. */
export interface AdapterInput {
  executable: string;
  /** The folder the CLI runs in. The adapter may write config files here, never the token. */
  workDirectory: string;
  /** Runner prompt plus task prompt, filled. */
  prompt: string;
  ajourMcpUrl: string;
  playwright: StdioServerSpec;
  /** Empty means the CLI's default. */
  model: string;
  /** The process environment to start from, with the login shell's PATH. */
  baseEnv: Record<string, string>;
  token: string;
}

export interface AdapterInvocation {
  command: string;
  args: string[];
  /** Includes AJOUR_MCP_TOKEN. The token appears nowhere else. */
  env: Record<string, string>;
  /** Files to write in `workDirectory` before starting, by relative name. */
  files: Record<string, string>;
}

/** What the runner learns from one line of the CLI's JSON output. */
export type RunnerEvent =
  | { kind: "mcp-failed"; server: string }
  | { kind: "tool-call" }
  | { kind: "finished"; summary: string }
  | { kind: "failed"; message: string };

export interface AgentCliAdapter {
  id: AgentCliId;
  label: string;
  /** The executable name looked up on PATH. */
  executableName: string;
  /** The version from `<cli> --version` output, or undefined. */
  parseVersion(output: string): string | undefined;
  buildInvocation(input: AdapterInput): AdapterInvocation;
  /** Null for lines the runner does not need. */
  parseEvent(line: string): RunnerEvent | null;
}
```

- [ ] **Step 4: Write the Claude Code adapter tests**

`apps/api/src/agent-runner/adapters/claude-code.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "./claude-code.ts";

const TOKEN = "ajour_secret-token-value";
const input = {
  executable: "/usr/local/bin/claude",
  workDirectory: "/tmp/run-1",
  prompt: "Do the week.",
  ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
  playwright: {
    command: "/app/node",
    args: ["/app/pw/cli.js", "--browser", "chrome"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  },
  model: "",
  baseEnv: { PATH: "/usr/bin", HOME: "/Users/a" },
  token: TOKEN,
};

describe("Claude Code adapter", () => {
  it("never puts the token in the arguments or the files", () => {
    const invocation = claudeCodeAdapter.buildInvocation(input);
    expect(invocation.args.join(" ")).not.toContain(TOKEN);
    expect(JSON.stringify(invocation.files)).not.toContain(TOKEN);
    expect(invocation.env.AJOUR_MCP_TOKEN).toBe(TOKEN);
  });

  it("loads only Ajour's two MCP servers and only their tools", () => {
    const { args, files } = claudeCodeAdapter.buildInvocation(input);
    expect(args).toContain("--strict-mcp-config");
    const config = JSON.parse(files["mcp.json"]!);
    expect(Object.keys(config.mcpServers)).toEqual(["ajour", "playwright"]);
    expect(config.mcpServers.ajour.headers.Authorization).toBe(
      "Bearer ${AJOUR_MCP_TOKEN}",
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "--allowedTools",
        "mcp__ajour",
        "mcp__playwright",
      ]),
    );
    expect(args).not.toContain("--bare");
  });

  it("keeps the user's instruction files out and passes the prompt as a file", () => {
    const { args, env, files } = claudeCodeAdapter.buildInvocation(input);
    expect(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe("1");
    expect(files["prompt.md"]).toBe("Do the week.");
    expect(args).toEqual(
      expect.arrayContaining([
        "--append-system-prompt-file",
        "/tmp/run-1/prompt.md",
      ]),
    );
  });

  it("passes a model only when one is set", () => {
    expect(claudeCodeAdapter.buildInvocation(input).args).not.toContain(
      "--model",
    );
    expect(
      claudeCodeAdapter.buildInvocation({ ...input, model: "sonnet" }).args,
    ).toEqual(expect.arrayContaining(["--model", "sonnet"]));
  });

  it("reads a failed MCP server, tool calls and the result", () => {
    expect(
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "system",
          subtype: "init",
          mcp_servers: [
            { name: "ajour", status: "connected" },
            { name: "playwright", status: "failed" },
          ],
        }),
      ),
    ).toEqual({ kind: "mcp-failed", server: "playwright" });
    expect(
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "mcp__ajour__get_submit_lines" },
            ],
          },
        }),
      ),
    ).toEqual({ kind: "tool-call" });
    expect(
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Entered 9 lines.",
        }),
      ),
    ).toEqual({ kind: "finished", summary: "Entered 9 lines." });
    expect(
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "result",
          subtype: "error_max_turns",
          is_error: true,
          result: "",
        }),
      ),
    ).toEqual({
      kind: "failed",
      message: "Claude Code stopped: error_max_turns.",
    });
    expect(claudeCodeAdapter.parseEvent("not json")).toBeNull();
  });

  it("reads the version", () => {
    expect(claudeCodeAdapter.parseVersion("2.1.293 (Claude Code)\n")).toBe(
      "2.1.293",
    );
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `pnpm --filter @ajour/api exec vitest run src/agent-runner`
Expected: FAIL, module not found.

- [ ] **Step 6: Write the adapter, PATH, Chrome, Playwright and prompt modules**

`apps/api/src/agent-runner/adapters/claude-code.ts`:

```ts
import path from "node:path";
import type { AgentCliAdapter, RunnerEvent } from "../adapter.ts";

/**
 * Claude Code, run headless with only Ajour's MCP servers. The MCP config
 * file holds `${AJOUR_MCP_TOKEN}`, which Claude Code expands from the
 * environment, so no file holds the token. Flags confirmed by
 * qa/agents/smoke-claude-code.sh (see the spec's smoke test results).
 * Never `--bare`: it drops subscription login.
 */
export const claudeCodeAdapter: AgentCliAdapter = {
  id: "claude-code",
  label: "Claude Code",
  executableName: "claude",

  parseVersion(output) {
    return output.match(/\d+\.\d+\.\d+/)?.[0];
  },

  buildInvocation(input) {
    const mcpConfig = {
      mcpServers: {
        ajour: {
          type: "http",
          url: input.ajourMcpUrl,
          headers: { Authorization: "Bearer ${AJOUR_MCP_TOKEN}" },
        },
        playwright: { type: "stdio", ...input.playwright },
      },
    };
    const args = [
      "-p",
      "Do the task in your instructions now.",
      "--append-system-prompt-file",
      path.join(input.workDirectory, "prompt.md"),
      "--mcp-config",
      path.join(input.workDirectory, "mcp.json"),
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--tools",
      "",
      "--allowedTools",
      "mcp__ajour",
      "mcp__playwright",
      "--permission-mode",
      "dontAsk",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(input.model ? ["--model", input.model] : []),
    ];
    return {
      command: input.executable,
      args,
      env: {
        ...input.baseEnv,
        AJOUR_MCP_TOKEN: input.token,
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      },
      files: {
        "prompt.md": input.prompt,
        "mcp.json": JSON.stringify(mcpConfig, null, 2),
      },
    };
  },

  parseEvent(line): RunnerEvent | null {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (event.type === "system" && event.subtype === "init") {
      const servers = (event.mcp_servers ?? []) as {
        name: string;
        status: string;
      }[];
      const failed = servers.find((server) => server.status !== "connected");
      return failed ? { kind: "mcp-failed", server: failed.name } : null;
    }
    if (event.type === "assistant") {
      const content = ((event.message as { content?: unknown[] })?.content ??
        []) as { type?: string }[];
      return content.some((item) => item.type === "tool_use")
        ? { kind: "tool-call" }
        : null;
    }
    if (event.type === "result") {
      return event.is_error
        ? {
            kind: "failed",
            message: `Claude Code stopped: ${String(event.subtype)}.`,
          }
        : { kind: "finished", summary: String(event.result ?? "") };
    }
    return null;
  },
};
```

If the smoke test showed that `${AJOUR_MCP_TOKEN}` does not expand in `--mcp-config`, replace `headers` with Claude Code's `headersHelper` (a command that prints `{"Authorization":"Bearer <token>"}` from the environment, for example `node -e 'process.stdout.write(JSON.stringify({Authorization:"Bearer "+process.env.AJOUR_MCP_TOKEN}))'` using `input.playwright.command` as the Node path), and update the first two tests to match. The token must still appear only in `env`.

`apps/api/src/agent-runner/cli-path.ts`:

```ts
import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";

/**
 * An app started from the Dock gets a short PATH without ~/.local/bin or
 * Homebrew. Read the login shell's PATH once, so Ajour finds the agent CLIs
 * the user installed. Windows keeps the process PATH.
 */
let cachedPath: Promise<string> | undefined;

export function resolveLoginShellPath(): Promise<string> {
  cachedPath ??= readLoginShellPath();
  return cachedPath;
}

async function readLoginShellPath(): Promise<string> {
  const fallback = process.env.PATH ?? "";
  if (process.platform === "win32") return fallback;
  const shell = process.env.SHELL || "/bin/zsh";
  return await new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", 'printf %s "$PATH"'],
      { timeout: 5000, encoding: "utf8" },
      (error, stdout) =>
        resolve(error || !stdout.trim() ? fallback : stdout.trim()),
    );
  });
}

/** The executable's full path on `pathValue`, or null. */
export async function findExecutable(
  name: string,
  pathValue: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const extensions = platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here; try the next directory.
      }
    }
  }
  return null;
}

/** Test seam: forget the cached PATH. */
export function resetLoginShellPathForTests() {
  cachedPath = undefined;
}
```

`apps/api/src/agent-runner/chrome.ts`:

```ts
import { access } from "node:fs/promises";
import path from "node:path";
import { findExecutable } from "./cli-path.ts";

/** Where Google Chrome installs, per platform. */
function chromeLocations(platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  if (platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (platform === "win32") {
    return [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter((root): root is string => Boolean(root))
      .map((root) =>
        path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      );
  }
  return [];
}

/** Whether Google Chrome is installed, which Playwright's `--browser chrome` needs. */
export async function isChromeInstalled({
  platform = process.platform,
  env = process.env,
  pathValue = env.PATH ?? "",
  exists = async (candidate: string) =>
    access(candidate).then(
      () => true,
      () => false,
    ),
}: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathValue?: string;
  exists?: (candidate: string) => Promise<boolean>;
} = {}): Promise<boolean> {
  for (const candidate of chromeLocations(platform, env)) {
    if (await exists(candidate)) return true;
  }
  if (platform === "linux") {
    return (
      (await findExecutable("google-chrome", pathValue, platform)) !== null
    );
  }
  return false;
}
```

`apps/api/src/agent-runner/playwright-mcp.ts`:

```ts
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { AgentBrowserMode } from "../../../../packages/shared/agent-runs.ts";
import type { StdioServerSpec } from "./adapter.ts";

const require = createRequire(import.meta.url);

/** The bundled Playwright MCP's CLI script. Never `npx @latest`. */
function playwrightMcpCli(): string {
  try {
    return require.resolve("@playwright/mcp/cli.js");
  } catch {
    const packageJsonPath = require.resolve("@playwright/mcp/package.json");
    const { bin } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      bin: Record<string, string>;
    };
    return path.join(
      path.dirname(packageJsonPath),
      bin["mcp-server-playwright"]!,
    );
  }
}

/**
 * Playwright MCP as a stdio server the CLI starts, run by the app's own
 * Node. In Electron, `process.execPath` is the Electron binary, which acts
 * as Node with ELECTRON_RUN_AS_NODE.
 */
export function playwrightMcpServer({
  browserMode,
  profileDirectory,
}: {
  browserMode: AgentBrowserMode;
  profileDirectory: string;
}): StdioServerSpec {
  const browserArgs =
    browserMode === "my-chrome"
      ? ["--extension"]
      : ["--browser", "chrome", "--user-data-dir", profileDirectory];
  return {
    command: process.execPath,
    args: [playwrightMcpCli(), ...browserArgs],
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
  };
}
```

`apps/api/src/agent-runner/prompts.ts`:

```ts
import { fillTemplate } from "../../../../packages/shared/agent-task-templates.ts";

/** Ajour's rules for every run. The task prompt follows it. */
export const RUNNER_PROMPT = `You are running a task for Ajour, the user's time tracker. You have two MCP servers: "ajour" for the user's Ajour data and "playwright" for a Chrome window.

Rules:
- Use the Ajour session {{sessionId}}. Ajour already began it. Send update_session at least every few minutes with what you are doing, and always end it with end_session and a short summary.
- Ask the user only when you cannot go on. Use ask with choices, then wait_for_answer.
- Never type a password, a code or any credential. When a sign-in page shows, ask the user to sign in in the Chrome window, with the choices "Done" and "Stop", and wait.
- After the external tool saved a line, call mark_entries_submitted with that line's unsubmittedEntryIds. When a line fails, call mark_entries_not_submitted on any entries you marked for it.
- Do not run shell commands and do not edit files.

The task follows.
`;

/** The runner prompt, then the task prompt, with every slot filled. */
export function buildPrompt({
  taskPrompt,
  values,
}: {
  taskPrompt: string;
  values: Record<string, string>;
}): string {
  return fillTemplate(`${RUNNER_PROMPT}\n${taskPrompt}`, values);
}
```

- [ ] **Step 7: Write the PATH, Chrome and prompt tests**

`apps/api/src/agent-runner/cli-path.test.ts`:

```ts
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findExecutable } from "./cli-path.ts";

describe("findExecutable", () => {
  it("finds an executable on PATH and skips folders without it", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "ajour-path-"));
    const bin = await mkdtemp(path.join(tmpdir(), "ajour-path-"));
    await writeFile(path.join(bin, "claude"), "#!/bin/sh\n");
    await chmod(path.join(bin, "claude"), 0o755);
    expect(
      await findExecutable(
        "claude",
        [empty, bin].join(path.delimiter),
        "darwin",
      ),
    ).toBe(path.join(bin, "claude"));
    expect(await findExecutable("codex", bin, "darwin")).toBeNull();
  });
});
```

`apps/api/src/agent-runner/chrome.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isChromeInstalled } from "./chrome.ts";

describe("isChromeInstalled", () => {
  it("looks in /Applications on macOS", async () => {
    const seen: string[] = [];
    const installed = await isChromeInstalled({
      platform: "darwin",
      exists: async (candidate) => {
        seen.push(candidate);
        return true;
      },
    });
    expect(installed).toBe(true);
    expect(seen[0]).toContain("Google Chrome.app");
  });

  it("is false when Chrome is nowhere", async () => {
    expect(
      await isChromeInstalled({
        platform: "win32",
        env: { PROGRAMFILES: "C:\\Program Files" },
        exists: async () => false,
      }),
    ).toBe(false);
  });
});
```

`apps/api/src/agent-runner/prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompts.ts";

describe("buildPrompt", () => {
  it("puts the runner rules first and fills the task's slots", () => {
    const prompt = buildPrompt({
      taskPrompt: "Enter week {{weekOf}} at {{settings.url}}.",
      values: {
        weekOf: "2026-10-12",
        sessionId: "s-1",
        "settings.url": "https://wd.example",
      },
    });
    expect(prompt.indexOf("Use the Ajour session s-1")).toBeLessThan(
      prompt.indexOf("Enter week 2026-10-12 at https://wd.example."),
    );
    expect(prompt).toContain("Never type a password");
  });

  it("refuses a slot without a value", () => {
    expect(() =>
      buildPrompt({ taskPrompt: "{{settings.x}}", values: { sessionId: "s" } }),
    ).toThrow();
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @ajour/api exec vitest run src/agent-runner && just typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared apps/api pnpm-lock.yaml
git commit -m "feat(agents): add the Claude Code adapter and runner building blocks"
```

---

### Task 9: The runner, its settings and routes

**Files:**

- Create: `apps/api/src/agent-runner/runner.ts`
- Create: `apps/api/src/agent-runner/fake-cli.mjs` (test fixture: a script that prints JSON lines and exits as told)
- Modify: `apps/api/src/storage.ts` (`agentRunner` block, methods)
- Modify: `apps/api/src/server.ts` (construct the runner, routes, tick, shutdown)
- Test: `apps/api/src/agent-runner/runner.test.ts`, `apps/api/src/storage.test.ts`, `apps/api/src/server.test.ts`

**Interfaces:**

- Consumes: Tasks 2, 7 and 8 (`readAgentTaskPrompt`, `begin(..., extra)`, `get`, adapters, `playwrightMcpServer`, `isChromeInstalled`, `buildPrompt`, shared run contracts).
- Produces:
  - `class AgentRunner` with `overview(): Promise<AgentRunnerOverview>`, `start(request: AgentRunStartRequest): Promise<AgentRun>`, `stop(runId: string): boolean`, `tick(): void`, `shutdown(): Promise<void>`.
  - `class AgentRunError extends Error` with `status: 400 | 404 | 409`.
  - Storage: `getAgentRunnerSettings(): Promise<AgentRunnerSettings>`, `updateAgentRunnerSettings(patch: Partial<AgentRunnerSettings>): Promise<AgentRunnerSettings>`, `getAgentTaskValues(pluginId: string, taskId: string): Promise<ConnectorFieldValues>`, `setAgentTaskValues(pluginId: string, taskId: string, values: ConnectorFieldValues): Promise<void>`.
  - Routes: `GET /api/agents`, `POST /api/agents/settings`, `POST /api/agents/tasks/:pluginId/:taskId/settings`, `POST /api/agent-runs`, `POST /api/agent-runs/:id/stop`, `GET /api/agent-runs/current`.

- [ ] **Step 1: Write the storage test**

In `storage.test.ts`:

```ts
it("keeps the agent runner settings and task values", async () => {
  const storage = await createTempStorage();
  expect(await storage.getAgentRunnerSettings()).toEqual({
    cli: null,
    browserMode: "ajour-chrome",
    model: "",
  });
  await storage.updateAgentRunnerSettings({ cli: "claude-code" });
  await storage.setAgentTaskValues("ajp-workday", "enter-week", {
    timesheetUrl: "https://wd.example/t",
  });
  const reloaded = new AppApiStorage(storage.statePathForTests);
  expect((await reloaded.getAgentRunnerSettings()).cli).toBe("claude-code");
  expect(
    await reloaded.getAgentTaskValues("ajp-workday", "enter-week"),
  ).toEqual({
    timesheetUrl: "https://wd.example/t",
  });
});
```

Use the file's existing temp storage helper and its way of reopening the same state path.

- [ ] **Step 2: Add the storage block**

Follow commit f8d7142 (how `mcp` was added, without a version bump):

1. Type:

```ts
interface StoredAgentRunnerState {
  settings: AgentRunnerSettings;
  /** Task setting values by plugin ID, then task ID. */
  taskValues: Record<string, Record<string, ConnectorFieldValues>>;
}
```

Add `agentRunner: StoredAgentRunnerState` to `AppApiStateV7`.

2. Default in `createDefaultState()` and in the V2 branch:

```ts
agentRunner: {
  settings: { cli: null, browserMode: "ajour-chrome", model: "" },
  taskValues: {},
},
```

3. Normalizer, used in the current-shape branch of `normalizeState`:

```ts
function normalizeAgentRunnerState(raw: unknown): StoredAgentRunnerState {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const settings = agentRunnerSettingsSchema.safeParse(record.settings);
  const taskValues: StoredAgentRunnerState["taskValues"] = {};
  if (typeof record.taskValues === "object" && record.taskValues !== null) {
    for (const [pluginId, tasks] of Object.entries(record.taskValues)) {
      if (typeof tasks !== "object" || tasks === null) continue;
      for (const [taskId, values] of Object.entries(tasks)) {
        const parsed = connectorFieldValuesSchema.safeParse(values);
        if (parsed.success) {
          (taskValues[pluginId] ??= {})[taskId] = parsed.data;
        }
      }
    }
  }
  return {
    settings: settings.success
      ? settings.data
      : { cli: null, browserMode: "ajour-chrome", model: "" },
    taskValues,
  };
}
```

4. Methods on `AppApiStorage`, next to the MCP methods:

```ts
async getAgentRunnerSettings(): Promise<AgentRunnerSettings> {
  return (await this.readState()).agentRunner.settings;
}

async updateAgentRunnerSettings(
  patch: Partial<AgentRunnerSettings>,
): Promise<AgentRunnerSettings> {
  return await this.mutate((state) => {
    const settings = agentRunnerSettingsSchema.parse({
      ...state.agentRunner.settings,
      ...patch,
    });
    return {
      nextState: { ...state, agentRunner: { ...state.agentRunner, settings } },
      result: settings,
    };
  });
}

async getAgentTaskValues(pluginId: string, taskId: string): Promise<ConnectorFieldValues> {
  return (await this.readState()).agentRunner.taskValues[pluginId]?.[taskId] ?? {};
}

async setAgentTaskValues(
  pluginId: string,
  taskId: string,
  values: ConnectorFieldValues,
): Promise<void> {
  await this.mutate((state) => ({
    nextState: {
      ...state,
      agentRunner: {
        ...state.agentRunner,
        taskValues: {
          ...state.agentRunner.taskValues,
          [pluginId]: { ...state.agentRunner.taskValues[pluginId], [taskId]: values },
        },
      },
    },
    result: undefined,
  }));
}
```

Match `mutate`'s exact signature in the file. In `removeConnectorPluginData` (`:796`), also drop `agentRunner.taskValues[pluginId]`.

- [ ] **Step 3: Run the storage test**

Run: `pnpm --filter @ajour/api exec vitest run src/storage.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the fake CLI**

`apps/api/src/agent-runner/fake-cli.mjs`:

```js
#!/usr/bin/env node
// Test stand-in for an agent CLI. Reads FAKE_CLI_SCRIPT, a JSON array of
// steps: { "stdout": "<line>" }, { "stderr": "<line>" }, { "wait": ms },
// { "exit": code }, { "hang": true }. Also prints its argv and the
// presence of AJOUR_MCP_TOKEN to FAKE_CLI_REPORT when set.
import { appendFileSync } from "node:fs";

if (process.env.FAKE_CLI_REPORT) {
  appendFileSync(
    process.env.FAKE_CLI_REPORT,
    JSON.stringify({
      argv: process.argv.slice(2),
      hasToken: Boolean(process.env.AJOUR_MCP_TOKEN),
      cwd: process.cwd(),
    }) + "\n",
  );
}
const steps = JSON.parse(process.env.FAKE_CLI_SCRIPT ?? "[]");
for (const step of steps) {
  if (step.stdout) process.stdout.write(step.stdout + "\n");
  if (step.stderr) process.stderr.write(step.stderr + "\n");
  if (step.wait) await new Promise((resolve) => setTimeout(resolve, step.wait));
  if (step.hang) await new Promise(() => {});
  if (step.exit !== undefined) process.exit(step.exit);
}
process.exit(0);
```

- [ ] **Step 5: Write the runner tests**

`apps/api/src/agent-runner/runner.test.ts`. The test adapter runs `fake-cli.mjs` with Node and uses the Claude Code event parser:

```ts
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AgentSessions } from "../agent-sessions.ts";
import { claudeCodeAdapter } from "./adapters/claude-code.ts";
import type { AgentCliAdapter } from "./adapter.ts";
import { AgentRunner, AgentRunError } from "./runner.ts";

const FAKE_CLI = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));
const result = (text: string) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
  });

const fakeAdapter = (script: unknown[], report: string): AgentCliAdapter => ({
  ...claudeCodeAdapter,
  executableName: "node",
  buildInvocation: (input) => ({
    command: process.execPath,
    args: [FAKE_CLI],
    env: {
      ...input.baseEnv,
      AJOUR_MCP_TOKEN: input.token,
      FAKE_CLI_SCRIPT: JSON.stringify(script),
      FAKE_CLI_REPORT: report,
    },
    files: { "prompt.md": input.prompt },
  }),
});

async function setup(script: unknown[], options: { chrome?: boolean } = {}) {
  const work = await mkdtemp(path.join(tmpdir(), "ajour-runner-test-"));
  const report = path.join(work, "report.jsonl");
  const sessions = new AgentSessions();
  const revoked: string[] = [];
  const events: Record<string, unknown>[] = [];
  const runner = new AgentRunner({
    storage: fakeStorage({
      cli: "claude-code",
      values: { url: "https://wd.example/t" },
      revoked,
    }),
    sessions,
    plugins: fakePlugins("Enter week {{weekOf}} in {{settings.url}}."),
    adapters: [fakeAdapter(script, report)],
    findExecutable: async () => "/fake/claude",
    readVersion: async () => "1.0.0",
    loginShellPath: async () => process.env.PATH ?? "",
    chromeInstalled: async () => options.chrome ?? true,
    playwright: () => ({ command: "node", args: [], env: {} }),
    profileDirectory: path.join(work, "profile"),
    tempRoot: work,
    ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
    logEvent: (event) => events.push(event),
  });
  return { runner, sessions, revoked, events, work, report };
}

const request = {
  pluginId: "ajp-test",
  taskId: "enter-week",
  weekOf: "2026-10-12",
};

/** Waits until the run is gone from the runner. */
async function settled(runner: AgentRunner) {
  await vi.waitFor(
    async () => expect((await runner.overview()).currentRun).toBeNull(),
    { timeout: 5000 },
  );
}

describe("AgentRunner", () => {
  it("keeps the agent's own outcome when it ended the session", async () => {
    const { runner, sessions } = await setup([
      { stdout: result("Entered 9 lines.") },
    ]);
    const run = await runner.start(request);
    sessions.end(sessions.get(run.sessionId)!.client, {
      sessionId: run.sessionId,
      outcome: "failed",
      summary: "Task not found.",
    });
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("failed");
  });

  it("ends the session as done when the agent exits 0 without ending it", async () => {
    const { runner, sessions } = await setup([
      { stdout: result("Entered 9 lines.") },
    ]);
    const run = await runner.start(request);
    await settled(runner);
    const session = sessions.get(run.sessionId)!;
    expect(session.state).toBe("done");
    expect(session.messages.at(-1)).toMatchObject({
      kind: "end",
      summary: "Entered 9 lines.",
    });
  });

  it("fails with the error output on a non-zero exit", async () => {
    const { runner, sessions } = await setup([{ stderr: "boom" }, { exit: 3 }]);
    const run = await runner.start(request);
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("failed");
    expect(sessions.snapshot().errors[0]!.message).toContain("boom");
  });

  it("stops a run as cancelled", async () => {
    const { runner, sessions } = await setup([{ hang: true }]);
    const run = await runner.start(request);
    expect(runner.stop(run.id)).toBe(true);
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("cancelled");
  });

  it("kills a run stalled for 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { runner, sessions } = await setup([{ hang: true }]);
      const run = await runner.start(request);
      vi.setSystemTime(Date.now() + 60 * 60_000);
      sessions.tick();
      runner.tick();
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
      runner.tick();
      await settled(runner);
      expect(sessions.get(run.sessionId)!.state).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a second run while one is going", async () => {
    const { runner } = await setup([{ hang: true }]);
    const run = await runner.start(request);
    await expect(runner.start(request)).rejects.toMatchObject({ status: 409 });
    runner.stop(run.id);
    await settled(runner);
  });

  it("refuses to start without Chrome in the default browser mode", async () => {
    const { runner } = await setup([], { chrome: false });
    await expect(runner.start(request)).rejects.toThrow(
      "Install Google Chrome to run agent tasks.",
    );
  });

  it("revokes the client and removes the folder on every exit", async () => {
    const { runner, revoked, work, report } = await setup([{ exit: 1 }]);
    await runner.start(request);
    await settled(runner);
    expect(revoked).toHaveLength(1);
    const left = (await readdir(work)).filter((name) =>
      name.startsWith("run-"),
    );
    expect(left).toEqual([]);
    const line = JSON.parse((await readFile(report, "utf8")).trim());
    expect(line.hasToken).toBe(true);
    expect(JSON.stringify(line.argv)).not.toContain("ajour_");
  });

  it("logs one agent.run event without prompt or output", async () => {
    const { runner, events } = await setup([
      { stderr: "secret week data" },
      { exit: 1 },
    ]);
    await runner.start(request);
    await settled(runner);
    const event = events.find((candidate) => candidate.event === "agent.run")!;
    expect(event).toMatchObject({
      plugin_id: "ajp-test",
      task_id: "enter-week",
      cli: "claude-code",
      outcome: "failed",
      exit_code: 1,
    });
    expect(JSON.stringify(events)).not.toContain("secret week data");
    expect(JSON.stringify(events)).not.toContain("Enter week");
  });

  it("shutdown kills the process and revokes the client", async () => {
    const { runner, revoked } = await setup([{ hang: true }]);
    await runner.start(request);
    await runner.shutdown();
    expect(revoked).toHaveLength(1);
    expect((await runner.overview()).currentRun).toBeNull();
  });
});
```

Write `fakeStorage` and `fakePlugins` in the same file:

```ts
function fakeStorage({
  cli,
  values,
  revoked,
}: {
  cli: "claude-code";
  values: Record<string, string>;
  revoked: string[];
}) {
  return {
    getMcpSettings: async () => ({ enabled: true, clients: [] }),
    getAgentRunnerSettings: async () => ({
      cli,
      browserMode: "ajour-chrome" as const,
      model: "",
    }),
    getAgentTaskValues: async () => values,
    createMcpClient: async (name: string) => ({
      client: { id: `c-${name}`, name, createdAt: 1 },
      token: "ajour_test-token",
    }),
    revokeMcpClient: async (clientId: string) => {
      revoked.push(clientId);
      return true;
    },
  };
}

function fakePlugins(prompt: string) {
  const manifest = {
    id: "ajp-test",
    displayName: "Workday",
    capabilities: {
      agentTask: {
        tasks: [
          {
            id: "enter-week",
            label: "Enter in Workday",
            placement: "submit-week" as const,
            prompt: "p.md",
            estimateMinutes: 10,
            weekLink: "{{settings.url}}?date={{weekOf}}",
            settings: [
              {
                id: "url",
                label: "URL",
                type: "url" as const,
                required: true,
                secret: false,
              },
            ],
          },
        ],
      },
    },
  };
  return {
    listPlugins: async () => [manifest],
    isPluginEnabled: async () => true,
    readAgentTaskPrompt: async () => prompt,
  };
}
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm --filter @ajour/api exec vitest run src/agent-runner/runner.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 7: Write the runner**

`apps/api/src/agent-runner/runner.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type {
  AgentClientRef,
  AgentSessionOutcome,
} from "../../../../packages/shared/agent-tools.ts";
import type {
  AgentCliStatus,
  AgentRun,
  AgentRunnerOverview,
  AgentRunnerSettings,
  AgentRunStartRequest,
  AgentTaskStatus,
} from "../../../../packages/shared/agent-runs.ts";
import type {
  AgentTask,
  ConnectorFieldValues,
  McpClientCreateResponse,
} from "../../../../packages/shared/index.ts";
import { fillTemplate } from "../../../../packages/shared/agent-task-templates.ts";
import type { AgentSessions } from "../agent-sessions.ts";
import type {
  AgentCliAdapter,
  RunnerEvent,
  StdioServerSpec,
} from "./adapter.ts";
import { buildPrompt } from "./prompts.ts";

/**
 * Runs one plugin agent task at a time: a per-run MCP client, a session the
 * runner begins, the CLI in an empty temp folder, and cleanup on every exit.
 * See docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md.
 */

const STALL_LIMIT_MS = 10 * 60_000;
const ERROR_LINES = 20;
const ALL_CLIS: {
  id: AgentCliStatus["id"];
  label: string;
  executableName: string;
}[] = [
  { id: "claude-code", label: "Claude Code", executableName: "claude" },
  { id: "codex", label: "Codex", executableName: "codex" },
  { id: "opencode", label: "OpenCode", executableName: "opencode" },
];

export class AgentRunError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.name = "AgentRunError";
    this.status = status;
  }
}

interface RunnerStorage {
  getMcpSettings(): Promise<{ enabled: boolean }>;
  getAgentRunnerSettings(): Promise<AgentRunnerSettings>;
  getAgentTaskValues(
    pluginId: string,
    taskId: string,
  ): Promise<ConnectorFieldValues>;
  createMcpClient(name: string): Promise<McpClientCreateResponse>;
  revokeMcpClient(clientId: string): Promise<boolean>;
}

interface RunnerPlugins {
  listPlugins(): Promise<
    {
      id: string;
      displayName: string;
      capabilities: { agentTask?: { tasks: AgentTask[] } };
    }[]
  >;
  isPluginEnabled(pluginId: string): Promise<boolean>;
  readAgentTaskPrompt(pluginId: string, taskId: string): Promise<string>;
}

export interface AgentRunnerOptions {
  storage: RunnerStorage;
  sessions: AgentSessions;
  plugins: RunnerPlugins;
  adapters: AgentCliAdapter[];
  findExecutable: (name: string, pathValue: string) => Promise<string | null>;
  readVersion?: (executable: string) => Promise<string | undefined>;
  loginShellPath: () => Promise<string>;
  chromeInstalled: () => Promise<boolean>;
  playwright: (input: {
    browserMode: AgentRunnerSettings["browserMode"];
    profileDirectory: string;
  }) => StdioServerSpec;
  profileDirectory: string;
  tempRoot: string;
  ajourMcpUrl: string;
  logEvent: (event: Record<string, unknown>) => void;
  now?: () => number;
}

interface ActiveRun {
  run: AgentRun;
  client: AgentClientRef;
  child: ChildProcess;
  workDirectory: string;
  cli: AgentCliStatus["id"];
  version: string | undefined;
  browserMode: AgentRunnerSettings["browserMode"];
  stopReason?: "user" | "stalled" | "mcp" | "shutdown";
  mcpFailure?: string;
  finalSummary?: string;
  failure?: string;
  errorLines: string[];
  toolCalls: number;
  stalledSince?: number;
  exited: Promise<void>;
}

function defaultReadVersion(executable: string) {
  return new Promise<string | undefined>((resolve) => {
    execFile(
      executable,
      ["--version"],
      { timeout: 5000, encoding: "utf8" },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}

export class AgentRunner {
  private readonly options: AgentRunnerOptions;
  private active: ActiveRun | null = null;

  constructor(options: AgentRunnerOptions) {
    this.options = options;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  /** Settings > Agents and the Submit page read this. */
  async overview(): Promise<AgentRunnerOverview> {
    const settings = await this.options.storage.getAgentRunnerSettings();
    const clis = await this.detectClis();
    return {
      settings,
      clis,
      tasks: await this.listTasks(settings, clis),
      currentRun: this.active?.run ?? null,
    };
  }

  private async detectClis(): Promise<AgentCliStatus[]> {
    const pathValue = await this.options.loginShellPath();
    const readVersion = this.options.readVersion ?? defaultReadVersion;
    return await Promise.all(
      ALL_CLIS.map(async (cli) => {
        const adapter = this.options.adapters.find(
          (candidate) => candidate.id === cli.id,
        );
        const executable = await this.options.findExecutable(
          cli.executableName,
          pathValue,
        );
        const output = executable ? await readVersion(executable) : undefined;
        const version = output
          ? (adapter?.parseVersion(output) ?? output.trim())
          : undefined;
        return {
          id: cli.id,
          label: cli.label,
          supported: adapter !== undefined,
          installed: executable !== null,
          ...(version ? { version } : {}),
        };
      }),
    );
  }

  private async listTasks(
    settings: AgentRunnerSettings,
    clis: AgentCliStatus[],
  ): Promise<AgentTaskStatus[]> {
    const tasks: AgentTaskStatus[] = [];
    const mcpEnabled = (await this.options.storage.getMcpSettings()).enabled;
    const cli = clis.find((candidate) => candidate.id === settings.cli);
    for (const plugin of await this.options.plugins.listPlugins()) {
      if (!(await this.options.plugins.isPluginEnabled(plugin.id))) continue;
      for (const task of plugin.capabilities.agentTask?.tasks ?? []) {
        const values = await this.options.storage.getAgentTaskValues(
          plugin.id,
          task.id,
        );
        const blockers = [
          ...(mcpEnabled ? [] : ["Turn on MCP in Settings > MCP"]),
          ...(cli?.supported && cli.installed
            ? []
            : ["Pick an installed agent in Settings > Agents"]),
          ...task.settings
            .filter(
              (field) =>
                field.required &&
                (values[field.id] === undefined || values[field.id] === ""),
            )
            .map((field) => `Fill in ${field.label} in Settings > Agents`),
        ];
        tasks.push({
          pluginId: plugin.id,
          pluginName: plugin.displayName,
          taskId: task.id,
          label: task.label,
          placement: task.placement,
          estimateMinutes: task.estimateMinutes,
          settings: task.settings,
          values,
          ...(task.weekLink ? { weekLink: task.weekLink } : {}),
          blockers,
        });
      }
    }
    return tasks;
  }

  async start(request: AgentRunStartRequest): Promise<AgentRun> {
    if (this.active) {
      throw new AgentRunError(
        "An agent task is already running. Stop it first.",
        409,
      );
    }
    const settings = await this.options.storage.getAgentRunnerSettings();
    const clis = await this.detectClis();
    const task = (await this.listTasks(settings, clis)).find(
      (candidate) =>
        candidate.pluginId === request.pluginId &&
        candidate.taskId === request.taskId,
    );
    if (!task)
      throw new AgentRunError("This agent task is not available.", 404);
    if (task.blockers.length > 0)
      throw new AgentRunError(`${task.blockers[0]}.`, 400);
    if (
      settings.browserMode === "ajour-chrome" &&
      !(await this.options.chromeInstalled())
    ) {
      throw new AgentRunError("Install Google Chrome to run agent tasks.", 400);
    }
    const adapter = this.options.adapters.find(
      (candidate) => candidate.id === settings.cli,
    )!;
    const cliStatus = clis.find((candidate) => candidate.id === settings.cli)!;
    const pathValue = await this.options.loginShellPath();
    const executable = await this.options.findExecutable(
      adapter.executableName,
      pathValue,
    );
    if (!executable)
      throw new AgentRunError(`${adapter.label} is not installed.`, 400);

    const taskPrompt = await this.options.plugins.readAgentTaskPrompt(
      request.pluginId,
      request.taskId,
    );
    const settingValues = Object.fromEntries(
      Object.entries(task.values).map(([id, value]) => [
        `settings.${id}`,
        String(value),
      ]),
    );
    const weekLink = task.weekLink
      ? safeHttpsUrl(
          fillTemplate(task.weekLink, {
            ...settingValues,
            weekOf: request.weekOf,
            sessionId: "",
          }),
        )
      : undefined;

    const created = await this.options.storage.createMcpClient(
      `${task.label} run`,
    );
    const client = { id: created.client.id, name: created.client.name };
    const runId = randomUUID();
    const session = this.options.sessions.begin(
      client,
      {
        title: `${task.label}, week of ${request.weekOf}`,
        estimateMinutes: task.estimateMinutes,
      },
      {
        runId,
        ...(weekLink
          ? {
              link: {
                label: `Open the week in ${task.pluginName}`,
                url: weekLink,
              },
            }
          : {}),
      },
    );
    const workDirectory = await mkdtemp(
      path.join(this.options.tempRoot, "run-"),
    );
    try {
      const invocation = adapter.buildInvocation({
        executable,
        workDirectory,
        prompt: buildPrompt({
          taskPrompt,
          values: {
            ...settingValues,
            weekOf: request.weekOf,
            sessionId: session.id,
          },
        }),
        ajourMcpUrl: this.options.ajourMcpUrl,
        playwright: this.options.playwright({
          browserMode: settings.browserMode,
          profileDirectory: this.options.profileDirectory,
        }),
        model: settings.model,
        baseEnv: { ...stringEnv(process.env), PATH: pathValue },
        token: created.token,
      });
      for (const [name, content] of Object.entries(invocation.files)) {
        await writeFile(path.join(workDirectory, name), content, {
          mode: 0o600,
        });
      }
      const child = spawn(invocation.command, invocation.args, {
        cwd: workDirectory,
        env: invocation.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const run: AgentRun = {
        id: runId,
        pluginId: request.pluginId,
        taskId: request.taskId,
        weekOf: request.weekOf,
        sessionId: session.id,
        startedAt: this.now(),
      };
      const active: ActiveRun = {
        run,
        client,
        child,
        workDirectory,
        cli: adapter.id,
        version: cliStatus.version,
        browserMode: settings.browserMode,
        errorLines: [],
        toolCalls: 0,
        exited: Promise.resolve(),
      };
      active.exited = this.watch(active, adapter);
      this.active = active;
      return run;
    } catch (error) {
      await this.cleanUp(client, workDirectory);
      this.options.sessions.end(client, {
        sessionId: session.id,
        outcome: "failed",
        summary: "Ajour could not start the agent.",
      });
      throw error;
    }
  }

  private watch(active: ActiveRun, adapter: AgentCliAdapter): Promise<void> {
    const { child } = active;
    createInterface({ input: child.stdout! }).on("line", (line) => {
      const event = adapter.parseEvent(line);
      if (event) this.onEvent(active, event);
    });
    createInterface({ input: child.stderr! }).on("line", (line) => {
      active.errorLines.push(line);
      if (active.errorLines.length > ERROR_LINES) active.errorLines.shift();
    });
    return new Promise((resolve) => {
      child.on("error", (error) => {
        active.failure = error.message;
      });
      child.on("close", (code) => {
        void this.finish(active, code).finally(resolve);
      });
    });
  }

  private onEvent(active: ActiveRun, event: RunnerEvent) {
    switch (event.kind) {
      case "tool-call":
        active.toolCalls += 1;
        return;
      case "finished":
        active.finalSummary = event.summary;
        return;
      case "failed":
        active.failure = event.message;
        return;
      case "mcp-failed":
        active.mcpFailure = event.server;
        active.stopReason = "mcp";
        active.child.kill("SIGTERM");
        return;
    }
  }

  private async finish(active: ActiveRun, code: number | null) {
    const { sessions } = this.options;
    const session = sessions.get(active.run.sessionId);
    const open =
      session && (session.state === "active" || session.state === "stalled");
    let outcome: AgentSessionOutcome | undefined =
      session && !open ? (session.state as AgentSessionOutcome) : undefined;
    if (open) {
      const ending = describeEnding(active, code);
      outcome = ending.outcome;
      if (ending.error) sessions.recordError(ending.error, active.client);
      sessions.end(active.client, {
        sessionId: active.run.sessionId,
        outcome: ending.outcome,
        summary: ending.summary,
      });
    }
    await this.cleanUp(active.client, active.workDirectory);
    this.options.logEvent({
      event: "agent.run",
      plugin_id: active.run.pluginId,
      task_id: active.run.taskId,
      cli: active.cli,
      cli_version: active.version,
      browser_mode: active.browserMode,
      duration_ms: this.now() - active.run.startedAt,
      outcome,
      exit_code: code,
      stop_reason: active.stopReason,
      tool_call_count: active.toolCalls,
    });
    if (this.active === active) this.active = null;
  }

  private async cleanUp(client: AgentClientRef, workDirectory: string) {
    await this.options.storage.revokeMcpClient(client.id).catch(() => false);
    await rm(workDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  /** The user pressed Stop. False when that run is not going. */
  stop(runId: string): boolean {
    if (!this.active || this.active.run.id !== runId) return false;
    this.active.stopReason = "user";
    this.active.child.kill("SIGTERM");
    return true;
  }

  /** Kills a run whose session stayed stalled for 10 minutes. Runs with the stall timer. */
  tick() {
    const active = this.active;
    if (!active) return;
    const session = this.options.sessions.get(active.run.sessionId);
    if (session?.state !== "stalled") {
      active.stalledSince = undefined;
      return;
    }
    active.stalledSince ??= this.now();
    if (
      this.now() - active.stalledSince >= STALL_LIMIT_MS &&
      !active.stopReason
    ) {
      active.stopReason = "stalled";
      active.child.kill("SIGTERM");
    }
  }

  /** Ajour is quitting: kill the CLI and wait for its cleanup. */
  async shutdown() {
    const active = this.active;
    if (!active) return;
    active.stopReason ??= "shutdown";
    active.child.kill("SIGTERM");
    await active.exited;
  }
}

function describeEnding(
  active: ActiveRun,
  code: number | null,
): { outcome: AgentSessionOutcome; summary: string; error?: string } {
  const errorOutput = active.errorLines.join("\n");
  switch (active.stopReason) {
    case "user":
    case "shutdown":
      return { outcome: "cancelled", summary: "Stopped by the user." };
    case "stalled":
      return { outcome: "failed", summary: "The agent stopped answering." };
    case "mcp":
      return {
        outcome: "failed",
        summary: `The ${active.mcpFailure} MCP server did not start.`,
        error: `The ${active.mcpFailure} MCP server did not start.${errorOutput ? `\n${errorOutput}` : ""}`,
      };
  }
  if (code === 0 && !active.failure) {
    return {
      outcome: "done",
      summary: active.finalSummary || "The agent finished.",
    };
  }
  const summary =
    active.failure ?? `The agent exited with code ${code ?? "unknown"}.`;
  return {
    outcome: "failed",
    summary,
    error: errorOutput ? `${summary}\n${errorOutput}` : summary,
  };
}

function safeHttpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
```

Imports: take `AgentTask`, `ConnectorFieldValues` and `McpClientCreateResponse` from wherever they are exported (`connectors.ts` and `agent-tools.ts` under `packages/shared`), using the same relative-path style as `mcp-server.ts`.

- [ ] **Step 8: Run the runner tests**

Run: `pnpm --filter @ajour/api exec vitest run src/agent-runner`
Expected: PASS (10 runner tests plus the Task 8 tests). If "kills a run stalled for 10 minutes" fails because `sessions.tick()` uses its own `now`, construct the `AgentSessions` in that test with `now: () => Date.now()` explicitly.

- [ ] **Step 9: Wire the runner into the server**

In `server.ts` `createAppApiServer`, after `agentSessions`:

```ts
const dataDirectory = path.dirname(storage.statePath);
const agentRunner = new AgentRunner({
  storage: {
    getMcpSettings: () => storage.getMcpSettings(),
    getAgentRunnerSettings: () => storage.getAgentRunnerSettings(),
    getAgentTaskValues: (pluginId, taskId) =>
      storage.getAgentTaskValues(pluginId, taskId),
    createMcpClient: (name) => createMcpClient(storage, name),
    revokeMcpClient: (clientId) =>
      storage.revokeMcpClient(clientId, Date.now()),
  },
  sessions: agentSessions,
  plugins: {
    listPlugins: () => pluginManager.listPlugins(),
    isPluginEnabled: async (pluginId) =>
      storage.isConnectorPluginEnabled(
        pluginId,
        (await pluginManager.listPlugins()).map((plugin) => plugin.id),
      ),
    readAgentTaskPrompt: (pluginId, taskId) =>
      pluginManager.readAgentTaskPrompt(pluginId, taskId),
  },
  adapters: [claudeCodeAdapter],
  findExecutable: (name, pathValue) => findExecutable(name, pathValue),
  loginShellPath: resolveLoginShellPath,
  chromeInstalled: () => isChromeInstalled(),
  playwright: playwrightMcpServer,
  profileDirectory: path.join(dataDirectory, "agent-browser-profile"),
  tempRoot: os.tmpdir(),
  ajourMcpUrl: `http://${host}:${port}/mcp/ajour`,
  logEvent: logMcpEvent,
});
```

If `AppApiStorage` keeps its state path private, use `options.statePath` the way `defaultInstalledPluginDirectory(options.statePath)` derives the data folder, through the same helper.

The stall timer becomes:

```ts
const stallTimer = setInterval(() => {
  agentSessions.tick();
  agentRunner.tick();
}, 15_000);
```

Routes, before `/api/mcp/settings`:

```ts
if (request.method === "GET" && requestUrl.pathname === "/api/agents") {
  writeJson(response, 200, await agentRunner.overview());
  return;
}

if (
  request.method === "POST" &&
  requestUrl.pathname === "/api/agents/settings"
) {
  const payload = agentRunnerSettingsUpdateSchema.parse(
    await readJsonBody(request),
  );
  await storage.updateAgentRunnerSettings(payload);
  writeJson(response, 200, await agentRunner.overview());
  return;
}

const agentTaskSettingsRoute = requestUrl.pathname.match(
  /^\/api\/agents\/tasks\/([^/]+)\/([^/]+)\/settings$/,
);
if (request.method === "POST" && agentTaskSettingsRoute) {
  const payload = agentTaskSettingsUpdateSchema.parse(
    await readJsonBody(request),
  );
  await storage.setAgentTaskValues(
    decodeURIComponent(agentTaskSettingsRoute[1] ?? ""),
    decodeURIComponent(agentTaskSettingsRoute[2] ?? ""),
    payload.values,
  );
  writeJson(response, 200, await agentRunner.overview());
  return;
}

if (request.method === "POST" && requestUrl.pathname === "/api/agent-runs") {
  const payload = agentRunStartRequestSchema.parse(await readJsonBody(request));
  try {
    writeJson(response, 201, await agentRunner.start(payload));
  } catch (error) {
    if (!(error instanceof AgentRunError)) throw error;
    writeJson(response, error.status, { error: error.message });
  }
  return;
}

if (
  request.method === "GET" &&
  requestUrl.pathname === "/api/agent-runs/current"
) {
  writeJson(response, 200, { run: (await agentRunner.overview()).currentRun });
  return;
}

const agentRunStopRoute = requestUrl.pathname.match(
  /^\/api\/agent-runs\/([^/]+)\/stop$/,
);
if (request.method === "POST" && agentRunStopRoute) {
  if (!agentRunner.stop(decodeURIComponent(agentRunStopRoute[1] ?? ""))) {
    writeJson(response, 404, { error: "That agent task is not running." });
    return;
  }
  writeJson(response, 200, agentSessions.snapshot());
  return;
}
```

Shutdown: in `stopAppApiServer`, before the plugin managers' shutdown is awaited, `await runtime.agentRunner.shutdown();`. Add `agentRunner` to `AppApiRuntime` and to the `runtime` object. In the `server.once("close")` handler, also call `void agentRunner.shutdown();`.

- [ ] **Step 10: Write the route tests**

In `server.test.ts` (or `mcp-server.test.ts`, whichever builds a full API with `startTestApi`), add:

```ts
it("answers 404 to Stop for a run that is not going", async () => {
  const { baseUrl } = await startTestApi();
  const response = await fetch(`${baseUrl}/api/agent-runs/nope/stop`, {
    method: "POST",
    headers: { Origin: TEST_ORIGIN },
  });
  expect(response.status).toBe(404);
});

it("lists the agents and keeps their settings", async () => {
  const { baseUrl } = await startTestApi();
  const update = await fetch(`${baseUrl}/api/agents/settings`, {
    method: "POST",
    headers: { Origin: TEST_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ browserMode: "my-chrome" }),
  });
  const overview = await update.json();
  expect(overview.settings.browserMode).toBe("my-chrome");
  expect(overview.clis.map((cli: { id: string }) => cli.id)).toEqual([
    "claude-code",
    "codex",
    "opencode",
  ]);
});
```

- [ ] **Step 11: Run all API tests and typecheck**

Run: `pnpm --filter @ajour/api exec vitest run && just typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add apps/api packages/shared
git commit -m "feat(agents): run plugin agent tasks from the local API"
```

---

### Task 10: Ship Playwright MCP in the desktop build

**Files:**

- Modify: `apps/desktop/scripts/prepare-internal-api.cjs` (runtime packages)
- Modify: `apps/desktop/internal-api-package.test.ts:42-110`

**Interfaces:**

- Produces: `build/internal-app-runtime/node_modules/@playwright/mcp` and its dependencies in the packaged app.

- [ ] **Step 1: Write the failing test**

In `internal-api-package.test.ts`, next to the zod and tar checks:

```ts
it("ships the pinned Playwright MCP with the internal API", () => {
  const packageJson = JSON.parse(
    readFileSync(
      path.join(runtimeRoot, "node_modules/@playwright/mcp/package.json"),
      "utf8",
    ),
  );
  const apiPackage = JSON.parse(
    readFileSync(path.join(repoRoot, "apps/api/package.json"), "utf8"),
  );
  expect(packageJson.version).toBe(apiPackage.dependencies["@playwright/mcp"]);
  expect(
    existsSync(
      path.join(runtimeRoot, "node_modules/playwright-core/package.json"),
    ),
  ).toBe(true);
});
```

Use the names the file already uses for the runtime folder and repo root.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @ajour/desktop exec vitest run internal-api-package.test.ts`
Expected: FAIL.

- [ ] **Step 3: Copy the package**

In `prepare-internal-api.cjs`, after the `@modelcontextprotocol/sdk` line:

```js
copyRuntimePackage("@playwright/mcp", [path.resolve(repoRoot, "apps/api")]);
```

`copyRuntimePackage` follows `dependencies` only. If `playwright-core` arrives through an optional or peer dependency of `@playwright/mcp` or `playwright`, add an explicit `copyRuntimePackage("playwright-core", [...])` line with the folder that resolves it.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @ajour/desktop exec vitest run`
Expected: PASS.

- [ ] **Step 5: Check the packaged app starts Playwright MCP**

Run: `just make --mac`, install the DMG, then in a terminal:
`"/Applications/Ajour.app/Contents/MacOS/Ajour" --version` is not useful; instead run
`ELECTRON_RUN_AS_NODE=1 "/Applications/Ajour.app/Contents/MacOS/Ajour" "/Applications/Ajour.app/Contents/Resources/internal-app-runtime/node_modules/@playwright/mcp/cli.js" --help`
Expected: Playwright MCP's help text. Record the result in the commit message. Skip this step if no Mac build is possible in the environment, and say so in the task report.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "build(desktop): ship Playwright MCP with the internal API"
```

---

### Task 11: Settings > Agents

**Files:**

- Create: `apps/web/src/lib/agent-runner.ts` (overview store)
- Modify: `apps/web/src/lib/app-api.ts` (requests)
- Create: `apps/web/src/features/settings/settings-agents-page.tsx`
- Modify: `apps/web/src/features/settings/settings-navigation.tsx:48-56`
- Modify: `apps/web/src/router.tsx:56-60,291-300,377-388`
- Modify: `apps/web/src/features/settings/settings-connectors-page.tsx` (remove the Task 3 route cast if one was added)
- Test: `apps/web/src/features/settings/settings-navigation.test.ts`

**Interfaces:**

- Consumes: routes and contracts from Tasks 8 and 9.
- Produces:
  - `getAgentRunner(): Promise<AgentRunnerOverview>`, `updateAgentRunnerSettings(patch)`, `saveAgentTaskSettings(pluginId, taskId, values)`, `startAgentRun(request): Promise<AgentRun>` in `app-api.ts`.
  - `useAgentRunner(): AgentRunnerState` and `refreshAgentRunner()`, `setAgentRunner(overview)` in `lib/agent-runner.ts`, with `AgentRunnerState = { kind: "loading" } | { kind: "unavailable" } | { kind: "error"; message: string } | { kind: "ready"; overview: AgentRunnerOverview }`.

- [ ] **Step 1: Add the requests**

`app-api.ts`, importing the schemas from `@ajour/shared/agent-runs`:

```ts
export async function getAgentRunner() {
  return appApiRequest("/api/agents", undefined, agentRunnerOverviewSchema);
}

export async function updateAgentRunnerSettings(
  patch: Partial<AgentRunnerSettings>,
) {
  return appApiRequest(
    "/api/agents/settings",
    { method: "POST", body: JSON.stringify(patch) },
    agentRunnerOverviewSchema,
  );
}

export async function saveAgentTaskSettings(
  pluginId: string,
  taskId: string,
  values: ConnectorFieldValues,
) {
  return appApiRequest(
    `/api/agents/tasks/${encodeURIComponent(pluginId)}/${encodeURIComponent(taskId)}/settings`,
    { method: "POST", body: JSON.stringify({ values }) },
    agentRunnerOverviewSchema,
  );
}

export async function startAgentRun(request: AgentRunStartRequest) {
  return appApiRequest(
    "/api/agent-runs",
    { method: "POST", body: JSON.stringify(request) },
    agentRunSchema,
  );
}
```

- [ ] **Step 2: Add the store**

`apps/web/src/lib/agent-runner.ts`, the same shape as `lib/mcp-settings.ts`:

```ts
import { useSyncExternalStore } from "react";
import type { AgentRunnerOverview } from "@ajour/shared/agent-runs";
import { getAgentRunner, isConnectorApiMissing } from "@/lib/app-api";

/**
 * The agent runner's overview from the local API, shared by Settings >
 * Agents and the Submit page. `unavailable` means Ajour runs as a plain web
 * app without the API.
 */
export type AgentRunnerState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready"; overview: AgentRunnerOverview };

let current: AgentRunnerState = { kind: "loading" };
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: AgentRunnerState) {
  current = next;
  listeners.forEach((listener) => listener());
}

export function setAgentRunner(overview: AgentRunnerOverview) {
  publish({ kind: "ready", overview });
}

export async function refreshAgentRunner() {
  try {
    setAgentRunner(await getAgentRunner());
  } catch (error) {
    publish(
      isConnectorApiMissing(error)
        ? { kind: "unavailable" }
        : {
            kind: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          },
    );
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    void refreshAgentRunner();
  }
  return () => listeners.delete(listener);
}

export function useAgentRunner(): AgentRunnerState {
  return useSyncExternalStore(subscribe, () => current);
}
```

- [ ] **Step 3: Write the navigation test**

In `settings-navigation.test.ts`, add:

```ts
it("lists Agents after MCP in the App group", () => {
  const app = getSettingsGroups(view)[0]!;
  const labels = app.pages.map((page) => page.label);
  expect(labels.indexOf("Agents")).toBe(labels.indexOf("MCP") + 1);
});
```

with `view` built like the file's other tests.

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --filter @ajour/web exec vitest run src/features/settings/settings-navigation.test.ts`
Expected: FAIL.

- [ ] **Step 5: Add the nav item, route and page**

`settings-navigation.tsx`, after the MCP item: `{ to: "/settings/agents", label: "Agents", icon: Terminal },` with `import { RiTerminalBoxLine as Terminal } from "@remixicon/react";` merged into the existing icon import.

`router.tsx`: a lazy `SettingsAgentsPage` like `SettingsMcpPage`, a `settingsAgentsRoute` with `path: "/agents"`, and `settingsAgentsRoute` after `settingsMcpRoute` in `settingsRoute.addChildren`.

`apps/web/src/features/settings/settings-agents-page.tsx`:

```tsx
import { useState } from "react";
import type { ConnectorFieldValues } from "@ajour/shared";
import type { AgentBrowserMode, AgentCliId } from "@ajour/shared/agent-runs";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { ConnectorFieldInput } from "@/features/settings/connector-settings-ui";
import {
  saveAgentTaskSettings,
  updateAgentRunnerSettings,
} from "@/lib/app-api";
import { setAgentRunner, useAgentRunner } from "@/lib/agent-runner";

/**
 * Settings > Agents: which coding agent Ajour starts for plugin agent tasks,
 * which browser it drives, and each task's settings.
 */
export function SettingsAgentsPage() {
  const state = useAgentRunner();
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    }
  };

  if (state.kind === "loading") return null;
  if (state.kind === "unavailable") {
    return (
      <p className="settings-section-desc">
        Agents need the Ajour desktop app.
      </p>
    );
  }
  if (state.kind === "error") {
    return <p className="text-sm text-destructive">{state.message}</p>;
  }
  const { settings, clis, tasks } = state.overview;
  const cliOptions = clis
    .filter((cli) => cli.supported)
    .map((cli) => ({
      value: cli.id,
      label: cli.installed
        ? `${cli.label}${cli.version ? ` ${cli.version}` : ""}`
        : `${cli.label} (not installed)`,
      disabled: !cli.installed,
    }));

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Agent</h2>
        <p className="settings-section-desc">
          Plugin tasks, such as entering your week in Workday, run in a coding
          agent you already have. Ajour starts it with its own instructions
          only, and gives it your Ajour data and a browser window.
        </p>
        <AppPanel>
          <SettingRow label="Agent" labelFor="agent-cli" stacked>
            <OptionSelect<AgentCliId | "">
              id="agent-cli"
              value={settings.cli ?? ""}
              options={[{ value: "", label: "None" }, ...cliOptions]}
              onChange={(cli) =>
                void run(async () =>
                  setAgentRunner(
                    await updateAgentRunnerSettings({ cli: cli || null }),
                  ),
                )
              }
            />
          </SettingRow>
          <SettingRow
            label="Browser"
            labelFor="agent-browser"
            description={
              settings.browserMode === "my-chrome"
                ? "The agent uses your Chrome profile, with every site you are signed in to. It needs Playwright's Chrome extension."
                : "Ajour opens Chrome with its own profile. Sign in to your tools there the first time."
            }
            stacked
          >
            <OptionSelect<AgentBrowserMode>
              id="agent-browser"
              value={settings.browserMode}
              options={[
                { value: "ajour-chrome", label: "Ajour's Chrome window" },
                { value: "my-chrome", label: "My Chrome" },
              ]}
              onChange={(browserMode) =>
                void run(async () =>
                  setAgentRunner(
                    await updateAgentRunnerSettings({ browserMode }),
                  ),
                )
              }
            />
          </SettingRow>
          <SettingRow
            label="Model"
            labelFor="agent-model"
            description="Leave empty to use the agent's default model."
          >
            <Input
              id="agent-model"
              defaultValue={settings.model}
              className="w-48"
              onBlur={(event) => {
                const model = event.target.value.trim();
                if (model !== settings.model) {
                  void run(async () =>
                    setAgentRunner(await updateAgentRunnerSettings({ model })),
                  );
                }
              }}
            />
          </SettingRow>
        </AppPanel>
      </section>

      {tasks.map((task) => (
        <TaskSettings
          key={`${task.pluginId}/${task.taskId}`}
          task={task}
          onSave={(values) =>
            run(async () =>
              setAgentRunner(
                await saveAgentTaskSettings(task.pluginId, task.taskId, values),
              ),
            )
          }
        />
      ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function TaskSettings({
  task,
  onSave,
}: {
  task: import("@ajour/shared/agent-runs").AgentTaskStatus;
  onSave: (values: ConnectorFieldValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ConnectorFieldValues>(task.values);
  if (task.settings.length === 0) return null;
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{task.label}</h2>
      <p className="settings-section-desc">
        From the {task.pluginName} plugin.
      </p>
      <AppPanel>
        <form
          className="flex flex-col gap-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(values);
          }}
        >
          {task.settings.map((field) => (
            <ConnectorFieldInput
              key={field.id}
              field={field}
              value={values[field.id]}
              onChange={(next) => setValues({ ...values, [field.id]: next })}
            />
          ))}
          <Button type="submit" className="self-start">
            Save
          </Button>
        </form>
      </AppPanel>
    </section>
  );
}
```

Replace the inline `import(...)` type with a top-level `import type { AgentTaskStatus } from "@ajour/shared/agent-runs";`. Check `OptionSelect`'s generic and option shape (`option-select.tsx:35`) and adapt if `""` is not allowed as a value; a `"none"` sentinel works the same way.

Remove the `as never` cast from Task 3's link, if present.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @ajour/web exec vitest run src/features/settings && just typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(agents): add Settings > Agents"
```

---

### Task 12: Submit page button, week link, acceptance and docs

**Files:**

- Create: `apps/web/src/features/agents/agent-task-buttons.tsx`
- Modify: `apps/web/src/features/time/submit-page.tsx:377-388` (header actions)
- Create: `apps/web/tests/acceptance/features/agent-runner.feature`
- Create: `apps/web/tests/acceptance/steps/agent-runner.steps.ts`
- Modify: `agents/architecture.md`, `agents/GLOSSARY.md`, `agents/ui-registry.md`, `agents/library-docs.md`, `agents/progress-tracker.md`, `docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md` (status)

**Interfaces:**

- Consumes: `useAgentRunner`, `startAgentRun`, `fillTemplate`, `useAgentBridgeState` (for open runner sessions).
- Produces: `AgentTaskButtons({ weekOf }: { weekOf: string })`, rendered in the Submit page header for `submit-week` tasks.

- [ ] **Step 1: Write the acceptance feature**

`apps/web/tests/acceptance/features/agent-runner.feature`:

```gherkin
Feature: Agent tasks from plugins

  Scenario: Settings lists the installed agents
    Given the local API reports Claude Code installed and Codex missing
    When I open Settings > Agents
    Then the agent choice offers "Claude Code 2.1.0"
    And the agent choice shows "Codex (not installed)" as unavailable

  Scenario: I start Enter in Workday from the Submit page
    Given the local API reports a ready "Enter in Workday" task with a week link
    When I open the Submit page for the week of 2026-10-12
    Then I see a link "Open the week in Workday" to "https://wd.example/t?date=2026-10-12"
    When I press "Enter in Workday"
    Then the run is requested for the week of 2026-10-12
    And the agent panel shows "Enter in Workday, week of 2026-10-12" with Stop

  Scenario: The button says what is missing
    Given the local API reports the "Enter in Workday" task blocked by "Fill in Workday timesheet URL in Settings > Agents"
    When I open the Submit page for the week of 2026-10-12
    Then "Enter in Workday" is disabled with the reason "Fill in Workday timesheet URL in Settings > Agents"
```

- [ ] **Step 2: Write the steps**

`apps/web/tests/acceptance/steps/agent-runner.steps.ts` stubs `/api/agents`, `/api/agent-runs`, the MCP settings and the bridge the same way `agent-mcp.steps.ts` does (copy its `mockMcp` route setup for `/api/mcp/settings`, `/api/mcp/bridge` and `/api/connectors`, and its CORS header). The run request answers `201` with an `AgentRun`, and the bridge then sends an `agents` snapshot with a session `{ id: "session-1", runId: "run-1", title: "Enter in Workday, week of 2026-10-12", state: "active", ... }` so the panel shows Stop. Open the panel through the agent indicator, as `agent-mcp.steps.ts` does.

Overview fixture:

```ts
const readyOverview = {
  settings: { cli: "claude-code", browserMode: "ajour-chrome", model: "" },
  clis: [
    {
      id: "claude-code",
      label: "Claude Code",
      supported: true,
      installed: true,
      version: "2.1.0",
    },
    { id: "codex", label: "Codex", supported: false, installed: false },
    { id: "opencode", label: "OpenCode", supported: false, installed: false },
  ],
  tasks: [
    {
      pluginId: "ajp-workday",
      pluginName: "Workday",
      taskId: "enter-week",
      label: "Enter in Workday",
      placement: "submit-week",
      estimateMinutes: 10,
      settings: [
        {
          id: "timesheetUrl",
          label: "Workday timesheet URL",
          type: "url",
          required: true,
          secret: false,
        },
      ],
      values: { timesheetUrl: "https://wd.example/t" },
      weekLink: "{{settings.timesheetUrl}}?date={{weekOf}}",
      blockers: [],
    },
  ],
  currentRun: null,
};
```

For the "Codex (not installed)" scenario, mark Codex `supported: true, installed: false` in that scenario's overview, since unsupported CLIs do not show.

- [ ] **Step 3: Run the feature to see it fail**

Create a temporary config on port 4187 (another worktree often holds 4173), run, then delete it:

```bash
cd apps/web
sed -e 's/const acceptancePort = 4173;/const acceptancePort = 4187;/' \
    -e 's#command: "just acceptance-server",#command: "corepack pnpm --filter @ajour/web dev --host 127.0.0.1 --port 4187 --strictPort --mode test",#' \
    -e 's/reuseExistingServer: !process.env.CI,/reuseExistingServer: false,/' \
    playwright.config.ts > playwright.local.config.ts
npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Agent tasks from plugins"
rm playwright.local.config.ts
```

Expected: FAIL, no "Enter in Workday" button.

- [ ] **Step 4: Write the buttons**

`apps/web/src/features/agents/agent-task-buttons.tsx`:

```tsx
import { useState } from "react";
import { fillTemplate } from "@ajour/shared/agent-task-templates";
import type { AgentTaskStatus } from "@ajour/shared/agent-runs";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  openAgentPanel,
  useAgentBridgeState,
} from "@/features/agents/agent-bridge-state";
import { refreshAgentRunner, useAgentRunner } from "@/lib/agent-runner";
import { startAgentRun } from "@/lib/app-api";

/** The task's week link for `weekOf`, or undefined when it is not https. */
export function weekLinkFor(task: AgentTaskStatus, weekOf: string) {
  if (!task.weekLink) return undefined;
  try {
    const values = Object.fromEntries(
      Object.entries(task.values).map(([id, value]) => [
        `settings.${id}`,
        String(value),
      ]),
    );
    const url = new URL(
      fillTemplate(task.weekLink, { ...values, weekOf, sessionId: "" }),
    );
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Submit page's plugin agent tasks for the week on screen: one button
 * each, disabled with the reason while the task cannot run or a run is
 * going, and the task's week link.
 */
export function AgentTaskButtons({ weekOf }: { weekOf: string }) {
  const state = useAgentRunner();
  const { snapshot } = useAgentBridgeState();
  const [error, setError] = useState<string | null>(null);
  if (state.kind !== "ready") return null;
  const tasks = state.overview.tasks.filter(
    (task) => task.placement === "submit-week",
  );
  if (tasks.length === 0) return null;
  const running = (snapshot?.sessions ?? []).some(
    (session) =>
      session.runId &&
      (session.state === "active" || session.state === "stalled"),
  );

  const start = async (task: AgentTaskStatus) => {
    setError(null);
    try {
      await startAgentRun({
        pluginId: task.pluginId,
        taskId: task.taskId,
        weekOf,
      });
      openAgentPanel();
      await refreshAgentRunner();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tasks.map((task) => {
        const reason = running
          ? "An agent task is already running."
          : task.blockers[0];
        const link = weekLinkFor(task, weekOf);
        const button = (
          <Button
            variant="outline"
            disabled={Boolean(reason)}
            onClick={() => void start(task)}
          >
            {task.label}
          </Button>
        );
        return (
          <div
            key={`${task.pluginId}/${task.taskId}`}
            className="flex items-center gap-2"
          >
            {reason ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      tabIndex={0}
                      aria-label={`${task.label}: ${reason}`}
                    />
                  }
                >
                  {button}
                </TooltipTrigger>
                <TooltipContent>{reason}</TooltipContent>
              </Tooltip>
            ) : (
              button
            )}
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline"
              >
                Open the week in {task.pluginName}
              </a>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
```

Check the repo's `Tooltip` API in `components/ui/tooltip.tsx` (Base UI) and adapt the trigger; a disabled button gets no pointer events, so the wrapper carries the tooltip. Use the same external link helper as Task 7 if one exists.

- [ ] **Step 5: Put it in the Submit page header**

`submit-page.tsx` header `actions`:

```tsx
actions={
  <>
    <AgentTaskButtons weekOf={weekDates[0]!} />
    {isReadOnly ? null : (
      <Button disabled={selectedIds.size === 0} onClick={handleMark}>
        {getSubmitButtonLabel(status, selectedIds)}
      </Button>
    )}
  </>
}
```

- [ ] **Step 6: Run the feature and the agent features**

Run the Step 3 commands with `--grep "Agent tasks from plugins|Agents through MCP"`.
Expected: PASS.

- [ ] **Step 7: Update the docs**

- `agents/GLOSSARY.md`, under "Agents":

```markdown
**Agent task**:
A task a plugin declares for an agent, such as "Enter in Workday": a prompt, its settings and where its button shows. No plugin code runs.

**Agent run**:
One agent task Ajour started: a coding agent CLI with Ajour's and the task's prompts, its own agent client and agent session. Ajour ends the session and revokes the client when the CLI exits.
```

- `agents/architecture.md`: a section "Agent runner" after the MCP section: the runner lives in the local API, one run at a time, adapters per CLI in `apps/api/src/agent-runner/adapters/`, the token only in `AJOUR_MCP_TOKEN`, Playwright MCP bundled and pinned, run through the app's Node, and `agentTask` plugins run no code.
- `agents/ui-registry.md`: Settings > Agents (`settings-agents-page.tsx`), `AgentTaskButtons` in the Submit page header, Stop and the session link in the agent panel.
- `agents/library-docs.md`: `@playwright/mcp`, pinned, owned by `apps/api/src/agent-runner/playwright-mcp.ts`.
- `agents/progress-tracker.md`: under "Ajour MCP", the runner items done, and "Codex and OpenCode adapters" and "ajp-workday" pending.
- Spec status: "Slices 1 and 2 implemented".

- [ ] **Step 8: Full verification**

Run: `just typecheck && just test`
Expected: PASS.
Run the full acceptance suite with the Step 3 commands without `--grep`.
Expected: only the 5 scenarios that fail on main fail (board close with subitems, Ctrl-click workflow link, packaged connector install, settle rules section, pull request Ctrl-click). Compare with `main` if the list differs.
Run: `AJOUR_QA_PORT=4188 just ui-perf` twice on this branch and twice on main (ignore each first run). Expected: within 10%. Record the numbers in `agents/progress-tracker.md`.

- [ ] **Step 9: Commit**

```bash
git add apps/web agents docs
git commit -m "feat(agents): start plugin agent tasks from the Submit page"
```

- [ ] **Step 10: Live check (human)**

Ask Alex to: build the desktop app (`just make --mac`), install it, add a development plugin folder with a minimal `agentTask` manifest whose prompt calls `get_submit_lines` and ends the session with a summary, set Settings > Agents to Claude Code, and press "Enter in Workday" on the Submit page. Expected: Chrome opens with Ajour's profile, the panel shows the run, it ends with the summary, and Settings > MCP no longer lists the run's client.

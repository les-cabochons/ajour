# Plugin project properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugins add text properties to projects, shown in a collapsed section of the project properties card, defaulting to the project's full name or code, and sent to agents in `get_submit_lines`.

**Architecture:** A `projectProperties` manifest capability in `packages/shared`. Overrides live on `LocalProject.pluginProperties` in the web app's local state; a pure domain module resolves defaults. The renderer reads active plugins from the cached connectors overview, both for the card and for the agent read tool.

**Tech Stack:** pnpm monorepo, zod 3.25, React 19, Vitest, playwright-bdd. Run commands with `just`.

**Spec:** `docs/superpowers/specs/2026-10-15-plugin-project-properties-design.md`

## Global Constraints

- `section`: 1 to 60 characters. `fields`: 1 to 10. `fields[].id`: `/^[a-z0-9][a-z0-9-]{0,62}$/`, unique. `fields[].label`: 1 to 60 characters. `fields[].defaultFrom`: optional, `fullName` or `code`.
- Values are plain text, trimmed, at most 240 characters. Only overrides are stored; an empty value is removed.
- Values of plugins that are not installed are kept.
- Only active plugins show a section and feed the agent: `pluginsEnabled !== false`, the group is enabled, and the plugin has no `unavailableReason`.
- Sections start collapsed; Ajour does not remember them open.
- `get_submit_lines` never drops `projectName`; it adds `projectFullName` and `projectProperties`.
- No enums, namespaces or constructor parameter properties (`erasableSyntaxOnly`).
- Repository text in English, plain words, no em dashes. Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A project with no code and a `defaultFrom: "code"` field: the row shows "None", and the agent gets no key for that field. Pinned in Task 2 and Task 3.
- Typing the default value itself as an override: it is stored, and survives a later rename of the project. Pinned in Task 2.
- A plugin is deactivated: its section disappears and the agent no longer gets its values, but the stored values stay. Pinned in Task 3 (read model only receives active plugins) and Task 2 (set keeps other plugins).
- Stored data from a future or corrupt state, such as a number value: `normalizeProject` drops it without throwing. Pinned in Task 2.
- The web build without the local API: no sections, and `get_submit_lines` still answers. Pinned in Task 3.

## File Structure

- `packages/shared/connectors.ts`: `projectPropertiesSchema`, the capability, `pluginHasProjectProperties`.
- `packages/shared/agent-tools.ts`: `get_submit_lines` output gets `projectFullName` and `projectProperties`.
- `apps/web/src/domain/local-state.ts`: `LocalProject.pluginProperties`.
- `apps/web/src/domain/projects/plugin-properties.ts` (new): pure rules.
- `apps/web/src/domain/projects/project-transitions.ts`: `normalizeProject` uses the new normalizer.
- `apps/web/src/lib/plugin-project-properties.ts` (new): active plugins from the connectors overview.
- `apps/web/src/domain/agents/agent-read-model.ts` and `apps/web/src/features/agents/agent-tool-runner.ts`: the agent output.
- `apps/web/src/features/projects/project-properties.tsx`: the sections in the card.
- `apps/web/tests/acceptance/features/plugin-project-properties.feature` and `steps/plugin-project-properties.steps.ts` (new).
- Docs: `apps/docs/developers/manifest.md`, `apps/docs/projects/index.md`, `apps/docs/plugins/workday-agent.md`, `agents/ui-registry.md`, `agents/architecture.md`.
- Separate repo `les-cabochons/ajp-workday-agent`: `plugin.json`, `package.json`, `prompts/enter-week.md`.

---

### Task 1: The `projectProperties` manifest capability

**Files:**

- Modify: `packages/shared/connectors.ts` (next to `agentTaskSchema`, around lines 123-200)
- Test: `packages/shared/tests/connectors.test.ts`

**Interfaces:**

- Produces: `projectPropertiesSchema`, `type ProjectPropertiesCapability`, `type ProjectPropertyField`, `pluginHasProjectProperties(manifest)`, and `capabilities.projectProperties?: ProjectPropertiesCapability` on every manifest type.

- [ ] **Step 1: Write the failing tests** in `packages/shared/tests/connectors.test.ts`, inside `describe("plugin manifest capabilities", ...)`. Import `pluginHasProjectProperties` from the same module as `pluginHasAgentTasks`.

```ts
const projectProperties = {
  section: "Workday",
  fields: [
    { id: "name", label: "Workday name", defaultFrom: "fullName" },
    { id: "code", label: "Workday code", defaultFrom: "code" },
  ],
};

it("accepts a plugin with only project properties", () => {
  const manifest = connectorPluginManifestSchema.parse({
    ...agentTaskBase,
    capabilities: { projectProperties },
  });
  expect(pluginHasProjectProperties(manifest)).toBe(true);
  expect(manifest.entrypoint).toBeUndefined();
});

it("refuses two project property fields with the same id", () => {
  expect(() =>
    connectorPluginManifestSchema.parse({
      ...agentTaskBase,
      capabilities: {
        projectProperties: {
          ...projectProperties,
          fields: [projectProperties.fields[0], projectProperties.fields[0]],
        },
      },
    }),
  ).toThrow(/name/);
});

it("refuses a default from an unknown project value", () => {
  expect(() =>
    connectorPluginManifestSchema.parse({
      ...agentTaskBase,
      capabilities: {
        projectProperties: {
          ...projectProperties,
          fields: [{ id: "name", label: "Workday name", defaultFrom: "color" }],
        },
      },
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/shared && npx vitest run tests/connectors.test.ts`
Expected: FAIL, `pluginHasProjectProperties` is not exported.

- [ ] **Step 3: Implement** in `packages/shared/connectors.ts`, after `export type AgentTask = ...`:

```ts
/**
 * Text properties a plugin adds to every project, shown in a section of the
 * project properties card. See
 * docs/superpowers/specs/2026-10-15-plugin-project-properties-design.md.
 */
export const projectPropertyFieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  label: z.string().trim().min(1).max(60),
  /** The Ajour project value shown while the user has typed none. */
  defaultFrom: z.enum(["fullName", "code"]).optional(),
});
export type ProjectPropertyField = z.infer<typeof projectPropertyFieldSchema>;

export const projectPropertiesSchema = z
  .object({
    section: z.string().trim().min(1).max(60),
    fields: z.array(projectPropertyFieldSchema).min(1).max(10),
  })
  .superRefine((capability, context) => {
    const seen = new Set<string>();
    capability.fields.forEach((field, index) => {
      if (seen.has(field.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fields", index, "id"],
          message: `Two project properties use the id ${field.id}.`,
        });
      }
      seen.add(field.id);
    });
  });
export type ProjectPropertiesCapability = z.infer<
  typeof projectPropertiesSchema
>;
```

In `connectorPluginCapabilitiesSchema`, add `projectProperties: projectPropertiesSchema.optional(),` after `agentTask`, add `|| capabilities.projectProperties !== undefined` to the refine, and change its message to `"A plugin must declare at least one capability: connector, codeHost, agentTask or projectProperties."`. After `pluginHasAgentTasks`, add:

```ts
export function pluginHasProjectProperties(manifest: {
  capabilities: ConnectorPluginCapabilities;
}) {
  return manifest.capabilities.projectProperties !== undefined;
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd packages/shared && npx vitest run tests/connectors.test.ts` then `just typecheck` from the repo root.
Expected: PASS, and no type errors. If a `switch` or record over capability names in `apps/web` or `apps/api` now fails to typecheck, add the new key there with the same treatment as `agentTask`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(plugins): add the projectProperties manifest capability"
```

---

### Task 2: Stored overrides and default rules

**Files:**

- Create: `apps/web/src/domain/projects/plugin-properties.ts`
- Create: `apps/web/src/domain/projects/plugin-properties.test.ts`
- Modify: `apps/web/src/domain/local-state.ts` (`LocalProject`, around line 16)
- Modify: `apps/web/src/domain/projects/project-transitions.ts` (`normalizeProject`, around line 69)
- Test: `apps/web/src/domain/projects/project-transitions.test.ts`

**Interfaces:**

- Consumes: `ProjectPropertiesCapability`, `ProjectPropertyField` from `@ajour/shared` (Task 1).
- Produces:
  - `type PluginProperties = Record<string, Record<string, string>>`
  - `type ProjectPropertyPlugin = { pluginId: string; capability: ProjectPropertiesCapability }`
  - `type ResolvedPluginProperty = { field: ProjectPropertyField; value: string; defaultValue: string; isDefault: boolean }`
  - `resolvePluginProperties(project: LocalProject, plugin: ProjectPropertyPlugin): ResolvedPluginProperty[]`
  - `setPluginProperty(project: LocalProject, pluginId: string, fieldId: string, value: string): PluginProperties | undefined`
  - `normalizePluginProperties(value: unknown): PluginProperties | undefined`
  - `PLUGIN_PROPERTY_MAX_LENGTH = 240`

- [ ] **Step 1: Write the failing tests** in `apps/web/src/domain/projects/plugin-properties.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LocalProject } from "@/domain/local-state";
import {
  normalizePluginProperties,
  resolvePluginProperties,
  setPluginProperty,
  type ProjectPropertyPlugin,
} from "@/domain/projects/plugin-properties";

const workday: ProjectPropertyPlugin = {
  pluginId: "workday-agent",
  capability: {
    section: "Workday",
    fields: [
      { id: "name", label: "Workday name", defaultFrom: "fullName" },
      { id: "code", label: "Workday code", defaultFrom: "code" },
      { id: "note", label: "Note" },
    ],
  },
};

function project(overrides: Partial<LocalProject> = {}): LocalProject {
  return {
    _id: "project-1",
    name: "CA004 Tech & Design",
    displayName: "Internal",
    code: "CA004",
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [],
    ...overrides,
  };
}

const values = (p: LocalProject) =>
  resolvePluginProperties(p, workday).map(({ value, isDefault }) => ({
    value,
    isDefault,
  }));

describe("plugin project properties", () => {
  it("defaults to the full name and the code, never the display name", () => {
    expect(values(project())).toEqual([
      { value: "CA004 Tech & Design", isDefault: true },
      { value: "CA004", isDefault: true },
      { value: "", isDefault: true },
    ]);
  });

  it("gives an empty default when the project has no code", () => {
    expect(values(project({ code: undefined }))[1]).toEqual({
      value: "",
      isDefault: true,
    });
  });

  it("uses an override, and keeps it when the project is renamed", () => {
    const withOverride = project({
      pluginProperties: setPluginProperty(
        project(),
        "workday-agent",
        "name",
        "CA004 Tech & Design",
      ),
    });
    expect(values({ ...withOverride, name: "Renamed" })[0]).toEqual({
      value: "CA004 Tech & Design",
      isDefault: false,
    });
  });

  it("brings the default back when the override is cleared", () => {
    const withOverride = project({
      pluginProperties: { "workday-agent": { name: "Tech" } },
    });
    expect(
      setPluginProperty(withOverride, "workday-agent", "name", "  "),
    ).toBeUndefined();
  });

  it("keeps the values of other plugins", () => {
    const other = project({ pluginProperties: { jira: { key: "ABC" } } });
    expect(setPluginProperty(other, "workday-agent", "code", " X1 ")).toEqual({
      jira: { key: "ABC" },
      "workday-agent": { code: "X1" },
    });
  });

  it("cuts a value to 240 characters", () => {
    const next = setPluginProperty(
      project(),
      "workday-agent",
      "name",
      "a".repeat(300),
    );
    expect(next?.["workday-agent"]?.name).toHaveLength(240);
  });

  it("drops stored values that are not text", () => {
    expect(
      normalizePluginProperties({
        "workday-agent": { name: "Tech", code: 4, note: "" },
        broken: "nope",
      }),
    ).toEqual({ "workday-agent": { name: "Tech" } });
    expect(normalizePluginProperties(undefined)).toBeUndefined();
    expect(normalizePluginProperties([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && npx vitest run src/domain/projects/plugin-properties.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement.** In `apps/web/src/domain/local-state.ts`, add to `LocalProject` after `code?: string;`:

```ts
  /**
   * Overrides of plugin project properties, keyed by plugin ID then field
   * ID. A missing value means the field's default. See plugin-properties.ts.
   */
  pluginProperties?: Record<string, Record<string, string>>;
```

Create `apps/web/src/domain/projects/plugin-properties.ts`:

```ts
import type {
  ProjectPropertiesCapability,
  ProjectPropertyField,
} from "@ajour/shared";
import type { LocalProject } from "@/domain/local-state";

/*
 * Properties that plugins add to projects, such as the Workday name. Only
 * overrides are stored; an empty value means the field's default, read live
 * from the project so a rename in Ajour follows. Values of plugins that are
 * not installed are kept untouched.
 */

export const PLUGIN_PROPERTY_MAX_LENGTH = 240;

export type PluginProperties = Record<string, Record<string, string>>;

/** An active plugin that adds project properties. */
export interface ProjectPropertyPlugin {
  pluginId: string;
  capability: ProjectPropertiesCapability;
}

export interface ResolvedPluginProperty {
  field: ProjectPropertyField;
  /** The override, or the default when there is none. */
  value: string;
  defaultValue: string;
  isDefault: boolean;
}

function defaultValue(project: LocalProject, field: ProjectPropertyField) {
  if (field.defaultFrom === "fullName") return project.name;
  if (field.defaultFrom === "code") return project.code ?? "";
  return "";
}

/** Each field of the plugin with its value for this project, in manifest order. */
export function resolvePluginProperties(
  project: LocalProject,
  plugin: ProjectPropertyPlugin,
): ResolvedPluginProperty[] {
  const stored = project.pluginProperties?.[plugin.pluginId] ?? {};
  return plugin.capability.fields.map((field) => {
    const fallback = defaultValue(project, field);
    const override = stored[field.id];
    return override
      ? { field, value: override, defaultValue: fallback, isDefault: false }
      : { field, value: fallback, defaultValue: fallback, isDefault: true };
  });
}

/**
 * The project's next overrides after setting one field. A blank value
 * removes the override; an empty plugin record is dropped. Returns
 * undefined when no override is left.
 */
export function setPluginProperty(
  project: LocalProject,
  pluginId: string,
  fieldId: string,
  value: string,
): PluginProperties | undefined {
  const text = value.trim().slice(0, PLUGIN_PROPERTY_MAX_LENGTH);
  const { [fieldId]: _previous, ...otherFields } =
    project.pluginProperties?.[pluginId] ?? {};
  const fields = text ? { ...otherFields, [fieldId]: text } : otherFields;
  const { [pluginId]: _plugin, ...otherPlugins } =
    project.pluginProperties ?? {};
  const next =
    Object.keys(fields).length > 0
      ? { ...otherPlugins, [pluginId]: fields }
      : otherPlugins;
  return Object.keys(next).length > 0 ? next : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Keeps the non-empty text values of stored overrides, and drops the rest. */
export function normalizePluginProperties(
  value: unknown,
): PluginProperties | undefined {
  if (!isRecord(value)) return undefined;
  const plugins: PluginProperties = {};
  for (const [pluginId, fields] of Object.entries(value)) {
    if (!isRecord(fields)) continue;
    const kept = Object.fromEntries(
      Object.entries(fields).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim() !== "",
      ),
    );
    if (Object.keys(kept).length > 0) plugins[pluginId] = kept;
  }
  return Object.keys(plugins).length > 0 ? plugins : undefined;
}
```

If the repo's lint forbids unused destructured names, replace the two rest destructurings with a copy and `delete`, keeping the same results.

In `project-transitions.ts`, import `normalizePluginProperties` and add to the object `normalizeProject` returns, after `icon: ...`:

```ts
    pluginProperties: normalizePluginProperties(project.pluginProperties),
```

- [ ] **Step 4: Add a normalize test** to `apps/web/src/domain/projects/project-transitions.test.ts`, in its `normalizeProject` describe block (follow the file's existing fixture helper for a project):

```ts
it("keeps plugin property overrides and drops broken ones", () => {
  const normalized = normalizeProject(
    {
      ...existingProjectFixture,
      pluginProperties: {
        "workday-agent": { name: "Tech", code: 7 },
      } as never,
    },
    () => 1,
  );
  expect(normalized.pluginProperties).toEqual({
    "workday-agent": { name: "Tech" },
  });
});
```

Use the file's actual project fixture in place of `existingProjectFixture`.

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && npx vitest run src/domain/projects`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/domain
git commit -m "feat(projects): store plugin project property overrides with defaults"
```

---

### Task 3: Plugin properties in `get_submit_lines`

**Files:**

- Create: `apps/web/src/lib/plugin-project-properties.ts`
- Modify: `packages/shared/agent-tools.ts` (the `get_submit_lines` output line object, around line 333)
- Modify: `apps/web/src/domain/agents/agent-read-model.ts` (`getSubmitLinesForAgent`, around line 255)
- Modify: `apps/web/src/features/agents/agent-tool-runner.ts` (`get_submit_lines` handler around line 82, and `runAgentToolCall` around line 140)
- Test: `apps/web/src/domain/agents/agent-read-model.test.ts`

**Interfaces:**

- Consumes: `resolvePluginProperties`, `ProjectPropertyPlugin` (Task 2); `pluginHasProjectProperties` (Task 1).
- Produces: `listProjectPropertyPlugins(): Promise<ProjectPropertyPlugin[]>`, used by Task 4. `getSubmitLinesForAgent` takes a new required option `projectPropertyPlugins: ProjectPropertyPlugin[]`.

- [ ] **Step 1: Write the failing test** in `agent-read-model.test.ts`, inside `describe("agent read model", ...)`. Add `projectPropertyPlugins: []` to the two existing `getSubmitLinesForAgent` calls first.

```ts
it("sends the full name and resolved plugin properties of active plugins", () => {
  const state = stateWithCodedProject();
  state.projects[0]!.pluginProperties = {
    "workday-agent": { name: "CA004 Tech & Design" },
    inactive: { other: "hidden" },
  };
  const result = getSubmitLinesForAgent(state, {
    weekDates: WEEK,
    groupBy: "day-task",
    onlyUnsubmitted: true,
    today: "2026-10-14",
    paceTolerancePercent: 20,
    projectPropertyPlugins: [
      {
        pluginId: "workday-agent",
        capability: {
          section: "Workday",
          fields: [
            { id: "name", label: "Workday name", defaultFrom: "fullName" },
            { id: "code", label: "Workday code", defaultFrom: "code" },
            { id: "empty", label: "Empty" },
          ],
        },
      },
    ],
  });
  const line = result.sections[0]!.lines[0]!;
  expect(line.projectFullName).toBe("Acme");
  expect(line.projectProperties).toEqual({
    "workday-agent": { name: "CA004 Tech & Design", code: "ACME-1" },
  });
});

it("sends no plugin properties when no plugin adds any", () => {
  const result = getSubmitLinesForAgent(stateWithCodedProject(), {
    weekDates: WEEK,
    groupBy: "day-task",
    onlyUnsubmitted: true,
    today: "2026-10-14",
    paceTolerancePercent: 20,
    projectPropertyPlugins: [],
  });
  const line = result.sections[0]!.lines[0]!;
  expect(line.projectFullName).toBe("Acme");
  expect(line).not.toHaveProperty("projectProperties");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd apps/web && npx vitest run src/domain/agents/agent-read-model.test.ts`
Expected: FAIL, `projectFullName` is undefined.

- [ ] **Step 3: Implement the output schema.** In `packages/shared/agent-tools.ts`, in the `get_submit_lines` output line object, after `projectCode`:

```ts
            /** The project's full name. `projectName` is its short display name. */
            projectFullName: z.string().optional(),
            /**
             * Properties that active plugins add to the project, keyed by
             * plugin ID then field ID, with defaults filled in.
             */
            projectProperties: z.record(z.record(z.string())).optional(),
```

- [ ] **Step 4: Implement the read model.** In `getSubmitLinesForAgent`, add `projectPropertyPlugins` to the destructured options and to their type (`projectPropertyPlugins: ProjectPropertyPlugin[];`). Before `return`, add:

```ts
const projectsById = new Map(
  state.projects.map((project) => [project._id, project]),
);
/** Non-empty values per active plugin, or undefined when there are none. */
const pluginValues = (projectId: string | undefined) => {
  const project = projectId ? projectsById.get(projectId) : undefined;
  if (!project) return undefined;
  const byPlugin: Record<string, Record<string, string>> = {};
  for (const plugin of projectPropertyPlugins) {
    const fields = Object.fromEntries(
      resolvePluginProperties(project, plugin)
        .filter((property) => property.value !== "")
        .map((property) => [property.field.id, property.value]),
    );
    if (Object.keys(fields).length > 0) byPlugin[plugin.pluginId] = fields;
  }
  return Object.keys(byPlugin).length > 0 ? byPlugin : undefined;
};
```

In the line mapping, after the `projectCode` spread:

```ts
        ...(line.projectId && projectsById.get(line.projectId)
          ? { projectFullName: projectsById.get(line.projectId)!.name }
          : {}),
        ...(pluginValues(line.projectId)
          ? { projectProperties: pluginValues(line.projectId) }
          : {}),
```

Compute `pluginValues(line.projectId)` once per line in a local `const` if the mapping is a block body; keep the code readable.

- [ ] **Step 5: Run the read model tests**

Run: `cd apps/web && npx vitest run src/domain/agents/agent-read-model.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement the active plugin list.** Create `apps/web/src/lib/plugin-project-properties.ts`:

```ts
import { pluginHasProjectProperties } from "@ajour/shared";
import type { ProjectPropertyPlugin } from "@/domain/projects/plugin-properties";
import { getConnectorsOverview, isConnectorApiMissing } from "@/lib/app-api";

/**
 * The active plugins that add project properties, from the connectors
 * overview. Empty without the local API, as in the web build.
 */
export async function listProjectPropertyPlugins(): Promise<
  ProjectPropertyPlugin[]
> {
  try {
    const overview = await getConnectorsOverview();
    if (overview.pluginsEnabled === false) return [];
    return overview.connectionGroups.flatMap((group) =>
      group.enabled &&
      !group.plugin.unavailableReason &&
      pluginHasProjectProperties(group.plugin)
        ? [
            {
              pluginId: group.plugin.id,
              capability: group.plugin.capabilities.projectProperties!,
            },
          ]
        : [],
    );
  } catch (error) {
    if (isConnectorApiMissing(error)) return [];
    throw error;
  }
}
```

- [ ] **Step 7: Wire the tool runner.** In `agent-tool-runner.ts`, make the `get_submit_lines` handler async and pass the plugins:

```ts
  get_submit_lines: async (rawInput) => {
    const input = readToolInputSchemas.get_submit_lines.parse(rawInput);
    const projectPropertyPlugins = await listProjectPropertyPlugins();
    const state = localStore.snapshot();
    return getSubmitLinesForAgent(state, {
      weekDates: getIsoWeekDates(input.weekOf),
      groupBy: input.groupBy,
      onlyUnsubmitted: input.onlyUnsubmitted,
      today: todayIsoDate(),
      paceTolerancePercent: getPaceTolerancePercent(state.userPreferences),
      projectPropertyPlugins,
    });
  },
```

In `runAgentToolCall`, change `output: readTools[call.tool](call.input),` to `output: await readTools[call.tool](call.input),`. If the `readTools` record has an explicit type whose values return a plain value, widen it to `unknown | Promise<unknown>` in the same place.

- [ ] **Step 8: Run tests and typecheck**

Run: `cd apps/web && npx vitest run src/domain/agents src/features/agents` then `just typecheck`.
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/shared apps/web/src
git commit -m "feat(agents): send the full name and plugin project properties in submit lines"
```

---

### Task 4: Plugin sections in the project properties card

**Files:**

- Modify: `apps/web/src/features/projects/project-properties.tsx`
- Create: `apps/web/tests/acceptance/features/plugin-project-properties.feature`
- Create: `apps/web/tests/acceptance/steps/plugin-project-properties.steps.ts`

**Interfaces:**

- Consumes: `listProjectPropertyPlugins` (Task 3), `resolvePluginProperties`, `setPluginProperty`, `ProjectPropertyPlugin` (Task 2), `localStore.updateProjectWithUndo`, `offerUndo`, the file's `InlineText` and `PropertyList`/`PropertyRow`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the acceptance scenario** `apps/web/tests/acceptance/features/plugin-project-properties.feature`:

```gherkin
Feature: Properties that plugins add to projects

  Scenario: Override a Workday name and undo it
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds project properties
    When I open project "aaa xyz"
    Then the "Workday" section is collapsed
    When I open the "Workday" section
    Then "Workday name" shows the default "aaa xyz"
    And "Workday code" shows the default "AAA"
    When I set "Workday name" to "CA004 Tech & Design"
    Then "Workday name" shows "CA004 Tech & Design"
    When I press Undo on the toast
    Then "Workday name" shows the default "aaa xyz"
```

Check `local-workspace.steps.ts` for an existing step that presses Undo on a toast (line 152 clicks `Undo`); reuse its exact wording if one exists instead of defining `I press Undo on the toast`.

- [ ] **Step 2: Write the steps** `apps/web/tests/acceptance/steps/plugin-project-properties.steps.ts`:

```ts
import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();
const cors = { "access-control-allow-origin": "*" };

const workdayAgent = {
  id: "workday-agent",
  displayName: "Workday (agent)",
  version: "0.3.0",
  apiVersion: 3,
  iconSvg:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>",
  connectionFields: [],
  capabilities: {
    projectProperties: {
      section: "Workday",
      fields: [
        { id: "name", label: "Workday name", defaultFrom: "fullName" },
        { id: "code", label: "Workday code", defaultFrom: "code" },
      ],
    },
  },
};

function card(page: Page) {
  return page.getByRole("region", { name: "Properties" });
}

// Registered after the Given that mocks an empty overview, so it wins.
Given(
  "the Workday \\(agent) plugin adds project properties",
  async ({ page }) => {
    await page.route("**/api/connectors", (route) =>
      route.fulfill({
        json: {
          pluginsEnabled: true,
          plugins: [workdayAgent],
          connectionGroups: [
            { plugin: workdayAgent, enabled: true, connections: [] },
          ],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
        headers: cors,
      }),
    );
  },
);

Then("the {string} section is collapsed", async ({ page }, section: string) => {
  await expect(
    card(page).getByRole("button", { name: section }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(card(page).getByText("Workday name")).toHaveCount(0);
});

When("I open the {string} section", async ({ page }, section: string) => {
  await card(page).getByRole("button", { name: section }).click();
});

Then(
  "{string} shows the default {string}",
  async ({ page }, label: string, value: string) => {
    await expect(
      card(page).getByRole("button", {
        name: `Edit ${label.toLowerCase()}, default ${value}`,
      }),
    ).toBeVisible();
  },
);

Then(
  "{string} shows {string}",
  async ({ page }, label: string, value: string) => {
    await expect(
      card(page).getByRole("button", {
        name: `Edit ${label.toLowerCase()}, ${value}`,
        exact: true,
      }),
    ).toBeVisible();
  },
);

When(
  "I set {string} to {string}",
  async ({ page }, label: string, value: string) => {
    await card(page)
      .getByRole("button", { name: new RegExp(`^Edit ${label.toLowerCase()}`) })
      .click();
    const field = page.getByRole("textbox", { name: label });
    await field.fill(value);
    await field.press("Enter");
  },
);

When("I press Undo on the toast", async ({ page }) => {
  await page.getByRole("button", { name: "Undo", exact: true }).click();
});
```

If the existing `mockEmptyConnectorOverview` uses a full URL instead of a glob, register this route with the same URL so it overrides it.

- [ ] **Step 3: Run it to see it fail**

Use a temporary copy of `apps/web/playwright.config.ts` on a free port, because 4173 is often held by another worktree. Do not commit it.

```bash
cd apps/web
sed -e 's/const acceptancePort = 4173;/const acceptancePort = 4187;/' \
  -e 's|command: "just acceptance-server"|command: "corepack pnpm dev --host 127.0.0.1 --port 4187 --strictPort --mode test"|' \
  -e 's/reuseExistingServer: !process.env.CI/reuseExistingServer: false/' \
  playwright.config.ts > playwright.local.config.ts
npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Properties that plugins add"
```

Expected: FAIL, no "Workday" button in the card.

- [ ] **Step 4: Implement the section.** In `project-properties.tsx`:

1. Give `InlineText` an optional `defaultValue?: string` prop. When `value` is empty and `defaultValue` is non-empty, the resting button shows `defaultValue` muted, and its `aria-label` is `` `Edit ${label.toLowerCase()}, default ${defaultValue}` ``. The input's `placeholder` becomes `defaultValue || placeholder`. Existing callers pass nothing and behave as before. Update the component's doc comment.

2. Add, above `ProjectPropertiesCard`:

```tsx
/** Saves one plugin property with Undo. Unchanged values save nothing. */
function patchPluginProperty(
  project: LocalProject,
  plugin: ProjectPropertyPlugin,
  field: ProjectPropertyField,
  value: string,
) {
  const pluginProperties = setPluginProperty(
    project,
    plugin.pluginId,
    field.id,
    value,
  );
  offerUndo(
    localStore.updateProjectWithUndo(project._id, { pluginProperties }),
    { title: `${field.label} changed`, subject: "project" },
  );
}

/**
 * The properties one plugin adds, under its section title. Collapsed on
 * each visit; the title toggles it.
 */
function PluginPropertySection({
  project,
  plugin,
  readOnly,
}: {
  project: LocalProject;
  plugin: ProjectPropertyPlugin;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = `${project._id}-${plugin.pluginId}-properties`;
  return (
    <div className="flex flex-col gap-2.5 border-t pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        className="flex items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <ChevronIcon
          aria-hidden="true"
          className={cn("size-4 transition-transform", open && "rotate-90")}
        />
        {plugin.capability.section}
      </button>
      {open ? (
        <PropertyList id={contentId}>
          {resolvePluginProperties(project, plugin).map((property) => (
            <PropertyRow key={property.field.id} label={property.field.label}>
              <InlineText
                value={property.isDefault ? "" : property.value}
                defaultValue={property.defaultValue}
                label={property.field.label}
                placeholder="None"
                readOnly={readOnly}
                onSave={(value) => {
                  if (
                    value.trim() === (property.isDefault ? "" : property.value)
                  )
                    return;
                  patchPluginProperty(project, plugin, property.field, value);
                }}
              />
            </PropertyRow>
          ))}
        </PropertyList>
      ) : null}
    </div>
  );
}
```

Import `RiArrowRightSLine as ChevronIcon` from `@remixicon/react`, `ProjectPropertyField` from `@ajour/shared`, `resolvePluginProperties`, `setPluginProperty` and `ProjectPropertyPlugin` from `@/domain/projects/plugin-properties`, `listProjectPropertyPlugins` from `@/lib/plugin-project-properties`, and `useEffect` from React.

3. In `ProjectPropertiesCard`, load the plugins once per mount and render the sections between `</PropertyList>` and `<PropertyActions>`:

```tsx
const [plugins, setPlugins] = useState<ProjectPropertyPlugin[]>([]);
useEffect(() => {
  let active = true;
  // A failed overview shows no plugin sections; the rest of the card works.
  void listProjectPropertyPlugins()
    .then((next) => active && setPlugins(next))
    .catch(() => undefined);
  return () => {
    active = false;
  };
}, []);
```

```tsx
{
  plugins.map((plugin) => (
    <PluginPropertySection
      key={plugin.pluginId}
      project={project}
      plugin={plugin}
      readOnly={isArchived}
    />
  ));
}
```

Update the card's doc comment to mention the plugin sections.

- [ ] **Step 5: Run the scenario and the project scenarios**

Run: `npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Properties that plugins add|Edit a project in place"`
Expected: PASS.

- [ ] **Step 6: Look at it.** Add a temporary `await page.screenshot({ path: "/tmp/plugin-section.png" })` after opening the section, run once, look at the image in light theme, remove the line. The section title must read as a small muted heading with a chevron, the rows aligned with Full name and Code.

- [ ] **Step 7: Run the full checks**

Run from the repo root: `just typecheck`, `just test`, then the whole acceptance suite with the local config: `cd apps/web && npx playwright test --config playwright.local.config.ts`. Delete `apps/web/playwright.local.config.ts` afterwards.
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(projects): show plugin properties in a collapsed card section"
```

---

### Task 5: Docs

**Files:**

- Modify: `apps/docs/developers/manifest.md`, `apps/docs/projects/index.md`, `apps/docs/plugins/workday-agent.md`
- Modify: `agents/ui-registry.md`, `agents/architecture.md`, `agents/progress-tracker.md`

- [ ] **Step 1: Manifest reference.** In `apps/docs/developers/manifest.md`:
  - In the Fields table, `capabilities` reads "At least one of `connector`, `codeHost`, `agentTask` and `projectProperties`."
  - In the Capabilities table, add a row: `projectProperties` | "Text properties the plugin adds to every project. No plugin code runs. See [Project properties](#project-properties)."
  - Add a `## Project properties` section before `## Connection fields`, with the JSON example from the spec, the key table from the spec, and these sentences: "Ajour shows the fields in a section of the project's properties card, titled `section`, collapsed until the user opens it. An empty value shows the default in grey: the project's full name for `fullName`, its code for `code`. Agents read the values in `get_submit_lines`, under `projectProperties.<plugin id>.<field id>`, with defaults filled in."

- [ ] **Step 2: Projects page.** In `apps/docs/projects/index.md`, after the properties card bullet, add: "Plugins can add their own section to the properties card, such as **Workday** with the project's Workday name and code. Click the section title to open it. An empty row shows its default in grey."

- [ ] **Step 3: Workday (agent) page.** In `apps/docs/plugins/workday-agent.md`, add a `## Match your projects` section after "Set it up": "The agent finds each project in Workday by its Workday code, then its Workday name. Both default to the project's code and full name in Ajour. When Workday uses other ones, open the project, open the **Workday** section of its properties and type them." Change the setup step that installs the plugin to say it needs version 0.3.0 or later.

- [ ] **Step 4: Repo docs.** In `agents/ui-registry.md`, next to the project properties card entry, add: "Plugins with `projectProperties` add a collapsed section each (`PluginPropertySection` in `features/projects/project-properties.tsx`), with rules in `domain/projects/plugin-properties.ts`." In `agents/architecture.md`, next to the agent runner paragraph, add one sentence: "Plugins can add text properties to projects (`projectProperties`); overrides live on `LocalProject.pluginProperties` in local state, and `get_submit_lines` sends them resolved, with `projectFullName`." In `agents/progress-tracker.md`, add a checked item for plugin project properties with the spec path.

- [ ] **Step 5: Build the docs**

Run: `just format` then `just docs-build`.
Expected: build complete, no dead links. Wrap any `{{...}}` text outside code fences in a `::: v-pre` block.

- [ ] **Step 6: Commit**

```bash
git add apps/docs agents
git commit -m "docs: document plugin project properties"
```

---

### Task 6: Workday (agent) plugin 0.3.0

**Files (repo `~/Repos/Personnal/ajp-workday-agent`, branch `feat/project-properties` from `feat/silent-sso`):**

- Modify: `plugin.json`, `package.json`, `prompts/enter-week.md`, `README.md`

- [ ] **Step 1: Branch.** `cd ~/Repos/Personnal/ajp-workday-agent && git checkout feat/silent-sso && git checkout -b feat/project-properties`.

- [ ] **Step 2: Manifest.** Set `version` to `0.3.0` in both `plugin.json` and `package.json`. Add to `plugin.json` `capabilities`:

```json
    "projectProperties": {
      "section": "Workday",
      "fields": [
        { "id": "name", "label": "Workday name", "defaultFrom": "fullName" },
        { "id": "code", "label": "Workday code", "defaultFrom": "code" }
      ]
    },
```

Update `tests/manifest.test.mjs`: the first test expects `Object.keys(manifest.capabilities).sort()` to equal `["agentTask", "projectProperties"]`.

- [ ] **Step 3: Prompt.** In `prompts/enter-week.md`, section 1 step 2, after the line listing the line fields, add: "A line may also have projectFullName and projectProperties. Use projectProperties["workday-agent"].code and .name for Workday; they already hold the defaults. Never use projectName to find a project: it is a short name only Ajour knows." In section 4 step 1, replace the matching sentence with: "Find the line's time type in Workday. Match the project by projectProperties["workday-agent"].code first, then projectProperties["workday-agent"].name, then projectFullName. Match the task by taskName." In section 4 step 5, add: "When you skip a line because its project is not found, say in the summary that the user can set the Workday name or code in the project's Workday section in Ajour."

- [ ] **Step 4: README.** Under "Install", add a step: "If a project has another name or code in Workday, set them in Ajour: open the project, then the Workday section of its properties." State that 0.3.0 needs an Ajour with plugin project properties.

- [ ] **Step 5: Verify against Ajour.** Run `corepack pnpm verify`, then install the archive with this branch's `installConnectorPluginArchive` from `apps/api/src/plugin-package.ts` (a throwaway script outside the plugin folder, run with `node --experimental-strip-types` from `apps/api`), and check it returns the manifest with both capabilities.

- [ ] **Step 6: Commit, push and open the PR** against `feat/silent-sso`, titled `feat: add Workday name and code to projects`, body naming the Ajour PR it depends on.

```bash
git commit -am "feat: add Workday name and code to projects"
git push -u origin feat/project-properties
```

---

## Self-review

- Spec coverage: manifest (Task 1), storage and defaults (Task 2), agent output and the web build fallback (Task 3), card sections, collapse, read-only archived projects, hidden for inactive plugins (Task 4 via `listProjectPropertyPlugins`), docs (Task 5), plugin and prompt (Task 6).
- Names used across tasks: `ProjectPropertyPlugin`, `resolvePluginProperties`, `setPluginProperty`, `normalizePluginProperties`, `listProjectPropertyPlugins`, `projectPropertyPlugins`, `projectFullName`, `projectProperties`.

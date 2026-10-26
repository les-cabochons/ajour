import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createApiEvents } from "./events.ts";
import { PluginManager } from "./plugin-host.ts";
import { PluginOperationRefused } from "./plugin-worker-lifetime.ts";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";
const SECRET = "tok_ajour_canary_9f8e7d";

const directories: string[] = [];
const hosts: { shutdown(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.shutdown()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** A development plugin whose `syncConnection` is `body`. */
async function fixturePlugin(body: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-plugin-events-"));
  directories.push(root);
  const directory = path.join(root, "jira");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "jira",
      version: "1.2.3",
      apiVersion: 3,
      displayName: "Jira",
      description: "Test plugin.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      capabilities: { connector: {} },
      connectionFields: [
        { id: "label", label: "Label", type: "text", required: true },
        { id: "tenantLabel", label: "Site", type: "text", required: true },
        {
          id: "token",
          label: "Token",
          type: "password",
          required: true,
          secret: true,
        },
      ],
    }),
  );
  await writeFile(
    path.join(directory, "plugin.mjs"),
    `export async function syncConnection(connection) {\n${body}\n}\n`,
  );
  return { root, directory };
}

async function pluginHost(
  body: string,
  options: Partial<ConstructorParameters<typeof PluginManager>[0]> = {},
) {
  const { root, directory } = await fixturePlugin(body);
  const sink = createRecordingSink<AjourEvent>();
  const events = createApiEvents({ sink, userDataPath: root });
  const host = new PluginManager({
    installedPluginDirectory: path.join(root, "installed"),
    developmentPluginDirectories: [directory],
    allowDevelopmentPlugins: true,
    requestTimeoutMs: 5_000,
    events,
    ...options,
  });
  hosts.push(host);
  return { host, events, logged: sink.events };
}

const connection = {
  id: "connection-1",
  pluginId: "jira",
  label: "Work",
  tenantLabel: "Example",
  autoSync: false,
  autoSyncIntervalMinutes: 15,
  connectedAt: 1,
  config: { token: SECRET },
};

const operations = (logged: AjourEvent[]) =>
  logged.filter((event) => event.kind === "plugin_operation");

const hang = "await new Promise(() => setInterval(() => {}, 1000));";

/** Waits until the host has registered `count` operations, so they can be cancelled. */
async function registered(host: PluginManager, count: number) {
  while (host.activeOperationCount < count) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("plugin operation events", () => {
  it("records a worker run with the plugin, its connection and its durations", async () => {
    const { host, logged } = await pluginHost(
      "return { items: [], workItemUpdates: [] };",
    );

    await host.syncConnection("jira", connection);

    expect(operations(logged)).toEqual([
      expect.objectContaining({
        name: "backlog.sync",
        kind: "plugin_operation",
        runtime: "api",
        outcome: "ok",
        plugin: {
          id: "jira",
          version: "1.2.3",
          source: "development",
          api_version: 3,
        },
        connection: { id: "connection-1" },
        worker: {
          host: "plugin",
          method: "syncConnection",
          capability: "connector",
          active_operations: 0,
          prepare_ms: expect.any(Number),
          worker_ms: expect.any(Number),
          timeout_ms: 5_000,
          result_bytes: expect.any(Number),
        },
      }),
    ]);
    expect(operations(logged)[0]?.worker?.result_bytes).toBeGreaterThan(0);
  });

  it("is a child span of the unit that started it", async () => {
    const { host, events, logged } = await pluginHost(
      "return { items: [], workItemUpdates: [] };",
    );

    await events.run(
      "backlog.sync",
      { kind: "request", trigger: "system" },
      () => host.syncConnection("jira", connection),
    );

    const request = logged.find((event) => event.kind === "request");
    const [operation] = operations(logged);
    expect(operation).toMatchObject({
      trace_id: request?.trace_id,
      parent_span_id: request?.span_id,
    });
  });

  it("refuses an operation over capacity, and cancels the rest at shutdown", async () => {
    const { host, logged } = await pluginHost(hang);
    const running = Array.from({ length: 4 }, () =>
      host.syncConnection("jira", connection).catch(() => undefined),
    );
    await registered(host, 4);

    await expect(host.syncConnection("jira", connection)).rejects.toThrow(
      "Too many",
    );
    await host.shutdown();
    await Promise.all(running);

    const outcomes = operations(logged).map(
      ({ outcome, outcome_reason }) => `${outcome}:${outcome_reason}`,
    );
    expect(outcomes.sort()).toEqual([
      "cancelled:shutdown",
      "cancelled:shutdown",
      "cancelled:shutdown",
      "cancelled:shutdown",
      "refused:capacity",
    ]);
    expect(
      operations(logged).find((event) => event.outcome === "refused")?.worker,
    ).toMatchObject({ active_operations: 4 });
  });

  it("refuses an operation its gate turns away, with the gate's reason", async () => {
    const { host, logged } = await pluginHost(
      "return { items: [], workItemUpdates: [] };",
      {
        operationGate: async () => {
          throw new PluginOperationRefused(
            "Turn on backlog items first.",
            "capability_off",
          );
        },
      },
    );

    await expect(host.syncConnection("jira", connection)).rejects.toThrow(
      "Turn on backlog items first.",
    );

    expect(operations(logged)).toEqual([
      expect.objectContaining({
        outcome: "refused",
        outcome_reason: "capability_off",
      }),
    ]);
  });

  it("refuses an operation for a plugin that isn't installed", async () => {
    const { host, logged } = await pluginHost(
      "return { items: [], workItemUpdates: [] };",
    );

    await expect(host.validateConnection("missing", {})).rejects.toThrow(
      "not installed",
    );

    expect(operations(logged)).toEqual([
      expect.objectContaining({
        outcome: "refused",
        outcome_reason: "not_installed",
      }),
    ]);
  });

  it("records a timeout", async () => {
    const { host, logged } = await pluginHost(hang, { requestTimeoutMs: 50 });

    await expect(host.syncConnection("jira", connection)).rejects.toThrow(
      "timed out",
    );

    expect(operations(logged)).toEqual([
      expect.objectContaining({
        outcome: "timeout",
        outcome_reason: "timeout",
        worker: expect.objectContaining({ timeout_ms: 50 }),
      }),
    ]);
  });

  it("records each cancellation with its reason", async () => {
    const { host, logged } = await pluginHost(hang);
    // Each rejection is handled from the start: they settle while the
    // cancel is awaited.
    const turnedOff = expect(
      host.syncConnection("jira", connection),
    ).rejects.toThrow("turned off");
    const alsoTurnedOff = expect(
      host.syncConnection("jira", connection),
    ).rejects.toThrow("turned off");
    await registered(host, 2);

    await host.cancelCapabilityOperations(
      "jira",
      "connector",
      new Error("Backlog items were turned off."),
    );
    await Promise.all([turnedOff, alsoTurnedOff]);
    const more = expect(
      host.syncConnection("jira", connection),
    ).rejects.toThrow("deactivated");
    await registered(host, 1);
    await host.cancelPluginOperations(
      "jira",
      new Error("Plugin was deactivated."),
      "plugin_off",
    );
    await more;

    expect(
      operations(logged).map(({ outcome, outcome_reason }) => [
        outcome,
        outcome_reason,
      ]),
    ).toEqual([
      ["cancelled", "capability_off"],
      ["cancelled", "capability_off"],
      ["cancelled", "plugin_off"],
    ]);
  });

  it("records a result over the size limit", async () => {
    const { host, logged } = await pluginHost(
      "return { items: [], workItemUpdates: [], padding: 'x'.repeat(9 * 1024 * 1024) };",
    );

    await expect(host.syncConnection("jira", connection)).rejects.toThrow(
      "exceeds the allowed size",
    );

    expect(operations(logged)).toEqual([
      expect.objectContaining({
        outcome: "error",
        outcome_reason: "result_too_large",
        worker: expect.objectContaining({
          result_bytes: expect.any(Number),
        }),
      }),
    ]);
    expect(operations(logged)[0]?.worker?.result_bytes).toBeGreaterThan(
      8 * 1024 * 1024,
    );
  });

  it("records a result that breaks the contract, without its content", async () => {
    const { host, logged } = await pluginHost(
      "return { items: 'Secret roadmap item', workItemUpdates: [] };",
    );

    await expect(host.syncConnection("jira", connection)).rejects.toThrow();

    expect(operations(logged)).toEqual([
      expect.objectContaining({
        outcome: "error",
        outcome_reason: "invalid_result",
        error: expect.objectContaining({ type: "ZodError" }),
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("Secret roadmap item");
  });

  it("records a worker that exits before it answers", async () => {
    const { host, logged } = await pluginHost("process.exit(3);");

    await expect(host.syncConnection("jira", connection)).rejects.toThrow(
      "exited before returning a result",
    );

    expect(operations(logged)).toEqual([
      expect.objectContaining({
        outcome: "error",
        outcome_reason: "exited_early",
      }),
    ]);
  });

  it("records a plugin error, scrubbed of the connection's secrets", async () => {
    const { host, logged } = await pluginHost(
      "throw new Error(`Rejected token ${connection.config.token}`);",
    );

    await expect(host.syncConnection("jira", connection)).rejects.toThrow(
      "Rejected token",
    );

    expect(operations(logged)).toEqual([
      expect.objectContaining({
        outcome: "error",
        outcome_reason: "plugin_error",
        error: expect.objectContaining({
          type: "Error",
          message: "Rejected token [secret]",
        }),
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain(SECRET);
  });

  it("records a schema plugin's run from the schema host", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-schema-events-"));
    directories.push(root);
    const directory = path.join(root, "workday");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "plugin.json"),
      JSON.stringify({
        id: "workday",
        version: "2.0.0",
        apiVersion: 1,
        displayName: "Workday",
        description: "Test schema.",
        iconSvg: ICON,
        entrypoint: "plugin.mjs",
        capabilities: {
          projectDataShape: {
            apiVersion: 1,
            datasets: [
              {
                id: "projects",
                displayName: "Projects",
                columns: [
                  {
                    key: "project",
                    header: "project",
                    type: "string",
                    required: true,
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    await writeFile(
      path.join(directory, "plugin.mjs"),
      "export async function exportProjects(projects) { return { datasets: [{ id: 'projects', rows: projects.map((p) => ({ project: p.name })) }] }; }",
    );
    const sink = createRecordingSink<AjourEvent>();
    const host = new ProjectDataShapePluginManager({
      pluginDirectories: [directory],
      events: createApiEvents({ sink, userDataPath: root }),
    });
    hosts.push(host);

    await host.exportProjects("workday", [
      { name: "Secret client", color: "#123456", status: "active", tasks: [] },
    ]);

    expect(operations(sink.events)).toEqual([
      expect.objectContaining({
        name: "project.export",
        outcome: "ok",
        plugin: expect.objectContaining({ id: "workday", version: "2.0.0" }),
        worker: expect.objectContaining({
          host: "schema",
          method: "exportProjects",
        }),
      }),
    ]);
    expect(JSON.stringify(sink.events)).not.toContain("Secret client");
  });
});

/** A schema plugin whose `exportProjects` is `body`, and its host. */
async function schemaHost(body: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-schema-events-"));
  directories.push(root);
  const directory = path.join(root, "workday");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "workday",
      version: "2.0.0",
      apiVersion: 1,
      displayName: "Workday",
      description: "Test schema.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      capabilities: {
        projectDataShape: {
          apiVersion: 1,
          datasets: [
            {
              id: "projects",
              displayName: "Projects",
              columns: [
                {
                  key: "project",
                  header: "project",
                  type: "string",
                  required: true,
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    path.join(directory, "plugin.mjs"),
    `export async function exportProjects(projects) {\n${body}\n}\nexport async function importProjects() { return { projects: [] }; }\n`,
  );
  const sink = createRecordingSink<AjourEvent>();
  const host = new ProjectDataShapePluginManager({
    pluginDirectories: [directory],
    events: createApiEvents({ sink, userDataPath: root }),
  });
  hosts.push(host);
  return { host, logged: sink.events };
}

describe("plugin operation events: validation and pre-flight", () => {
  it("records a schema result that breaks its definition by type and code only", async () => {
    const { host, logged } = await schemaHost(
      "return { datasets: [{ id: 'Secret heading sheet', rows: [] }] };",
    );

    await expect(host.exportProjects("workday", [])).rejects.toThrow(
      "Secret heading sheet",
    );

    const [operation] = operations(logged);
    expect(operation).toMatchObject({
      outcome: "error",
      outcome_reason: "invalid_result",
      error: { type: "Error", code: "invalid_result" },
    });
    expect(operation?.error?.message).toBeUndefined();
    expect(JSON.stringify(logged)).not.toContain("Secret heading");
  });

  it("refuses an import past the sheet limits, without the sheet's text", async () => {
    const { host, logged } = await schemaHost("return { datasets: [] };");

    await expect(
      host.importProjects("workday", [
        { name: "Private heading ".repeat(20), rows: [["Acme"]] },
      ]),
    ).rejects.toThrow("at most 255");

    expect(operations(logged)).toEqual([
      expect.objectContaining({
        name: "project.import",
        outcome: "refused",
        outcome_reason: "invalid_request",
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("Private heading");
  });

  it("records a refusal its pre-flight finds through a real method", async () => {
    const { host, logged } = await pluginHost(
      "return { items: [], workItemUpdates: [] };",
    );

    await expect(
      host.syncConnection("missing", { ...connection, pluginId: "missing" }),
    ).rejects.toThrow("not installed");
    await expect(
      host.runCalendarOperation("jira", "listCalendarEvents", connection, {
        from: "2026-10-12",
        to: "2026-10-18",
        timeZone: "UTC",
      }),
    ).rejects.toThrow("does not provide calendar events");
    await expect(
      host.runCodeHostOperation("jira", "syncPullRequests", connection, {
        tracked: [],
      }),
    ).rejects.toThrow("does not provide pull requests");
    await expect(
      host.runBacklogCommentOperation("jira", "listItemComments", connection, {
        sourceId: "ENG-1",
        limit: 10,
      }),
    ).rejects.toThrow("does not provide comments");
    await expect(
      host.syncTeamProjects("jira", connection, { changes: [] }),
    ).rejects.toThrow("does not sync a team's projects");
    await expect(
      host.listSettleStates("jira", connection, { sourceId: "ENG-1" }),
    ).rejects.toThrow("does not support settling");
    await host.shutdown();
    await expect(host.syncConnection("jira", connection)).rejects.toThrow(
      "shutting down",
    );

    expect(
      operations(logged).map(({ name, outcome, outcome_reason }) => [
        name,
        outcome,
        outcome_reason,
      ]),
    ).toEqual([
      ["backlog.sync", "refused", "not_installed"],
      ["calendar.fetch", "refused", "not_supported"],
      ["pull_request.sync", "refused", "not_supported"],
      ["comment.list", "refused", "not_supported"],
      ["team.sync", "refused", "not_supported"],
      ["source_state.list", "refused", "not_supported"],
      ["backlog.sync", "refused", "host_stopping"],
    ]);
  });

  it("takes the trigger of the unit that started it", async () => {
    const { host, events, logged } = await pluginHost(
      "return { items: [], workItemUpdates: [] };",
    );

    await events.run(
      "backlog.sync",
      { kind: "request", trigger: "agent" },
      () => host.syncConnection("jira", connection),
    );
    await host.syncConnection("jira", connection);

    expect(operations(logged).map((event) => event.trigger)).toEqual([
      "agent",
      "system",
    ]);
  });
});

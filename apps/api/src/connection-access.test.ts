import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createAppApiServer } from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/*
 * Seam 1 of the spec #381 for connection access (#395): the app API with
 * an Azure DevOps plugin on plugin API 3, run in process. A connection
 * reads only until the user turns editing on, so a write is refused before
 * the plugin runs, a read sent as POST goes through, a sync uploads no
 * estimate, and the plugin's own answer never widens the access.
 */

const ICON = "<svg viewBox='0 0 16 16' />";

const MANIFEST = {
  id: "azure_devops",
  version: "1.1.0",
  apiVersion: 3,
  displayName: "Azure DevOps",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  capabilities: {
    connector: {
      settle: true,
      comments: {
        edit: true,
        delete: true,
        reactions: ["like"],
        mentions: true,
      },
      description: { write: true },
    },
    codeHost: {},
  },
  connectionFields: [
    { id: "label", label: "Connection label", type: "text", required: true },
    { id: "tenantLabel", label: "Tenant", type: "text", required: true },
    {
      id: "organizationUrl",
      label: "Organization URL",
      type: "url",
      required: true,
    },
    {
      id: "personalAccessToken",
      label: "Personal Access Token",
      type: "password",
      required: true,
      secret: true,
    },
    { id: "originalEstimateFieldName", label: "Original", type: "text" },
  ],
};

/**
 * The fixture plugin. Each call it runs lands on a global the test reads,
 * with the organisation its connection names. Its sync answers as the real
 * plugin decides: a field whose local value left the agreed one uploads.
 */
const PLUGIN_SOURCE = `
const calls = (globalThis.__adoCalls ??= []);
const record = (method, connection, request) =>
  calls.push({ method, connectionId: connection.id, organizationUrl: connection.config.organizationUrl, request });
const FIELDS = ["originalEstimateHours", "remainingEstimateHours", "completedEstimateHours"];

export async function validateConnection(config) {
  return { normalizedConfig: { ...config, ...(globalThis.__adoNormalize ?? {}) }, connectionSummary: {} };
}
export async function syncConnection(connection, workItems) {
  record("syncConnection", connection, workItems);
  const workItemUpdates = workItems.map((item) => ({
    localWorkItemId: item.localWorkItemId,
    sourceId: item.sourceId,
    fields: Object.fromEntries(FIELDS.flatMap((field) => {
      const state = item.estimateSync?.[field];
      if (item[field] === undefined && state === undefined) return [];
      const pushes = state?.resolution === "keep_local" || item[field] !== state?.baselineValue;
      if (pushes) record("pushEstimate", connection, { sourceId: item.sourceId, field, value: item[field] });
      return [[field, pushes
        ? { status: "pushed", localValue: item[field], baselineValue: state?.baselineValue, nextBaselineValue: item[field] }
        : { status: "noop", localValue: item[field], remoteValue: state?.remoteValue, baselineValue: state?.baselineValue, nextBaselineValue: state?.baselineValue }]];
    })),
  }));
  return { items: [], workItemUpdates };
}
export async function listSettleStates(connection, request) {
  record("listSettleStates", connection, request);
  return { states: [{ name: "Done", category: "Done", done: true }] };
}
export async function writeSettle(connection, request) {
  record("writeSettle", connection, request);
  if (globalThis.__adoSettleWait) await globalThis.__adoSettleWait;
  return { state: request.state };
}
export async function readDescription(connection, request) {
  record("readDescription", connection, request);
  return { description: { text: "Remote" } };
}
export async function writeDescription(connection, request) {
  record("writeDescription", connection, request);
  return { outcome: "written", description: { text: request.text } };
}
export async function listItemComments(connection, request) {
  record("listItemComments", connection, request);
  return { viewer: { id: "me", displayName: "Me" }, comments: [] };
}
export async function postItemComment(connection, request) {
  record("postItemComment", connection, request);
  throw new Error("Not in this test.");
}
export async function deleteItemComment(connection, request) {
  record("deleteItemComment", connection, request);
  return {};
}
export async function setItemCommentReaction(connection, request) {
  record("setItemCommentReaction", connection, request);
  return { reactions: [] };
}
export async function searchItemPeople(connection, request) {
  record("searchItemPeople", connection, request);
  return { people: [] };
}
export async function syncPullRequests(connection, request) {
  record("syncPullRequests", connection, request);
  return { pullRequests: [] };
}
`;

type Call = {
  method: string;
  connectionId: string;
  organizationUrl: string;
  request: unknown;
};

const calls = () =>
  (globalThis as { __adoCalls?: Call[] }).__adoCalls ?? ([] as Call[]);

describe("connection access", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    const holder = globalThis as {
      __adoCalls?: unknown;
      __adoNormalize?: unknown;
      __adoSettleWait?: unknown;
    };
    delete holder.__adoCalls;
    delete holder.__adoNormalize;
    delete holder.__adoSettleWait;
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function setup(initialState?: object) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-access-"));
    tempDirs.push(root);
    const pluginDirectory = path.join(root, "azure_devops");
    await mkdir(pluginDirectory, { recursive: true });
    await writeFile(
      path.join(pluginDirectory, "plugin.json"),
      JSON.stringify(MANIFEST),
    );
    await writeFile(path.join(pluginDirectory, "plugin.mjs"), PLUGIN_SOURCE);
    const statePath = path.join(root, "state.json");
    if (initialState) {
      await writeFile(statePath, JSON.stringify(initialState));
    }
    const vault = new MemorySecretVault();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault,
      statePath,
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      projectDataShapePluginDirectories: [],
      allowDevelopmentPlugins: true,
      pluginRuntime: new InProcessPluginRuntime(),
    });
    const post = (route: string, body: unknown) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: route,
        body: JSON.stringify(body),
      });
    const save = async (
      organization: string,
      extra: { id?: string; access?: string[] } = {},
    ) => {
      const saved = await post("/api/plugins/azure_devops/connections", {
        ...(extra.id ? { id: extra.id } : {}),
        values: {
          label: organization,
          tenantLabel: "Entra",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          organizationUrl: `https://dev.azure.com/${organization}`,
          personalAccessToken: extra.id ? "" : "shared-pat",
        },
        ...(extra.access ? { access: extra.access } : {}),
      });
      expect(saved.status).toBe(200);
      return (
        saved.body as {
          connection: { id: string; access?: string[] };
        }
      ).connection;
    };
    const overview = async () =>
      (
        await dispatchJsonRequest(server, {
          method: "GET",
          path: "/api/plugins",
        })
      ).body as {
        connectionGroups: {
          plugin: { id: string };
          connectionAccess?: { id: string; always: boolean }[];
          connections: {
            id: string;
            access?: string[];
            autoSync: boolean;
            editableValues: Record<string, unknown>;
          }[];
        }[];
      };
    return { server, post, save, overview, statePath };
  }

  const route = (connectionId: string, operation: string) =>
    `/api/plugins/azure_devops/connections/${connectionId}/${operation}`;
  const comments = (connectionId: string, operation: string) =>
    `/api/backlog-comments/azure_devops/connections/${connectionId}/${operation}`;

  it("starts a new connection reading only, and lists its choices", async () => {
    const { save, overview } = await setup();

    const connection = await save("contoso");

    expect(connection.access).toEqual(["readBacklog"]);
    const group = (await overview()).connectionGroups.find(
      (candidate) => candidate.plugin.id === "azure_devops",
    );
    expect(
      group?.connectionAccess?.map((choice) => [choice.id, choice.always]),
    ).toEqual([
      ["readBacklog", true],
      ["editWorkItems", false],
      ["pullRequests", false],
      ["peopleSearch", false],
    ]);
  });

  it("refuses every write on a connection that reads only before the plugin runs, and lets reads sent as POST through", async () => {
    const { post, save } = await setup();
    const { id } = await save("contoso");

    const refused = await Promise.all([
      post(route(id, "settle"), { sourceId: "1", state: "Done" }),
      post(route(id, "description-write"), {
        sourceId: "1",
        text: "Mine",
        expected: "Remote",
      }),
      post(comments(id, "postItemComment"), { sourceId: "1", body: "Hi" }),
      post(comments(id, "deleteItemComment"), {
        sourceId: "1",
        commentId: "7",
      }),
      post(comments(id, "setItemCommentReaction"), {
        sourceId: "1",
        commentId: "7",
        reaction: "like",
        reacted: true,
      }),
      post(comments(id, "searchItemPeople"), {
        sourceId: "1",
        query: "an",
        limit: 5,
      }),
      post(`/api/code-hosts/azure_devops/connections/${id}/syncPullRequests`, {
        tracked: [],
      }),
    ]);
    const reads = await Promise.all([
      post(route(id, "settle-states"), { sourceId: "1" }),
      post(route(id, "description"), { sourceId: "1" }),
      post(comments(id, "listItemComments"), { sourceId: "1", limit: 20 }),
      post(route(id, "sync"), { trigger: "manual", workItems: [] }),
    ]);
    // A bare @ reads only the item's own people.
    reads.push(
      await post(comments(id, "searchItemPeople"), {
        sourceId: "1",
        query: "",
        limit: 5,
      }),
    );

    expect(refused.map((answer) => answer.status)).toEqual([
      403, 403, 403, 403, 403, 403, 403,
    ]);
    expect(
      refused.map((answer) => (answer.body as { access: string }).access),
    ).toEqual([
      "editWorkItems",
      "editWorkItems",
      "editWorkItems",
      "editWorkItems",
      "editWorkItems",
      "peopleSearch",
      "pullRequests",
    ]);
    expect(refused[0]!.body).toEqual({
      error:
        'The "contoso" connection\'s access doesn\'t include "Edit work items". Turn it on in the connection\'s settings.',
      reason: "access_off",
      access: "editWorkItems",
    });
    expect(reads.map((answer) => answer.status)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    expect(
      calls()
        .map((call) => call.method)
        .sort(),
    ).toEqual([
      "listItemComments",
      "listSettleStates",
      "readDescription",
      "searchItemPeople",
      "syncConnection",
    ]);
  });

  it("writes once editing is on, and a plugin's answer never widens access", async () => {
    const { post, save, overview } = await setup();
    (globalThis as { __adoNormalize?: unknown }).__adoNormalize = {
      access: "editWorkItems",
    };
    const { id } = await save("contoso");
    expect(
      (await post(route(id, "settle"), { sourceId: "1", state: "Done" }))
        .status,
    ).toBe(403);

    const edited = await save("contoso", { id, access: ["editWorkItems"] });
    const written = await post(route(id, "settle"), {
      sourceId: "1",
      state: "Done",
    });

    expect(edited.access).toEqual(["readBacklog", "editWorkItems"]);
    expect(written.status).toBe(200);
    expect(calls().filter((call) => call.method === "writeSettle")).toEqual([
      expect.objectContaining({ request: { sourceId: "1", state: "Done" } }),
    ]);
    // Saving other settings keeps the access chosen.
    await save("contoso", { id });
    const connection = (await overview()).connectionGroups
      .find((group) => group.plugin.id === "azure_devops")
      ?.connections.find((candidate) => candidate.id === id);
    expect(connection?.access).toEqual(["readBacklog", "editWorkItems"]);
  });

  it("syncs a connection that reads only without uploading an estimate, and holds the change", async () => {
    const { post, save } = await setup();
    const { id } = await save("contoso");

    const synced = await post(route(id, "sync"), {
      trigger: "manual",
      workItems: [
        {
          localWorkItemId: "local-1",
          sourceId: "42",
          originalEstimateHours: 8,
          remainingEstimateHours: 2,
          estimateSync: {
            originalEstimateHours: { baselineValue: 8, remoteValue: 8 },
            remainingEstimateHours: { baselineValue: 5, remoteValue: 5 },
          },
        },
      ],
    });

    expect(synced.status).toBe(200);
    expect(calls().filter((call) => call.method === "pushEstimate")).toEqual(
      [],
    );
    expect(synced.body).toMatchObject({
      heldEstimates: [
        { localWorkItemId: "local-1", fields: ["remainingEstimateHours"] },
      ],
      workItemUpdates: [
        {
          localWorkItemId: "local-1",
          fields: { originalEstimateHours: { status: "noop" } },
        },
      ],
    });
    expect(
      (
        synced.body as {
          workItemUpdates: { fields: Record<string, unknown> }[];
        }
      ).workItemUpdates[0]!.fields,
    ).not.toHaveProperty("remainingEstimateHours");
  });

  it("uploads with editing on only the estimates the user approved", async () => {
    const { post, save } = await setup();
    const { id } = await save("contoso", { access: ["editWorkItems"] });

    const synced = await post(route(id, "sync"), {
      trigger: "manual",
      workItems: [
        {
          localWorkItemId: "waiting",
          sourceId: "41",
          remainingEstimateHours: 2,
          estimateSync: {
            remainingEstimateHours: {
              baselineValue: 5,
              remoteValue: 5,
              held: true,
            },
          },
        },
        {
          localWorkItemId: "approved",
          sourceId: "42",
          remainingEstimateHours: 1,
          estimateSync: {
            remainingEstimateHours: { baselineValue: 5, remoteValue: 5 },
          },
        },
      ],
    });

    expect(synced.status).toBe(200);
    expect(
      calls()
        .filter((call) => call.method === "pushEstimate")
        .map((call) => call.request),
    ).toEqual([{ sourceId: "42", field: "remainingEstimateHours", value: 1 }]);
    // Ajour's mark never reaches the plugin.
    expect(JSON.stringify(calls())).not.toContain("held");
    expect(synced.body).toMatchObject({
      heldEstimates: [
        { localWorkItemId: "waiting", fields: ["remainingEstimateHours"] },
      ],
    });
  });

  it("migrates a connection that uploaded estimates and edited descriptions to reading only, keeping its settings, and its first sync sends no change", async () => {
    const { post, overview } = await setup({
      version: 8,
      connections: [
        {
          id: "azure_main",
          pluginId: "azure_devops",
          label: "Contoso",
          tenantLabel: "Entra",
          autoSync: true,
          autoSyncIntervalMinutes: 30,
          allowLossyConversion: true,
          config: {
            organizationUrl: "https://dev.azure.com/contoso",
            originalEstimateFieldName: "Custom.Original",
          },
          configSummary: {},
          connectedAt: 1_700_000_000_000,
          lastSyncAt: 1_700_000_100_000,
        },
      ],
      stagedImports: [],
      dismissedImportKeys: [],
      connectorBacklogStatuses: [],
      disabledPluginIds: [],
      pluginsEnabled: true,
    });

    const connection = (await overview()).connectionGroups
      .find((group) => group.plugin.id === "azure_devops")
      ?.connections.find((candidate) => candidate.id === "azure_main");
    const synced = await post(route("azure_main", "sync"), {
      trigger: "auto",
      workItems: [
        {
          localWorkItemId: "local-1",
          sourceId: "42",
          originalEstimateHours: 13,
          completedEstimateHours: 4,
          estimateSync: {
            originalEstimateHours: { baselineValue: 8, remoteValue: 8 },
            completedEstimateHours: {
              baselineValue: 1,
              remoteValue: 3,
              resolution: "keep_local",
            },
          },
        },
      ],
    });
    const description = await post(route("azure_main", "description-write"), {
      sourceId: "42",
      text: "Mine",
      expected: "Remote",
    });

    expect(connection).toMatchObject({
      access: ["readBacklog"],
      autoSync: true,
      editableValues: {
        organizationUrl: "https://dev.azure.com/contoso",
        originalEstimateFieldName: "Custom.Original",
        autoSyncIntervalMinutes: 30,
      },
    });
    expect(synced.status).toBe(200);
    expect(synced.body).toMatchObject({
      heldEstimates: [
        {
          localWorkItemId: "local-1",
          fields: ["originalEstimateHours", "completedEstimateHours"],
        },
      ],
    });
    expect(description.status).toBe(403);
    // The sync ran, and nothing it could send was a change.
    expect(calls().map((call) => call.method)).toEqual(["syncConnection"]);
    expect(calls()[0]!.request).toEqual([
      {
        localWorkItemId: "local-1",
        sourceId: "42",
        originalEstimateHours: 8,
        completedEstimateHours: 1,
        estimateSync: {
          originalEstimateHours: { baselineValue: 8, remoteValue: 8 },
          completedEstimateHours: { baselineValue: 1, remoteValue: 3 },
        },
      },
    ]);
  });

  it("keeps two connections on one token apart: only the editing one writes, and only in its own organisation", async () => {
    const { post, save } = await setup();
    const readOnly = await save("contoso");
    const editing = await save("fabrikam", { access: ["editWorkItems"] });

    const refused = await post(route(readOnly.id, "settle"), {
      sourceId: "1",
      state: "Done",
    });
    const written = await post(route(editing.id, "settle"), {
      sourceId: "1",
      state: "Done",
    });

    expect(refused.status).toBe(403);
    expect(written.status).toBe(200);
    expect(calls().filter((call) => call.method === "writeSettle")).toEqual([
      expect.objectContaining({
        connectionId: editing.id,
        organizationUrl: "https://dev.azure.com/fabrikam",
      }),
    ]);
  });

  it("cancels a write still running when editing is turned off, and refuses the next", async () => {
    const { post, save } = await setup();
    const { id } = await save("contoso", { access: ["editWorkItems"] });
    let release!: () => void;
    (globalThis as { __adoSettleWait?: unknown }).__adoSettleWait =
      new Promise<void>((resolve) => {
        release = resolve;
      });

    const running = post(route(id, "settle"), {
      sourceId: "1",
      state: "Done",
    });
    await waitUntil(() =>
      calls().some((call) => call.method === "writeSettle"),
    );
    await save("contoso", { id, access: [] });
    const answer = await running;
    release();
    const next = await post(route(id, "settle"), {
      sourceId: "2",
      state: "Done",
    });

    expect(answer).toMatchObject({
      status: 403,
      body: { reason: "access_off", access: "editWorkItems" },
    });
    expect(next.status).toBe(403);
    expect(
      calls().filter((call) => call.method === "writeSettle"),
    ).toHaveLength(1);
  });

  it("writes the migration's version and the empty access to the state file", async () => {
    const { overview, statePath } = await setup({
      version: 8,
      connections: [
        {
          id: "azure_main",
          pluginId: "azure_devops",
          label: "Contoso",
          tenantLabel: "Entra",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          config: { organizationUrl: "https://dev.azure.com/contoso" },
          configSummary: {},
          connectedAt: 1_700_000_000_000,
        },
      ],
    });

    await overview();
    const saved = JSON.parse(await readFile(statePath, "utf8")) as {
      version: number;
      connections: { access?: string[] }[];
    };

    expect(saved.version).toBe(9);
    expect(saved.connections[0]!.access).toEqual([]);
  });
});

async function waitUntil(condition: () => boolean) {
  for (let tries = 0; tries < 200; tries += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("The condition never held.");
}

import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createAppApiServer } from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

// Seam 1: the local API with a fake runtime and a fake vault. What a user
// sees of a saved secret: its state, its dates, Remove, a rejected token,
// and the vault's own failures. No answer holds a secret.

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";
const SITE = "https://acme.atlassian.net";
const TOKEN = "pat-0a91c7e35b2d4f68";
const NEW_TOKEN = "pat-7d4e1b90a3c85f26";
const AGENT_KEY = "wd-key-5b8e0c3a9d17";
const FEED = "https://cal.example/private/feed-6d20c4e9.ics";
const SECRETS = [TOKEN, NEW_TOKEN, AGENT_KEY, FEED, "pw-3e91ab", "memo-0b17"];
const DAY = 86_400_000;
const FROZEN =
  "Ajour couldn't read its vault file (EPERM), so it changes nothing in it until it starts again.";
const REFUSAL =
  "Ajour can't change saved secrets right now: Ajour couldn't read its vault file (EPERM), so it changes nothing in it until it starts again. Restart Ajour and try again.";

const baseFields = [
  { id: "label", label: "Label", type: "text", required: true },
  { id: "tenantLabel", label: "Site", type: "text", required: true },
  { id: "baseUrl", label: "Site URL", type: "url", required: true },
];

/** A plugin whose sync fails with the HTTP status its `failWith` setting names. */
const service = {
  id: "service",
  connectionFields: [
    ...baseFields,
    { id: "failWith", label: "Fail with", type: "text" },
    {
      id: "token",
      label: "API token",
      type: "password",
      secret: true,
      required: true,
    },
    // A secret the plugin doesn't require.
    { id: "note", label: "Note", type: "password", secret: true },
    // A secret address: a url field, which a form once showed as text.
    { id: "feed", label: "Feed address", type: "url", secret: true },
  ],
  capabilities: {
    connector: {},
    agentTask: {
      tasks: [
        {
          id: "enter-week",
          label: "Enter",
          placement: "commit-week",
          prompt: "prompts/enter-week.md",
          estimateMinutes: 5,
          settings: [
            { id: "apiKey", label: "API key", type: "password", secret: true },
            { id: "region", label: "Region", type: "text" },
          ],
        },
      ],
    },
  },
  source: [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: {} };",
    "}",
    "export async function syncConnection(connection) {",
    // A test holds the call open by setting this promise, to answer late.
    "  if (globalThis.__serviceGate) await globalThis.__serviceGate;",
    "  const status = Number(connection.config.failWith);",
    "  if (status) {",
    "    const error = new Error('The service answered ' + status + '.');",
    "    error.status = status;",
    "    throw error;",
    "  }",
    "  return { items: [], workItemUpdates: [] };",
    "}",
  ].join("\n"),
};

/** A plugin that is installed in the first launch only. */
const gone = {
  id: "gone",
  connectionFields: [
    ...baseFields,
    { id: "password", label: "Password", type: "password", secret: true },
  ],
  capabilities: { connector: {} },
  source: service.source,
};

interface Fixture {
  id: string;
  connectionFields: object[];
  capabilities: object;
  source: string;
}

async function writePlugin(parent: string, plugin: Fixture) {
  const directory = path.join(parent, plugin.id);
  await mkdir(path.join(directory, "prompts"), { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: plugin.id,
      version: "1.0.0",
      apiVersion: 3,
      displayName: plugin.id,
      description: "Test plugin.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      capabilities: plugin.capabilities,
      connectionFields: plugin.connectionFields,
    }),
  );
  await writeFile(
    path.join(directory, "prompts", "enter-week.md"),
    "Enter week {{weekOf}}.",
  );
  await writeFile(path.join(directory, "plugin.mjs"), plugin.source);
  return directory;
}

type Summary = {
  id: string;
  editableValues: Record<string, unknown>;
  lastError?: string;
  secretFields?: Array<{
    id: string;
    state: string;
    setAt?: number;
    lastUsedAt?: number;
    expiresAt?: number;
  }>;
  sealedConfig?: { state: string };
  paused?: { reason: string; message: string };
};

/** The events a launch recorded under `name`. */
function removeEvents(events: readonly AjourEvent[], name: string) {
  return events.filter((event) => event.name === name);
}

describe("saved secret states", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];
  const seen: unknown[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) server.emit("close");
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
    // No answer of any launch holds a secret.
    const text = JSON.stringify(seen.splice(0));
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  async function launch(
    options: {
      directory?: string;
      vault?: MemorySecretVault;
      plugins?: Fixture[];
    } = {},
  ) {
    const directory =
      options.directory ??
      (await mkdtemp(path.join(os.tmpdir(), "ajour-secret-states-")));
    if (!options.directory) tempDirs.push(directory);
    const vault = options.vault ?? new MemorySecretVault();
    const sink = createRecordingSink<AjourEvent>();
    seen.push(sink.events);
    const pluginDirectories = await Promise.all(
      (options.plugins ?? [service]).map((plugin) =>
        writePlugin(path.join(directory, "source"), plugin),
      ),
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault,
      pluginRuntime: new InProcessPluginRuntime(),
      statePath: path.join(directory, "state.json"),
      installedPluginDirectory: path.join(directory, "installed"),
      developmentPluginDirectories: pluginDirectories,
      allowDevelopmentPlugins: true,
      eventSink: sink,
    });
    servers.push(server);
    const send = async (method: string, pathname: string, body?: object) => {
      const response = await dispatchJsonRequest(server, {
        method,
        path: pathname,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      seen.push(response);
      return response;
    };
    const overview = async () => {
      const response = await send("GET", "/api/plugins");
      expect(response.status).toBe(200);
      return response.body as {
        vault: { state: string; reason?: string };
        connectionGroups: Array<{
          plugin: { id: string };
          connections: Summary[];
          agentTaskSecretFields?: Array<{ id: string; state: string }>;
          missing?: boolean;
        }>;
      };
    };
    const connectionOf = async (pluginId: string, id: string) =>
      (await overview()).connectionGroups
        .filter((group) => group.plugin.id === pluginId)
        .flatMap((group) => group.connections)
        .find((candidate) => candidate.id === id);
    const save = (
      pluginId: string,
      values: object,
      extras: {
        id?: string;
        removeSecrets?: string[];
        secretExpiry?: Record<string, number | null>;
      } = {},
    ) =>
      send("POST", `/api/plugins/${pluginId}/connections`, {
        ...extras,
        values: {
          label: "Main",
          tenantLabel: "Acme",
          baseUrl: SITE,
          ...values,
        },
      });
    const connect = async (values: object = { token: TOKEN }) => {
      const saved = await save("service", values);
      expect(saved.status).toBe(200);
      return (saved.body as { connection: Summary }).connection.id;
    };
    return {
      directory,
      vault,
      events: sink.events,
      send,
      overview,
      connectionOf,
      save,
      connect,
      sync: (id: string) =>
        send("POST", `/api/plugins/service/connections/${id}/sync`, {
          trigger: "manual",
          workItems: [],
        }),
      removeSecrets: (id: string, fieldIds: string[]) =>
        send("POST", `/api/plugins/service/connections/${id}/secrets/remove`, {
          fieldIds,
        }),
    };
  }

  it("reports when each saved secret was set, last used, and when its reminder falls", async () => {
    const api = await launch();
    const expiresAt = Date.now() + 5 * DAY;
    const saved = await api.save(
      "service",
      { token: TOKEN },
      { secretExpiry: { token: expiresAt } },
    );
    const id = (saved.body as { connection: Summary }).connection.id;

    const before = await api.connectionOf("service", id);
    expect(before?.secretFields).toEqual([
      { id: "token", state: "saved", setAt: expect.any(Number), expiresAt },
    ]);
    expect(before?.secretFields?.[0]).not.toHaveProperty("lastUsedAt");

    await api.sync(id);

    const after = await api.connectionOf("service", id);
    expect(after?.secretFields?.[0]).toMatchObject({
      state: "saved",
      expiresAt,
      lastUsedAt: expect.any(Number),
    });
  });

  it("never sends a secret back, whatever its field's type, and keeps it out of the state file", async () => {
    const api = await launch();
    const id = await api.connect({ token: TOKEN, feed: FEED });

    const summary = await api.connectionOf("service", id);

    // The secret address is a url field, but it is a secret like the token.
    expect(summary?.editableValues).toMatchObject({ baseUrl: SITE });
    expect(summary?.editableValues).not.toHaveProperty("feed");
    expect(summary?.editableValues).not.toHaveProperty("token");
    expect(summary?.secretFields?.map((secret) => secret.id)).toEqual([
      "feed",
      "token",
    ]);
    expect(JSON.stringify(summary)).not.toContain(FEED);
    const state = await readFile(
      path.join(api.directory, "state.json"),
      "utf8",
    );
    expect(state).not.toContain(FEED);
    expect(state).not.toContain(TOKEN);
  });

  it("changes a reminder date without a new token, clears it, and starts a replaced token without one", async () => {
    const api = await launch();
    const first = Date.now() + 3 * DAY;
    const id = await api.connect();
    await api.save(
      "service",
      { token: "" },
      { id, secretExpiry: { token: first } },
    );
    expect(
      (await api.connectionOf("service", id))?.secretFields?.[0]?.expiresAt,
    ).toBe(first);

    await api.save(
      "service",
      { token: "" },
      { id, secretExpiry: { token: null } },
    );
    expect(
      (await api.connectionOf("service", id))?.secretFields?.[0],
    ).not.toHaveProperty("expiresAt");

    await api.save(
      "service",
      { token: "" },
      { id, secretExpiry: { token: first } },
    );
    // A new token has a reminder of its own, or none.
    await api.save("service", { token: NEW_TOKEN }, { id });
    expect(
      (await api.connectionOf("service", id))?.secretFields?.[0],
    ).not.toHaveProperty("expiresAt");
  });

  it("removes a saved secret and pauses the connection when the plugin requires it, until a new one is saved", async () => {
    const api = await launch();
    const id = await api.connect({ token: TOKEN, note: "memo-0b17" });

    const removed = await api.removeSecrets(id, ["token"]);

    expect(removed.status).toBe(200);
    expect(removeEvents(api.events, "connection.remove_secrets")).toEqual([
      expect.objectContaining({
        outcome: "ok",
        plugin: { id: "service" },
        connection: { id },
        secret: { field_count: 1 },
      }),
    ]);
    expect(api.vault.contents().map((entry) => entry.fieldId)).toEqual([
      "note",
    ]);
    const summary = await api.connectionOf("service", id);
    expect(summary?.secretFields).toEqual([
      { id: "note", state: "saved", setAt: expect.any(Number) },
    ]);
    expect(summary?.paused).toMatchObject({ reason: "secret_removed" });
    await expect(api.sync(id)).resolves.toMatchObject({
      status: 409,
      body: {
        error: expect.stringContaining("token was removed"),
      },
    });
    // Its other settings are kept.
    expect(summary?.editableValues).toMatchObject({ baseUrl: SITE });

    await api.save("service", { token: NEW_TOKEN }, { id });

    expect((await api.connectionOf("service", id))?.paused).toBeUndefined();
    await expect(api.sync(id)).resolves.toMatchObject({ status: 200 });
  });

  it("doesn't pause a connection when the secret removed is optional", async () => {
    const api = await launch();
    const id = await api.connect({ token: TOKEN, note: "memo-0b17" });

    await api.removeSecrets(id, ["note"]);

    expect((await api.connectionOf("service", id))?.paused).toBeUndefined();
    await expect(api.sync(id)).resolves.toMatchObject({ status: 200 });
  });

  it("refuses to remove a field that isn't secret, or a connection that doesn't exist", async () => {
    const api = await launch();
    const id = await api.connect();

    await expect(api.removeSecrets(id, ["baseUrl"])).resolves.toMatchObject({
      status: 400,
    });
    await expect(api.removeSecrets("nope", ["token"])).resolves.toMatchObject({
      status: 404,
    });
    expect(api.vault.contents()).toHaveLength(1);
    expect(
      removeEvents(api.events, "connection.remove_secrets").map((event) => [
        event.outcome,
        event.outcome_reason,
      ]),
    ).toEqual([
      ["refused", "not_secret"],
      ["refused", "connection_not_found"],
    ]);
  });

  it("marks the secret rejected after a 401, pauses the connection, and resumes it when the token is replaced", async () => {
    const api = await launch();
    const id = await api.connect({ token: TOKEN, failWith: "401" });

    const failed = await api.sync(id);

    expect(failed.status).toBe(502);
    const rejected = await api.connectionOf("service", id);
    expect(rejected?.secretFields?.[0]).toMatchObject({
      id: "token",
      state: "rejected",
    });
    expect(rejected?.paused).toMatchObject({ reason: "secret_rejected" });
    await expect(api.sync(id)).resolves.toMatchObject({
      status: 409,
      body: { error: expect.stringContaining("rejected") },
    });

    // Replace the token, and the service answers.
    await api.save("service", { token: NEW_TOKEN, failWith: "" }, { id });

    const resumed = await api.connectionOf("service", id);
    expect(resumed?.paused).toBeUndefined();
    expect(resumed?.secretFields?.[0]).toMatchObject({ state: "saved" });
    await expect(api.sync(id)).resolves.toMatchObject({ status: 200 });
  });

  it("marks a secret rejected only after a 401, not another status", async () => {
    const api = await launch();
    const id = await api.connect({ token: TOKEN, failWith: "403" });

    await api.sync(id);

    const summary = await api.connectionOf("service", id);
    expect(summary?.secretFields?.[0]?.state).toBe("saved");
    expect(summary?.paused).toBeUndefined();
    expect(summary?.lastError).toContain("403");
  });

  it("keeps a rejected mark when the form saves other settings, and clears it when the same token is given again", async () => {
    const api = await launch();
    const id = await api.connect({ token: TOKEN, failWith: "401" });
    await api.sync(id);

    await api.save("service", { token: "", failWith: "401" }, { id });
    expect(
      (await api.connectionOf("service", id))?.secretFields?.[0]?.state,
    ).toBe("rejected");

    await api.save("service", { token: TOKEN, failWith: "401" }, { id });
    expect(
      (await api.connectionOf("service", id))?.secretFields?.[0]?.state,
    ).toBe("saved");
  });

  it("saves a non-secret setting while the vault can't be changed, though the form sends every reminder date", async () => {
    const api = await launch();
    const date = Date.now() + 3 * DAY;
    const id = await api.connect({ token: TOKEN, note: "memo-0b17" });
    await api.save(
      "service",
      { token: "", note: "" },
      { id, secretExpiry: { token: date, note: null } },
    );
    api.vault.faults.frozen = FROZEN;

    // The form sends a date for every secret, changed or not.
    const renamed = await api.save(
      "service",
      { label: "Renamed", token: "", note: "" },
      { id, secretExpiry: { token: date, note: null } },
    );

    expect(renamed.status).toBe(200);
    expect(await api.connectionOf("service", id)).toMatchObject({
      editableValues: { label: "Renamed" },
      secretFields: [
        { id: "note", state: "saved" },
        { id: "token", state: "saved", expiresAt: date },
      ],
    });
    // A date that changes is still refused: the vault holds it.
    await expect(
      api.save(
        "service",
        { token: "", note: "" },
        { id, secretExpiry: { token: null } },
      ),
    ).resolves.toEqual({ status: 400, body: { error: REFUSAL } });
    expect(
      (await api.connectionOf("service", id))?.secretFields?.[1]?.expiresAt,
    ).toBe(date);
  });

  it("saves an agent task's non-secret setting while the vault can't be changed", async () => {
    const api = await launch();
    const date = Date.now() + 3 * DAY;
    await api.send("POST", "/api/agents/plugins/service/settings", {
      values: { apiKey: AGENT_KEY, region: "eu" },
      secretExpiry: { apiKey: date },
    });
    api.vault.faults.frozen = FROZEN;

    const saved = await api.send(
      "POST",
      "/api/agents/plugins/service/settings",
      {
        values: { apiKey: "", region: "us" },
        secretExpiry: { apiKey: date },
      },
    );

    expect(saved.status).toBe(200);
    const agents = await api.send("GET", "/api/agents");
    expect(
      (
        agents.body as {
          tasks: Array<{ pluginValues?: unknown; secretFields?: unknown }>;
        }
      ).tasks[0]?.secretFields,
    ).toEqual([
      {
        id: "apiKey",
        state: "saved",
        setAt: expect.any(Number),
        expiresAt: date,
      },
    ]);
    expect(JSON.stringify(agents.body)).toContain('"us"');
  });

  it("refuses Remove while the vault can't be changed, and changes nothing", async () => {
    const api = await launch();
    const id = await api.connect();
    api.vault.faults.frozen = FROZEN;

    const refused = await api.removeSecrets(id, ["token"]);

    expect(refused).toEqual({ status: 400, body: { error: REFUSAL } });
    expect(api.vault.contents().map((entry) => entry.fieldId)).toEqual([
      "token",
    ]);
    const summary = await api.connectionOf("service", id);
    expect(summary?.paused).toBeUndefined();
    expect(summary?.secretFields?.[0]).toMatchObject({ state: "saved" });
    expect(removeEvents(api.events, "connection.remove_secrets")).toEqual([
      expect.objectContaining({
        outcome: "refused",
        outcome_reason: "vault_unavailable",
      }),
    ]);
  });

  it("refuses to delete a missing plugin's data while the vault can't be changed, and changes nothing", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ajour-secret-states-"),
    );
    tempDirs.push(directory);
    const vault = new MemorySecretVault();
    const first = await launch({ directory, vault, plugins: [service, gone] });
    expect((await first.save("gone", { password: "pw-3e91ab" })).status).toBe(
      200,
    );
    for (const server of servers.splice(0)) server.emit("close");
    const relaunched = vault.relaunch();
    const api = await launch({ directory, vault: relaunched });
    relaunched.faults.frozen = FROZEN;

    const refused = await api.send("DELETE", "/api/plugins/gone/data");

    expect(refused).toEqual({ status: 400, body: { error: REFUSAL } });
    expect(relaunched.contents()).toHaveLength(1);
    const group = (await api.overview()).connectionGroups.find(
      (candidate) => candidate.plugin.id === "gone",
    );
    expect(group?.connections).toHaveLength(1);
    expect(removeEvents(api.events, "plugin.remove_data")).toEqual([
      expect.objectContaining({
        outcome: "refused",
        outcome_reason: "vault_unavailable",
      }),
    ]);
  });

  it("doesn't mark a token replaced while the call ran when the service's 401 arrives late", async () => {
    const api = await launch();
    const id = await api.connect({ token: TOKEN, failWith: "401" });
    let release!: () => void;
    (globalThis as { __serviceGate?: Promise<void> }).__serviceGate =
      new Promise<void>((resolve) => {
        release = resolve;
      });
    try {
      const reads = api.vault.decryptAttempts;
      const late = api.sync(id);
      // The call has read the old token and waits for the service.
      while (api.vault.decryptAttempts === reads) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      // The user replaces the token meanwhile.
      await api.save("service", { token: NEW_TOKEN, failWith: "" }, { id });
      release();

      const answered = await late;

      expect(answered.status).toBe(502);
    } finally {
      delete (globalThis as { __serviceGate?: Promise<void> }).__serviceGate;
    }
    const summary = await api.connectionOf("service", id);
    expect(summary?.secretFields?.[0]).toMatchObject({ state: "saved" });
    expect(summary?.paused).toBeUndefined();
  });

  it("lists the agent task secrets with their states, and removes one", async () => {
    const api = await launch();
    await api.send("POST", "/api/agents/plugins/service/settings", {
      values: { apiKey: AGENT_KEY },
      secretExpiry: { apiKey: Date.now() + 2 * DAY },
    });

    const group = (await api.overview()).connectionGroups[0];
    expect(group?.agentTaskSecretFields).toEqual([
      {
        id: "apiKey",
        state: "saved",
        setAt: expect.any(Number),
        expiresAt: expect.any(Number),
      },
    ]);

    await api.send("POST", "/api/agents/plugins/service/settings", {
      values: {},
      removeSecrets: ["apiKey"],
    });

    expect(
      (await api.overview()).connectionGroups[0]?.agentTaskSecretFields,
    ).toBeUndefined();
    expect(api.vault.contents()).toEqual([]);
  });

  it("tells the agent tasks' settings pages which secrets are saved, without a value", async () => {
    const api = await launch();
    await api.send("POST", "/api/plugins/service/activation", {
      enabled: true,
    });
    await api.send("POST", "/api/agents/plugins/service/settings", {
      values: { apiKey: AGENT_KEY },
    });

    const agents = await api.send("GET", "/api/agents");

    expect(agents.status).toBe(200);
    expect(
      (
        agents.body as {
          tasks: Array<{ secretFields?: Array<{ id: string; state: string }> }>;
        }
      ).tasks[0]?.secretFields,
    ).toEqual([{ id: "apiKey", state: "saved", setAt: expect.any(Number) }]);
  });

  it("opens the vault again on request, and moves what waited for it", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ajour-secret-states-"),
    );
    tempDirs.push(directory);
    const vault = new MemorySecretVault({
      unavailable: "The keychain is locked.",
    });
    const api = await launch({ directory, vault });
    expect((await api.overview()).vault).toEqual({
      state: "unavailable",
      reason: "The keychain is locked.",
    });

    // The keychain unlocks.
    vault.launch.unavailable = undefined;
    const retried = await api.send("POST", "/api/vault/retry");

    expect(retried.status).toBe(200);
    expect((retried.body as { vault: unknown }).vault).toEqual({
      state: "available",
    });
    expect(removeEvents(api.events, "vault.retry")).toEqual([
      expect.objectContaining({ outcome: "ok", vault: { state: "available" } }),
    ]);
    await expect(api.connect()).resolves.toEqual(expect.any(String));
  });

  it("answers 'Try again' with the failure when it persists", async () => {
    const vault = new MemorySecretVault({ unavailable: "No keyring." });
    const api = await launch({ vault });

    const retried = await api.send("POST", "/api/vault/retry");

    expect(retried.status).toBe(200);
    expect((retried.body as { vault: unknown }).vault).toEqual({
      state: "unavailable",
      reason: "No keyring.",
    });
  });

  it("removes a missing plugin's connections and secrets, and refuses an installed plugin's", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ajour-secret-states-"),
    );
    tempDirs.push(directory);
    const vault = new MemorySecretVault();
    const first = await launch({
      directory,
      vault,
      plugins: [service, gone],
    });
    const saved = await first.save("gone", { password: "pw-3e91ab" });
    expect(saved.status).toBe(200);
    await first.connect();
    for (const server of servers.splice(0)) server.emit("close");

    const api = await launch({ directory, vault: vault.relaunch() });
    const missing = (await api.overview()).connectionGroups.find(
      (group) => group.plugin.id === "gone",
    );
    expect(missing?.connections).toHaveLength(1);
    // The overview says it stands in for a plugin that isn't installed.
    expect(missing?.missing).toBe(true);
    expect(
      (await api.overview()).connectionGroups.find(
        (group) => group.plugin.id === "service",
      )?.missing,
    ).toBeUndefined();

    await expect(
      api.send("DELETE", "/api/plugins/service/data"),
    ).resolves.toMatchObject({ status: 409 });
    const removed = await api.send("DELETE", "/api/plugins/gone/data");
    expect(
      removeEvents(api.events, "plugin.remove_data").map((event) => [
        event.outcome,
        event.outcome_reason,
        event.plugin,
      ]),
    ).toEqual([
      ["refused", "installed", { id: "service" }],
      ["ok", undefined, { id: "gone" }],
    ]);

    expect(removed.status).toBe(200);
    expect(
      (
        removed.body as { connectionGroups: Array<{ plugin: { id: string } }> }
      ).connectionGroups.map((group) => group.plugin.id),
    ).toEqual(["service"]);
    expect(
      vault.contents().filter((entry) => entry.pluginId === "gone"),
    ).toEqual([]);
    expect(
      vault.contents().filter((entry) => entry.pluginId === "service"),
    ).toHaveLength(1);
  });

  it("lists a missing plugin's sealed settings by state, without a value", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ajour-secret-states-"),
    );
    tempDirs.push(directory);
    // A state file from before the vault, whose plugin is not installed:
    // nothing says which of its values are secret, so the vault seals them.
    await writeFile(
      path.join(directory, "state.json"),
      JSON.stringify({
        version: 7,
        connections: [
          {
            id: "gone_1",
            pluginId: "gone",
            label: "Gone",
            tenantLabel: "Acme",
            autoSync: false,
            autoSyncIntervalMinutes: 15,
            config: { baseUrl: SITE, password: "pw-3e91ab" },
            configSummary: {},
            connectedAt: 1,
          },
        ],
      }),
    );
    const api = await launch({
      directory,
      vault: new MemorySecretVault(),
      plugins: [service],
    });
    const group = (await api.overview()).connectionGroups.find(
      (candidate) => candidate.plugin.id === "gone",
    );

    expect(group?.connections[0]?.sealedConfig).toMatchObject({
      state: "saved",
    });
    expect(JSON.stringify(group)).not.toContain("pw-3e91ab");
  });
});

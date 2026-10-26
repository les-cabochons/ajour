import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { create } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  createAppApiServer,
  installPluginForServer,
  uninstallPluginForServer,
} from "./server.ts";
import { NO_VAULT_REASON } from "./secret-vault.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

// The state file's rename can be made to fail, as when the process dies
// before the state without plain text replaces the old one.
let failStateRename = false;
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(async (from: string, to: string) => {
      if (failStateRename && String(to).endsWith("state.json")) {
        throw Object.assign(new Error("Interrupted"), { code: "EIO" });
      }
      return actual.rename(from, to);
    }),
  };
});

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";
const SITE = "https://acme.atlassian.net";
const TOKEN = "pat-5f2c8e1a9b7d4063";
const AGENT_KEY = "wd-key-0b6e3a9c4f1d";
const GONE_PASSWORD = "gone-pw-6c1f93ab";
const SESSION = "sess-3d7a50e8c2b14f69";
/** Every secret the fixtures hold. None may show up outside the vault. */
const SECRETS = [TOKEN, AGENT_KEY, GONE_PASSWORD, SESSION];

const baseFields = [
  { id: "label", label: "Label", type: "text", required: true },
  { id: "tenantLabel", label: "Site", type: "text", required: true },
  { id: "baseUrl", label: "Site URL", type: "url", required: true },
];

/** A plugin whose sync succeeds only with the saved token. */
const jira = {
  id: "jira",
  connectionFields: [
    ...baseFields,
    { id: "token", label: "API token", type: "password", secret: true },
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
            { id: "url", label: "Timesheet URL", type: "url" },
            { id: "apiKey", label: "API key", type: "password", secret: true },
          ],
        },
      ],
    },
  },
  source: [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: { site: config.baseUrl } };",
    "}",
    "export async function syncConnection(connection) {",
    `  if (connection.config.token !== ${JSON.stringify(TOKEN)}) throw new Error('The plugin got no saved token.');`,
    "  return { items: [], workItemUpdates: [] };",
    "}",
  ].join("\n"),
};

/** A plugin without secrets. */
const notes = {
  id: "notes",
  connectionFields: baseFields,
  capabilities: { connector: {} },
  source: [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: {} };",
    "}",
    "export async function syncConnection() {",
    "  return { items: [], workItemUpdates: [] };",
    "}",
  ].join("\n"),
};

/** A plugin whose validation answers with a key its manifest doesn't declare. */
const trader = {
  id: "trader",
  connectionFields: baseFields,
  capabilities: { connector: {} },
  source: [
    "export async function validateConnection(config) {",
    `  return { normalizedConfig: { ...config, sessionId: ${JSON.stringify(SESSION)} }, connectionSummary: {} };`,
    "}",
    "export async function syncConnection() {",
    "  return { items: [], workItems: [], workItemUpdates: [] };",
    "}",
  ].join("\n"),
};

/** The plugin whose package went missing, when it comes back. */
const gone = {
  id: "gone",
  connectionFields: [
    ...baseFields,
    { id: "password", label: "Password", type: "password", secret: true },
  ],
  capabilities: { connector: {} },
  source: notes.source,
};

/** Jira after an update renamed its secret field: `token` is no longer declared. */
const jiraRenamed = {
  ...jira,
  connectionFields: [
    ...baseFields,
    {
      id: "accessToken",
      label: "Access token",
      type: "password",
      secret: true,
    },
  ],
};

/**
 * Jira after an update dropped `secret: true` from its token, with a sync
 * that echoes the token in its error.
 */
const jiraWithoutSecretFlag = {
  ...jira,
  connectionFields: [
    ...baseFields,
    { id: "token", label: "API token", type: "password" },
  ],
  source: [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: {} };",
    "}",
    "export async function syncConnection(connection) {",
    "  throw new Error('Token ' + connection.config.token + ' was refused.');",
    "}",
  ].join("\n"),
};

/** The missing plugin, back with other field ids than those its config holds. */
const goneRenamed = {
  ...gone,
  connectionFields: [
    ...baseFields,
    { id: "apiKey", label: "API key", type: "password", secret: true },
  ],
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

const connection = (
  id: string,
  pluginId: string,
  config: Record<string, unknown>,
  extras: object = {},
) => ({
  id,
  pluginId,
  label: id,
  tenantLabel: "Acme",
  autoSync: false,
  autoSyncIntervalMinutes: 15,
  config,
  configSummary: { site: SITE },
  connectedAt: 1,
  ...extras,
});

/** A state file from before the vault: every secret in plain text. */
const plainState = {
  version: 7,
  connections: [
    connection(
      "jira_main",
      "jira",
      { baseUrl: SITE, token: TOKEN },
      { lastError: `Token ${TOKEN} was refused.` },
    ),
    connection("notes_1", "notes", { baseUrl: SITE }),
    connection("gone_1", "gone", { baseUrl: SITE, password: GONE_PASSWORD }),
  ],
  // An inactive plugin's secrets move too.
  disabledPluginIds: ["jira"],
  agentRunner: {
    pluginValues: { jira: { url: "https://wd.example/t", apiKey: AGENT_KEY } },
  },
};

describe("secrets in the vault", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    failStateRename = false;
    for (const server of servers.splice(0)) server.emit("close");
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function root(seed?: object) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-vault-api-"));
    tempDirs.push(directory);
    if (seed) {
      await writeFile(path.join(directory, "state.json"), JSON.stringify(seed));
    }
    return directory;
  }

  /** Every answer and event a launch gave, for the check that none holds a secret. */
  const seen: unknown[] = [];

  /** One launch of the API on `directory`'s state, with the plugins given. */
  async function launch(
    directory: string,
    options: { vault?: MemorySecretVault; plugins?: Fixture[] } = {},
  ) {
    const sink = createRecordingSink<AjourEvent>();
    seen.push(sink.events);
    const pluginDirectories = await Promise.all(
      (options.plugins ?? [jira, notes]).map((plugin) =>
        writePlugin(path.join(directory, "source"), plugin),
      ),
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      ...(options.vault ? { vault: options.vault } : {}),
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
    return {
      server,
      events: sink.events,
      overview: async () => {
        const response = await send("GET", "/api/plugins");
        expect(response.status).toBe(200);
        return response.body as {
          vault: unknown;
          connectionGroups: {
            plugin: { id: string };
            connections: {
              id: string;
              editableValues: object;
              secretFields?: object[];
              paused?: { reason: string; message: string };
            }[];
          }[];
        };
      },
      sync: (pluginId: string, connectionId: string) =>
        send(
          "POST",
          `/api/plugins/${pluginId}/connections/${connectionId}/sync`,
          { trigger: "manual", workItems: [] },
        ),
      save: (
        pluginId: string,
        values: object,
        id?: string,
        removeSecrets?: string[],
      ) =>
        send("POST", `/api/plugins/${pluginId}/connections`, {
          ...(id ? { id } : {}),
          ...(removeSecrets ? { removeSecrets } : {}),
          values: {
            label: "Saved",
            tenantLabel: "Acme",
            baseUrl: SITE,
            ...values,
          },
        }),
      activate: (pluginId: string, enabled: boolean) =>
        send("POST", `/api/plugins/${pluginId}/activation`, { enabled }),
      remove: (pluginId: string, connectionId: string) =>
        send("DELETE", `/api/plugins/${pluginId}/connections/${connectionId}`),
      saveAgentTask: (values: object) =>
        send("POST", "/api/agents/plugins/jira/settings", { values }),
    };
  }

  async function stateText(directory: string) {
    return await readFile(path.join(directory, "state.json"), "utf8");
  }

  async function storedConnection(directory: string, id: string) {
    const state = JSON.parse(await stateText(directory)) as {
      connections: { id: string }[];
    };
    return state.connections.find((candidate) => candidate.id === id);
  }

  function pausedOf(
    overview: Awaited<
      ReturnType<Awaited<ReturnType<typeof launch>>["overview"]>
    >,
    id: string,
  ) {
    return overview.connectionGroups
      .flatMap((group) => group.connections)
      .find((candidate) => candidate.id === id);
  }

  afterEach(() => {
    // No answer and no event of any launch holds a secret.
    const text = JSON.stringify(seen.splice(0));
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it("moves every secret into the vault at the first launch, and every connection still syncs", async () => {
    const directory = await root(plainState);
    const vault = new MemorySecretVault();
    const api = await launch(directory, { vault });

    const overview = await api.overview();

    expect(overview.vault).toEqual({ state: "available" });
    const text = await stateText(directory);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    const state = JSON.parse(text) as {
      version: number;
      agentRunner: object;
    };
    expect(state.version).toBe(9);
    await expect(
      storedConnection(directory, "jira_main"),
    ).resolves.toMatchObject({
      config: { baseUrl: SITE },
      secrets: { fields: ["token"] },
      // Redacted as the secret left, so the overview needs no secret.
      lastError: "Token [secret] was refused.",
    });
    await expect(storedConnection(directory, "notes_1")).resolves.toMatchObject(
      { config: { baseUrl: SITE }, secrets: { fields: [] } },
    );
    // Nothing says which of a missing plugin's values are secret: all go.
    await expect(storedConnection(directory, "gone_1")).resolves.toMatchObject({
      config: {},
      secrets: { fields: [], sealed: true },
    });
    expect(state.agentRunner).toMatchObject({
      pluginValues: { jira: { url: "https://wd.example/t" } },
      pluginSecrets: { jira: { fields: ["apiKey"] } },
    });
    expect(
      vault
        .contents()
        .map(({ pluginId, connectionId, fieldId }) => [
          pluginId,
          connectionId,
          fieldId,
        ])
        .sort(),
    ).toEqual(
      [
        ["gone", "gone_1", null],
        ["jira", "jira_main", "token"],
        ["jira", null, "apiKey"],
      ].sort(),
    );

    expect((await api.activate("jira", true)).status).toBe(200);
    await expect(api.sync("jira", "jira_main")).resolves.toMatchObject({
      status: 200,
    });
    await expect(api.sync("notes", "notes_1")).resolves.toMatchObject({
      status: 200,
    });
    // The sync used the token, and the vault says when.
    expect(
      (await vault.list()).find((entry) => entry.fieldId === "token")
        ?.lastUsedAt,
    ).toEqual(expect.any(Number));
  });

  it.each(["encrypt", "save", "readBack"] as const)(
    "keeps the plain text and pauses the connection when the %s step fails, and the next launch moves it",
    async (fault) => {
      const directory = await root(plainState);
      const vault = new MemorySecretVault();
      vault.faults = { [fault]: true };
      const first = await launch(directory, { vault });

      const overview = await first.overview();

      // Nothing is lost: the token stays where it was, and the file stays
      // at the version before the vault.
      const text = await stateText(directory);
      expect(text).toContain(TOKEN);
      expect(text).toContain(AGENT_KEY);
      expect(JSON.parse(text).version).toBe(7);
      expect(pausedOf(overview, "jira_main")?.paused).toEqual({
        reason: "not_in_vault",
        message: expect.stringContaining("tries again at the next launch"),
      });
      await first.activate("jira", true);
      await expect(first.sync("jira", "jira_main")).resolves.toEqual({
        status: 409,
        body: {
          error:
            "Ajour couldn't move this connection's credentials into the vault, so it is paused. Ajour tries again at the next launch.",
        },
      });
      // A connection without secrets keeps working.
      await expect(first.sync("notes", "notes_1")).resolves.toMatchObject({
        status: 200,
      });

      const next = await launch(directory, { vault: vault.relaunch() });
      await next.overview();
      const moved = await stateText(directory);
      for (const secret of SECRETS) expect(moved).not.toContain(secret);
      expect(JSON.parse(moved).version).toBe(9);
      await expect(next.sync("jira", "jira_main")).resolves.toMatchObject({
        status: 200,
      });
    },
  );

  it("loses no secret when the state file can't be rewritten after the vault holds them, and the next launch finishes", async () => {
    const directory = await root(plainState);
    const vault = new MemorySecretVault();
    failStateRename = true;
    const first = await launch(directory, { vault });

    await first.overview();

    const kept = JSON.parse(await stateText(directory)) as {
      version: number;
      connections: { config: object }[];
    };
    expect(kept.version).toBe(7);
    expect(kept.connections[0]?.config).toHaveProperty("token");
    expect(
      first.events.find((event) => event.name === "storage.load"),
    ).toMatchObject({ vault_migration: { saved: false } });

    failStateRename = false;
    const next = await launch(directory, { vault: vault.relaunch() });
    await next.overview();
    const moved = await stateText(directory);
    for (const secret of SECRETS) expect(moved).not.toContain(secret);
    await next.activate("jira", true);
    await expect(next.sync("jira", "jira_main")).resolves.toMatchObject({
      status: 200,
    });
  });

  it("marks every secret unreadable at once under another key, and pauses those connections with their settings kept", async () => {
    const directory = await root(plainState);
    const vault = new MemorySecretVault();
    await (await launch(directory, { vault })).overview();

    // As after a restore on another computer.
    const moved = vault.relaunch({ keyLost: true });
    const api = await launch(directory, { vault: moved });
    await api.activate("jira", true);
    const overview = await api.overview();

    expect(overview.vault).toEqual({ state: "unreadable" });
    expect(pausedOf(overview, "jira_main")).toMatchObject({
      editableValues: { baseUrl: SITE },
      secretFields: [{ id: "token", state: "unreadable" }],
      paused: { reason: "secret_unreadable" },
    });
    await expect(api.sync("jira", "jira_main")).resolves.toEqual({
      status: 409,
      body: {
        error:
          "This connection's saved credentials can't be read on this computer. Enter them again to resume it.",
      },
    });
    await expect(api.sync("notes", "notes_1")).resolves.toMatchObject({
      status: 200,
    });
    expect(moved.decryptAttempts).toBe(0);

    // Entering the token again is all it takes.
    await expect(
      api.save("jira", { token: TOKEN }, "jira_main"),
    ).resolves.toMatchObject({ status: 200 });
    await expect(api.sync("jira", "jira_main")).resolves.toMatchObject({
      status: 200,
    });
  });

  it("marks one unreadable entry alone, and doesn't try it again before the next launch", async () => {
    const directory = await root({
      ...plainState,
      connections: [
        ...plainState.connections,
        connection("jira_second", "jira", { baseUrl: SITE, token: TOKEN }),
      ],
      disabledPluginIds: [],
    });
    const vault = new MemorySecretVault();
    await (await launch(directory, { vault })).overview();
    vault.corrupt({
      pluginId: "jira",
      connectionId: "jira_main",
      fieldId: "token",
    });
    const next = vault.relaunch();
    const api = await launch(directory, { vault: next });

    await expect(api.sync("jira", "jira_main")).resolves.toMatchObject({
      status: 409,
    });
    const tried = next.decryptAttempts;
    await expect(api.sync("jira", "jira_main")).resolves.toMatchObject({
      status: 409,
    });
    expect(next.decryptAttempts).toBe(tried);
    await expect(api.sync("jira", "jira_second")).resolves.toMatchObject({
      status: 200,
    });
    const overview = await api.overview();
    expect(overview.vault).toEqual({ state: "available" });
    expect(pausedOf(overview, "jira_main")?.paused?.reason).toBe(
      "secret_unreadable",
    );
    expect(pausedOf(overview, "jira_second")?.paused).toBeUndefined();
  });

  it("refuses a secret it can't encrypt, keeps no plain text, and keeps connections without secrets working", async () => {
    const directory = await root();
    const vault = new MemorySecretVault({
      unavailable: "The keychain refused access.",
    });
    const api = await launch(directory, { vault });

    await expect(api.save("jira", { token: TOKEN })).resolves.toEqual({
      status: 400,
      body: {
        error:
          "Ajour can't protect credentials on this computer, so it can't save a secret. The keychain refused access.",
      },
    });
    const saved = await api.save("notes", {});
    expect(saved.status).toBe(200);
    const notesId = (saved.body as { connection: { id: string } }).connection
      .id;
    await expect(api.sync("notes", notesId)).resolves.toMatchObject({
      status: 200,
    });
    await expect(api.overview()).resolves.toMatchObject({
      vault: { state: "unavailable", reason: "The keychain refused access." },
    });
    expect(await stateText(directory)).not.toContain(TOKEN);
    expect(
      api.events.find(
        (event) =>
          event.name === "connection.save" && event.outcome === "refused",
      ),
    ).toMatchObject({ outcome_reason: "vault_unavailable" });
  });

  it("pauses a connection whose saved secret it can't decrypt when encryption is unavailable", async () => {
    const directory = await root(plainState);
    const vault = new MemorySecretVault();
    await (await launch(directory, { vault })).overview();

    const api = await launch(directory, {
      vault: vault.relaunch({ unavailable: "No keyring (basic_text)." }),
    });
    await api.activate("jira", true);
    await expect(api.sync("jira", "jira_main")).resolves.toEqual({
      status: 409,
      body: {
        error:
          "Ajour can't protect credentials on this computer, so this connection is paused. No keyring (basic_text).",
      },
    });
    expect(
      api.events.find(
        (event) => event.name === "backlog.sync" && event.outcome === "refused",
      ),
    ).toMatchObject({ outcome_reason: "secret_unavailable" });
  });

  it("splits a missing plugin's sealed config when the plugin comes back", async () => {
    const directory = await root(plainState);
    const vault = new MemorySecretVault();
    await (await launch(directory, { vault })).overview();

    const api = await launch(directory, {
      vault: vault.relaunch(),
      plugins: [jira, notes, gone],
    });
    const overview = await api.overview();

    await expect(storedConnection(directory, "gone_1")).resolves.toMatchObject({
      config: { baseUrl: SITE },
      secrets: { fields: ["password"] },
    });
    expect(pausedOf(overview, "gone_1")).toMatchObject({
      editableValues: { baseUrl: SITE },
      secretFields: [{ id: "password", state: "saved" }],
    });
    expect(
      vault
        .contents()
        .filter((entry) => entry.pluginId === "gone")
        .map(({ fieldId, value }) => [fieldId, JSON.parse(value)]),
    ).toEqual([["password", GONE_PASSWORD]]);
  });

  it("deletes a connection's entries when it is removed, and keeps them when its plugin is deactivated", async () => {
    const directory = await root({ ...plainState, disabledPluginIds: [] });
    const vault = new MemorySecretVault();
    const api = await launch(directory, { vault });
    await api.overview();
    const jiraEntries = () =>
      vault
        .contents()
        .filter((entry) => entry.pluginId === "jira")
        .map((entry) => entry.fieldId)
        .sort();

    await api.activate("jira", false);
    expect(jiraEntries()).toEqual(["apiKey", "token"]);

    await expect(api.remove("jira", "jira_main")).resolves.toMatchObject({
      status: 200,
    });
    expect(jiraEntries()).toEqual(["apiKey"]);
  });

  it("deletes every entry of a plugin it uninstalls", async () => {
    const directory = await root();
    const source = await writePlugin(path.join(directory, "source"), jira);
    const archivePath = path.join(directory, "jira-1.0.0.ajour-connector");
    await create({ cwd: source, file: archivePath, gzip: true }, [
      "plugin.json",
      "plugin.mjs",
      "prompts",
    ]);
    const vault = new MemorySecretVault();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault,
      statePath: path.join(directory, "state.json"),
      installedPluginDirectory: path.join(directory, "installed"),
      allowDevelopmentPlugins: false,
    });
    servers.push(server);
    await installPluginForServer(
      server,
      await readFile(archivePath),
      path.basename(archivePath),
    );
    const saved = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        values: {
          label: "Main",
          tenantLabel: "Acme",
          baseUrl: SITE,
          token: TOKEN,
        },
      }),
    });
    expect(saved.status).toBe(200);
    await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/agents/plugins/jira/settings",
      body: JSON.stringify({ values: { apiKey: AGENT_KEY } }),
    });
    expect(vault.contents()).toHaveLength(2);

    await uninstallPluginForServer(server, "jira");

    expect(vault.contents()).toEqual([]);
  });

  describe("when the vault file can't be changed this launch", () => {
    const FROZEN =
      "Ajour couldn't read its vault file (EPERM), so it changes nothing in it until it starts again.";
    const REFUSAL =
      "Ajour can't change saved secrets right now: Ajour couldn't read its vault file (EPERM), so it changes nothing in it until it starts again. Restart Ajour and try again.";

    async function frozenLaunch() {
      const directory = await root({ ...plainState, disabledPluginIds: [] });
      const first = new MemorySecretVault();
      await (await launch(directory, { vault: first })).overview();
      const vault = first.relaunch();
      const api = await launch(directory, { vault });
      await api.overview();
      vault.faults.frozen = FROZEN;
      return { directory, vault, api };
    }

    const entries = (vault: MemorySecretVault) =>
      vault
        .contents()
        .map((entry) => `${entry.pluginId}/${entry.fieldId}`)
        .sort();

    it("refuses to delete a connection, and keeps it with its secret", async () => {
      const { directory, vault, api } = await frozenLaunch();
      const before = entries(vault);

      await expect(api.remove("jira", "jira_main")).resolves.toEqual({
        status: 400,
        body: { error: REFUSAL },
      });

      expect(entries(vault)).toEqual(before);
      await expect(
        storedConnection(directory, "jira_main"),
      ).resolves.toMatchObject({ secrets: { fields: ["token"] } });
      expect(
        api.events.find(
          (event) =>
            event.name === "connection.delete" && event.outcome === "refused",
        ),
      ).toMatchObject({ outcome_reason: "vault_unavailable" });
    });

    it("refuses to remove a secret from a connection, and keeps the field", async () => {
      const { directory, vault, api } = await frozenLaunch();
      const before = entries(vault);

      const response = await api.save("jira", { token: "" }, "jira_main", [
        "token",
      ]);

      expect(response).toEqual({ status: 400, body: { error: REFUSAL } });
      expect(entries(vault)).toEqual(before);
      await expect(
        storedConnection(directory, "jira_main"),
      ).resolves.toMatchObject({ secrets: { fields: ["token"] } });
    });

    it("refuses to uninstall a plugin, and leaves its package, connections and secrets", async () => {
      const directory = await root();
      const source = await writePlugin(path.join(directory, "source"), jira);
      const archivePath = path.join(directory, "jira-1.0.0.ajour-connector");
      await create({ cwd: source, file: archivePath, gzip: true }, [
        "plugin.json",
        "plugin.mjs",
        "prompts",
      ]);
      const vault = new MemorySecretVault();
      const server = createAppApiServer({
        ...windowServerOptions,
        vault,
        statePath: path.join(directory, "state.json"),
        installedPluginDirectory: path.join(directory, "installed"),
        allowDevelopmentPlugins: false,
      });
      servers.push(server);
      await installPluginForServer(
        server,
        await readFile(archivePath),
        path.basename(archivePath),
      );
      const saved = await dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/connections",
        body: JSON.stringify({
          values: {
            label: "Main",
            tenantLabel: "Acme",
            baseUrl: SITE,
            token: TOKEN,
          },
        }),
      });
      expect(saved.status).toBe(200);
      vault.faults.frozen = FROZEN;

      await expect(uninstallPluginForServer(server, "jira")).rejects.toThrow(
        REFUSAL,
      );

      expect(entries(vault)).toEqual(["jira/token"]);
      const overview = await dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/plugins",
      });
      expect(JSON.stringify(overview.body)).toContain('"id":"jira"');
      const state = JSON.parse(await stateText(directory)) as {
        connections: { pluginId: string }[];
      };
      expect(
        state.connections.filter((entry) => entry.pluginId === "jira"),
      ).toHaveLength(1);
      // Once the vault can be changed, the same uninstall goes through.
      vault.faults.frozen = undefined;
      await uninstallPluginForServer(server, "jira");
      expect(entries(vault)).toEqual([]);
    });
  });

  it("holds no secret in the standalone API: it refuses secret fields and saves the rest", async () => {
    const directory = await root(plainState);
    const api = await launch(directory);

    await expect(api.save("jira", { token: TOKEN })).resolves.toEqual({
      status: 400,
      body: {
        error: `Ajour can't protect credentials on this computer, so it can't save a secret. ${NO_VAULT_REASON}`,
      },
    });
    await expect(
      api.saveAgentTask({ apiKey: AGENT_KEY }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(api.save("notes", {})).resolves.toMatchObject({ status: 200 });
    await expect(api.sync("notes", "notes_1")).resolves.toMatchObject({
      status: 200,
    });
    // A token saved in plain text before never reaches a plugin from here.
    await api.activate("jira", true);
    await expect(api.sync("jira", "jira_main")).resolves.toMatchObject({
      status: 409,
    });
    await expect(api.overview()).resolves.toMatchObject({
      vault: { state: "unavailable", reason: NO_VAULT_REASON },
    });
  });

  it("refuses, clearly, a plugin's answer with a key it doesn't declare when there is no vault", async () => {
    const directory = await root();
    const api = await launch(directory, { plugins: [trader, notes] });

    await expect(api.save("trader", {})).resolves.toEqual({
      status: 400,
      body: {
        error: `Ajour can't protect credentials on this computer, so it can't save a secret. ${NO_VAULT_REASON}`,
      },
    });

    expect(await stateText(directory).catch(() => "")).not.toContain("trader");
    expect(
      api.events.find(
        (event) =>
          event.name === "connection.save" && event.outcome === "refused",
      ),
    ).toMatchObject({ outcome_reason: "vault_unavailable" });
  });

  it("pauses a connection holding an undeclared key with vault_unavailable when there is no vault", async () => {
    const directory = await root({
      version: 7,
      connections: [
        connection("trader_1", "trader", { baseUrl: SITE, sessionId: SESSION }),
      ],
    });
    const api = await launch(directory, { plugins: [trader, notes] });

    const overview = await api.overview();

    expect(pausedOf(overview, "trader_1")?.paused).toMatchObject({
      reason: "vault_unavailable",
    });
    await expect(api.sync("trader", "trader_1")).resolves.toMatchObject({
      status: 409,
    });
  });

  it("moves a stored key the manifest no longer declares into the vault too", async () => {
    const directory = await root({ ...plainState, disabledPluginIds: [] });
    const vault = new MemorySecretVault();
    // An update renamed `token` to `accessToken`.
    const api = await launch(directory, {
      vault,
      plugins: [jiraRenamed, notes],
    });

    await api.overview();

    const text = await stateText(directory);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    await expect(
      storedConnection(directory, "jira_main"),
    ).resolves.toMatchObject({
      config: { baseUrl: SITE },
      secrets: { fields: ["token"] },
    });
    // The plugin still gets the value it saved under its old id.
    await expect(api.sync("jira", "jira_main")).resolves.toMatchObject({
      status: 200,
    });
  });

  it("keeps in the vault a sealed value that the returning plugin's manifest doesn't declare", async () => {
    const directory = await root(plainState);
    const vault = new MemorySecretVault();
    await (await launch(directory, { vault })).overview();

    const api = await launch(directory, {
      vault: vault.relaunch(),
      plugins: [jira, notes, goneRenamed],
    });
    await api.overview();

    expect(await stateText(directory)).not.toContain(GONE_PASSWORD);
    await expect(storedConnection(directory, "gone_1")).resolves.toMatchObject({
      config: { baseUrl: SITE },
      secrets: { fields: ["password"] },
    });
    expect(
      vault
        .contents()
        .filter((entry) => entry.pluginId === "gone")
        .map(({ fieldId, value }) => [fieldId, JSON.parse(value)]),
    ).toEqual([["password", GONE_PASSWORD]]);
  });

  it("keeps a sealed config it couldn't split when its connection is saved", async () => {
    const directory = await root(plainState);
    const vault = new MemorySecretVault();
    await (await launch(directory, { vault })).overview();

    // The plugin is back, but this launch can't decrypt.
    const locked = await launch(directory, {
      vault: vault.relaunch({ unavailable: "No keyring (basic_text)." }),
      plugins: [jira, notes, gone],
    });
    const saved = await locked.save("gone", { label: "Renamed" }, "gone_1");
    expect(saved).toMatchObject({
      status: 409,
      body: {
        error:
          "Ajour can't protect credentials on this computer, so this connection is paused. No keyring (basic_text).",
      },
    });
    expect(
      vault
        .contents()
        .filter((entry) => entry.pluginId === "gone")
        .map((entry) => entry.fieldId),
    ).toEqual([null]);

    const next = await launch(directory, {
      vault: vault.relaunch(),
      plugins: [jira, notes, gone],
    });
    await next.overview();
    await expect(storedConnection(directory, "gone_1")).resolves.toMatchObject({
      secrets: { fields: ["password"] },
    });
  });

  it("redacts a secret the vault holds after an update drops its secret flag", async () => {
    const directory = await root({ ...plainState, disabledPluginIds: [] });
    const vault = new MemorySecretVault();
    await (await launch(directory, { vault })).overview();

    const api = await launch(directory, {
      vault: vault.relaunch(),
      plugins: [jiraWithoutSecretFlag, notes],
    });
    const failed = await api.sync("jira", "jira_main");

    expect(failed.status).toBe(502);
    expect(failed.body).toMatchObject({
      error: "Token [secret] was refused.",
    });
    expect(
      pausedOf(await api.overview(), "jira_main") as { lastError?: string },
    ).toMatchObject({ lastError: "Token [secret] was refused." });
  });

  it("pauses a connection whose secret waits in plain text with the reason encryption is unavailable", async () => {
    const directory = await root({ ...plainState, disabledPluginIds: [] });
    const api = await launch(directory, {
      vault: new MemorySecretVault({ unavailable: "No keyring (basic_text)." }),
    });

    const message =
      "Ajour can't protect credentials on this computer, so this connection is paused. No keyring (basic_text).";
    expect(pausedOf(await api.overview(), "jira_main")?.paused).toEqual({
      reason: "vault_unavailable",
      message,
    });
    await expect(api.sync("jira", "jira_main")).resolves.toEqual({
      status: 409,
      body: { error: message },
    });
    // The token stays where it was until a launch can move it.
    expect(await stateText(directory)).toContain(TOKEN);
  });

  it("saves what moved when another holder fails in the same pass, and the next launch moves the rest", async () => {
    const directory = await root({
      ...plainState,
      connections: [
        ...plainState.connections,
        connection("jira_second", "jira", { baseUrl: SITE, token: TOKEN }),
      ],
      disabledPluginIds: [],
    });
    const vault = new MemorySecretVault();
    vault.faults = {
      failFor: (key) => key.connectionId === "jira_second",
    };
    const first = await launch(directory, { vault });

    const overview = await first.overview();

    const kept = JSON.parse(await stateText(directory)) as {
      version: number;
      connections: { id: string; config: object; secrets?: object }[];
    };
    expect(kept.version).toBe(7);
    const byId = new Map(kept.connections.map((entry) => [entry.id, entry]));
    expect(byId.get("jira_main")).toMatchObject({
      config: { baseUrl: SITE },
      secrets: { fields: ["token"] },
    });
    expect(byId.get("jira_second")?.config).toHaveProperty("token");
    expect(pausedOf(overview, "jira_second")?.paused?.reason).toBe(
      "not_in_vault",
    );
    await expect(first.sync("jira", "jira_main")).resolves.toMatchObject({
      status: 200,
    });

    const next = await launch(directory, { vault: vault.relaunch() });
    await next.overview();
    const moved = await stateText(directory);
    for (const secret of SECRETS) expect(moved).not.toContain(secret);
    expect(JSON.parse(moved).version).toBe(9);
    await expect(next.sync("jira", "jira_second")).resolves.toMatchObject({
      status: 200,
    });
  });
});

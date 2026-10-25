import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createAppApiServer } from "./server.ts";
import { AppApiStorage } from "./storage.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { nodeBrokerTransport } from "./test-support/node-broker-transport.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/*
 * The acceptance test of #389: a fixture API 4 plugin, run through the fake
 * runtime, saves a connection and syncs from a fixture HTTP service through
 * the real broker with Basic auth. The plugin never sees the token, and a
 * token the service echoes back is redacted in the result, the error and
 * the wide events.
 */

const TOKEN = "jira-api-token-5c0ffee/42+x";
const EMAIL = "ada@acme.test";
const BASIC = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;
const ICON = "<svg viewBox='0 0 16 16' />";

const MANIFEST = {
  id: "fixture-jira",
  version: "4.0.0",
  apiVersion: 4,
  displayName: "Fixture Jira",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  connectionFields: [
    { id: "baseUrl", label: "Site URL", type: "url", required: true },
    { id: "email", label: "Email", type: "text", required: true },
    {
      id: "apiToken",
      label: "API token",
      type: "password",
      required: true,
      secret: true,
    },
  ],
  capabilities: { connector: {} },
  network: {
    auth: { scheme: "basic", userField: "email", secretField: "apiToken" },
    baseAddress: { field: "baseUrl", allowOnPremises: true },
    endpoints: [
      { method: "GET", path: "/rest/api/3/myself" },
      { method: "POST", path: "/rest/api/3/search/jql" },
    ],
    requestHeaders: ["Accept", "Content-Type"],
  },
};

/**
 * The fixture plugin. It keeps everything it receives, its arguments and
 * every answer, on a global the test reads, so the test can show the token
 * never reached it in any form.
 */
const PLUGIN_SOURCE = `
const seen = (globalThis.__fixtureJiraSeen ??= []);

async function call(connection, method, path, body) {
  const response = await ajour.http({
    connectionId: connection.id,
    method,
    path,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  seen.push({ status: response.status, headers: response.headers, text });
  if (!response.ok) throw new Error("Jira answered " + response.status + ": " + text);
  return JSON.parse(text);
}

export async function validateConnection(connection, context) {
  seen.push({ validate: connection, context });
  const me = await call(connection, "GET", "/rest/api/3/myself");
  return {
    normalizedConfig: connection.config,
    connectionSummary: { user: me.displayName },
  };
}

export async function syncConnection(connection, workItems) {
  seen.push({ sync: connection, workItems });
  const found = await call(connection, "POST", "/rest/api/3/search/jql", { jql: "project = ENG" });
  return {
    items: found.issues.map((issue) => ({
      source: "fixture-jira",
      connectionId: connection.id,
      connectionLabel: connection.label,
      tenantLabel: connection.tenantLabel,
      sourceId: issue.id,
      externalId: issue.key,
      title: issue.summary,
      workItemType: "Task",
      depth: 0,
    })),
  };
}
`;

interface FixtureService {
  server: Server;
  baseUrl: string;
  received: { method: string; url: string; authorization?: string }[];
  /** Makes the search fail with the token in its answer. */
  failSearch: boolean;
}

/** A service shaped like Jira's, which echoes the credential it was sent. */
async function startFixtureService(): Promise<FixtureService> {
  const service: FixtureService = {
    server: undefined as unknown as Server,
    baseUrl: "",
    received: [],
    failSearch: false,
  };
  service.server = createServer((request, response) => {
    service.received.push({
      method: request.method ?? "",
      url: request.url ?? "",
      ...(request.headers.authorization
        ? { authorization: request.headers.authorization }
        : {}),
    });
    if (request.headers.authorization !== BASIC) {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="jira"' });
      response.end();
      return;
    }
    const token = Buffer.from(
      request.headers.authorization.slice("Basic ".length),
      "base64",
    )
      .toString("utf8")
      .split(":")
      .slice(1)
      .join(":");
    request.resume();
    request.on("end", () => {
      const json = (status: number, body: unknown) => {
        response.writeHead(status, {
          "Content-Type": "application/json",
          "Set-Cookie": "atlassian.xsrf.token=abc",
          "X-Echo-Auth": request.headers.authorization ?? "",
        });
        response.end(JSON.stringify(body));
      };
      if (request.url === "/jira/rest/api/3/myself") {
        json(200, { displayName: "Ada", note: `seen ${token}` });
      } else if (request.url === "/jira/rest/api/3/search/jql") {
        if (service.failSearch) {
          json(500, {
            error: `Bad token ${token} (${encodeURIComponent(token)})`,
          });
          return;
        }
        json(200, {
          issues: [
            { id: "10001", key: "ENG-1", summary: "Ship the broker" },
            { id: "10002", key: "ENG-2", summary: `Leaked ${token}` },
          ],
        });
      } else {
        json(404, {});
      }
    });
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = service.server.address() as AddressInfo;
  service.baseUrl = `http://127.0.0.1:${port}/jira`;
  return service;
}

describe("an API 4 plugin through the real broker", () => {
  const tempDirs: string[] = [];
  const services: FixtureService[] = [];

  afterEach(async () => {
    for (const service of services.splice(0)) {
      service.server.closeAllConnections();
      await new Promise((resolve) => service.server.close(resolve));
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
    delete (globalThis as { __fixtureJiraSeen?: unknown }).__fixtureJiraSeen;
  });

  async function setup() {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-api4-sync-"));
    tempDirs.push(root);
    const pluginDirectory = path.join(root, "fixture-jira");
    await mkdir(pluginDirectory, { recursive: true });
    await writeFile(
      path.join(pluginDirectory, "plugin.json"),
      JSON.stringify(MANIFEST),
    );
    await writeFile(path.join(pluginDirectory, "plugin.mjs"), PLUGIN_SOURCE);
    const service = await startFixtureService();
    services.push(service);
    const sink = createRecordingSink<AjourEvent>();
    const statePath = path.join(root, "state.json");
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
      brokerTransport: nodeBrokerTransport(),
      eventSink: sink,
    });
    const seen = () =>
      (globalThis as { __fixtureJiraSeen?: unknown[] }).__fixtureJiraSeen ?? [];
    return { server, service, sink, statePath, vault, seen };
  }

  async function saveConnection(
    server: ReturnType<typeof createAppApiServer>,
    baseUrl: string,
    extra: Record<string, unknown> = {},
  ) {
    return await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/fixture-jira/connections",
      body: JSON.stringify({
        values: {
          label: "Acme Jira",
          tenantLabel: "Acme",
          autoSync: true,
          autoSyncIntervalMinutes: 15,
          baseUrl,
          email: EMAIL,
          apiToken: TOKEN,
          onPremises: true,
          ...extra,
        },
      }),
    });
  }

  /** Every form of the token the plugin or an event could have seen. */
  const tokenForms = [
    TOKEN,
    encodeURIComponent(TOKEN),
    Buffer.from(TOKEN).toString("base64"),
    Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64"),
  ];

  it("validates and syncs with Basic auth, and the plugin never sees the token", async () => {
    const { server, service, sink, statePath, seen } = await setup();

    const saved = await saveConnection(server, service.baseUrl);
    expect(saved.status).toBe(200);
    const connectionId = (saved.body as { connection: { id: string } })
      .connection.id;
    const synced = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/fixture-jira/connections/${connectionId}/sync`,
      body: JSON.stringify({ trigger: "auto", workItems: [] }),
    });

    expect(synced.status).toBe(200);
    expect(synced.body).toMatchObject({
      mode: "backlog",
      items: [
        { externalId: "ENG-1", title: "Ship the broker" },
        { externalId: "ENG-2", title: "Leaked [secret]" },
      ],
    });
    // The service got the credential from the broker, never from the plugin.
    expect(service.received).toEqual([
      { method: "GET", url: "/jira/rest/api/3/myself", authorization: BASIC },
      {
        method: "POST",
        url: "/jira/rest/api/3/search/jql",
        authorization: BASIC,
      },
    ]);
    const pluginSaw = JSON.stringify(seen());
    expect(pluginSaw).toContain("Ship the broker");
    for (const form of tokenForms) expect(pluginSaw).not.toContain(form);
    expect(pluginSaw).not.toContain("atlassian.xsrf");
    expect(pluginSaw).not.toContain("x-echo-auth");
    // Validation ran on a connection of its own, without the secret.
    const validated = (
      seen()[0] as { validate: { id: string; config: object } }
    ).validate;
    expect(validated.id).toMatch(/^pending-/);
    expect(validated.config).toEqual({
      baseUrl: service.baseUrl,
      email: EMAIL,
    });
    const synced0 = seen().find(
      (entry) => (entry as { sync?: unknown }).sync,
    ) as { sync: { id: string; config: object; access: string[] } };
    expect(synced0.sync).toMatchObject({
      id: connectionId,
      config: { baseUrl: service.baseUrl, email: EMAIL },
      access: [],
    });
    // One event per request, under the operation that sent it.
    const requests = sink.events.filter(
      (event) => event.name === "plugin.request",
    );
    expect(requests).toMatchObject([
      {
        outcome: "ok",
        plugin: { id: "fixture-jira" },
        broker: {
          method: "GET",
          path_template: "/rest/api/3/myself",
          status_code: 200,
          pending: true,
          on_premises: true,
        },
      },
      {
        outcome: "ok",
        connection: { id: connectionId },
        broker: {
          method: "POST",
          path_template: "/rest/api/3/search/jql",
          status_code: 200,
          pending: false,
        },
      },
    ]);
    const sync = sink.events.find(
      (event) =>
        event.name === "backlog.sync" && event.kind === "plugin_operation",
    );
    expect(requests[1]!.parent_span_id).toBe(sync!.span_id);
    expect(requests[1]!.trace_id).toBe(sync!.trace_id);
    const everything = JSON.stringify(sink.events);
    for (const form of tokenForms) expect(everything).not.toContain(form);
    // Access review's records.
    const activity = await new AppApiStorage(statePath).brokerActivity(
      "fixture-jira",
    );
    expect(activity.plugin?.lastRequestAt).toEqual(expect.any(Number));
    expect(activity.connections[connectionId]?.lastRequestAt).toEqual(
      expect.any(Number),
    );
    expect(activity.connections[connectionId]?.blockedCount).toBeUndefined();
  });

  it("redacts a token the service echoes in a failed sync's error, everywhere it lands", async () => {
    const { server, service, sink, statePath } = await setup();
    const saved = await saveConnection(server, service.baseUrl);
    const connectionId = (saved.body as { connection: { id: string } })
      .connection.id;
    service.failSearch = true;

    const failed = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/fixture-jira/connections/${connectionId}/sync`,
      body: JSON.stringify({ trigger: "manual", workItems: [] }),
    });

    expect(failed.status).toBe(502);
    const error = (failed.body as { error: string }).error;
    expect(error).toContain("Jira answered 500");
    expect(error).toContain("Bad token [secret] ([secret])");
    for (const form of tokenForms) {
      expect(error).not.toContain(form);
      expect(JSON.stringify(sink.events)).not.toContain(form);
    }
    const stored = JSON.stringify(
      await new AppApiStorage(statePath).listConnections("fixture-jira"),
    );
    for (const form of tokenForms) expect(stored).not.toContain(form);
  });

  it("refuses a loopback service for a connection not marked on-premises, and records the blocked attempt", async () => {
    const { server, service, sink, statePath } = await setup();

    const saved = await saveConnection(server, service.baseUrl, {
      onPremises: false,
    });

    // Plain http needs on-premises, and so does a loopback address.
    expect(saved.status).toBe(400);
    expect(service.received).toEqual([]);
    expect(
      sink.events.find((event) => event.name === "plugin.request"),
    ).toMatchObject({ outcome: "refused", outcome_reason: "invalid_address" });

    const https = await saveConnection(
      server,
      service.baseUrl.replace("http:", "https:"),
      { onPremises: false },
    );
    expect(https.status).toBe(400);
    expect(
      sink.events.filter((event) => event.name === "plugin.request")[1],
    ).toMatchObject({ outcome: "refused", outcome_reason: "private_address" });
    const activity = await new AppApiStorage(statePath).brokerActivity(
      "fixture-jira",
    );
    expect(activity.plugin).toMatchObject({ blockedCount: 1 });
  });

  it("refuses on-premises for a plugin whose manifest doesn't allow it", async () => {
    const { server, service } = await setup();
    const manifestPath = path.join(tempDirs[0]!, "fixture-jira", "plugin.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...MANIFEST,
        network: {
          ...MANIFEST.network,
          baseAddress: { field: "baseUrl" },
        },
      }),
    );

    const saved = await saveConnection(server, service.baseUrl);

    expect(saved).toEqual({
      status: 400,
      body: { error: "This plugin can't reach on-premises servers." },
    });
  });
});

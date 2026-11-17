import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  createAppApiServer,
  addRepositoryFolderForServer,
  stopAppApiServer,
} from "./server.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

// How many state reads the fake tool answered, by thread.
const reads = globalThis as { __hookReads?: number };

let root: string;
let server: ReturnType<typeof createAppApiServer>;
let sink: ReturnType<typeof createRecordingSink>;
let clock: number;

const PLUGIN = `
export function detectTools() { return { tools: [{ id: 't3', available: true }] }; }
export function startHandoff(request) {
  return { threadId: 'thread', native: { hook: request.hook?.url ?? null } };
}
export function readHandoffStates(request) {
  globalThis.__hookReads = (globalThis.__hookReads ?? 0) + 1;
  return request.handoffs.map((h) => ({ id: h.id, state: 'needs-you', native: { hook: h.native.hook } }));
}
`;

async function startServer(
  hooks: Partial<{
    debounceMs: number;
    perHandoffLimit: number;
    globalLimit: number;
  }> = {},
) {
  root = await mkdtemp(path.join(os.tmpdir(), "handoff-hook-"));
  const plugin = path.join(root, "plugin");
  await mkdir(plugin);
  await mkdir(path.join(root, "repo"));
  await writeFile(
    path.join(plugin, "plugin.json"),
    JSON.stringify({
      id: "handoff",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Tools",
      description: "Test tools",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      connectionFields: [],
      capabilities: {
        handoff: {
          tools: [{ id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] }],
        },
      },
    }),
  );
  await writeFile(path.join(plugin, "plugin.mjs"), PLUGIN);
  sink = createRecordingSink();
  clock = Date.now();
  server = createAppApiServer({
    ...windowServerOptions,
    port: 43210,
    statePath: path.join(root, "data", "state.json"),
    protectedRepositoryFolders: {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    },
    developmentPluginDirectories: [plugin],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
    eventSink: sink,
    handoffHooks: { debounceMs: 5, now: () => clock, ...hooks },
  });
}

const call = (method: string, route: string, body?: unknown) =>
  dispatchJsonRequest(server, {
    method,
    path: route,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A post as a tool's hook sends it: no Origin, no window token, a JSON body. */
const post = (url: string, headers: Record<string, string> = {}) => {
  const target = new URL(url);
  return dispatchJsonRequest(server, {
    method: "POST",
    path: `${target.pathname}${target.search}`,
    headers: {
      host: target.host,
      origin: undefined as unknown as string,
      "x-ajour-window-token": undefined as unknown as string,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      hook_event_name: "Stop",
      last_assistant_message: "CANARY-HOOK-BODY",
    }),
  });
};

async function startHandoff() {
  const folder = await addRepositoryFolderForServer(
    server,
    "p",
    path.join(root, "repo"),
  );
  const started = await call("POST", "/api/handoffs", {
    pluginId: "handoff",
    toolId: "t3",
    workItemId: "i",
    projectId: "p",
    folderId: folder.id,
    projectName: "Project",
    item: {
      key: "KEY-1",
      title: "Fix it",
      type: "Bug",
      url: "https://example.test/KEY-1",
    },
    settings: {},
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const record = started.body as { id: string; native: { hook: string } };
  return { id: record.id, url: record.native.hook };
}

const stateOf = async (id: string) =>
  (
    (await call("GET", "/api/handoffs")).body as Array<{
      id: string;
      state: string;
    }>
  ).find((h) => h.id === id)?.state;

async function settle(ms = 40) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const hookEvents = () =>
  sink.events.filter((e) => e.name === "handoff.hook") as Array<
    (typeof sink.events)[number] & { handoff?: Record<string, unknown> }
  >;

beforeEach(() => {
  reads.__hookReads = 0;
});

afterEach(async () => {
  await stopAppApiServer(server);
  await rm(root, { recursive: true, force: true });
});

it("gives the tool a loopback hook URL on the API's port, holding the handoff's own token", async () => {
  await startServer();
  const { id, url } = await startHandoff();
  const hook = new URL(url);
  expect(hook.origin).toBe("http://127.0.0.1:43210");
  expect(hook.pathname).toBe(`/hooks/handoff/${id}`);
  expect(hook.searchParams.get("token")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // Only a hash of the token is kept. (This fake tool keeps its URL in its
  // native state, which a real tool has no reason to do.)
  const { readFile } = await import("node:fs/promises");
  const state = JSON.parse(
    await readFile(path.join(root, "data", "state.json"), "utf8"),
  ) as { handoffHooks: Record<string, { tokenHash: string }> };
  expect(state.handoffHooks).toEqual({
    [id]: { tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
  });
  expect(JSON.stringify(state.handoffHooks)).not.toContain(
    hook.searchParams.get("token"),
  );
});

it("refreshes that one handoff through the plugin after a valid post, without trusting or logging the body", async () => {
  await startServer();
  const { id, url } = await startHandoff();
  expect(await stateOf(id)).toBe("working");

  const answer = await post(url);
  expect(answer.status).toBe(204);
  // The refresh runs after the debounce, however slow the runner.
  await vi.waitFor(async () => expect(await stateOf(id)).toBe("needs-you"), {
    timeout: 5_000,
  });
  expect(reads.__hookReads).toBe(1);
  expect(hookEvents()).toEqual([
    expect.objectContaining({
      kind: "request",
      outcome: "ok",
      handoff: { hook: "accepted", tool: "t3" },
    }),
  ]);
  const logged = JSON.stringify(sink.events);
  expect(logged).not.toContain("CANARY-HOOK-BODY");
  expect(logged).not.toContain(new URL(url).searchParams.get("token"));
  expect(JSON.stringify(hookEvents())).not.toContain(id);
});

it("answers a wrong token as it answers an unknown id, and refreshes nothing", async () => {
  await startServer();
  const { id, url } = await startHandoff();
  const wrong = new URL(url);
  wrong.searchParams.set("token", "A".repeat(43));
  const unknownId = new URL(url);
  unknownId.pathname = "/hooks/handoff/00000000-0000-0000-0000-000000000000";
  const noToken = new URL(url);
  noToken.search = "";

  const answers = [
    await post(wrong.href),
    await post(unknownId.href),
    await post(noToken.href),
  ];
  for (const answer of answers) expect(answer).toEqual(answers[1]);
  expect(answers[0]!.status).toBe(404);
  await settle();

  expect(await stateOf(id)).toBe("working");
  expect(reads.__hookReads).toBe(0);
  expect(hookEvents().map((e) => e.handoff)).toEqual([
    { hook: "unknown" },
    { hook: "unknown" },
    { hook: "unknown" },
  ]);
});

it("revokes the token when the handoff is removed", async () => {
  await startServer();
  const { id, url } = await startHandoff();
  await call("DELETE", `/api/handoffs/${id}`);

  expect((await post(url)).status).toBe(404);
  await settle();
  expect(reads.__hookReads).toBe(0);
});

it("revokes the token 24 hours after the handoff is done or gone", async () => {
  await startServer();
  const plugin = path.join(root, "plugin", "plugin.mjs");
  await writeFile(plugin, PLUGIN.replace("'needs-you'", "'done'"));
  const { id, url } = await startHandoff();
  await call("POST", `/api/handoffs/${id}/refresh`);
  expect(await stateOf(id)).toBe("done");
  reads.__hookReads = 0;

  // Within the day, a done thread can still say it started again.
  clock += 23 * 3_600_000;
  expect((await post(url)).status).toBe(204);
  await vi.waitFor(() => expect(reads.__hookReads).toBe(1), { timeout: 5_000 });

  clock += 2 * 3_600_000;
  expect((await post(url)).status).toBe(404);
  await settle();
  expect(reads.__hookReads).toBe(1);
});

it("answers a flood with 429 and does no extra refresh work for it", async () => {
  await startServer({ perHandoffLimit: 3, globalLimit: 100, debounceMs: 30 });
  const { id, url } = await startHandoff();

  const statuses: number[] = [];
  for (let i = 0; i < 10; i++) statuses.push((await post(url)).status);
  expect(statuses).toEqual([204, 204, 204, 429, 429, 429, 429, 429, 429, 429]);
  // Accepted posts within the debounce make one refresh.
  await vi.waitFor(async () => expect(await stateOf(id)).toBe("needs-you"), {
    timeout: 5_000,
  });
  await settle(120);
  expect(reads.__hookReads).toBe(1);
  expect(
    hookEvents().filter((e) => e.handoff?.hook === "rate_limited"),
  ).toHaveLength(7);
  expect(
    hookEvents().find((e) => e.handoff?.hook === "rate_limited"),
  ).toMatchObject({ outcome: "refused", outcome_reason: "rate_limited" });
});

it("limits posts across every handoff, before it checks a token", async () => {
  await startServer({ perHandoffLimit: 100, globalLimit: 2 });
  const { url } = await startHandoff();
  const wrong = new URL(url);
  wrong.searchParams.set("token", "A".repeat(43));

  expect((await post(wrong.href)).status).toBe(404);
  expect((await post(url)).status).toBe(204);
  expect((await post(url)).status).toBe(429);
  expect((await post(wrong.href)).status).toBe(429);
});

it("refuses browsers, other hosts and other methods", async () => {
  await startServer();
  const { url } = await startHandoff();

  expect((await post(url, { origin: "https://evil.example" })).status).toBe(
    403,
  );
  expect((await post(url, { host: "evil.example:43210" })).status).toBe(403);
  const target = new URL(url);
  const get = await dispatchJsonRequest(server, {
    method: "GET",
    path: `${target.pathname}${target.search}`,
    headers: { origin: undefined as unknown as string },
  });
  expect(get.status).toBe(404);
  await settle();
  expect(reads.__hookReads).toBe(0);
});

it("refuses a body over the cap", async () => {
  await startServer();
  const { url } = await startHandoff();
  const target = new URL(url);
  const answer = await dispatchJsonRequest(server, {
    method: "POST",
    path: `${target.pathname}${target.search}`,
    headers: {
      origin: undefined as unknown as string,
      "x-ajour-window-token": undefined as unknown as string,
    },
    body: "x".repeat(1024 * 1024 + 1),
  });
  expect(answer.status).toBe(413);
  await settle();
  expect(reads.__hookReads).toBe(0);
});

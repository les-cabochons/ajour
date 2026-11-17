import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createApiEvents } from "./events.ts";
import { createHookToken, handoffHookUrl } from "./handoff-hooks.ts";
import { PluginManager } from "./plugin-host.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** A handoff plugin whose start fails, echoing the hook URL and its token. */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-hook-redaction-"));
  roots.push(root);
  const directory = path.join(root, "plugin");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "tools",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Tools",
      description: "Test",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      capabilities: {
        handoff: {
          tools: [{ id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] }],
        },
      },
    }),
  );
  await writeFile(
    path.join(directory, "plugin.mjs"),
    `
export async function detectTools() {
  return { tools: [{ id: 't3', available: true }] };
}
export async function startHandoff(request) {
  const url = request.hook.url;
  const token = new URL(url).searchParams.get('token');
  throw new Error('Refused ' + url + ' and bare ' + token);
}
`,
  );
  const sink = createRecordingSink<AjourEvent>();
  const manager = new PluginManager({
    runtime: new InProcessPluginRuntime(),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: true,
    developmentPluginDirectories: [directory],
    requestTimeoutMs: 5_000,
    events: createApiEvents({ sink, userDataPath: root }),
  });
  return { manager, logged: sink.events };
}

it("keeps a failed start's hook URL and token out of every event and log", async () => {
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  const { manager, logged } = await setup();
  const { token } = createHookToken();
  const url = handoffHookUrl("127.0.0.1", 8787, "h1", token);
  try {
    await manager.detectTools("tools", "p");
    await expect(
      manager.startHandoff(
        "tools",
        {
          tool: "t3",
          folder: { id: "f", name: "Repo" },
          title: "Title",
          prompt: "Prompt",
          item: { key: "KEY", url: "" },
          settings: {},
          hook: { url },
        },
        "p",
      ),
    ).rejects.toThrow("Refused");
  } finally {
    await manager.shutdown();
  }
  const start = logged.find((event) => event.name === "handoff.start");
  expect(start).toMatchObject({ outcome: "error" });
  expect(JSON.stringify(start)).toContain("Refused");
  const everything = JSON.stringify(logged) + lines.join("\n");
  expect(everything).not.toContain(token);
  expect(everything).not.toContain(url);
  expect(everything).not.toContain("/hooks/handoff/h1");
});

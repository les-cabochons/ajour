import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createApiEvents } from "./events.ts";
import { ProcessBroker } from "./process-broker.ts";
import { FolderResolver } from "./repository-folders.ts";
import { AppApiStorage } from "./storage.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

const HOOK =
  "http://127.0.0.1:8787/hooks/handoff/0b8f1c1e-0000-4000-8000-000000000001?token=AbC_d-1234567890123456789012345678901234567";

/** Claude Code's per-start settings, as the plugin's manifest declares them. */
const SETTINGS_TEMPLATE =
  '{"hooks":{"Stop":[{"hooks":[{"type":"http","url":"{url}"}]}],"SessionEnd":[{"hooks":[{"type":"http","url":"{url}"}]}]}}';

function manifestWith(args: unknown[], extra: Record<string, unknown> = {}) {
  return {
    id: "agent-handoff",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "Agent handoff",
    iconSvg: "<svg/>",
    entrypoint: "index.js",
    connectionFields: [],
    capabilities: {
      handoff: {
        tools: [
          {
            id: "claude",
            label: "Claude Code",
            iconSvg: "<svg/>",
            settings: [],
          },
        ],
      },
    },
    processes: {
      executables: { node: { names: ["node"] } },
      commands: [{ id: "start", executable: "node", args, mode: "capture" }],
    },
    ...extra,
  };
}

/** A `claude --settings <json> --session-id <id>`-like command, run by node so the test reads its argv. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-hook-url-"));
  roots.push(root);
  const script = path.join(root, "tool.cjs");
  await writeFile(
    script,
    "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
  );
  const manifest = pluginApi4ManifestSchema.parse(
    manifestWith([
      { kind: "literal", value: script },
      "--settings",
      { kind: "hook-url", name: "hook", template: SETTINGS_TEMPLATE },
      "--session-id",
      "{session:id}",
      { if: "bare", args: ["{bare:id}", "{url:hook-url}"] },
    ]),
  );
  const storage = new AppApiStorage(path.join(root, "state.json"));
  const sink = createRecordingSink<AjourEvent>();
  const broker = new ProcessBroker({
    events: createApiEvents({ sink, userDataPath: root }),
    folders: new FolderResolver(storage, {}),
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
  });
  const operation = (hookUrl?: string, method = "startHandoff") =>
    broker.forOperation({
      pluginId: manifest.id,
      manifest,
      method,
      projectId: "p",
      ...(hookUrl ? { hookUrl } : {}),
    });
  const reasons = () =>
    sink.events
      .filter((event) => event.name === "plugin.process")
      .map((event) => (event as { outcome_reason?: string }).outcome_reason);
  return { operation, reasons };
}

it("fills a hook-url template with the start's hook URL, as one argument the tool reads as JSON", async () => {
  const { operation } = await fixture();
  const result = await operation(HOOK).run({
    command: "start",
    args: { session: "ses_1" },
  });
  const argv = JSON.parse(result.stdout!) as string[];
  expect(argv).toEqual([
    "--settings",
    expect.any(String),
    "--session-id",
    "ses_1",
  ]);
  expect(JSON.parse(argv[1]!)).toEqual({
    hooks: {
      Stop: [{ hooks: [{ type: "http", url: HOOK }] }],
      SessionEnd: [{ hooks: [{ type: "http", url: HOOK }] }],
    },
  });
});

it("fills a compact hook-url slot with the bare URL", async () => {
  const { operation } = await fixture();
  const result = await operation(HOOK).run({
    command: "start",
    args: { session: "s", bare: "x" },
  });
  expect((JSON.parse(result.stdout!) as string[]).slice(-2)).toEqual([
    "x",
    HOOK,
  ]);
});

it("refuses a value the plugin passes for a hook-url slot", async () => {
  const { operation } = await fixture();
  await expect(
    operation(HOOK).run({
      command: "start",
      args: { session: "s", hook: "http://attacker.test/" },
    }),
  ).rejects.toMatchObject({ reason: "invalid_request" });
});

it("refuses the slot in a start without a hook, and in any other operation", async () => {
  const { operation, reasons } = await fixture();
  await expect(
    operation().run({ command: "start", args: { session: "s" } }),
  ).rejects.toMatchObject({ reason: "hook_refused" });
  await expect(
    operation(HOOK, "readHandoffStates").run({
      command: "start",
      args: { session: "s" },
    }),
  ).rejects.toMatchObject({ reason: "hook_refused" });
  expect(reasons()).toEqual(["hook_refused", "hook_refused"]);
});

it.each([
  ["another host", HOOK.replace("127.0.0.1", "attacker.test")],
  ["a quote that would break the JSON", `${HOOK}"`],
  ["https", HOOK.replace("http:", "https:")],
])("refuses a hook URL to %s", async (_case, url) => {
  const { operation } = await fixture();
  await expect(
    operation(url).run({ command: "start", args: { session: "s" } }),
  ).rejects.toMatchObject({ reason: "hook_refused" });
});

it("accepts a hook-url slot only from a handoff plugin, with {url} in a template, never as a group's test", () => {
  const parse = (args: unknown[], extra?: Record<string, unknown>) =>
    pluginApi4ManifestSchema.safeParse(manifestWith(args, extra)).success;
  expect(parse(["{url:hook-url}"])).toBe(true);
  expect(parse([{ kind: "hook-url", name: "hook", template: "a{url}b" }])).toBe(
    true,
  );
  expect(parse([{ kind: "hook-url", name: "hook", template: "none" }])).toBe(
    false,
  );
  expect(
    parse([{ kind: "hook-url", name: "hook", template: "{url}{url}" }]),
  ).toBe(true);
  expect(parse([{ if: "url", args: ["{url:hook-url}"] }])).toBe(false);
  expect(
    parse(["literal"], {
      capabilities: { connector: {} },
      connectionFields: [{ id: "url", label: "URL", type: "url" }],
    }),
  ).toBe(true);
  expect(
    parse(["{url:hook-url}"], {
      capabilities: { connector: {} },
      connectionFields: [{ id: "url", label: "URL", type: "url" }],
    }),
  ).toBe(false);
});

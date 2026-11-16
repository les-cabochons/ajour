import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import type { BrokerCaller } from "./broker-port.ts";
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

/**
 * An `opencode attach <url> -s <id>`-like command, run by node so the test
 * reads the argv it got.
 */
async function fixture(
  connectionAddress?: (caller: BrokerCaller) => Promise<string | undefined>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-connection-url-"));
  roots.push(root);
  const script = path.join(root, "tool.cjs");
  await writeFile(
    script,
    "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
  );
  const manifest = pluginApi4ManifestSchema.parse({
    id: "opencode",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "OpenCode",
    iconSvg: "<svg/>",
    entrypoint: "index.js",
    connectionFields: [
      { id: "serverUrl", label: "Server URL", type: "url", required: true },
    ],
    network: { baseAddress: { field: "serverUrl", allowOnPremises: true } },
    capabilities: {
      handoff: {
        tools: [
          {
            id: "opencode",
            label: "OpenCode",
            iconSvg: "<svg/>",
            settings: [],
            connection: "required",
          },
        ],
      },
    },
    processes: {
      executables: { node: { names: ["node"] } },
      commands: [
        {
          id: "attach",
          executable: "node",
          args: [
            { kind: "literal", value: script },
            "attach",
            "{server:connection-url}",
            "-s",
            "{session:id}",
          ],
          mode: "capture",
        },
        {
          id: "maybe",
          executable: "node",
          args: [
            { kind: "literal", value: script },
            {
              if: "session",
              args: ["{server:connection-url}", "{session:id}"],
            },
          ],
          mode: "capture",
        },
      ],
    },
  });
  const storage = new AppApiStorage(path.join(root, "state.json"));
  const sink = createRecordingSink<AjourEvent>();
  const asked: BrokerCaller[] = [];
  const broker = new ProcessBroker({
    events: createApiEvents({ sink, userDataPath: root }),
    folders: new FolderResolver(storage, {}),
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
    ...(connectionAddress
      ? {
          connectionAddress: async (caller: BrokerCaller) => {
            asked.push(caller);
            return connectionAddress(caller);
          },
        }
      : {}),
  });
  const operation = (connectionId?: string, method = "startHandoff") =>
    broker.forOperation({
      pluginId: manifest.id,
      manifest,
      method,
      projectId: "p",
      ...(connectionId ? { connectionId } : {}),
    });
  const reasons = () =>
    sink.events
      .filter((event) => event.name === "plugin.process")
      .map((event) => (event as { outcome_reason?: string }).outcome_reason);
  return { operation, asked, reasons };
}

it("fills a connection-url slot from the operation's connection, so the plugin never passes a URL", async () => {
  const { operation, asked } = await fixture(
    async () => "http://127.0.0.1:4096",
  );
  const result = await operation("c1").run({
    command: "attach",
    args: { session: "ses_123" },
  });
  expect(JSON.parse(result.stdout!)).toEqual([
    "attach",
    "http://127.0.0.1:4096",
    "-s",
    "ses_123",
  ]);
  expect(asked.map((caller) => caller.connectionId)).toEqual(["c1"]);
});

it("fills one inside a conditional group that applies, and leaves it out otherwise", async () => {
  const { operation } = await fixture(async () => "http://127.0.0.1:4096/base");
  const op = operation("c1");
  expect(
    JSON.parse(
      (await op.run({ command: "maybe", args: { session: "s" } })).stdout!,
    ),
  ).toEqual(["http://127.0.0.1:4096/base", "s"]);
  expect(
    JSON.parse((await op.run({ command: "maybe", args: {} })).stdout!),
  ).toEqual([]);
});

it("refuses a URL the plugin passes for the slot", async () => {
  const { operation, asked } = await fixture(
    async () => "http://127.0.0.1:4096",
  );
  await expect(
    operation("c1").run({
      command: "attach",
      args: { server: "http://attacker.test", session: "s" },
    }),
  ).rejects.toMatchObject({ reason: "invalid_request" });
  expect(asked).toEqual([]);
});

it("refuses the slot in an operation without a connection", async () => {
  const { operation, asked, reasons } = await fixture(
    async () => "http://127.0.0.1:4096",
  );
  await expect(
    operation().run({ command: "attach", args: { session: "s" } }),
  ).rejects.toMatchObject({ reason: "connection_refused" });
  expect(asked).toEqual([]);
  expect(reasons()).toEqual(["connection_refused"]);
});

it("refuses the slot outside a handoff operation, even with a connection", async () => {
  const { operation, asked } = await fixture(
    async () => "http://127.0.0.1:4096",
  );
  await expect(
    operation("c1", "syncConnection").run({
      command: "attach",
      args: { session: "s" },
    }),
  ).rejects.toMatchObject({ reason: "connection_refused" });
  expect(asked).toEqual([]);
});

it.each([
  ["has no address", async () => undefined],
  [
    "can't be read",
    async () => {
      throw new Error("The connection's address must start with https://.");
    },
  ],
])("refuses the slot when the connection %s", async (_case, address) => {
  const { operation } = await fixture(address);
  await expect(
    operation("c1").run({ command: "attach", args: { session: "s" } }),
  ).rejects.toMatchObject({ reason: "connection_refused" });
});

it("refuses the slot when the host can't read connections at all", async () => {
  const { operation } = await fixture();
  await expect(
    operation("c1").run({ command: "attach", args: { session: "s" } }),
  ).rejects.toMatchObject({ reason: "connection_refused" });
});

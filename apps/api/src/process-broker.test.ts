import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { createApiEvents } from "./events.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { ProcessBroker } from "./process-broker.ts";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture(
  args: unknown[] = ["{title:text}"],
  source = "process.stdin.resume(); process.stdin.on('end',()=>process.stdout.write(JSON.stringify(process.argv.slice(2))))",
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-process-"));
  roots.push(root);
  const script = path.join(root, "tool.cjs");
  await writeFile(script, source);
  const manifest = pluginApi4ManifestSchema.parse({
    id: "process-test",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "Process test",
    iconSvg: "<svg/>",
    entrypoint: "index.js",
    connectionFields: [{ id: "site", label: "Site", type: "text" }],
    capabilities: { connector: {} },
    processes: {
      executables: { node: { names: ["node"] } },
      commands: [
        {
          id: "run",
          executable: "node",
          args: [{ kind: "literal", value: script }, ...args],
          stdin: "text",
          mode: "capture",
          timeoutSeconds: 1,
        },
      ],
    },
  });
  const broker = new ProcessBroker({
    folders: { resolve: async (id) => (id === "repo" ? root : undefined) },
    protectedDirectories: [path.join(root, "data")],
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
  });
  return {
    root,
    manifest,
    broker,
    op: broker.forOperation({
      pluginId: manifest.id,
      manifest,
      method: "syncConnection",
    }),
  };
}
it("Given text with shell metacharacters, capture preserves one argument", async () => {
  const { op } = await fixture();
  expect(
    JSON.parse(
      (await op.run({ command: "run", args: { title: "hello & echo $(x)" } }))
        .stdout,
    ),
  ).toEqual(["hello & echo $(x)"]);
});
it.each(["-option", "a\0b", "a\rb", "a\nb"])(
  "Given invalid text %j, refuses before spawn",
  async (title) => {
    const { op } = await fixture();
    await expect(
      op.run({ command: "run", args: { title } }),
    ).rejects.toMatchObject({ reason: "invalid_request" });
  },
);
it("Given every slot kind and a conditional group, fills exactly one argument each", async () => {
  const { op, root } = await fixture([
    "{id:id}",
    "{ref:ref}",
    "{count:number}",
    { kind: "enum", name: "format", values: ["json", "text"] },
    "{url:https-url}",
    "{folder:folder}",
    { if: "branch", args: ["--branch", "{branch:ref}"] },
  ]);
  const request = {
    command: "run",
    args: {
      id: "PAY:12",
      ref: "feature/login",
      count: 42,
      format: "json",
      url: "https://example.test/a",
      folder: "repo",
      branch: "fix/login",
    },
  };
  expect(JSON.parse((await op.run(request)).stdout)).toEqual([
    "PAY:12",
    "feature/login",
    "42",
    "json",
    "https://example.test/a",
    await import("node:fs/promises").then((fs) => fs.realpath(root)),
    "--branch",
    "fix/login",
  ]);
});
it.each([
  ["id", "a b"],
  ["ref", "x..y"],
  ["ref", "a/.hidden"],
  ["number", "NaN"],
  ["https-url", "http://example.test"],
  ["folder", "C:/unknown"],
])("Given invalid %s slot, refuses", async (kind, value) => {
  const { op } = await fixture([`{value:${kind}}`]);
  await expect(
    op.run({ command: "run", args: { value } }),
  ).rejects.toBeInstanceOf(Error);
});
it("Given a command waiting for input, sends stdin and removes AJOUR environment", async () => {
  process.env.AJOUR_PROCESS_CANARY = "secret";
  try {
    const { op } = await fixture(
      [],
      "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({data,keys:Object.keys(process.env).filter(k=>/^AJOUR_/i.test(k))})))",
    );
    expect(
      JSON.parse(
        (await op.run({ command: "run", args: {}, stdin: "hello\nworld" }))
          .stdout,
      ),
    ).toEqual({ data: "hello\nworld", keys: [] });
  } finally {
    delete process.env.AJOUR_PROCESS_CANARY;
  }
});
it("Given a hanging child, the declared timeout ends it", async () => {
  const { op } = await fixture([], "setInterval(()=>{},1000)");
  await expect(op.run({ command: "run", args: {} })).rejects.toMatchObject({
    reason: "timeout",
  });
});
it.each(["stdout", "stderr"])(
  "Given more than 1 MB on %s, ends the child",
  async (stream) => {
    const { op } = await fixture(
      [],
      `process.${stream}.write('x'.repeat(1048577));setInterval(()=>{},1000)`,
    );
    await expect(op.run({ command: "run", args: {} })).rejects.toMatchObject({
      reason: "output_limit",
    });
  },
);
it("Given four active calls across operations, a fifth is refused and close cancels only its operation", async () => {
  const { op, broker, manifest } = await fixture(
    [],
    "setInterval(()=>{},1000)",
  );
  const pending = Array.from({ length: 4 }, () =>
    op.run({ command: "run", args: {} }).catch((e) => e),
  );
  // Reservations happen before executable lookup, across every operation of this plugin.
  await new Promise((r) => setTimeout(r, 100));
  const other = broker.forOperation({
    pluginId: manifest.id,
    manifest,
    method: "syncConnection",
  });
  await expect(other.run({ command: "run", args: {} })).rejects.toMatchObject({
    reason: "concurrency",
  });
  op.close();
  expect(await Promise.all(pending)).toEqual(
    Array.from({ length: 4 }, () =>
      expect.objectContaining({ reason: "operation_ended" }),
    ),
  );
  await expect(op.run({ command: "run", args: {} })).rejects.toMatchObject({
    reason: "operation_ended",
  });
});

it.each(["plugin_off", "needs_consent"] as const)(
  "Given gate %s, refuses before checking commands",
  async (reason) => {
    const { manifest, root } = await fixture();
    const broker = new ProcessBroker({
      folders: { resolve: async () => root },
      protectedDirectories: [],
      gate: async () => reason,
    });
    await expect(
      broker
        .forOperation({
          pluginId: manifest.id,
          manifest,
          method: "syncConnection",
        })
        .run({ command: "unknown", args: {} }),
    ).rejects.toMatchObject({ reason });
  },
);
it("Given undeclared commands and modes not yet supported, refuses", async () => {
  const { op, manifest, broker } = await fixture();
  await expect(op.run({ command: "unknown", args: {} })).rejects.toMatchObject({
    reason: "undeclared",
  });
  for (const mode of ["detached", "terminal"] as const) {
    const altered = structuredClone(manifest);
    altered.processes!.commands[0]!.mode = mode;
    await expect(
      broker
        .forOperation({
          pluginId: manifest.id,
          manifest: altered,
          method: "syncConnection",
        })
        .run({ command: "run", args: { title: "x" } }),
    ).rejects.toMatchObject({ reason: "not_yet" });
  }
});
it("Given a repository folder in Ajour data, refuses it", async () => {
  const { manifest, root } = await fixture(["{folder:folder}"]);
  const broker = new ProcessBroker({
    folders: { resolve: async () => root },
    protectedDirectories: [root],
    gate: async () => undefined,
  });
  await expect(
    broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
      })
      .run({ command: "run", args: { folder: "repo" } }),
  ).rejects.toMatchObject({ reason: "folder_refused" });
});
it("Given marked argv, stdin, output and paths, emits one content-free event per call and records activity", async () => {
  const marker = "CANARY-LEAK-7Q4X";
  const { manifest, root } = await fixture(
    ["{title:text}"],
    `process.stdout.write('${marker}');process.stdin.resume()`,
  );
  const sink = createRecordingSink<AjourEvent>();
  const records: unknown[] = [];
  const broker = new ProcessBroker({
    folders: { resolve: async () => root },
    protectedDirectories: [],
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
    events: createApiEvents({ sink, userDataPath: root }),
    record: async (...args) => {
      records.push(args);
    },
  });
  const op = broker.forOperation({
    pluginId: manifest.id,
    manifest,
    method: "syncConnection",
  });
  expect(
    (await op.run({ command: "run", args: { title: marker }, stdin: marker }))
      .stdout,
  ).toBe(marker);
  await expect(op.run({ command: marker, args: {} })).rejects.toMatchObject({
    reason: "undeclared",
  });
  expect(sink.events).toMatchObject([
    {
      name: "plugin.process",
      kind: "job",
      outcome: "ok",
      process: { command_id: "run", exit_code: 0, decided_by: "gate" },
    },
    {
      name: "plugin.process",
      outcome: "refused",
      outcome_reason: "undeclared",
      process: { command_id: "undeclared" },
    },
  ]);
  expect(JSON.stringify(sink.events)).not.toContain(marker);
  expect(JSON.stringify(sink.events)).not.toContain(root);
  expect(records).toEqual([
    [manifest.id, expect.any(Number), false],
    [manifest.id, expect.any(Number), true],
  ]);
});

it("Given saved process settings, reload preserves overrides and activity and removing an override clears it", async () => {
  const { root } = await fixture();
  const { AppApiStorage } = await import("./storage.ts");
  const file = path.join(root, "state.json");
  const storage = new AppApiStorage(file);
  expect(await storage.getPluginProcessSettings("test")).toEqual({
    overrides: {},
    refusedCount: 0,
  });
  await storage.setPluginProcessOverride("test", "node", process.execPath);
  await Promise.all([
    storage.recordPluginProcess("test", 100, true),
    storage.recordPluginProcess("test", 200, false),
  ]);
  const reloaded = new AppApiStorage(file);
  expect(await reloaded.getPluginProcessSettings("test")).toEqual({
    overrides: { node: process.execPath },
    lastRunAt: 200,
    refusedCount: 1,
  });
  await reloaded.setPluginProcessOverride("test", "node", null);
  expect((await reloaded.getPluginProcessSettings("test")).overrides).toEqual(
    {},
  );
});

it("Given a child that starts a descendant, cancellation ends both", async () => {
  const { root } = await fixture();
  const pidFile = path.join(root, "descendant.pid");
  const { op } = await fixture(
    [],
    `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000)`,
  );
  const running = op.run({ command: "run", args: {} }).catch((error) => error);
  const fs = await import("node:fs/promises");
  let pids: number[] = [];
  try {
    for (let n = 0; n < 100; n++) {
      try {
        pids = JSON.parse(await fs.readFile(pidFile, "utf8"));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    expect(pids).toHaveLength(2);
  } finally {
    op.close();
    await running;
  }
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
});
it("Given no override, finds an executable by name on the user's PATH", async () => {
  const { manifest, root } = await fixture([]);
  const previous = process.env.PATH;
  process.env.PATH = path.dirname(process.execPath);
  try {
    const broker = new ProcessBroker({
      folders: { resolve: async () => root },
      protectedDirectories: [],
      gate: async () => undefined,
    });
    const op = broker.forOperation({
      pluginId: manifest.id,
      manifest,
      method: "syncConnection",
    });
    expect((await op.run({ command: "run", args: {} })).exitCode).toBe(0);
  } finally {
    process.env.PATH = previous;
  }
});
it.each(["id", "text"])(
  "Given a number in a %s slot, refuses it",
  async (kind) => {
    const { op } = await fixture([`{value:${kind}}`]);
    await expect(
      op.run({ command: "run", args: { value: 12 } }),
    ).rejects.toMatchObject({ reason: "invalid_request" });
  },
);
it("Given an empty optional group, omits it, and refuses unknown or partial slots", async () => {
  const { op } = await fixture([
    { if: "branch", args: ["--branch", "{branch:ref}", "{base:ref}"] },
  ]);
  expect(
    JSON.parse((await op.run({ command: "run", args: {} })).stdout),
  ).toEqual([]);
  const invalidArgs: Record<string, string>[] = [
    { base: "main" },
    { branch: "feature" },
    { extra: "value" },
  ];
  for (const args of invalidArgs)
    await expect(op.run({ command: "run", args })).rejects.toMatchObject({
      reason: "invalid_request",
    });
});
it.each([
  ["relative.exe", "spawn_refused"],
  [path.join(os.tmpdir(), "ajour-no-such-executable.exe"), "spawn_failed"],
])(
  "Given unusable executable override %s, reports %s",
  async (executable, reason) => {
    const { manifest } = await fixture([]);
    const broker = new ProcessBroker({
      folders: { resolve: async () => undefined },
      protectedDirectories: [],
      gate: async () => undefined,
      executableOverride: async () => executable,
    });
    await expect(
      broker
        .forOperation({
          pluginId: manifest.id,
          manifest,
          method: "syncConnection",
        })
        .run({ command: "run", args: {} }),
    ).rejects.toMatchObject({ reason });
  },
);
it("Given a declared executable absent from PATH, refuses without starting", async () => {
  const { manifest } = await fixture([]);
  manifest.processes!.executables.node!.names = [
    "ajour-missing-executable-713",
  ];
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    protectedDirectories: [],
    gate: async () => undefined,
  });
  await expect(
    broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
      })
      .run({ command: "run", args: {} }),
  ).rejects.toMatchObject({ reason: "executable_missing" });
});
it("Given an enum outside its declared set, refuses", async () => {
  const { op } = await fixture([
    { kind: "enum", name: "format", values: ["json"] },
  ]);
  await expect(
    op.run({ command: "run", args: { format: "xml" } }),
  ).rejects.toMatchObject({ reason: "invalid_request" });
});

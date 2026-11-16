import { copyFile, link, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { createApiEvents } from "./events.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { gitEnvironment, ProcessBroker } from "./process-broker.ts";
import { processRuleTable, processRules } from "./process-rules.ts";
import { FolderResolver } from "./repository-folders.ts";
import { AppApiStorage } from "./storage.ts";
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
  const storage = new AppApiStorage(path.join(root, "state.json"));
  const folder = await storage.addRepositoryFolder("project", root, "repo");
  const folders = new FolderResolver(storage, {});
  const sink = createRecordingSink<AjourEvent>();
  const broker = new ProcessBroker({
    events: createApiEvents({ sink, userDataPath: root }),
    folders,
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
  });
  return {
    root,
    manifest,
    broker,
    folder,
    sink,
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
        .stdout!,
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
  const { op, root, folder } = await fixture([
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
      folder: folder.id,
      branch: "fix/login",
    },
  };
  expect(JSON.parse((await op.run(request)).stdout!)).toEqual([
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
  ).rejects.toMatchObject({
    reason: kind == "folder" ? "folder_refused" : "invalid_request",
  });
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
          .stdout!,
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
describe("Given a git child", () => {
  const printGitEnvironment =
    "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k])=>/^GIT_/i.test(k))))))";
  const saved: Record<string, string | undefined> = {};
  function setEnv(values: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(values)) {
      saved[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      delete saved[key];
    }
  });
  /** A broker whose executable is a copy of node named git. */
  async function gitBroker(name = "git") {
    const { manifest, root } = await fixture([], printGitEnvironment);
    const git = path.join(
      root,
      process.platform === "win32" ? `${name}.exe` : name,
    );
    await link(process.execPath, git).catch(() =>
      copyFile(process.execPath, git),
    );
    const broker = new ProcessBroker({
      folders: { resolve: async () => root },
      gate: async () => undefined,
      executableOverride: async () => git,
    });
    const op = broker.forOperation({
      pluginId: manifest.id,
      manifest,
      method: "syncConnection",
    });
    return async () =>
      JSON.parse(
        (await op.run({ command: "run", args: {} })).stdout!,
      ) as Record<string, string>;
  }

  it("refuses bare repositories it wasn't pointed at and takes no optional locks", async () => {
    setEnv({ GIT_CONFIG_COUNT: undefined, GIT_OPTIONAL_LOCKS: undefined });
    const run = await gitBroker();
    expect(await run()).toMatchObject({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.bareRepository",
      GIT_CONFIG_VALUE_0: "explicit",
      GIT_OPTIONAL_LOCKS: "0",
    });
  });

  it("keeps the configuration entries Ajour's environment already has", async () => {
    setEnv({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.pager",
      GIT_CONFIG_VALUE_0: "cat",
      GIT_CONFIG_KEY_1: "safe.bareRepository",
      GIT_CONFIG_VALUE_1: "all",
    });
    const run = await gitBroker();
    expect(await run()).toMatchObject({
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "core.pager",
      GIT_CONFIG_VALUE_0: "cat",
      GIT_CONFIG_KEY_1: "safe.bareRepository",
      GIT_CONFIG_VALUE_1: "all",
      // The last entry wins.
      GIT_CONFIG_KEY_2: "safe.bareRepository",
      GIT_CONFIG_VALUE_2: "explicit",
      GIT_OPTIONAL_LOCKS: "0",
    });
  });

  it("replaces a count git couldn't read, and reuses the key's spelling", () => {
    expect(gitEnvironment({ GIT_CONFIG_COUNT: "x" })).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.bareRepository",
      GIT_CONFIG_VALUE_0: "explicit",
      GIT_OPTIONAL_LOCKS: "0",
    });
    expect(
      gitEnvironment({ Git_Config_Count: "1", Git_Optional_Locks: "1" }),
    ).toEqual({
      Git_Config_Count: "2",
      GIT_CONFIG_KEY_1: "safe.bareRepository",
      GIT_CONFIG_VALUE_1: "explicit",
      Git_Optional_Locks: "0",
    });
  });

  it("gives other programs no git settings", async () => {
    setEnv({ GIT_CONFIG_COUNT: undefined, GIT_OPTIONAL_LOCKS: undefined });
    const run = await gitBroker("gitk");
    expect(await run()).not.toHaveProperty("GIT_CONFIG_COUNT");
    expect(await run()).not.toHaveProperty("GIT_OPTIONAL_LOCKS");
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
  manifest.processes!.undeclaredCommands = true;
  await expect(
    other.run({ executable: "node", argv: ["--version"] }),
  ).rejects.toMatchObject({ reason: "concurrency" });
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
});
it("Given a repository folder in Ajour data, refuses it", async () => {
  const { manifest, root } = await fixture(["{folder:folder}"]);
  const storage = new AppApiStorage(path.join(root, "state.json"));
  // Simulate a saved folder that now points into a protected root.
  const folder = await storage.addRepositoryFolder("project", root, "repo");
  const broker = new ProcessBroker({
    folders: new FolderResolver(storage, { userData: root }),
    gate: async () => undefined,
  });
  await expect(
    broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
      })
      .run({ command: "run", args: { folder: folder.id } }),
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
      .stdout!,
  ).toBe(marker);
  await expect(op.run({ command: marker, args: {} })).rejects.toMatchObject({
    reason: "undeclared",
  });
  expect(sink.events).toMatchObject([
    {
      name: "plugin.process",
      kind: "job",
      outcome: "ok",
      process: { command_id: "run", exit_code: 0, decided_by: "ok" },
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
    [manifest.id, expect.any(Number), false, true],
    [manifest.id, expect.any(Number), true, false],
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
  await storage.flushBrokerActivity();
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
  try {
    // taskkill can close the parent's pipes before it finishes the tree.
    await vi.waitFor(
      () => {
        for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
      },
      { timeout: 2000 },
    );
  } finally {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    }
  }
});
it("Given no override, finds an executable by name on the user's PATH", async () => {
  const { manifest, root } = await fixture([]);
  const previous = process.env.PATH;
  process.env.PATH = path.dirname(process.execPath);
  try {
    const broker = new ProcessBroker({
      folders: { resolve: async () => root },
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
    JSON.parse((await op.run({ command: "run", args: {} })).stdout!),
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

it.each([" https://example.test/a ", "https://exa\tmple.test/a"])(
  "Given URL whitespace %j, passes the normalized URL",
  async (value) => {
    const { op } = await fixture(["{url:https-url}"]);
    expect(
      JSON.parse(
        (await op.run({ command: "run", args: { url: value } })).stdout!,
      ),
    ).toEqual(["https://example.test/a"]);
  },
);
it("Given stdin without text permission, refuses", async () => {
  const { op, manifest } = await fixture([]);
  delete manifest.processes!.commands[0]!.stdin;
  await expect(
    op.run({ command: "run", args: {}, stdin: "input" }),
  ).rejects.toMatchObject({ reason: "invalid_request" });
});
it("Given text beyond 32767 UTF-16 units, refuses", async () => {
  const { op } = await fixture();
  await expect(
    op.run({ command: "run", args: { title: "x".repeat(32768) } }),
  ).rejects.toMatchObject({ reason: "invalid_request" });
});

it("Given a refusal before spawn, activity has no lastRunAt", async () => {
  const { root } = await fixture();
  const { AppApiStorage } = await import("./storage.ts");
  const storage = new AppApiStorage(path.join(root, "activity.json"));
  storage.recordPluginProcess("test", 100, true, false);
  await storage.flushBrokerActivity();
  expect(await storage.getPluginProcessSettings("test")).toEqual({
    overrides: {},
    refusedCount: 1,
  });
});
it("Given an activity recorder still writing, run settles without waiting", async () => {
  const { manifest } = await fixture([]);
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
    record: () => new Promise(() => {}),
  });
  const op = broker.forOperation({
    pluginId: manifest.id,
    manifest,
    method: "syncConnection",
  });
  expect((await op.run({ command: "run", args: {} })).exitCode).toBe(0);
});
// Windows Node closes inherited pipe handles when this fixture parent exits.
it.skipIf(process.platform === "win32").each(["stdout", "stderr"] as const)(
  "Given a descendant writing later to %s, captures through EOF",
  async (stream) => {
    const { op, manifest } = await fixture(
      [],
      `process.${stream}.write('HEAD');require('node:child_process').spawn(process.execPath,['-e',"setTimeout(()=>process.${stream}.write('TAIL'),400)"],{stdio:['ignore',1,2]}).unref()`,
    );
    manifest.processes!.commands[0]!.timeoutSeconds = 10;
    expect((await op.run({ command: "run", args: {} }))[stream]).toBe(
      "HEADTAIL",
    );
  },
);
it.skipIf(process.platform === "win32")(
  "Given a descendant holding a pipe beyond the drain bound, refuses incomplete capture",
  async () => {
    const { op, manifest } = await fixture(
      [],
      `require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2600)'],{stdio:['ignore',1,'ignore']}).unref()`,
    );
    manifest.processes!.commands[0]!.timeoutSeconds = 10;
    await expect(op.run({ command: "run", args: {} })).rejects.toMatchObject({
      reason: "capture_incomplete",
    });
  },
);

it.each(["missing", "changed", "off", "during-operation"])(
  "Given %s consent, the broker port refuses with real storage",
  async (scenario) => {
    const { manifest, root } = await fixture([]);
    const { AppApiStorage } = await import("./storage.ts");
    const { processConsentGate } = await import("./plugin-consent.ts");
    const { summarizePluginAccess } =
      await import("../../../packages/shared/plugin-access.ts");
    const storage = new AppApiStorage(path.join(root, "consent.json"));
    const access = summarizePluginAccess(manifest, { agentPrompts: {} });
    await storage.setPluginOrigin(manifest.id, {
      kind: "source",
      signed: true,
      installedAt: new Date().toISOString(),
    });
    if (scenario === "missing") access.commands = [];
    await storage.recordPluginConsent(manifest.id, {
      version: "1.0.0",
      access,
      at: 1,
    });
    if (scenario === "changed")
      manifest.processes!.commands[0]!.args.push({
        kind: "literal",
        value: "changed",
      });
    if (scenario === "off") await storage.setPluginEnabled(manifest.id, false);
    const broker = new ProcessBroker({
      folders: { resolve: async () => undefined },
      gate: (c) => processConsentGate(storage, c),
      executableOverride: async () => {
        if (scenario === "during-operation") {
          const updated = structuredClone(manifest);
          updated.processes!.commands[0]!.args.push({
            kind: "literal",
            value: "updated",
          });
          await storage.recordPluginConsent(manifest.id, {
            version: "2.0.0",
            access: summarizePluginAccess(updated, { agentPrompts: {} }),
            at: 2,
          });
        }
        return process.execPath;
      },
    });
    await expect(
      broker
        .forOperation({
          pluginId: manifest.id,
          manifest,
          method: "syncConnection",
        })
        .run({ command: "run", args: {} }),
    ).rejects.toMatchObject({
      reason: scenario === "off" ? "plugin_off" : "needs_consent",
    });
  },
);

it("Given one malformed process settings entry, preserves the other plugin's settings", async () => {
  const { root } = await fixture();
  const { AppApiStorage } = await import("./storage.ts");
  const fs = await import("node:fs/promises");
  const file = path.join(root, "normalize.json");
  const storage = new AppApiStorage(file);
  await storage.setPluginProcessOverride("valid", "node", process.execPath);
  const state = JSON.parse(await fs.readFile(file, "utf8"));
  state.pluginProcesses.broken = { overrides: 7 };
  await fs.writeFile(file, JSON.stringify(state));
  const reloaded = new AppApiStorage(file);
  expect((await reloaded.getPluginProcessSettings("valid")).overrides).toEqual({
    node: process.execPath,
  });
  expect(await reloaded.getPluginProcessSettings("broken")).toEqual({
    overrides: {},
    refusedCount: 0,
  });
});
it("Given a burst of process activity, gathers it without writing until flush", async () => {
  const { root } = await fixture();
  const { AppApiStorage } = await import("./storage.ts");
  const fs = await import("node:fs/promises");
  const file = path.join(root, "buffered.json");
  const storage = new AppApiStorage(file);
  await storage.setPluginProcessOverride("test", "node", process.execPath);
  const before = await fs.readFile(file, "utf8");
  for (let i = 0; i < 20; i++)
    storage.recordPluginProcess("test", i, true, false);
  expect(await fs.readFile(file, "utf8")).toBe(before);
  expect(await storage.getPluginProcessSettings("test")).toMatchObject({
    refusedCount: 20,
  });
  await storage.flushBrokerActivity();
  expect(
    await new AppApiStorage(file).getPluginProcessSettings("test"),
  ).toMatchObject({ refusedCount: 20 });
});

it("Given caller project context, refuses a folder from another project", async () => {
  const { broker, manifest, folder } = await fixture(["{folder:folder}"]);
  await expect(
    broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
        projectId: "other",
      })
      .run({ command: "run", args: { folder: folder.id } }),
  ).rejects.toMatchObject({ reason: "folder_refused" });
});

it("Given an undeclared capture command, preserves leading options and resolves cwd by id", async () => {
  const { root, manifest, folder } = await fixture();
  manifest.processes!.undeclaredCommands = true;
  const broker = new ProcessBroker({
    folders: { resolve: async (id) => (id === folder.id ? root : undefined) },
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
    policy: async () => ({
      identity: "v1",
      signed: true,
      mode: "auto",
      approvals: [],
    }),
  });
  const op = broker.forOperation({
    pluginId: manifest.id,
    manifest,
    method: "syncConnection",
  });
  const result = await op.run({
    executable: "node",
    argv: [
      "-p",
      "JSON.stringify([process.cwd(), process.argv.slice(1)])",
      "--",
      "-value",
      "a  b & c",
    ],
    cwdFolder: folder.id,
  });
  // The child reports its cwd as the system sees it: macOS turns /var into
  // /private/var, while Windows keeps a short 8.3 name such as RUNNER~1.
  const { realpath } = await import("node:fs/promises");
  const [cwd, argv] = JSON.parse(result.stdout!);
  expect([root, await realpath(root)]).toContain(cwd);
  expect(argv).toEqual(["-value", "a  b & c"]);
  await expect(
    op.run({ executable: "node", argv: [], cwdFolder: "missing" }),
  ).rejects.toMatchObject({ reason: "folder_refused" });
  await broker.shutdown();
});
it.each([
  "cmd.exe",
  "bash",
  "pwsh",
  "wscript",
  "C:/tool.exe",
  "../tool",
  "tool.ps1",
])(
  "Given executable %s, no mode or review bypasses name validation",
  async (executable) => {
    const { manifest } = await fixture();
    const review = vi.fn(async () => ({ verdict: "none" as const }));
    const broker = new ProcessBroker({
      folders: { resolve: async () => undefined },
      gate: async () => undefined,
      review: { review },
      policy: async () => ({
        identity: "v",
        signed: true,
        mode: "accept-everything",
        approvals: [],
      }),
    });
    await expect(
      broker
        .forOperation({
          pluginId: manifest.id,
          manifest,
          method: "syncConnection",
        })
        .run({ executable, argv: [] }),
    ).rejects.toMatchObject({ reason: "invalid_request" });
    expect(review).not.toHaveBeenCalled();
  },
);
it.each([
  "x\0y",
  "x\ry",
  "x\ny",
  "x\u202ey",
  "x\u2028y",
  "x\u2029y",
  "x\ty",
  "x\u007fy",
  "xㅤy",
  "xᅟy",
  "xﾠy",
  "x͏y",
  "x️y",
  "x\ud800y",
  "x͸y",
])("Given an invalid argument, refuses %j", async (value) => {
  const { op } = await fixture();
  await expect(
    op.run({ executable: "git", argv: [value] }),
  ).rejects.toMatchObject({ reason: "invalid_request" });
});
it("Given Always, remembers only the exact line and folder, then rechecks gates after an ask", async () => {
  const { manifest, root, folder } = await fixture();
  manifest.processes!.undeclaredCommands = true;
  let off = false;
  const approvals: import("../../../packages/shared/command-modes.ts").CommandPolicy["approvals"] =
    [];
  const ask = vi.fn(async () => ({ answer: "always" as const }));
  const broker = new ProcessBroker({
    folders: { resolve: async () => root },
    gate: async () => (off ? "plugin_off" : undefined),
    executableOverride: async () => process.execPath,
    policy: async () => ({
      identity: "v",
      signed: true,
      mode: "always-ask",
      approvals,
    }),
    ask,
    remember: async (_caller, command) => {
      approvals.push({ ...command, id: "approved" });
    },
  });
  const op = broker.forOperation({
    pluginId: manifest.id,
    manifest,
    method: "syncConnection",
  });
  const request = {
    executable: "node",
    argv: ["--version"],
    cwdFolder: folder.id,
  };
  await op.run(request);
  await op.run(request);
  expect(ask).toHaveBeenCalledTimes(1);
  await op.run({ ...request, argv: ["-v"] });
  expect(ask).toHaveBeenCalledTimes(2);
  await op.run({ ...request, cwdFolder: undefined });
  expect(ask).toHaveBeenCalledTimes(3);
  off = true;
  await expect(op.run(request)).rejects.toMatchObject({ reason: "plugin_off" });
  off = false;
  ask.mockImplementationOnce(async () => {
    off = true;
    return { answer: "always" };
  });
  await expect(op.run({ ...request, argv: ["--help"] })).rejects.toMatchObject({
    reason: "plugin_off",
  });
  await broker.shutdown();
});

it.each([
  ["user_denied", "user"],
  ["ask_queue_full", "gate"],
  ["ask_timeout", "mode"],
  ["no_window", "gate"],
] as const)(
  "Given %s, plugin.process records %s without argv",
  async (reason, decidedBy) => {
    const { manifest } = await fixture();
    manifest.processes!.undeclaredCommands = true;
    const marker = "private-command-text";
    const sink = createRecordingSink<AjourEvent>();
    const broker = new ProcessBroker({
      folders: { resolve: async () => undefined },
      gate: async () => undefined,
      events: createApiEvents({ sink, userDataPath: os.tmpdir() }),
      policy: async () => ({
        identity: "v",
        signed: true,
        mode: "always-ask",
        approvals: [],
      }),
      ask: async () => ({ answer: "deny", reason }),
    });
    await expect(
      broker
        .forOperation({
          pluginId: manifest.id,
          manifest,
          method: "syncConnection",
        })
        .run({ executable: "git", argv: [marker] }),
    ).rejects.toMatchObject({ reason });
    expect(sink.events).toMatchObject([
      {
        name: "plugin.process",
        outcome: "refused",
        process: { mode: "always-ask", decided_by: decidedBy },
      },
    ]);
    expect(JSON.stringify(sink.events)).not.toContain(marker);
  },
);

describe("Given the rule table", () => {
  async function ruleBroker(mode: "auto" | "always-ask") {
    const { manifest, root } = await fixture();
    manifest.processes!.undeclaredCommands = true;
    const sink = createRecordingSink<AjourEvent>();
    const ask = vi.fn(async () => ({ answer: "once" as const }));
    const broker = new ProcessBroker({
      folders: { resolve: async () => root },
      gate: async () => undefined,
      events: createApiEvents({ sink, userDataPath: root }),
      review: processRules({
        repositoryFolders: async () => [root],
        protectedRoots: [path.join(root, "ajour-data")],
        home: os.homedir(),
      }),
      policy: async () => ({
        identity: "v",
        signed: true,
        mode,
        approvals: [],
      }),
      ask,
    });
    const op = broker.forOperation({
      pluginId: manifest.id,
      manifest,
      method: "syncConnection",
    });
    return { broker, op, ask, sink };
  }
  const reasonOf = (id: string) =>
    processRuleTable.find((rule) => rule.id === id)!.reason;

  it("Auto asks for a risky command with the rule's reason and runs a plain one", async () => {
    const { broker, op, ask, sink } = await ruleBroker("auto");
    const plain = await op.run({ executable: "node", argv: ["--version"] });
    expect(plain.exitCode).toBe(0);
    expect(ask).not.toHaveBeenCalled();

    const risky = await op.run({
      executable: "node",
      argv: ["-e", "process.exit(3)"],
    });
    expect(risky.exitCode).toBe(3);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        executable: "node",
        risky: true,
        reason: reasonOf("inline-code"),
      }),
      expect.anything(),
    );
    expect(sink.events.map((e) => e.process)).toMatchObject([
      { mode: "auto", decided_by: "mode" },
      { mode: "auto", rule_id: "inline-code", decided_by: "user" },
    ]);
    expect(sink.events[0]!.process).not.toHaveProperty(
      "rule_id",
      expect.anything(),
    );
    expect(JSON.stringify(sink.events)).not.toContain("process.exit");
    await broker.shutdown();
  });

  it("Auto asks for a history rewrite with its reason, and Always ask shows the same", async () => {
    // `--git-dir=missing` makes git fail before it reads any repository.
    const request = {
      executable: "git",
      argv: ["--git-dir=missing", "branch", "-D", "old"],
      cwdFolder: "repo",
    };
    for (const mode of ["auto", "always-ask"] as const) {
      const { broker, op, ask, sink } = await ruleBroker(mode);
      expect((await op.run(request)).exitCode).not.toBe(0);
      expect(ask).toHaveBeenCalledWith(
        expect.objectContaining({
          risky: true,
          reason: reasonOf("git-branch-delete"),
        }),
        expect.anything(),
      );
      expect(sink.events[0]!.process).toMatchObject({
        rule_id: "git-branch-delete",
        decided_by: "user",
      });
      await broker.shutdown();
    }
  });

  it("Auto asks for a command Ajour doesn't know, and the event carries only the rule id", async () => {
    const { broker, op, ask, sink } = await ruleBroker("auto");
    const result = await op.run({
      executable: "node",
      argv: ["missing-secret-script.js", "--token=hunter2"],
    });
    expect(result.exitCode).not.toBe(0);
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        risky: true,
        reason: "Ajour doesn't know what this command does, so it asks.",
      }),
      expect.anything(),
    );
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]!.process).toMatchObject({
      mode: "auto",
      rule_id: "unknown",
      decided_by: "user",
    });
    const logged = JSON.stringify(sink.events);
    expect(logged).not.toContain("missing-secret-script");
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("doesn't know");
    await broker.shutdown();
  });
});

it("Given a detached command, returns started and leaves the child alive after close and shutdown", async () => {
  const { manifest, broker, root, folder, sink } = await fixture(
    ["{folder:folder}"],
    "const fs=require('fs');setTimeout(()=>{fs.writeFileSync(require('path').join(process.cwd(),'detached-done'),'done')},300)",
  );
  manifest.processes!.commands[0]!.mode = "detached";
  const op = broker.forOperation({
    pluginId: manifest.id,
    manifest,
    method: "syncConnection",
  });
  expect(await op.run({ command: "run", args: { folder: folder.id } })).toEqual(
    { started: true },
  );
  expect(sink.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "plugin.process",
        outcome: "ok",
        process: expect.objectContaining({
          mode: "detached",
          command_id: "run",
        }),
      }),
    ]),
  );
  op.close();
  await broker.shutdown();
  const { readFile } = await import("node:fs/promises");
  await expect
    .poll(async () => readFile(path.join(root, "detached-done"), "utf8"))
    .toBe("done");
});
it.each([
  "https://example.test/private?secret=CANARY",
  "codex://thread/private?secret=CANARY",
])(
  "Given allowed link %s, opens through the injected main port and logs only the scheme",
  async (url) => {
    const { manifest } = await fixture();
    manifest.processes!.openSchemes = ["codex"];
    const sink = createRecordingSink<AjourEvent>();
    const opened = vi.fn(async (_url: string) => undefined);
    const gate = vi.fn(async () => undefined);
    const broker = new ProcessBroker({
      folders: { resolve: async () => undefined },
      gate,
      openExternal: opened,
      events: createApiEvents({ sink, userDataPath: os.tmpdir() }),
    });
    await broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
      })
      .open(url);
    expect(opened).toHaveBeenCalledWith(url, ["codex"]);
    expect(JSON.stringify(sink.events)).not.toContain("CANARY");
    expect(sink.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "plugin.open",
          outcome: "ok",
          open: { scheme: new URL(url).protocol.slice(0, -1) },
        }),
      ]),
    );
  },
);
it.each([
  "file:///tmp/x",
  "javascript:alert(1)",
  "data:text/plain,x",
  "other://x",
  "http://example.test",
])("Given forbidden link %s, never opens", async (url) => {
  const { manifest } = await fixture();
  const opened = vi.fn(async () => undefined);
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    gate: async () => undefined,
    openExternal: opened,
  });
  await expect(
    broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
      })
      .open(url),
  ).rejects.toMatchObject({ reason: "undeclared" });
  expect(opened).not.toHaveBeenCalled();
});
it.each([
  "unsigned_processes_off",
  "process_acceptance_required",
  "needs_consent",
  "plugin_off",
] as const)("Given a declared scheme behind %s, refuses", async (reason) => {
  const { manifest } = await fixture();
  manifest.processes!.openSchemes = ["codex"];
  const opened = vi.fn(async () => undefined);
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    enabledGate: async () => undefined,
    gate: async () => reason,
    openExternal: opened,
  });
  await expect(
    broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
      })
      .open("codex://thread/1"),
  ).rejects.toMatchObject({ reason });
  expect(opened).not.toHaveBeenCalled();
});
it("Given an enabled unsigned plugin, HTTPS does not need process acceptance", async () => {
  const { manifest } = await fixture();
  const opened = vi.fn(async () => undefined);
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    enabledGate: async () => undefined,
    gate: async () => "unsigned_processes_off",
    openExternal: opened,
  });
  const op = broker.forOperation({
    pluginId: manifest.id,
    manifest,
    method: "syncConnection",
  });
  await op.open("https://example.test/");
  op.close();
  await expect(op.open("https://example.test/")).rejects.toMatchObject({
    reason: "operation_ended",
  });
  expect(opened).toHaveBeenCalledTimes(1);
});

it("Given five opens, refuses a sixth across operations until the minute expires", async () => {
  const { manifest } = await fixture();
  const opened = vi.fn(async () => undefined);
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    const broker = new ProcessBroker({
      folders: { resolve: async () => undefined },
      gate: async () => undefined,
      openExternal: opened,
    });
    const caller = {
      pluginId: manifest.id,
      manifest,
      method: "syncConnection" as const,
    };
    for (let i = 0; i < 5; i++)
      await broker.forOperation(caller).open("https://example.test/");
    await expect(
      broker.forOperation(caller).open("https://example.test/"),
    ).rejects.toMatchObject({ reason: "rate_limit" });
    await broker
      .forOperation({ ...caller, pluginId: "other" })
      .open("https://example.test/");
    clock.mockReturnValue(61_000);
    await broker.forOperation(caller).open("https://example.test/");
    expect(opened).toHaveBeenCalledTimes(7);
  } finally {
    clock.mockRestore();
  }
});
it.skipIf(process.platform !== "win32")(
  "Given unsafe terminal text, the plugin receives invalid_request and a terminal reason",
  async () => {
    const { manifest, broker, folder } = await fixture([
      "{folder:folder}",
      "{title:text}",
    ]);
    manifest.processes!.commands[0]!.mode = "terminal";
    await expect(
      broker
        .forOperation({
          pluginId: manifest.id,
          manifest,
          method: "syncConnection",
        })
        .run({
          command: "run",
          args: { folder: folder.id, title: 'x" --injected "y' },
        }),
    ).rejects.toMatchObject({
      reason: "invalid_request",
      message: expect.stringContaining("terminal mode"),
    });
  },
);

// Opens a real Windows Terminal window, which needs an interactive desktop: CI
// runners have none, so it runs only when AJOUR_REAL_WT_TEST=1 is set on a
// developer machine. The unit tests above stay authoritative.
it.skipIf(
  process.platform !== "win32" || process.env.AJOUR_REAL_WT_TEST !== "1",
)(
  "Given real Windows Terminal, a declared command receives every allowed argument exactly",
  async (context) => {
    const { findExecutable } = await import("./agent-runner/cli-path.ts");
    if (!(await findExecutable("wt.exe", process.env.PATH ?? ""))) {
      context.skip(true, "Windows Terminal is not installed on this runner");
      return;
    }
    const values = [
      "last",
      "space value",
      "end\\ with space",
      "abc._-:/@+=,~()",
      "C:\\folder\\child",
      "123",
    ];
    const { manifest, broker, folder, root } = await fixture(
      [
        "{folder:folder}",
        { kind: "literal", value: "--resume" },
        ...values.map((_, i) => `{v${i}:text}`),
      ],
      "require('fs').writeFileSync(require('path').join(process.cwd(),'terminal-result.json'),JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))",
    );
    manifest.processes!.commands[0]!.mode = "terminal";
    const op = broker.forOperation({
      pluginId: manifest.id,
      manifest,
      method: "syncConnection",
    });
    expect(
      await op.run({
        command: "run",
        args: {
          folder: folder.id,
          ...Object.fromEntries(values.map((v, i) => [`v${i}`, v])),
        },
      }),
    ).toEqual({ started: true });
    op.close();
    await broker.shutdown();
    const { readFile } = await import("node:fs/promises");
    await expect
      .poll(
        async () =>
          JSON.parse(
            await readFile(path.join(root, "terminal-result.json"), "utf8"),
          ),
        { timeout: 15000 },
      )
      .toEqual({ cwd: root, args: [root, "--resume", ...values] });
  },
  20000,
);

it.each(["always-ask", "auto", "accept-everything"] as const)(
  "Given no undeclared access under %s, refuses without reading policy",
  async (mode) => {
    const { manifest } = await fixture();
    const policy = vi.fn(async () => ({
      identity: "v",
      signed: true,
      mode,
      approvals: [],
    }));
    const broker = new ProcessBroker({
      folders: { resolve: async () => undefined },
      gate: async () => undefined,
      policy,
    });
    await expect(
      broker
        .forOperation({
          pluginId: manifest.id,
          manifest,
          method: "syncConnection",
        })
        .run({ executable: "node", argv: ["--version"] }),
    ).rejects.toMatchObject({ reason: "undeclared" });
    expect(policy).not.toHaveBeenCalled();
  },
);

it("Given no process access, a refusal reads no policy and writes no activity", async () => {
  const { manifest } = await fixture();
  delete manifest.processes;
  const policy = vi.fn();
  const record = vi.fn();
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    gate: async () => undefined,
    policy,
    record,
  });
  await expect(
    broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
      })
      .run({ command: "missing", args: {} }),
  ).rejects.toMatchObject({ reason: "undeclared" });
  expect(policy).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});
it("Given an undeclared executable with a declared key, ignores the override and shows its resolved path", async () => {
  const { manifest } = await fixture();
  manifest.processes!.undeclaredCommands = true;
  const override = vi.fn(async () => "C:/wrong.exe");
  const ask = vi.fn(async (_ask: unknown) => ({
    answer: "deny" as const,
    reason: "user_denied" as const,
  }));
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    gate: async () => undefined,
    executableOverride: override,
    ask,
  });
  await expect(
    broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
      })
      .run({ executable: "node", argv: ["--version"] }),
  ).rejects.toMatchObject({ reason: "user_denied" });
  expect(override).not.toHaveBeenCalled();
  expect(ask.mock.calls[0]?.[0]).toMatchObject({
    resolvedExecutable: expect.stringMatching(/node(?:\.exe)?$/),
  });
});

it.each([
  "x\u202ey",
  "x\u2028y",
  "x\ty",
  "\ud83d\udc68\u200d\ud83d\udc69",
  "re\u00adport",
])(
  "Given folder display %j chosen by the user, asks with it for the dialog to escape",
  async (value) => {
    const { manifest, root } = await fixture();
    manifest.processes!.undeclaredCommands = true;
    const ask = vi.fn(async (_ask: unknown) => ({
      answer: "deny" as const,
      reason: "user_denied" as const,
    }));
    for (const spoofName of [true, false]) {
      const broker = new ProcessBroker({
        folders: { resolve: async () => (spoofName ? root : value) },
        folderName: async () => (spoofName ? value : "Repo"),
        gate: async () => undefined,
        ask,
      });
      await expect(
        broker
          .forOperation({
            pluginId: manifest.id,
            manifest,
            method: "syncConnection",
          })
          .run({ executable: "node", argv: [], cwdFolder: "folder" }),
      ).rejects.toMatchObject({ reason: "user_denied" });
    }
    expect(ask.mock.calls.map(([a]) => a)).toMatchObject([
      { folderName: value, folderPath: root },
      { folderName: "Repo", folderPath: value },
    ]);
  },
);
it("Given a missing executable, never asks or saves Always", async () => {
  const { manifest } = await fixture();
  manifest.processes!.undeclaredCommands = true;
  const ask = vi.fn(async () => ({ answer: "always" as const }));
  const remember = vi.fn();
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    gate: async () => undefined,
    ask,
    remember,
  });
  await expect(
    broker
      .forOperation({
        pluginId: manifest.id,
        manifest,
        method: "syncConnection",
      })
      .run({ executable: "ajour-nonexistent-test-executable", argv: [] }),
  ).rejects.toMatchObject({ reason: "executable_missing" });
  expect(ask).not.toHaveBeenCalled();
  expect(remember).not.toHaveBeenCalled();
});

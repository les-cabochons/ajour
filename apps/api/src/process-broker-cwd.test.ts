import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { ProcessBroker } from "./process-broker.ts";
import { FolderResolver } from "./repository-folders.ts";
import { AppApiStorage } from "./storage.ts";

// A terminal launch would open a real terminal window: record what it would
// open instead, and let every other launch run.
const terminalLaunches = vi.hoisted(
  () => [] as { cwd: string; args: string[] }[],
);
vi.mock("./process-launch.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./process-launch.ts")>();
  return {
    ...actual,
    launchProcess: async (...call: Parameters<typeof actual.launchProcess>) => {
      const [plan, cwd, terminal] = call;
      if (!terminal) return actual.launchProcess(...call);
      terminalLaunches.push({ cwd, args: plan.args });
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  terminalLaunches.length = 0;
  await Promise.all(
    // A detached child can hold its folder open while it exits on Windows.
    roots
      .splice(0)
      .map((p) =>
        rm(p, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        }),
      ),
  );
});

/** A tool that reports its working folder and argv, as stdout or a file. */
const REPORT =
  "const report=JSON.stringify([process.cwd(),process.argv.slice(2)]);" +
  "if(process.argv.includes('--file'))require('fs').writeFileSync(require('path').join(process.cwd(),'report.json'),report);" +
  "else process.stdout.write(report+'\\n');" +
  "if(process.argv.includes('--stay'))process.stdin.resume();";

async function fixture(
  mode: "capture" | "detached" | "terminal" | "session",
  args: unknown[],
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-process-cwd-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  await import("node:fs/promises").then((fs) => fs.mkdir(repo));
  const script = path.join(root, "tool.cjs");
  await writeFile(script, REPORT);
  const manifest = pluginApi4ManifestSchema.parse({
    id: "process-cwd-test",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "Process cwd test",
    iconSvg: "<svg/>",
    entrypoint: "index.js",
    connectionFields: [{ id: "site", label: "Site", type: "text" }],
    capabilities: { connector: {} },
    processes: {
      executables: { node: { names: ["node"] } },
      commands: [
        {
          id: "show",
          executable: "node",
          args: [{ kind: "literal", value: script }, ...args],
          cwd: "{repo:folder}",
          mode,
          ...(mode === "session" ? { idleTimeoutSeconds: 60 } : {}),
        },
      ],
    },
  });
  const storage = new AppApiStorage(path.join(root, "state.json"));
  const folder = await storage.addRepositoryFolder("project", repo, "repo");
  const other = await storage.addRepositoryFolder("project", root, "root");
  const broker = new ProcessBroker({
    folders: new FolderResolver(storage, {}),
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
    terminal: async () => (process.platform === "win32" ? "wt" : "Terminal"),
  });
  const op = broker.forOperation({
    pluginId: manifest.id,
    manifest,
    method: "syncConnection",
  });
  return { root, repo, folder, other, broker, op };
}

// macOS reports /private/var for /var: compare the real paths.
const same = async (actual: string, expected: string) =>
  expect(await realpath(actual)).toBe(await realpath(expected));

describe("a declared command's working folder (#761)", () => {
  it("runs a capture command in the resolved folder and keeps it out of argv", async () => {
    const { op, folder, repo, broker } = await fixture("capture", [
      "show",
      "{thread:id}",
    ]);
    const result = await op.run({
      command: "show",
      args: { repo: folder.id, thread: "thr_1" },
    });
    const [cwd, argv] = JSON.parse(result.stdout!) as [string, string[]];
    await same(cwd, repo);
    expect(argv).toEqual(["show", "thr_1"]);
    await broker.shutdown();
  });

  it("takes precedence over the first folder argument", async () => {
    const { op, folder, other, repo, root, broker } = await fixture("capture", [
      "{target:folder}",
    ]);
    const result = await op.run({
      command: "show",
      args: { repo: folder.id, target: other.id },
    });
    const [cwd, argv] = JSON.parse(result.stdout!) as [string, string[]];
    await same(cwd, repo);
    expect(argv).toHaveLength(1);
    await same(argv[0]!, root);
    await broker.shutdown();
  });

  it("passes a slot the arguments also use once, in its place", async () => {
    const { op, folder, repo, broker } = await fixture("capture", [
      "{repo:folder}",
    ]);
    const result = await op.run({ command: "show", args: { repo: folder.id } });
    const [cwd, argv] = JSON.parse(result.stdout!) as [string, string[]];
    await same(cwd, repo);
    expect(argv).toHaveLength(1);
    await same(argv[0]!, repo);
    await broker.shutdown();
  });

  it.each([
    ["missing", {}, "invalid_request"],
    ["unknown", { repo: "not-a-folder" }, "folder_refused"],
  ])("refuses a %s folder before spawn", async (_, args, reason) => {
    const { op, broker } = await fixture("capture", []);
    await expect(op.run({ command: "show", args })).rejects.toMatchObject({
      reason,
    });
    await broker.shutdown();
  });

  it("starts a detached command in the resolved folder", async () => {
    const { op, folder, repo, broker } = await fixture("detached", ["--file"]);
    expect(
      await op.run({ command: "show", args: { repo: folder.id } }),
    ).toEqual({ started: true });
    op.close();
    await broker.shutdown();
    const report = path.join(repo, "report.json");
    await expect
      .poll(() => readFile(report, "utf8").catch(() => ""))
      .not.toBe("");
    const [cwd, argv] = JSON.parse(await readFile(report, "utf8")) as [
      string,
      string[],
    ];
    await same(cwd, repo);
    expect(argv).toEqual(["--file"]);
  });

  it("opens a terminal command in the resolved folder", async () => {
    const { op, folder, repo, root, broker } = await fixture("terminal", [
      "--file",
    ]);
    expect(
      await op.run({ command: "show", args: { repo: folder.id } }),
    ).toEqual({ started: true });
    expect(terminalLaunches).toHaveLength(1);
    await same(terminalLaunches[0]!.cwd, repo);
    expect(terminalLaunches[0]!.args).toEqual([
      path.join(root, "tool.cjs"),
      "--file",
    ]);
    await broker.shutdown();
  });

  it("opens a session in the resolved folder", async () => {
    const { op, folder, repo, broker } = await fixture("session", ["--stay"]);
    const id = (await op.session({
      action: "open",
      command: "show",
      args: { repo: folder.id },
    })) as string;
    const { lines } = (await op.session({
      action: "read",
      id,
      waitMs: 2000,
    })) as { lines: string[] };
    const [cwd, argv] = JSON.parse(lines[0]!) as [string, string[]];
    await same(cwd, repo);
    expect(argv).toEqual(["--stay"]);
    await op.session({ action: "close", id });
    await broker.shutdown();
  });
});

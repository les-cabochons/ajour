import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalog } from "../../packages/wide-events/catalog.ts";
import { createEmitter } from "../../packages/wide-events/index.ts";
import { asyncContextScope } from "../../packages/wide-events/node.ts";
import { createRecordingSink } from "../../packages/wide-events/sinks.ts";

const require = createRequire(import.meta.url);
const {
  apiLaunchOf,
  createLaunchContext,
  createMainEvents,
  loadMainEmitter,
} = require("./electron/main-events.cjs");

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const launch = {
  launch_id: "launch-1",
  app: { version: "1.2.0", channel: "stable", packaged: true },
  device: { platform: "win32", arch: "x64", electron: "41.3.0" },
};

/** A facade attached to a real emitter with a recording sink. */
function attached(clock: { now: number }) {
  const sink = createRecordingSink();
  const events = createMainEvents({ now: () => clock.now });
  const attach = () =>
    events.attach((now: () => number) =>
      createEmitter({
        catalog,
        context: { runtime: "main", ...launch },
        sink,
        scope: asyncContextScope(),
        now,
      }),
    );
  return { events, sink, attach };
}

describe("the launch context", () => {
  it("reports a packaged nightly build with its commit", () => {
    expect(
      createLaunchContext({
        version: "1.3.0-nightly.20261020.2",
        packaged: true,
        commit: "0b3404ce0b3404ce0b3404ce0b3404ce0b3404ce",
        platform: "win32",
        arch: "x64",
        electron: "41.3.0",
        randomUUID: () => "launch-7",
      }),
    ).toEqual({
      launch_id: "launch-7",
      app: {
        version: "1.3.0-nightly.20261020.2",
        channel: "nightly",
        commit: "0b3404ce0b3404ce0b3404ce0b3404ce0b3404ce",
        packaged: true,
      },
      device: { platform: "win32", arch: "x64", electron: "41.3.0" },
    });
  });

  it("reports stable for a packaged release and dev for an unpackaged run, without a commit it doesn't know", () => {
    const base = {
      platform: "darwin",
      arch: "arm64",
      electron: "41.3.0",
      randomUUID: () => "id",
    };
    expect(
      createLaunchContext({ ...base, version: "1.2.0", packaged: true }).app,
    ).toEqual({ version: "1.2.0", channel: "stable", packaged: true });
    expect(
      createLaunchContext({ ...base, version: "1.2.0", packaged: false }).app,
    ).toEqual({ version: "1.2.0", channel: "dev", packaged: false });
  });

  it("hands the local API the same launch through its launch option", () => {
    expect(
      apiLaunchOf({
        ...launch,
        app: { ...launch.app, commit: "abc1234" },
      }),
    ).toEqual({
      id: "launch-1",
      appVersion: "1.2.0",
      channel: "stable",
      commit: "abc1234",
      packaged: true,
    });
  });
});

describe("the main process's events", () => {
  it("emits through the emitter once it is attached", async () => {
    const clock = { now: 1_000 };
    const { events, sink, attach } = attached(clock);
    attach();

    await events.run(
      "app.second_launch",
      { kind: "lifecycle", trigger: "system" },
      async (unit: { set: (fields: object) => void }) => {
        unit.set({ second_launch: { had_window: true } });
      },
    );

    expect(sink.events).toMatchObject([
      {
        name: "app.second_launch",
        runtime: "main",
        launch_id: "launch-1",
        second_launch: { had_window: true },
      },
    ]);
  });

  it("keeps a unit that ended before the package loaded, with its own times", async () => {
    const clock = { now: 1_000 };
    const { events, sink, attach } = attached(clock);

    const unit = events.start("window.load", {
      kind: "lifecycle",
      trigger: "boot",
    });
    clock.now = 1_250;
    unit.set({ window: { trigger: "launch" } });
    unit.fail(new Error("ERR_FAILED"));
    unit.end();
    clock.now = 9_000;
    attach();
    await events.ready;

    expect(sink.events).toMatchObject([
      {
        name: "window.load",
        outcome: "error",
        started_at: new Date(1_000).toISOString(),
        duration_ms: 250,
        window: { trigger: "launch" },
        error: { type: "Error", message: "ERR_FAILED" },
      },
    ]);
  });

  it("carries on a unit that started before the package loaded and ends after", () => {
    const clock = { now: 0 };
    const { events, sink, attach } = attached(clock);

    const unit = events.start("app.launch", {
      kind: "lifecycle",
      trigger: "boot",
      startedAt: -400,
    });
    attach();
    clock.now = 600;
    unit.set({ launch: { ready_ms: 300 } });
    unit.end();

    expect(sink.events).toMatchObject([
      { name: "app.launch", duration_ms: 1_000, launch: { ready_ms: 300 } },
    ]);
    expect(sink.events[0]!.started_at).toBe(new Date(-400).toISOString());
  });

  it("knows a unit's name and recorded outcome before the package loads", () => {
    const { events } = attached({ now: 0 });

    const unit = events.start("app.quit", {
      kind: "lifecycle",
      trigger: "user",
    });
    unit.refuse("api_stop_failed");

    expect([unit.name, unit.outcome]).toEqual(["app.quit", "refused"]);
  });

  it("ends a unit that runs before the package loads in every path", async () => {
    const clock = { now: 0 };
    const { events, sink, attach } = attached(clock);

    await expect(
      events.run(
        "catalog.refresh",
        { kind: "job", trigger: "boot" },
        async () => {
          throw new Error("offline");
        },
      ),
    ).rejects.toThrow("offline");
    attach();

    expect(sink.events).toMatchObject([
      { name: "catalog.refresh", outcome: "error" },
    ]);
  });

  it("drops what it recorded when the package cannot load, and is ready all the same", async () => {
    const { events } = attached({ now: 0 });
    events
      .start("app.lock_refused", { kind: "lifecycle", trigger: "system" })
      .end();

    events.abandon();

    await expect(events.ready).resolves.toBeUndefined();
    expect(events.current()).toBeUndefined();
  });

  it("follows the active unit through awaits once attached", async () => {
    const { events, attach } = attached({ now: 0 });
    attach();

    let active: unknown;
    await events.run(
      "update.check",
      { kind: "ipc", trigger: "user" },
      async (unit: unknown) => {
        await Promise.resolve();
        active = events.current() === unit;
      },
    );

    expect(active).toBe(true);
  });
});

describe("loading the package", () => {
  it("loads the wide-events package from the runtime root, with the scrubber's paths", async () => {
    const lines: string[] = [];
    const factory = await loadMainEmitter({
      packageRoot: path.join(repoRoot, "packages/wide-events"),
      launch,
      homeDirectory: "C:\\Users\\alex",
      userDataPath: "C:\\Users\\alex\\AppData\\Roaming\\Ajour",
      sinkSwitch: "console",
      write: (line: string) => lines.push(line),
    });
    const emitter = factory(() => 5);

    const unit = emitter.start("app.error", {
      kind: "crash",
      trigger: "system",
    });
    unit.fail(
      new Error(
        "EPERM: open 'C:\\Users\\alex\\AppData\\Roaming\\Ajour\\plugins\\a.json' from C:\\Users\\alex\\repo",
      ),
    );
    unit.end();

    const event = JSON.parse(lines[0]!);
    expect(event).toMatchObject({
      name: "app.error",
      runtime: "main",
      launch_id: "launch-1",
    });
    expect(event.error.message).not.toContain("alex");
  });
});

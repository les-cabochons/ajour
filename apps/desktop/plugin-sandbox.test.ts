import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { launchSandboxRefusal, rendererSandboxRefusal } =
  require("./electron/plugin-sandbox.cjs") as {
    launchSandboxRefusal: (launch: {
      argv: string[];
      hasSwitch: (name: string) => boolean;
      env: Record<string, string | undefined>;
      platform: string;
      inspectorActive: boolean;
    }) => { cause: string; reason: string } | undefined;
    rendererSandboxRefusal: (renderer: {
      pid: number;
      metrics: { pid: number; sandboxed?: boolean; integrityLevel?: string }[];
      platform: string;
      otherPluginPids: number[];
    }) => { cause: string; reason: string } | undefined;
  };

const launch = {
  argv: ["C:\\Ajour\\Ajour.exe", "."],
  hasSwitch: () => false,
  env: {},
  platform: "win32",
  inspectorActive: false,
};

describe("when plugins stay off at launch", () => {
  it("lets plugins run on Windows and macOS with the sandbox on", () => {
    expect(launchSandboxRefusal(launch)).toBeUndefined();
    expect(
      launchSandboxRefusal({ ...launch, platform: "darwin" }),
    ).toBeUndefined();
  });

  it.each([
    ["--no-sandbox", "launch_flag"],
    ["--disable-gpu-sandbox", "launch_flag"],
    ["--single-process", "launch_flag"],
    ["--remote-debugging-port=9222", "debugger"],
    ["--remote-debugging-pipe", "debugger"],
    ["--inspect", "debugger"],
    ["--inspect=9229", "debugger"],
    ["--inspect-brk", "debugger"],
  ])("turns plugins off when Ajour starts with %s", (flag, cause) => {
    const name = flag.slice(2).split("=")[0];
    expect(
      launchSandboxRefusal({ ...launch, argv: [...launch.argv, flag] }),
    ).toEqual({ cause, reason: `Ajour was started with --${name}.` });
  });

  it("turns plugins off for a switch code appended, not only one typed", () => {
    expect(
      launchSandboxRefusal({
        ...launch,
        hasSwitch: (name) => name === "no-sandbox",
      }),
    ).toEqual({
      cause: "launch_flag",
      reason: "Ajour was started with --no-sandbox.",
    });
  });

  it("doesn't mistake another switch for one it refuses", () => {
    expect(
      launchSandboxRefusal({
        ...launch,
        argv: [...launch.argv, "--inspector-theme", "--no-sandboxing-note"],
      }),
    ).toBeUndefined();
  });

  it("turns plugins off when ELECTRON_DISABLE_SANDBOX is set, whatever its value", () => {
    expect(
      launchSandboxRefusal({
        ...launch,
        env: { ELECTRON_DISABLE_SANDBOX: "" },
      }),
    ).toEqual({
      cause: "environment",
      reason: "The ELECTRON_DISABLE_SANDBOX environment variable is set.",
    });
  });

  it("turns plugins off while a debugger is attached to main", () => {
    expect(
      launchSandboxRefusal({ ...launch, inspectorActive: true }),
    ).toMatchObject({ cause: "debugger" });
  });

  it("turns plugins off on a system other than Windows and macOS", () => {
    expect(launchSandboxRefusal({ ...launch, platform: "linux" })).toEqual({
      cause: "unsupported_os",
      reason: "Plugins run only on Windows and macOS.",
    });
  });
});

describe("when a plugin renderer turns plugins off", () => {
  const renderer = {
    pid: 41,
    metrics: [
      { pid: 7, sandboxed: false, integrityLevel: "medium" },
      { pid: 41, sandboxed: true, integrityLevel: "untrusted" },
    ],
    platform: "win32",
    otherPluginPids: [52],
  };

  it("lets a sandboxed renderer at untrusted integrity run on Windows", () => {
    expect(rendererSandboxRefusal(renderer)).toBeUndefined();
  });

  it("lets a sandboxed renderer run on macOS, which reports no integrity", () => {
    expect(
      rendererSandboxRefusal({
        ...renderer,
        platform: "darwin",
        metrics: [{ pid: 41, sandboxed: true }],
      }),
    ).toBeUndefined();
  });

  it("refuses a renderer that isn't sandboxed", () => {
    expect(
      rendererSandboxRefusal({
        ...renderer,
        platform: "darwin",
        metrics: [{ pid: 41, sandboxed: false }],
      }),
    ).toEqual({
      cause: "renderer_not_sandboxed",
      reason: "A plugin's process isn't sandboxed.",
    });
  });

  it("refuses a Windows renderer above untrusted integrity", () => {
    expect(
      rendererSandboxRefusal({
        ...renderer,
        metrics: [{ pid: 41, sandboxed: true, integrityLevel: "low" }],
      }),
    ).toMatchObject({ cause: "renderer_integrity" });
  });

  it("refuses a renderer whose process it can't find", () => {
    expect(rendererSandboxRefusal({ ...renderer, pid: 99 })).toMatchObject({
      cause: "renderer_unknown",
    });
    expect(rendererSandboxRefusal({ ...renderer, pid: 0 })).toMatchObject({
      cause: "renderer_unknown",
    });
  });

  it("refuses a process another plugin already runs in", () => {
    expect(
      rendererSandboxRefusal({ ...renderer, otherPluginPids: [41] }),
    ).toMatchObject({ cause: "shared_process" });
  });
});

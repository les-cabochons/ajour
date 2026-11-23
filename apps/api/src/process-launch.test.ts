import { expect, it, vi } from "vitest";
import { launchProcess, launchTerminalIn } from "./process-launch.ts";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ports = {
  platform: "win32" as const,
  find: async () => "C:\\tools\\wt.exe",
  start: async () => undefined,
};
it.each([
  ["BAD-NAME", "value"],
  ["9BAD", "value"],
  ["BAD;touch injected", "value"],
  ["VALID_NAME", "nul\0value"],
])(
  "Given unsafe macOS environment %j, refuses before spawning",
  async (name, value) => {
    const start = vi.fn(async () => undefined);
    await expect(
      launchProcess(
        { command: "/tools/fake", args: [], env: { [name]: value } },
        "/repo",
        { app: "Terminal" },
        { platform: "darwin", start },
      ),
    ).rejects.toMatchObject({ reason: "invalid_request" });
    expect(start).not.toHaveBeenCalled();
  },
);
it("Given launcher environment changes, exports only changed values with POSIX quoting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-launch-env-"));
  vi.stubEnv("HOME", "/home/alex");
  vi.stubEnv("NODE_PATH", "/old/modules");
  vi.stubEnv("UNRELATED_SECRET", "must-not-reach-disk");
  vi.stubEnv("ELECTRON_RUN_AS_NODE", undefined);
  vi.stubEnv("T3CODE_TEST", undefined);
  try {
    await launchProcess(
      {
        command: "/tools/fake",
        args: [],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          T3CODE_TEST: "a'b\n$(touch bad)",
          NODE_PATH: "/new/modules",
        },
      },
      "/repo",
      { app: "Terminal" },
      {
        platform: "darwin",
        temp: root,
        start: async (plan) => {
          const script = await readFile(plan.args[2]!, "utf8");
          expect(script).toContain("export ELECTRON_RUN_AS_NODE='1'\n");
          expect(script).toContain(
            "export T3CODE_TEST='a'\\''b\n$(touch bad)'\n",
          );
          expect(script).toContain("export NODE_PATH='/new/modules'\n");
          expect(script).not.toContain("export HOME=");
          expect(script).not.toContain("UNRELATED_SECRET");
          expect(script).not.toContain("must-not-reach-disk");
          expect(script.indexOf("export NODE_PATH=")).toBeLessThan(
            script.indexOf("cd '/repo'"),
          );
        },
        later: () => undefined,
      },
    );
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
it.each([
  'x" --injected "y',
  "a\t--tabflag",
  "",
  "end\\ with space\\",
  "pct %USERNAME%",
  "a!",
  "a;b",
  "a^b",
  "a&b",
  "a|b",
  "a<b",
  "a>b",
  "a\n",
  "a\x7f",
  "-flag",
  "snowman\u2603",
])("Given unsafe terminal value %j, refuses before spawning", async (value) => {
  for (const field of ["arg", "command", "cwd"] as const) {
    await expect(
      launchProcess(
        {
          command: field === "command" ? value : "C:\\tools\\fake.exe",
          args: [field === "arg" ? value : "last"],
          env: {},
        },
        field === "cwd" ? value : "C:\\repo",
        { app: "wt" },
        ports,
      ),
    ).rejects.toMatchObject({
      reason: "invalid_request",
      message: expect.stringContaining("terminal mode"),
    });
  }
});
it("Given the reviewer's final safe value, permits last", async () => {
  await expect(
    launchProcess(
      { command: "C:\\tools\\fake.exe", args: ["last"], env: {} },
      "C:\\repo",
      { app: "wt" },
      ports,
    ),
  ).resolves.toBeUndefined();
});
it("Given a manifest literal flag, permits only its declared position", async () => {
  await expect(
    launchProcess(
      { command: "C:\\tools\\fake.exe", args: ["--resume", "id-1"], env: {} },
      "C:\\repo",
      { app: "wt" },
      { ...ports, literalArgIndices: [0] },
    ),
  ).resolves.toBeUndefined();
});
it("Given missing Windows Terminal, explains how to install it", async () => {
  await expect(
    launchProcess(
      { command: "C:\\tools\\fake.exe", args: [], env: {} },
      "C:\\repo",
      { app: "wt" },
      { ...ports, find: async () => null },
    ),
  ).rejects.toThrow("Install Windows Terminal to open commands in a terminal");
});
it.each(["Terminal"] as const)(
  "Given %s, writes a private quoted script and cleans it after the delay",
  async (terminal) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-launch-test-"));
    let cleanup: (() => Promise<void>) | undefined;
    vi.stubEnv("AJOUR_TEST_SECRET", "ajour-secret-must-not-reach-disk");
    try {
      let script = "";
      await launchProcess(
        { command: "/tools/fake", args: ["a'b", "$(touch bad)", ""], env: {} },
        "/repo's folder",
        { app: terminal },
        {
          platform: "darwin",
          temp: root,
          start: async (plan) => {
            expect(plan.command).toBe("/usr/bin/open");
            expect(plan.args.slice(0, 2)).toEqual(["-a", terminal]);
            script = plan.args[2]!;
          },
          later: (callback, delayMs) => {
            expect(delayMs).toBe(300_000);
            cleanup = callback;
          },
        },
      );
      expect(await readFile(script, "utf8")).toBe(
        "#!/bin/sh\nfor v in $(env | sed -n 's/^\\(AJOUR_[A-Za-z0-9_]*\\)=.*/\\1/p'); do unset \"$v\"; done\ncd '/repo'\\''s folder' || exit 1\nexec '/tools/fake' 'a'\\''b' '$(touch bad)' ''\n",
      );
      if (process.platform !== "win32")
        expect((await stat(script)).mode & 0o777).toBe(0o700);
      const { ProcessBroker } = await import("./process-broker.ts");
      await new ProcessBroker({
        folders: { resolve: async () => undefined },
        gate: async () => undefined,
      }).shutdown();
      expect(await readFile(script, "utf8")).toContain("#!/bin/sh");
      await cleanup!();
      await expect(stat(script)).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each([
  [{ app: "Terminal" as const }, "Terminal"],
  [
    { app: "iTerm" as const, path: "/Applications/iTerm.app" },
    "/Applications/iTerm.app",
  ],
  [
    { app: "Ghostty" as const, path: "/Users/me/Applications/Ghostty.app" },
    "/Users/me/Applications/Ghostty.app",
  ],
])(
  "Given %o chosen on macOS, opens the private script with it",
  async (terminal, target) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-launch-app-"));
    try {
      const opened: string[][] = [];
      await launchProcess(
        { command: "/tools/fake", args: ["a b"], env: {} },
        "/repo",
        terminal,
        {
          platform: "darwin",
          temp: root,
          start: async (plan) => {
            expect(plan.command).toBe("/usr/bin/open");
            opened.push(plan.args);
          },
          later: () => undefined,
        },
      );
      expect(opened).toEqual([
        ["-a", target, expect.stringMatching(/launch\.command$/)],
      ]);
      // The values stay in the script, never on the terminal's command line.
      expect(opened[0]!.join(" ")).not.toContain("a b");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each([
  [{ app: "kitty" as const, path: "/Applications/kitty.app" }, []],
  [
    { app: "WezTerm" as const, path: "/Applications/WezTerm.app" },
    ["start", "--"],
  ],
  [{ app: "Alacritty" as const, path: "/Applications/Alacritty.app" }, ["-e"]],
])(
  "Given %o chosen on macOS, starts a new instance on the private script",
  async (terminal, before) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-launch-program-"));
    try {
      const opened: string[][] = [];
      await launchProcess(
        { command: "/tools/fake", args: ["a b"], env: {} },
        "/repo",
        terminal,
        {
          platform: "darwin",
          temp: root,
          start: async (plan) => {
            expect(plan.command).toBe("/usr/bin/open");
            opened.push(plan.args);
          },
          later: () => undefined,
        },
      );
      expect(opened).toEqual([
        [
          "-n",
          "-a",
          terminal.path,
          "--args",
          ...before,
          expect.stringMatching(/launch\.command$/),
        ],
      ]);
      expect(opened[0]!.join(" ")).not.toContain("a b");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each([
  [
    { app: "WezTerm" as const, path: "C:\\Tools\\wezterm-gui.exe" },
    ["start", "--cwd", "C:\\repo", "--", "C:\\tools\\fake.exe", "last"],
  ],
  [
    {
      app: "Alacritty" as const,
      path: "C:\\Program Files\\Alacritty\\alacritty.exe",
    },
    ["--working-directory", "C:\\repo", "-e", "C:\\tools\\fake.exe", "last"],
  ],
])(
  "Given %o chosen on Windows, starts it on the command in the folder",
  async (terminal, args) => {
    const started: { command: string; args: string[] }[] = [];
    await launchProcess(
      { command: "C:\\tools\\fake.exe", args: ["last"], env: {} },
      "C:\\repo",
      terminal,
      {
        platform: "win32",
        start: async (plan) => {
          started.push({ command: plan.command, args: plan.args });
        },
      },
    );
    expect(started).toEqual([{ command: terminal.path, args }]);
  },
);

it("Given Alacritty on Windows, quotes each value with a space itself, since it joins them unquoted", async () => {
  const started: string[][] = [];
  await launchProcess(
    {
      command: "C:\\Program Files\\tool\\fake.exe",
      args: ["a b", "last"],
      env: {},
    },
    "C:\\My repo",
    { app: "Alacritty", path: "C:\\Program Files\\Alacritty\\alacritty.exe" },
    {
      platform: "win32",
      start: async (plan) => {
        started.push(plan.args);
      },
    },
  );
  expect(started).toEqual([
    [
      "--working-directory",
      "C:\\My repo",
      "-e",
      '"C:\\Program Files\\tool\\fake.exe"',
      '"a b"',
      "last",
    ],
  ]);
});

it("Given a Windows terminal installed under an unsafe path, refuses before spawning", async () => {
  const start = vi.fn(async () => undefined);
  await expect(
    launchProcess(
      { command: "C:\\tools\\fake.exe", args: ["last"], env: {} },
      "C:\\repo",
      { app: "WezTerm", path: "C:\\R&D\\wezterm-gui.exe" },
      { platform: "win32", start },
    ),
  ).rejects.toMatchObject({ reason: "invalid_request" });
  expect(start).not.toHaveBeenCalled();
});

it.each([
  ["win32", { app: "iTerm" as const, path: "/Applications/iTerm.app" }],
  ["darwin", { app: "wt" as const }],
  ["win32", { app: "WezTerm" as const }],
  ["darwin", { app: "kitty" as const }],
] as const)(
  "Given %s and a terminal it can't open, %o, refuses",
  async (platform, terminal) => {
    const start = vi.fn(async () => undefined);
    await expect(
      launchProcess(
        { command: "/tools/fake", args: [], env: {} },
        "/repo",
        terminal,
        { platform, start, find: async () => "C:\\tools\\wt.exe" },
      ),
    ).rejects.toThrow("Unsupported terminal");
    expect(start).not.toHaveBeenCalled();
  },
);

it("Given stale macOS scripts, sweeps only directories older than one hour", async () => {
  const { mkdir, utimes } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-launch-sweep-"));
  const old = path.join(root, "ajour-terminal-old"),
    fresh = path.join(root, "ajour-terminal-fresh"),
    unrelated = path.join(root, "other");
  let cleanup: (() => Promise<void>) | undefined;
  try {
    for (const dir of [old, fresh, unrelated]) await mkdir(dir);
    for (const dir of [old, unrelated])
      await utimes(dir, new Date(0), new Date(0));
    await launchProcess(
      { command: "/bin/tool", args: [], env: {} },
      "/repo",
      { app: "Terminal" },
      {
        platform: "darwin",
        temp: root,
        start: async () => undefined,
        later: (fn) => {
          cleanup = fn;
        },
      },
    );
    await expect(stat(old)).rejects.toThrow();
    expect(await stat(fresh)).toBeTruthy();
    expect(await stat(unrelated)).toBeTruthy();
  } finally {
    await cleanup?.();
    await rm(root, { recursive: true, force: true });
  }
});

/*
 * A worktree's Open in terminal (#862): the terminal app opens in a folder
 * with the user's shell and no command.
 */
it.each([
  [{ app: "wt" as const }, "C:\\tools\\wt.exe", ["-d", "C:\\My repo"]],
  [
    { app: "WezTerm" as const, path: "C:\\tools\\wezterm-gui.exe" },
    "C:\\tools\\wezterm-gui.exe",
    ["start", "--cwd", "C:\\My repo"],
  ],
  [
    { app: "Alacritty" as const, path: "C:\\tools\\alacritty.exe" },
    "C:\\tools\\alacritty.exe",
    ["--working-directory", "C:\\My repo"],
  ],
])(
  "Given %o on Windows and no command, opens its default shell in the folder",
  async (terminal, command, args) => {
    const started: { command: string; args: string[]; hidden: boolean }[] = [];
    await launchTerminalIn("C:\\My repo", {}, terminal, {
      ...ports,
      start: async (plan, _cwd, hidden) => {
        started.push({ command: plan.command, args: plan.args, hidden });
      },
    });
    expect(started).toEqual([{ command, args, hidden: false }]);
  },
);

it("Given a folder Windows can't take in one argument and no command, refuses before spawning", async () => {
  const start = vi.fn(async () => undefined);
  await expect(
    launchTerminalIn("C:\\R&D\\repo", {}, { app: "wt" }, { ...ports, start }),
  ).rejects.toMatchObject({ reason: "invalid_request" });
  expect(start).not.toHaveBeenCalled();
});

it.each([
  ["/opt/homebrew/bin/fish", "/opt/homebrew/bin/fish"],
  // No shell the script could run by its path: the system's default one.
  ["fish", "/bin/zsh"],
  [undefined, "/bin/zsh"],
])(
  "Given SHELL %j on macOS and no command, starts that login shell in the folder: %s",
  async (shell, expected) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-launch-shell-"));
    let cleanup: (() => Promise<void>) | undefined;
    try {
      let script = "";
      await launchTerminalIn(
        "/repo/.ajour/worktrees/aj-1",
        { SHELL: shell },
        { app: "Terminal" },
        {
          platform: "darwin",
          temp: root,
          start: async (plan) => {
            expect(plan.args.slice(0, 2)).toEqual(["-a", "Terminal"]);
            script = plan.args[2]!;
          },
          later: (callback) => {
            cleanup = callback;
          },
        },
      );
      expect(await readFile(script, "utf8")).toContain(
        `cd '/repo/.ajour/worktrees/aj-1' || exit 1\nexec '${expected}' '-l'\n`,
      );
    } finally {
      await cleanup?.();
      await rm(root, { recursive: true, force: true });
    }
  },
);

import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { terminalSettings, openPluginLink } = createRequire(import.meta.url)(
  "./electron/terminal-settings.cjs",
);

const HOME = "/Users/me";
const TERMINAL = "/System/Applications/Utilities/Terminal.app";

/** A computer where only the `installed` paths exist. */
function computer(
  installed: string[],
  env = {},
  icon?: (where: string) => Promise<string | undefined>,
) {
  return {
    home: HOME,
    env,
    exists: async (candidate: string) => installed.includes(candidate),
    icon,
  };
}

/** Runs `body` with the setting saved as `saved` in a throwaway file. */
async function withSaved(
  saved: string | undefined,
  body: (file: string) => Promise<void>,
) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "ajour-terminal-setting-test-"),
  );
  const file = path.join(root, "setting.json");
  try {
    if (saved !== undefined) await writeFile(file, JSON.stringify(saved));
    await body(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it.each([
  ["powershell", "wt"],
  ["cmd", "wt"],
])("Given Windows saved %s, migrates to %s", async (old, current) => {
  await withSaved(old, async (file) => {
    const settings = terminalSettings("win32", file, computer([]));
    expect((await settings.list()).value).toBe(current);
    expect(JSON.parse(await readFile(file, "utf8"))).toBe(current);
    await expect(settings.save(old)).rejects.toThrow("Unsupported");
    await expect(settings.save(current)).resolves.toBe(current);
  });
});

it("Given macOS with iTerm2 and Ghostty installed, offers them after Terminal", async () => {
  await withSaved(undefined, async (file) => {
    const settings = terminalSettings(
      "darwin",
      file,
      computer([
        TERMINAL,
        "/Applications/iTerm.app",
        `${HOME}/Applications/Ghostty.app`,
      ]),
    );
    expect(await settings.list()).toEqual({
      value: "Terminal",
      choices: [
        { value: "Terminal", label: "Terminal" },
        { value: "iTerm", label: "iTerm2" },
        { value: "Ghostty", label: "Ghostty" },
      ],
    });
    await expect(settings.save("Ghostty")).resolves.toBe("Ghostty");
    expect(await settings.resolve()).toEqual({
      app: "Ghostty",
      path: `${HOME}/Applications/Ghostty.app`,
    });
  });
});

it("Given macOS with every supported app installed, lists them in order", async () => {
  await withSaved(undefined, async (file) => {
    const apps = ["iTerm", "Ghostty", "kitty", "WezTerm", "Alacritty"];
    const settings = terminalSettings(
      "darwin",
      file,
      computer([TERMINAL, ...apps.map((app) => `/Applications/${app}.app`)]),
    );
    expect((await settings.list()).choices.map((c) => c.label)).toEqual([
      "Terminal",
      "iTerm2",
      "Ghostty",
      "kitty",
      "WezTerm",
      "Alacritty",
    ]);
  });
});

it("Given a terminal that isn't installed, refuses to save it", async () => {
  await withSaved(undefined, async (file) => {
    const settings = terminalSettings("darwin", file, computer([TERMINAL]));
    await expect(settings.save("iTerm")).rejects.toThrow("Unsupported");
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });
});

it("Given a saved terminal that was uninstalled, opens Terminal and keeps the choice", async () => {
  await withSaved("iTerm", async (file) => {
    const settings = terminalSettings("darwin", file, computer([TERMINAL]));
    expect((await settings.list()).value).toBe("Terminal");
    expect(await settings.resolve()).toEqual({
      app: "Terminal",
      path: TERMINAL,
    });
    // Installing it again brings the choice back.
    expect(JSON.parse(await readFile(file, "utf8"))).toBe("iTerm");
  });
});

it("Given Windows with WezTerm on PATH and Alacritty in Program Files, offers them after Windows Terminal", async () => {
  await withSaved("WezTerm", async (file) => {
    const settings = terminalSettings(
      "win32",
      file,
      computer(
        [
          "C:\\Tools\\wezterm-gui.exe",
          "C:\\Program Files\\Alacritty\\alacritty.exe",
        ],
        { PATH: "C:\\Tools;relative\\bin", ProgramFiles: "C:\\Program Files" },
      ),
    );
    expect(await settings.list()).toEqual({
      value: "WezTerm",
      choices: [
        { value: "wt", label: "Windows Terminal" },
        { value: "WezTerm", label: "WezTerm" },
        { value: "Alacritty", label: "Alacritty" },
      ],
    });
    expect(await settings.resolve()).toEqual({
      app: "WezTerm",
      path: "C:\\Tools\\wezterm-gui.exe",
    });
  });
});

it("Given Windows Terminal, leaves finding it to the launch, which explains a missing one", async () => {
  await withSaved(undefined, async (file) => {
    const settings = terminalSettings("win32", file, computer([]));
    expect(await settings.resolve()).toEqual({ app: "wt" });
  });
});

it("Given installed terminals, shows each one's own icon, and none when it can't be read", async () => {
  await withSaved(undefined, async (file) => {
    const settings = terminalSettings(
      "darwin",
      file,
      computer(
        [TERMINAL, "/Applications/iTerm.app", "/Applications/Ghostty.app"],
        {},
        async (where) => {
          if (where.endsWith("Ghostty.app")) throw new Error("no thumbnail");
          return `data:image/png;base64,${where}`;
        },
      ),
    );
    expect((await settings.list()).choices).toEqual([
      {
        value: "Terminal",
        label: "Terminal",
        icon: `data:image/png;base64,${TERMINAL}`,
      },
      {
        value: "iTerm",
        label: "iTerm2",
        icon: "data:image/png;base64,/Applications/iTerm.app",
      },
      { value: "Ghostty", label: "Ghostty" },
    ]);
  });
});

it("Given Windows Terminal on PATH, shows its icon but still lets the launch find it", async () => {
  await withSaved(undefined, async (file) => {
    const alias = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps";
    const settings = terminalSettings(
      "win32",
      file,
      computer([`${alias}\\wt.exe`], { PATH: alias }, async (where) => where),
    );
    expect((await settings.list()).choices).toEqual([
      { value: "wt", label: "Windows Terminal", icon: `${alias}\\wt.exe` },
    ]);
    expect(await settings.resolve()).toEqual({ app: "wt" });
  });
});

it("Given Linux, has no terminal default", async () => {
  const settings = terminalSettings("linux", "unused", computer([]));
  expect(await settings.list()).toEqual({ value: undefined, choices: [] });
  expect(await settings.resolve()).toBeUndefined();
  await expect(settings.save("Terminal")).rejects.toThrow();
});

it.each([
  "file:///x",
  "http://example.test/",
  "javascript:alert(1)",
  "other://thread",
])("Given forbidden main-process link %s, refuses", async (url) => {
  await expect(
    openPluginLink(url, ["codex"], async () => {
      throw new Error("called");
    }),
  ).rejects.toThrow("scheme");
});
it.each(["https://example.test/", "codex://thread/1"])(
  "Given allowed main-process link %s, opens",
  async (url) => {
    const opened: string[] = [];
    await openPluginLink(url, ["codex"], async (value: string) => {
      opened.push(value);
    });
    expect(opened).toEqual([url]);
  },
);

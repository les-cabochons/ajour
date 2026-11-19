const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * The terminal apps a plugin's terminal command can open in, per platform,
 * in the order Settings › General › Terminal lists them. The first is the
 * default and is always offered. On macOS each is an app bundle looked up in
 * the Applications folders; on Windows an executable on PATH or in its usual
 * install folder. The API's `process-launch.ts` knows how each one starts a
 * command; this list only says which exist on this computer.
 */
const TERMINALS = {
  darwin: [
    {
      value: "Terminal",
      label: "Terminal",
      bundle: "Terminal.app",
      fixed: "/System/Applications/Utilities/Terminal.app",
    },
    { value: "iTerm", label: "iTerm2", bundle: "iTerm.app" },
    { value: "Ghostty", label: "Ghostty", bundle: "Ghostty.app" },
    { value: "kitty", label: "kitty", bundle: "kitty.app" },
    { value: "WezTerm", label: "WezTerm", bundle: "WezTerm.app" },
    { value: "Alacritty", label: "Alacritty", bundle: "Alacritty.app" },
    // Warp is left out: its stable builds may open a `.command` script in
    // its editor instead of running it (warpdotdev/warp#9020), and it has no
    // command line that runs a program.
  ],
  win32: [
    // Windows Terminal is an app execution alias. The launch looks it up on
    // the PATH it runs with, and asks the user to install it when missing.
    { value: "wt", label: "Windows Terminal" },
    {
      value: "WezTerm",
      label: "WezTerm",
      // The GUI program: wezterm.exe is a console one that forwards to it and
      // may flash a console window.
      exe: "wezterm-gui.exe",
      folders: ["WezTerm"],
    },
    {
      value: "Alacritty",
      label: "Alacritty",
      exe: "alacritty.exe",
      folders: ["Alacritty"],
    },
  ],
};
// Choices from earlier builds that no longer exist, and what replaces them.
const RETIRED = { win32: { powershell: "wt", cmd: "wt" } };

async function present(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * The terminal app setting of this computer, saved as JSON in `file`.
 * `computer` gives the user's home folder, the environment and an `exists`
 * check, so tests can describe what is installed.
 */
function terminalSettings(
  platform,
  file,
  computer = {
    home: require("node:os").homedir(),
    env: process.env,
    exists: present,
  },
) {
  const terminals = TERMINALS[platform] ?? [];
  const pathOf = platform === "win32" ? path.win32 : path.posix;

  /** Where a terminal is installed, `null` for the default found at launch, or undefined. */
  async function locate(terminal) {
    if (terminal === terminals[0]) return terminal.fixed ?? null;
    if (terminal.bundle) {
      for (const folder of [
        "/Applications",
        pathOf.join(computer.home, "Applications"),
      ]) {
        const candidate = pathOf.join(folder, terminal.bundle);
        if (await computer.exists(candidate)) return candidate;
      }
      return undefined;
    }
    // Only absolute PATH entries: a relative one depends on the current folder.
    const folders = (computer.env.PATH ?? computer.env.Path ?? "")
      .split(";")
      .filter((folder) => pathOf.isAbsolute(folder));
    for (const base of [
      computer.env.ProgramFiles,
      computer.env.LOCALAPPDATA &&
        pathOf.join(computer.env.LOCALAPPDATA, "Programs"),
    ])
      if (base)
        for (const folder of terminal.folders)
          folders.push(pathOf.join(base, folder));
    for (const folder of folders) {
      const candidate = pathOf.join(folder, terminal.exe);
      if (await computer.exists(candidate)) return candidate;
    }
    return undefined;
  }

  /** The installed terminals, with where each is. */
  async function installed() {
    const found = [];
    for (const terminal of terminals) {
      const where = await locate(terminal);
      if (where !== undefined) found.push({ terminal, where });
    }
    return found;
  }

  async function saved() {
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8"));
      const replacement = RETIRED[platform]?.[value];
      if (replacement) {
        await fs.writeFile(file, JSON.stringify(replacement));
        return replacement;
      }
      return typeof value === "string" ? value : undefined;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
      return undefined;
    }
  }

  /**
   * The chosen terminal while it is installed, else the default. An
   * uninstalled choice stays saved, so installing the app again brings it back.
   */
  async function chosen(found) {
    const value = await saved();
    return found.find(({ terminal }) => terminal.value === value) ?? found[0];
  }

  return {
    /** What Settings shows: the terminal that opens commands, and the installed ones. */
    async list() {
      const found = await installed();
      return {
        value: (await chosen(found))?.terminal.value,
        choices: found.map(({ terminal }) => ({
          value: terminal.value,
          label: terminal.label,
        })),
      };
    },
    /** Saves an installed terminal as the choice. */
    async save(value) {
      const found = await installed();
      if (!found.some(({ terminal }) => terminal.value === value))
        throw new Error("Unsupported terminal app");
      await fs.writeFile(file, JSON.stringify(value));
      return value;
    },
    /** The terminal the API opens commands in, with where it is installed. */
    async resolve() {
      const choice = await chosen(await installed());
      if (!choice) return undefined;
      return choice.where === null
        ? { app: choice.terminal.value }
        : { app: choice.terminal.value, path: choice.where };
    },
  };
}
async function openPluginLink(given, declaredSchemes, openExternal) {
  const url = new URL(given);
  const scheme = url.protocol.slice(0, -1);
  // The API supplies the manifest schemes, never the requesting plugin renderer.
  if (
    scheme !== "https" &&
    (!/^[a-z][a-z0-9+.-]*$/.test(scheme) ||
      ["file", "http", "javascript", "data", "vbscript"].includes(scheme) ||
      !declaredSchemes.includes(scheme))
  )
    throw new Error("Unsupported plugin link scheme");
  if (url.username || url.password) throw new Error("Invalid plugin link");
  await openExternal(url.href);
}
module.exports = { terminalSettings, openPluginLink };

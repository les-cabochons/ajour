const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// TODO(#730): unify with protectedRepositoryFolders and cliInstallDirectory
// when that PR lands. Keep data, install, CLI and override roots identical.
function protectedInstructionRoots({ home, env, platform, runtime }) {
  const roots = [
    runtime.userData,
    runtime.packaged
      ? platform === "darwin"
        ? path.resolve(runtime.resources, "../..")
        : path.dirname(runtime.exe)
      : runtime.runtimeRoot,
    (!runtime.packaged && env.AJOUR_CLI_INSTALL_DIR) ||
      (platform === "darwin"
        ? path.join(home, "Library/Application Support/Ajour/bin")
        : path.join(
            env.LOCALAPPDATA || path.join(home, "AppData/Local"),
            "Ajour/bin",
          )),
    env.AJOUR_APP_API_STATE_PATH &&
      path.dirname(path.resolve(env.AJOUR_APP_API_STATE_PATH)),
    env.AJOUR_USER_DATA_PATH && path.resolve(env.AJOUR_USER_DATA_PATH),
  ];
  return roots
    .concat(
      platform === "win32"
        ? [
            env.SystemRoot || "C:\\Windows",
            env.ProgramFiles || "C:\\Program Files",
            env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
            env.ProgramData || "C:\\ProgramData",
          ]
        : [
            "/System",
            "/Library",
            "/usr",
            "/bin",
            "/sbin",
            "/etc",
            "/var",
            "/private",
            "/Applications",
          ],
    )
    .filter(Boolean);
}

function decode(bytes) {
  if (bytes === null)
    return { text: null, encode: (text) => Buffer.from(text, "utf8") };
  const be = bytes[0] === 0xfe && bytes[1] === 0xff;
  const le = bytes[0] === 0xff && bytes[1] === 0xfe;
  if (
    (le && bytes[2] === 0 && bytes[3] === 0) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
  ) {
    throw new Error("Unsupported UTF-32 encoding. No changes made.");
  }
  if (be || le) {
    if (bytes.length % 2)
      throw new Error("Invalid UTF-16 file. No changes made.");
    const copy = Buffer.from(bytes);
    new TextDecoder(be ? "utf-16be" : "utf-16le", { fatal: true }).decode(
      bytes,
    );
    if (be) copy.swap16();
    const text = copy.toString("utf16le");
    return {
      text,
      encode: (value) => {
        const result = Buffer.from(value, "utf16le");
        return be ? result.swap16() : result;
      },
    };
  }
  // Validate without stripping the BOM, which belongs to the user's text.
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (bytes.includes(0))
    throw new Error("Unsupported file encoding. No changes made.");
  return {
    text: bytes.toString("utf8"),
    encode: (text) => Buffer.from(text, "utf8"),
  };
}

/** All paths come from the fixed catalog. Tests inject a disposable home. */
function createInstructionController({
  home,
  editor,
  env = process.env,
  io = fs,
  userId = process.getuid?.(),
  platform = process.platform,
  runtime = {},
}) {
  const protectedRoots = protectedInstructionRoots({
    home,
    env,
    platform,
    runtime,
  });
  const pending = new Map();
  let writing = Promise.resolve();
  const load = async () =>
    typeof editor === "function" ? await editor() : editor;
  function root(variable, fallback) {
    const value = env[variable] || fallback;
    if (
      !path.isAbsolute(value) ||
      (process.platform === "win32" && path.win32.parse(value).root.length <= 1)
    )
      throw new Error(
        `${variable} must be an absolute folder. No changes made.`,
      );
    return value;
  }
  async function existingAncestor(file) {
    let current = path.resolve(file);
    for (;;) {
      try {
        const real = await io.realpath(current);
        return {
          ancestor: real,
          resolved: path.join(real, path.relative(current, file)),
        };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        current = parent;
      }
    }
  }
  async function checkLocation(file) {
    const location = await existingAncestor(file);
    for (const protectedRoot of protectedRoots) {
      const protectedLocation = (await existingAncestor(protectedRoot))
        .resolved;
      const relative = path.relative(protectedLocation, location.resolved);
      if (
        !relative ||
        (!relative.startsWith(`..${path.sep}`) &&
          relative !== ".." &&
          !path.isAbsolute(relative))
      )
        throw new Error(
          "Instruction file is in a protected folder. No changes made.",
        );
    }
    return location.ancestor;
  }
  async function isReadOnly(file, info) {
    if (!(info.mode & 0o222) || (userId !== undefined && info.uid !== userId))
      return true;
    try {
      await io.access(file, constants.W_OK);
      return false;
    } catch {
      return true;
    }
  }
  async function target(id) {
    const module = await load();
    const file = module.INSTRUCTION_FILES.find((entry) => entry.id === id);
    if (!file) throw new Error("Unknown agent instruction file.");
    let resolved = path.join(home, file.path);
    try {
      if (id === "codex") {
        const directory = root("CODEX_HOME", path.join(home, ".codex"));
        resolved = path.join(directory, "AGENTS.md");
        const override = path.join(directory, "AGENTS.override.md");
        if (decode((await read(override)).bytes).text?.trim())
          resolved = override;
      }
      if (id === "claude")
        resolved = path.join(
          root("CLAUDE_CONFIG_DIR", path.join(home, ".claude")),
          "CLAUDE.md",
        );
      // OPENCODE_CONFIG_DIR wins; XDG_CONFIG_HOME is read, and checked, only
      // when it is unset.
      if (id === "opencode")
        resolved = path.join(
          env.OPENCODE_CONFIG_DIR
            ? root("OPENCODE_CONFIG_DIR", "")
            : path.join(
                root("XDG_CONFIG_HOME", path.join(home, ".config")),
                "opencode",
              ),
          "AGENTS.md",
        );
      if (id === "copilot")
        resolved = path.join(
          root("COPILOT_HOME", path.join(home, ".copilot")),
          "copilot-instructions.md",
        );
      if (id === "gemini") {
        const directory = path.join(root("GEMINI_CLI_HOME", home), ".gemini");
        resolved = path.join(directory, "GEMINI.md");
        const settings = await read(path.join(directory, "settings.json"));
        if (settings.bytes !== null) {
          let name;
          try {
            const { default: stripJsonComments } =
              await import("strip-json-comments");
            name = JSON.parse(stripJsonComments(decode(settings.bytes).text))
              ?.context?.fileName;
          } catch {
            throw new Error(
              "Cannot parse Gemini settings.json. No changes made.",
            );
          }
          if (name !== undefined) {
            // Multiple context names have no single write target.
            if (Array.isArray(name) && name.length === 1) name = name[0];
            if (
              typeof name !== "string" ||
              name.startsWith(".") ||
              name.includes("..") ||
              !name.endsWith(".md") ||
              /[\\/:\x00-\x1f<>"|?*]/.test(name)
            )
              throw new Error(
                "Gemini settings.json must select one context filename. No changes made.",
              );
            resolved = path.join(directory, name);
          }
        }
      }
    } catch (error) {
      error.instructionPath = resolved;
      throw error;
    }
    return { module, file: resolved };
  }
  async function read(file) {
    const ancestor = await checkLocation(file);
    try {
      const info = await io.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1)
        throw new Error(
          "Instruction file must be a regular file, without links.",
        );
      if (info.size > 1024 * 1024)
        throw new Error("Instruction file exceeds 1 MB. No changes made.");
      const readOnly = await isReadOnly(file, info);
      return { bytes: await io.readFile(file), mode: info.mode, readOnly };
    } catch (error) {
      if (error.code === "ENOENT")
        return {
          bytes: null,
          mode: 0o600,
          readOnly: await isReadOnly(ancestor, await io.lstat(ancestor)),
        };
      throw error;
    }
  }
  async function fallbackNotice(id, bytes) {
    if (id !== "opencode" || bytes !== null) return undefined;
    // OpenCode V1's compatibility fallback is the fixed ~/.claude path.
    const fallback = path.join(home, ".claude/CLAUDE.md");
    const source = decode((await read(fallback)).bytes).text;
    if (source === null) return undefined;
    let covered = false;
    try {
      covered = ["block current", "block outdated"].includes(
        (await load()).instructionStatus(source),
      );
    } catch {}
    return `${covered ? "The Claude Code file already covers OpenCode. " : ""}Creating this file makes OpenCode V1 stop reading your Claude Code rules in ${fallback}.`;
  }
  return {
    async list() {
      const module = await load();
      return Promise.all(
        module.INSTRUCTION_FILES.map(async (entry) => {
          let file = path.join(home, entry.path);
          try {
            ({ file } = await target(entry.id));
            const current = await read(file);
            return {
              id: entry.id,
              readOnly: current.readOnly ?? false,
              notice: await fallbackNotice(entry.id, current.bytes),
              path: file,
              status: module.instructionStatus(decode(current.bytes).text),
            };
          } catch (error) {
            return {
              id: entry.id,
              path: error.instructionPath ?? file,
              error: error.message,
            };
          }
        }),
      );
    },
    async preview(id, action) {
      const { module, file } = await target(id);
      if (!["add", "update", "remove"].includes(action))
        throw new Error("Unknown instruction action.");
      const { bytes, readOnly } = await read(file);
      if (readOnly)
        throw new Error("The instruction file is read-only. No changes made.");
      const decoded = decode(bytes);
      const after = module.editInstructions(decoded.text, action);
      const token = randomUUID();
      pending.set(id, { token, file, bytes, next: decoded.encode(after) });
      return {
        token,
        before: decoded.text ?? "",
        after,
        notice: await fallbackNotice(id, bytes),
      };
    },
    async apply(id, token) {
      const run = async () => {
        const { file } = await target(id);
        const preview = pending.get(id);
        if (!preview || preview.token !== token || preview.file !== file)
          throw new Error("Reopen the preview before saving.");
        const current = await read(file);
        if (
          current.bytes === null
            ? preview.bytes !== null
            : preview.bytes === null || !current.bytes.equals(preview.bytes)
        )
          throw new Error(
            "The file changed. Reopen the preview before saving.",
          );
        if (current.readOnly)
          throw new Error(
            "The instruction file is read-only. No changes made.",
          );
        await io.mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await io.writeFile(temporary, preview.next, {
            flag: "wx",
            mode: current.mode & 0o777,
          });
          // Recheck after preparing the replacement, before the atomic rename.
          const latest = await read(file);
          if (
            latest.bytes === null
              ? current.bytes !== null
              : current.bytes === null || !latest.bytes.equals(current.bytes)
          )
            throw new Error(
              "The file changed. Reopen the preview before saving.",
            );
          if (latest.readOnly)
            throw new Error(
              "The instruction file is read-only. No changes made.",
            );
          await io.rename(temporary, file);
          pending.delete(id);
        } finally {
          await io.rm(temporary, { force: true });
        }
      };
      const result = writing.then(run);
      writing = result.catch(() => {});
      return result;
    },
  };
}

function registerInstructionIpc(ipc, controller, assertSender) {
  ipc.handle("ajour:instruction-list", async (event) => {
    assertSender(event, "read agent instructions");
    return controller.list();
  });
  ipc.handle("ajour:instruction-preview", async (event, id, action) => {
    assertSender(event, "preview agent instructions");
    return controller.preview(id, action);
  });
  ipc.handle("ajour:instruction-apply", async (event, id, token) => {
    assertSender(event, "change agent instructions");
    return controller.apply(id, token);
  });
}
module.exports = { createInstructionController, registerInstructionIpc };

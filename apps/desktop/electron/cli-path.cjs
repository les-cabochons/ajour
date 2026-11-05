const { execFile } = require("node:child_process");
const path = require("node:path");

/** Edits only Ajour's folder entry in the raw user Path, preserving its type. */
/** How long PowerShell gets to read, or to write and broadcast. */
const POWERSHELL_TIMEOUT_MS = 30_000;
/** Reads and writes when another program keeps changing the Path meanwhile. */
const WRITE_ATTEMPTS = 3;

/** `%NAME%` expanded from `env`, by name in any case; unknown names stay. */
function expandEnvironment(text, env) {
  return text.replace(/%([^%;]+)%/g, (whole, name) => {
    const key = Object.keys(env).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    const value = key === undefined ? undefined : env[key];
    return typeof value === "string" ? value : whole;
  });
}

/** An entry as Windows resolves it, for comparison only: never written. */
function comparable(entry, env, kind) {
  const unquoted = entry.trim().replace(/^"(.*)"$/, "$1");
  return path.win32
    .normalize(
      kind === "ExpandString" ? expandEnvironment(unquoted, env) : unquoted,
    )
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/**
 * The Path with `folder` appended, or null when it already holds it. Every
 * other entry, separator and %VAR% stays as it was.
 */
function pathWithFolder(raw, folder, env, kind) {
  const value = raw ?? "";
  const wanted = comparable(folder, env, "String");
  const present = value
    .split(";")
    .some(
      (entry) => entry.trim() !== "" && comparable(entry, env, kind) === wanted,
    );
  if (present) return null;
  if (value.trim() === "") return folder;
  return `${value.replace(/;+$/, "")};${folder}`;
}

/**
 * The Path without the entry `folder`, exactly as an add wrote it, or null
 * when it isn't there. Every other entry stays as it was.
 */
function pathWithoutFolder(raw, folder) {
  const entries = (raw ?? "").split(";");
  const kept = entries.filter((entry) => entry !== folder);
  return kept.length === entries.length ? null : kept.join(";");
}

/** The check may restore a snapshot only while its own write is still current. */
function checkPathRestoration(current, saved, written, folder) {
  if (
    (current?.value ?? null) === written &&
    (current?.kind ?? null) === (saved?.kind ?? "ExpandString")
  )
    return saved;
  const value = pathWithoutFolder(current?.value, folder);
  return value === null ? current : { value, kind: current.kind };
}

/** The kinds a user Path is written back with. */
const KINDS = new Set(["ExpandString", "String"]);

/**
 * @typedef {{ value: string | null, kind: string | null }} RegistryValue
 */

/**
 * @param {{
 *   registry: {
 *     read(): Promise<RegistryValue>,
 *     write(change: { expected: string | null, expectedKind: string | null, value: string | null, kind: string | null }): Promise<boolean>,
 *     broadcast(): Promise<void>,
 *   },
 *   env?: Record<string, string | undefined>,
 *   events?: { start(name: string, options: { kind: string, trigger: string }): { fail(error: unknown): { end(): void } } },
 * }} options
 */
function createWindowsUserPath({ registry, env = process.env, events }) {
  async function ensure(folder, present) {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const current = await registry.read();
      const next = present
        ? pathWithFolder(current.value, folder, env, current.kind)
        : pathWithoutFolder(current.value, folder);
      if (next === null) return { added: false };
      if (
        await registry.write({
          expected: current.value,
          expectedKind: current.kind,
          value: next,
          kind: current.kind ?? "ExpandString",
        })
      ) {
        // A successful write remains successful even if Explorer cannot be notified.
        await registry.broadcast().catch((error) =>
          events
            ?.start("cli_command.path_broadcast", {
              kind: "job",
              trigger: "system",
            })
            .fail(error)
            .end(),
        );
        return { added: present };
      }
    }
    throw new Error("Your PATH kept changing while Ajour edited it.");
  }
  return {
    add: (folder) => ensure(folder, true),
    remove: (folder) => ensure(folder, false),
  };
}

const READ_SCRIPT = [
  "$ErrorActionPreference = 'Stop';",
  "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment');",
  "$value = if ($key) { $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames') } else { $null };",
  "$kind = if ($null -ne $value) { $key.GetValueKind('Path').ToString() } else { '' };",
  "$encoded = if ($null -ne $value) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$value)) } else { $null };",
  "[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ kind = $kind; value = $encoded }))",
].join(" ");

// The values come from the environment, as "v" and base64 of UTF-8, so
// nothing of them is ever parsed as script, and an empty value is still set
// (Windows drops an empty variable). "-" is no value: an expected "-" means
// there was no Path, and a value "-" deletes it. "-" is also the kind of a
// missing Path, on both sides: an empty variable reads as $null, never ''. `-cne` compares
// case-sensitively. The broadcast is a run of its own, so a failure in it is
// told apart from a failed write.
const WRITE_SCRIPT = [
  "$ErrorActionPreference = 'Stop';",
  "$decode = { param($text) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text.Substring(1))) };",
  "$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');",
  "$current = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames');",
  "$expected = if ($env:AJOUR_PATH_EXPECTED -eq '-') { $null } else { & $decode $env:AJOUR_PATH_EXPECTED };",
  "$currentKind = if ($null -ne $current) { $key.GetValueKind('Path').ToString() } else { '-' };",
  "if ($currentKind -cne $env:AJOUR_PATH_EXPECTED_KIND -or $current -cne $expected) { [Console]::Out.Write('changed'); exit 0 };",
  "if ($env:AJOUR_PATH_VALUE -eq '-') { $key.DeleteValue('Path', $false) }",
  "else { $key.SetValue('Path', (& $decode $env:AJOUR_PATH_VALUE), [Microsoft.Win32.RegistryValueKind]$env:AJOUR_PATH_KIND) };",
  "$key.Close();",
  "[Console]::Out.Write('written')",
].join(" ");

const BROADCAST_SCRIPT = [
  "$ErrorActionPreference = 'Stop';",
  "$WM_SETTINGCHANGE = 0x1A; $HWND_BROADCAST = [IntPtr]0xffff; $SMTO_ABORTIFHUNG = 2;",
  "Add-Type -Namespace AjourCli -Name Broadcast -MemberDefinition '[DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);';",
  "$result = [UIntPtr]::Zero;",
  "[void][AjourCli.Broadcast]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, 'Environment', $SMTO_ABORTIFHUNG, 5000, [ref]$result)",
].join(" ");

/**
 * @param {string} file
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<string>}
 */
function runPowerShell(file, args, env) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: POWERSHELL_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env,
      },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
    );
  });
}

const encode = (text) => `v${Buffer.from(text, "utf8").toString("base64")}`;

/**
 * The user Path in HKCU\Environment, through Windows PowerShell run by its
 * absolute path, as plugin-renderer-sweep.cjs does: a bare name would search
 * the working folder first.
 *
 * @param {{
 *   run?: typeof runPowerShell,
 *   env?: Record<string, string | undefined>,
 * }} [options]
 */
function createPowerShellRegistry({
  run = runPowerShell,
  env = process.env,
} = {}) {
  const powershell = path.win32.join(
    env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const ask = (script, extra = {}) =>
    run(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      ...env,
      ...extra,
    });

  return {
    async read() {
      const answer = JSON.parse((await ask(READ_SCRIPT)).trim() || "{}");
      if (typeof answer?.value !== "string") return { value: null, kind: null };
      return {
        value: Buffer.from(answer.value, "base64").toString("utf8"),
        kind: typeof answer.kind === "string" ? answer.kind : null,
      };
    },
    async write({ expected, expectedKind, value, kind }) {
      if (value !== null && !KINDS.has(kind)) {
        throw new Error(`Ajour doesn't write a ${kind} Path.`);
      }
      const answer = await ask(WRITE_SCRIPT, {
        AJOUR_PATH_EXPECTED: expected === null ? "-" : encode(expected),
        AJOUR_PATH_EXPECTED_KIND: expectedKind ?? "-",
        AJOUR_PATH_VALUE: value === null ? "-" : encode(value),
        AJOUR_PATH_KIND: value === null ? "" : kind,
      });
      if (answer.trim() === "written") return true;
      if (answer.trim() === "changed") return false;
      throw new Error("Ajour couldn't change your PATH.");
    },
    async broadcast() {
      await ask(BROADCAST_SCRIPT);
    },
  };
}

module.exports = {
  createPowerShellRegistry,
  createWindowsUserPath,
  pathWithFolder,
  checkPathRestoration,
};

/**
 * Links into this install folder are owned, but only the committed binary is correct.
 * Repair precedes reconciliation cleanup. Launch reconciliation never prompts.
 * @param {{ fs: Pick<typeof import("node:fs/promises"), "lstat" | "readlink" | "access" | "mkdir" | "symlink">,
 *   exec: (file: string, args: string[], options?: { timeout?: number }) => Promise<unknown> }} options
 */
function createMacosCommandLink({ fs, exec }) {
  const destination = "/usr/local/bin/ajour";
  const directory = path.posix.dirname(destination);
  const failure = (reason, message) =>
    Object.assign(new Error(message), { reason });
  async function inspect(folder) {
    let entry;
    try {
      entry = await fs.lstat(destination);
    } catch (error) {
      if (error.code === "ENOENT") return { kind: "absent" };
      throw error;
    }
    if (!entry.isSymbolicLink()) return { kind: "foreign" };
    const observed = await fs.readlink(destination);
    const target = path.posix.resolve(directory, observed);
    const relative = path.posix.relative(folder, target);
    return relative &&
      relative !== ".." &&
      !relative.startsWith("../") &&
      !path.posix.isAbsolute(relative)
      ? { kind: "ours", target: observed }
      : { kind: "foreign" };
  }
  async function ensure(folder, present, { interactive = false } = {}) {
    const current = await inspect(folder);
    if (current.kind === "foreign") {
      if (!present) return { added: false, cleanupSafe: false };
      throw failure(
        "foreign_command",
        "Another ajour is at /usr/local/bin/ajour. Remove it, then install again.",
      );
    }
    const target = path.posix.join(folder, "ajour");
    const repair =
      present && current.kind === "ours" && current.target !== target;
    if (
      (present && current.kind === "ours" && !repair) ||
      (!present && current.kind === "absent")
    )
      return { added: false };
    const canWrite = async (location) =>
      fs.access(location, 2).then(
        () => true,
        (error) => {
          if (["EACCES", "EPERM"].includes(error.code)) return false;
          throw error;
        },
      );
    let writable;
    try {
      writable = await canWrite(directory);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      writable = await canWrite(path.posix.dirname(directory)).catch(
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (writable) {
        try {
          await fs.mkdir(directory, { mode: 0o755 });
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      }
    }
    if (!writable) {
      const parentWritable = await canWrite("/usr/local").catch((error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
      if (parentWritable)
        throw new Error(
          "Ajour can't add ajour to /usr/local/bin: the folder isn't yours, but /usr/local is. Fix their owners, then try again.",
        );
      for (const ancestor of linkAncestors(destination)) {
        let entry;
        try {
          entry = await fs.lstat(ancestor);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        if (
          entry.isSymbolicLink() ||
          !entry.isDirectory() ||
          entry.uid !== 0 ||
          (entry.mode & 0o022) !== 0
        )
          throw new Error(
            "Ajour can't safely change /usr/local/bin/ajour because an ancestor isn't a protected root-owned directory. Fix its owner and permissions, then press Retry in Settings.",
          );
      }
    }
    if (!writable && !interactive)
      throw new Error(
        "Ajour needs your password to repair /usr/local/bin/ajour. Press Retry in Settings.",
      );
    // Recheck before removing. A foreign replacement is never deliberately removed.
    if (!present || repair) {
      const checked = await inspect(folder);
      if (checked.kind !== "ours" || checked.target !== current.target) {
        throw new Error(
          "The ajour link changed during reconciliation. Press Retry in Settings.",
        );
      }
    }
    const removal = guardedRemoval(destination, current.target ?? "");
    const changed = () =>
      new Error(
        "The ajour link changed during reconciliation. Press Retry in Settings.",
      );
    if (writable) {
      if (!present || repair) {
        try {
          await exec("/bin/sh", ["-c", removal], { timeout: 30_000 });
        } catch {
          throw changed();
        }
      }
      if (present) {
        try {
          // symlink(2) fails for every existing destination, including a directory.
          await fs.symlink(target, destination);
        } catch {
          throw new Error(
            "Ajour couldn't create /usr/local/bin/ajour. Press Retry in Settings.",
          );
        }
      }
    } else {
      const { appleScript: script } = macosPrivilegedCommand({
        destination,
        target,
        present,
        observed: !present || repair ? current.target : "",
      });
      try {
        await exec("/usr/bin/osascript", ["-e", script], { timeout: 120_000 });
      } catch (error) {
        if (/(-128|cancel)/i.test(`${error.message} ${error.stderr ?? ""}`))
          throw failure(
            "admin_cancelled",
            present
              ? "Ajour needs your password to link /usr/local/bin/ajour. Nothing was installed."
              : "Ajour needs your password to remove /usr/local/bin/ajour. Nothing was removed.",
          );
        if (!present) throw changed();
        throw new Error(
          "Ajour couldn't create /usr/local/bin/ajour. Press Retry in Settings.",
        );
      }
    }
    if (!present && (await inspect(folder)).kind !== "absent") throw changed();
    if (
      present &&
      (await fs.readlink(destination).catch(() => null)) !==
        path.posix.join(folder, "ajour")
    )
      throw new Error(
        "Ajour couldn't verify /usr/local/bin/ajour. Press Retry in Settings.",
      );
    return { added: present };
  }
  return {
    add: (folder, options) => ensure(folder, true, options),
    remove: (folder, options) => ensure(folder, false, options),
  };
}
module.exports.createMacosCommandLink = createMacosCommandLink;

const shellQuote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
function linkAncestors(destination) {
  const result = ["/"];
  for (const part of path.posix.dirname(destination).split("/").filter(Boolean))
    result.push(path.posix.join(result[result.length - 1], part));
  return result;
}
function guardedRemoval(destination, observed) {
  const quote = shellQuote;
  return `if [ -L ${quote(destination)} ] && [ "$(/usr/bin/readlink ${quote(destination)})" = ${quote(observed)} ]; then /bin/rm ${quote(destination)}; else exit 1; fi`;
}
/** Same builder for production and the real macOS check. No caller-controlled path reaches it from IPC. */
function macosPrivilegedCommand({
  destination,
  target,
  present,
  observed = "",
}) {
  const quote = shellQuote;
  const ancestors = linkAncestors(destination);
  const verify = (directory) =>
    `[ ! -L ${quote(directory)} ] && [ -d ${quote(directory)} ] || exit 1; set -- $(/usr/bin/stat -f '%u %Lp' ${quote(directory)}); [ "$#" -eq 2 ] && [ "$1" = 0 ] && [ "$((0$2 & 022))" -eq 0 ] || exit 1`;
  const guards = ancestors.map(verify).join("; ");
  // Each mkdir runs only under parents already verified in this invocation.
  const prepare = ancestors
    .map((directory, index) => {
      const parents = ancestors.slice(0, index).map(verify).join("; ");
      return `${parents ? parents + "; " : ""}if [ ! -e ${quote(directory)} ] && [ ! -L ${quote(directory)} ]; then /bin/mkdir -m 755 ${quote(directory)} || exit 1; fi; ${verify(directory)}`;
    })
    .join("; ");
  // Foundation normalizes Unicode paths. The POSIX call keeps the exact UTF-8
  // target and atomically refuses every existing destination, including directories.
  const jxa = `ObjC.import("Foundation"); ObjC.bindFunction("symlink", ["int", ["char *", "char *"]]); const env = $.NSProcessInfo.processInfo.environment; if ($.symlink(ObjC.unwrap(env.objectForKey("AJOUR_TARGET")), ObjC.unwrap(env.objectForKey("AJOUR_LINK"))) !== 0) throw new Error("Link creation failed");`;
  const creation = `[ ! -e ${quote(destination)} ] && [ ! -L ${quote(destination)} ] && AJOUR_LINK=${quote(destination)} AJOUR_TARGET=${quote(target)} /usr/bin/osascript -l JavaScript -e ${quote(jxa)} && [ -L ${quote(destination)} ] && [ "$(/usr/bin/readlink ${quote(destination)})" = ${quote(target)} ]`;

  const removal = guardedRemoval(destination, observed);
  const operation = present
    ? observed
      ? `${guards}; ${removal} && { ${guards}; ${creation}; }`
      : `${guards}; ${creation}`
    : `${guards}; ${removal}`;
  const shell = `${prepare}; ${operation}`;
  return {
    shell,
    appleScript: `do shell script ${JSON.stringify(shell)} with administrator privileges`,
  };
}
// Electron never exports the destination override, including in packaged builds.
if (!process.versions.electron)
  module.exports.macosPrivilegedCommand = macosPrivilegedCommand;

const { execFile } = require("node:child_process");
const path = require("node:path");

/**
 * Puts the ajour command's folder on the PATH (#568, spec #567). On Windows
 * it is the user `Path` of HKCU\Environment, so no administrator prompt is
 * needed and new terminals see it. macOS links /usr/local/bin/ajour instead
 * (#569).
 *
 * The value is read raw, without expanding its %VARS%, the folder is
 * appended only when absent, and the value is written back as REG_EXPAND_SZ,
 * then WM_SETTINGCHANGE tells Explorer, so a terminal opened from it reads
 * the new Path. The registry is a seam: tests pass a fake, and Ajour passes
 * `createPowerShellRegistry`.
 */

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
function comparable(entry, env) {
  const unquoted = entry.trim().replace(/^"(.*)"$/, "$1");
  return path.win32
    .normalize(expandEnvironment(unquoted, env))
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/**
 * The Path with `folder` appended, or null when it already holds it. Every
 * other entry, separator and %VAR% stays as it was.
 */
function pathWithFolder(raw, folder, env) {
  const value = raw ?? "";
  const wanted = comparable(folder, env);
  const present = value
    .split(";")
    .some((entry) => entry.trim() !== "" && comparable(entry, env) === wanted);
  if (present) return null;
  if (value.trim() === "") return folder;
  return `${value.replace(/;+$/, "")};${folder}`;
}

/**
 * @param {{
 *   registry: {
 *     read(): Promise<{ value: string | null, kind: string | null }>,
 *     write(change: { expected: string | null, value: string }): Promise<boolean>,
 *   },
 *   env?: Record<string, string | undefined>,
 * }} options
 */
function createWindowsUserPath({ registry, env = process.env }) {
  return {
    /** Appends `folder` to the user Path unless it is there. */
    async add(folder) {
      for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
        const { value } = await registry.read();
        const next = pathWithFolder(value, folder, env);
        if (next === null) return { added: false };
        // The write refuses when the Path changed since this read.
        if (await registry.write({ expected: value, value: next })) {
          return { added: true };
        }
      }
      throw new Error("Your PATH kept changing while Ajour edited it.");
    },
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
// (Windows drops an empty variable). `-cne` compares case-sensitively.
const WRITE_SCRIPT = [
  "$ErrorActionPreference = 'Stop';",
  "$decode = { param($text) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text.Substring(1))) };",
  "$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');",
  "$current = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames');",
  "$expected = if ($env:AJOUR_PATH_EXPECTED -eq '-') { $null } else { & $decode $env:AJOUR_PATH_EXPECTED };",
  "if ($current -cne $expected) { [Console]::Out.Write('changed'); exit 0 };",
  "$key.SetValue('Path', (& $decode $env:AJOUR_PATH_VALUE), [Microsoft.Win32.RegistryValueKind]::ExpandString);",
  "$key.Close();",
  "$WM_SETTINGCHANGE = 0x1A; $HWND_BROADCAST = [IntPtr]0xffff; $SMTO_ABORTIFHUNG = 2;",
  "Add-Type -Namespace AjourCli -Name Broadcast -MemberDefinition '[DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);';",
  "$result = [UIntPtr]::Zero;",
  "[void][AjourCli.Broadcast]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, 'Environment', $SMTO_ABORTIFHUNG, 5000, [ref]$result);",
  "[Console]::Out.Write('written')",
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
    async write({ expected, value }) {
      const answer = await ask(WRITE_SCRIPT, {
        AJOUR_PATH_EXPECTED: expected === null ? "-" : encode(expected),
        AJOUR_PATH_VALUE: encode(value),
      });
      if (answer.trim() === "written") return true;
      if (answer.trim() === "changed") return false;
      throw new Error("Ajour couldn't change your PATH.");
    },
  };
}

module.exports = {
  createPowerShellRegistry,
  createWindowsUserPath,
  pathWithFolder,
};

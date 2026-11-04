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
 *   onBroadcastError?: (error: unknown) => void,
 * }} options
 */
function createWindowsUserPath({
  registry,
  env = process.env,
  onBroadcastError,
}) {
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
        await registry.broadcast().catch((error) => onBroadcastError?.(error));
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
// there was no Path, and a value "-" deletes it. `-cne` compares
// case-sensitively. The broadcast is a run of its own, so a failure in it is
// told apart from a failed write.
const WRITE_SCRIPT = [
  "$ErrorActionPreference = 'Stop';",
  "$decode = { param($text) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text.Substring(1))) };",
  "$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');",
  "$current = $key.GetValue('Path', $null, 'DoNotExpandEnvironmentNames');",
  "$expected = if ($env:AJOUR_PATH_EXPECTED -eq '-') { $null } else { & $decode $env:AJOUR_PATH_EXPECTED };",
  "$currentKind = if ($null -ne $current) { $key.GetValueKind('Path').ToString() } else { '' };",
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
        AJOUR_PATH_EXPECTED_KIND: expectedKind ?? "",
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

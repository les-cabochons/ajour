import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type SpawnResolution =
  | {
      command: string;
      args: string[];
      env: NodeJS.ProcessEnv;
    }
  | { refused: string };

/** Resolve only; callers must spawn with shell:false and must not override args/env. */
export function resolveSpawn(
  executablePath: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): SpawnResolution {
  if (
    [executablePath, ...argv, ...Object.keys(env), ...Object.values(env)].some(
      (v) => v?.includes("\0"),
    )
  )
    return { refused: "nul" };
  if (process.platform !== "win32")
    return { command: executablePath, args: [...argv], env: { ...env } };
  // CreateProcess uses UTF-16; lone surrogates do not round-trip through Node's UTF-8 IO.
  if (
    [executablePath, ...argv, ...Object.values(env)].some(
      (v) => v !== undefined && Buffer.from(v, "utf8").toString("utf8") !== v,
    )
  )
    return { refused: "invalid_unicode" };
  if (!isAbsoluteWindowsPath(executablePath))
    return { refused: "absolute_path_required" };
  let command = executablePath;
  let args = [...argv];
  const childEnv = { ...env };
  if (/\.(cmd|bat)$/i.test(command)) {
    try {
      if (statSync(command).size > 65536) return { refused: "shim_too_large" };
      const source = readFileSync(command, "utf8")
        .replace(/\r\n/g, "\n")
        .trimEnd();
      const shim = recognizeShim(source, path.dirname(command), childEnv);
      if (!shim) return { refused: "unknown_shim" };
      if ("refused" in shim) return shim;
      command = shim.command;
      args = [...shim.prefix, ...argv];
    } catch {
      return { refused: "shim_unreadable" };
    }
  }
  if (
    !isAbsoluteWindowsPath(command) ||
    !/\.exe$/i.test(command) ||
    isInterpreter(command)
  )
    return { refused: "native_exe_required" };
  // Conservative upper bound on libuv's CRT quoting, including argv[0] and NUL.
  if ([command, ...args].reduce((n, v) => n + 2 * v.length + 3, 1) > 32767)
    return { refused: "command_line_too_long" };
  return { command, args, env: childEnv };
}

function getEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  // Node sorts Windows environment keys before retaining the first case variant.
  const key = Object.keys(env)
    .sort()
    .find((key) => key.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

function setEnv(env: NodeJS.ProcessEnv, name: string, value: string) {
  for (const key of Object.keys(env))
    if (key.toLowerCase() === name.toLowerCase()) delete env[key];
  env[name] = value;
}

function nodeExecutable(
  directory: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const local = path.join(directory, "node.exe");
  if (isFile(local)) return local;
  // No current-directory or PATHEXT lookup and never recurse into another shim.
  return (getEnv(env, "PATH") ?? "")
    .split(";")
    .filter(isAbsoluteWindowsPath)
    .map((part) => path.join(part, "node.exe"))
    .find(isFile);
}

function expandPath(
  value: string,
  directory: string,
  normalize = true,
): string | undefined {
  const expanded = value.replace(/%~dp0|%dp0%/g, directory + "\\");
  if (/[\x00-\x1f\x7f%!"]/.test(expanded) || !isAbsoluteWindowsPath(expanded))
    return;
  return normalize ? path.normalize(expanded) : expanded;
}

type Shim = { command: string; prefix: string[] };

function recognizeShim(
  source: string,
  directory: string,
  env: NodeJS.ProcessEnv,
): Shim | { refused: string } | undefined {
  // Match whole templates. A familiar final invocation alone is not sufficient.
  // npm's cmd-shim writes the PATHEXT change in one of two places: after
  // endLocal (cmd-shim 6), where the child inherits it, or inside the ELSE
  // block (cmd-shim 7 and 8, npm 11), where endLocal discards it.
  const npmMatch =
    /^@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT \/b\n:start\nSETLOCAL\nCALL :find_dp0\n\nIF EXIST "%dp0%\\node.exe" \(\n  SET "_prog=%dp0%\\node.exe"\n\) ELSE \(\n  SET "_prog=node"\n(  SET PATHEXT=%PATHEXT:;\.JS;=;%\n)?\)\n\nendLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & (set PATHEXT=%PATHEXT:;\.JS;=;% & )?"%_prog%"  "([^"\n]+)" %\*$/i.exec(
      source,
    );
  // Exactly one of the two places, never both or neither.
  const npm = npmMatch && !npmMatch[1] !== !npmMatch[2] ? npmMatch : null;
  const npmChildPathext = Boolean(npm?.[2]);
  // pnpm's common node template, including optional NODE_PATH prefixing.
  const pnpm =
    /^@SETLOCAL\n(?:@IF NOT DEFINED NODE_PATH \(\n  @SET "NODE_PATH=([^"\n]+)"\n\) ELSE \(\n  @SET "NODE_PATH=\1;%NODE_PATH%"\n\)\n)?@IF EXIST "%~dp0\\node.exe" \(\n  "%~dp0\\node.exe"  "([^"\n]+)" %\*\n\) ELSE \(\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\n  node  "\2" %\*\n\)$/i.exec(
      source,
    );
  if (npm || pnpm) {
    const script = expandPath(npm?.[3] ?? pnpm?.[2] ?? "", directory);
    const command = nodeExecutable(directory, env);
    if (!script || !command || isScriptHostInput(script) || !isFile(script))
      return;
    if (pnpm?.[1]) {
      const entries = pnpm[1]
        .split(";")
        .map((v) => expandPath(v, directory, false));
      if (entries.some((v) => !v)) return;
      const previous = getEnv(env, "NODE_PATH");
      setEnv(
        env,
        "NODE_PATH",
        entries.join(";") + (previous ? ";" + previous : ""),
      );
    }
    // The child sees the PATHEXT change only from cmd-shim 6's npm shim, which
    // makes it after endLocal, and from pnpm's ELSE branch. cmd-shim 6 writes
    // `set PATHEXT=… & "%_prog%"`, so cmd.exe keeps the space before the `&`.
    const pathext = getEnv(env, "PATHEXT");
    if (
      pathext &&
      (npm ? npmChildPathext : !existsSync(path.join(directory, "node.exe")))
    )
      setEnv(
        env,
        "PATHEXT",
        pathext.replace(/;\.JS;/gi, ";") + (npm ? " " : ""),
      );
    return { command, prefix: [script] };
  }
  // npm's cmd-shim for a bin that is itself a Windows program, such as
  // opencode-ai's opencode.exe: it runs the program beside it, with no Node.
  const npmNative =
    /^@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT \/b\n:start\nSETLOCAL\nCALL :find_dp0\n"%dp0%\\([^"\n]+)" +%\*$/i.exec(
      source,
    );
  if (npmNative) {
    const command = expandPath(`%dp0%\\${npmNative[1]}`, directory);
    if (!command || !isFile(command)) return;
    // Node with no script would read the arguments as its own options.
    if (
      !/\.exe$/i.test(command) ||
      isInterpreter(command) ||
      path.basename(command).toLowerCase() === "node.exe"
    )
      return { refused: "native_exe_required" };
    return { command, prefix: [] };
  }
  const yarn =
    /^(?:@|@goto #_undefined_# 2>NUL \|\| @title %COMSPEC% & @setlocal & @)"([^"\n]+)" +((?:"[^"\n]*"(?: +"[^"\n]*")*)?) *%\*$/.exec(
      source,
    );
  if (yarn) {
    const command = expandPath(yarn[1]!, directory);
    const prefix = [...yarn[2]!.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]!);
    if (
      !command ||
      prefix.some(
        (v) =>
          /[%!\x00-\x1f\x7f]/.test(v) ||
          v.endsWith("\\") ||
          isScriptHostInput(v),
      )
    )
      return;
    if (!/\.exe$/i.test(command) || isInterpreter(command))
      return { refused: "native_exe_required" };
    // Node must receive a script before any options. PnP scripts may be in zip files.
    if (path.basename(command).toLowerCase() === "node.exe") {
      if (
        !prefix[0] ||
        prefix[0].startsWith("-") ||
        !isAbsoluteWindowsPath(prefix[0])
      )
        return;
    } else if (prefix.length) return;
    return { command, prefix };
  }
  const t3 =
    /^@echo off\nrem Written by T3 Code: runs the desktop app's bundled t3 CLI.\nsetlocal EnableExtensions DisableDelayedExpansion\nset "T3CODE_CLI_PATH=([^"\n]+)"\nif not defined T3CODE_HOME set "T3CODE_HOME=([^"\n]+)"\nset "ELECTRON_RUN_AS_NODE=1"\nset "T3CODE_DESKTOP_CLI_LAUNCHER=1"\nif exist "([^"\n]+)" goto run\necho T3 Code has moved or been removed. Open the app once to update this command. 1>&2\nexit \/b 127\n:run\n"\3" "([^"\n]+)" %\*\nset "t3_exit=%ERRORLEVEL%"\nexit \/b %t3_exit%$/.exec(
      source,
    );
  if (t3) {
    const values = t3.slice(1).map((v) => expandPath(v, directory, false));
    const [cli, home, command, script] = values;
    if (
      !cli ||
      !home ||
      !command ||
      !script ||
      !/^T3 Code(?: \(Nightly\))?\.exe$/i.test(path.basename(command)) ||
      !isNodeScript(script) ||
      !isFile(command) ||
      !existsSync(script.split(/(?<=\.asar)[\\/]/i)[0]!)
    )
      return;
    setEnv(env, "T3CODE_CLI_PATH", cli);
    if (!getEnv(env, "T3CODE_HOME")) setEnv(env, "T3CODE_HOME", home);
    setEnv(env, "ELECTRON_RUN_AS_NODE", "1");
    setEnv(env, "T3CODE_DESKTOP_CLI_LAUNCHER", "1");
    return { command, prefix: [script] };
  }
  return;
}

// Root-relative paths depend on the child's current drive and are not fully qualified.
function isAbsoluteWindowsPath(value: string): boolean {
  return /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(value);
}

function isFile(value: string): boolean {
  try {
    return statSync(value).isFile();
  } catch {
    return false;
  }
}

function isScriptHostInput(value: string): boolean {
  return /\.(?:bat|cmd|ps1|psm1|psd1|vbs|vbe|jse|wsf|wsh|hta|sct)(?:$|[ .])/i.test(
    value,
  );
}

function isNodeScript(value: string): boolean {
  return /\.(?:js|cjs|mjs)$/i.test(value);
}

function isInterpreter(value: string): boolean {
  return /^(?:cmd|command|powershell|powershell_ise|pwsh|wscript|cscript|mshta|bash|sh|dash|zsh|csh|ksh|wsl|conhost|rundll32|regsvr32|msbuild|installutil|(?:python|pythonw|py|pyw|ruby|rubyw|perl|php|php-cgi|deno|bun|java|javaw|lua|tclsh|wish|rscript)(?:\d+(?:\.\d+)*)?)\.exe$/i.test(
    path.basename(value),
  );
}

/** User-facing explanations shared by launch and CLI detection. */
export function spawnRefusalMessage(
  reason: string,
  tool: string,
  launcher: string,
): string {
  if (reason === "nul" || reason === "invalid_unicode")
    return "The command's settings or environment contain a character Windows can't pass.";
  if (reason === "command_line_too_long")
    return "The command's settings are too long for Windows to pass. Shorten them, then try again.";
  const reinstall =
    "Reinstall it with npm, pnpm or Yarn, or use its Windows .exe file.";
  const messages: Record<string, string> = {
    absolute_path_required:
      "that file's location is relative to the current folder. Add the full folder path to PATH, then reopen Ajour.",
    native_exe_required: `it starts a program Ajour can't run directly. ${reinstall}`,
    shim_too_large: `that launcher file is too large to check. ${reinstall}`,
    unknown_shim: `it doesn't recognise that launcher. ${reinstall}`,
    shim_unreadable: `it can't read that launcher file. Check that the file is still there and you can open it. ${reinstall}`,
  };
  return `Ajour can't start ${tool} from ${launcher} because ${messages[reason] ?? `it couldn't check that launcher. ${reinstall}`}`;
}

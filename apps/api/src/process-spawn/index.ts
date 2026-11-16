import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type SpawnResolution =
  | {
      command: string;
      args: string[];
      env: NodeJS.ProcessEnv;
      windowsVerbatimArguments?: boolean;
    }
  | { refused: string };

/** Resolve only; callers must spawn with shell:false and must not override args/env. */
export function resolveSpawn(
  executablePath: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): SpawnResolution {
  if (
    [executablePath, ...argv, ...Object.values(env)].some((v) =>
      v?.includes("\0"),
    )
  )
    return { refused: "nul" };
  if (process.platform !== "win32")
    return { command: executablePath, args: [...argv], env: { ...env } };
  // CreateProcess uses UTF-16; lone surrogates do not round-trip through Node's UTF-8 IO.
  if (
    [executablePath, ...argv].some(
      (v) => Buffer.from(v, "utf8").toString("utf8") !== v,
    )
  )
    return { refused: "invalid_unicode" };
  if (!path.isAbsolute(executablePath))
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
      command = shim.command;
      args = [...shim.prefix, ...argv];
    } catch {
      return { refused: "shim_unreadable" };
    }
  }
  if (!path.isAbsolute(command) || !/\.exe$/i.test(command))
    return { refused: "native_exe_required" };
  // Conservative upper bound on libuv's CRT quoting, including argv[0] and NUL.
  if ([command, ...args].reduce((n, v) => n + 2 * v.length + 3, 1) > 32767)
    return { refused: "command_line_too_long" };
  return { command, args, env: childEnv };
}

function getEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return Object.entries(env).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
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
  if (existsSync(local)) return local;
  // No current-directory or PATHEXT lookup and never recurse into another shim.
  return (getEnv(env, "PATH") ?? "")
    .split(";")
    .filter((part) => path.isAbsolute(part))
    .map((part) => path.join(part, "node.exe"))
    .find((candidate) => existsSync(candidate));
}

function expandPath(
  value: string,
  directory: string,
  normalize = true,
): string | undefined {
  const expanded = value.replace(/%~dp0|%dp0%/g, directory + "\\");
  if (/[\x00-\x1f%!"]/.test(expanded) || !path.isAbsolute(expanded)) return;
  return normalize ? path.normalize(expanded) : expanded;
}

type Shim = { command: string; prefix: string[] };

function recognizeShim(
  source: string,
  directory: string,
  env: NodeJS.ProcessEnv,
): Shim | undefined {
  // Match whole templates. A familiar final invocation alone is not sufficient.
  const npm =
    /^@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT \/b\n:start\nSETLOCAL\nCALL :find_dp0\n\nIF EXIST "%dp0%\\node.exe" \(\n  SET "_prog=%dp0%\\node.exe"\n\) ELSE \(\n  SET "_prog=node"\n\)\n\nendLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "([^"\n]+)" %\*$/i.exec(
      source,
    );
  // pnpm's common node template, including optional NODE_PATH prefixing.
  const pnpm =
    /^@SETLOCAL\n(?:@IF NOT DEFINED NODE_PATH \(\n  @SET "NODE_PATH=([^"\n]+)"\n\) ELSE \(\n  @SET "NODE_PATH=\1;%NODE_PATH%"\n\)\n)?@IF EXIST "%~dp0\\node.exe" \(\n  "%~dp0\\node.exe"  "([^"\n]+)" %\*\n\) ELSE \(\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\n  node  "\2" %\*\n\)$/i.exec(
      source,
    );
  if (npm || pnpm) {
    const script = expandPath(npm?.[1] ?? pnpm?.[2] ?? "", directory);
    const command = nodeExecutable(directory, env);
    if (!script || !command || !existsSync(script)) return;
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
    // npm's endLocal still executes this PATHEXT assignment for the child.
    const pathext = getEnv(env, "PATHEXT");
    if (pathext && (npm || !existsSync(path.join(directory, "node.exe"))))
      setEnv(env, "PATHEXT", pathext.replace(/;\.JS;/gi, ";"));
    return { command, prefix: [script] };
  }
  const yarn =
    /^(?:@|@goto #_undefined_# 2>NUL \|\| @title %COMSPEC% & @setlocal & @)"([^"\n]+)" ((?: *"[^"\n]*")*) *%\*$/.exec(
      source,
    );
  if (yarn) {
    const command = expandPath(yarn[1]!, directory);
    const prefix = [...yarn[2]!.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]!);
    if (!command || prefix.some((v) => /[%!\x00-\x1f]/.test(v))) return;
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
      !existsSync(command) ||
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

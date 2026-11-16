// A command-line tool the checks put where the process broker looks for one:
// a Node script, and the launcher a user's install would have. On Windows
// that is the `.cmd` shim npm 11's cmd-shim 8 writes, verbatim but for the
// script's name, which the broker resolves to node.exe and the script
// without cmd.exe. Elsewhere it is the script itself, with a shebang.
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

/** npm 11's cmd-shim 8 launcher of `script`, beside it. */
const cmdShim = (script) => `@ECHO off\r
GOTO start\r
:find_dp0\r
SET dp0=%~dp0\r
EXIT /b\r
:start\r
SETLOCAL\r
CALL :find_dp0\r
\r
IF EXIST "%dp0%\\node.exe" (\r
  SET "_prog=%dp0%\\node.exe"\r
) ELSE (\r
  SET "_prog=node"\r
  SET PATHEXT=%PATHEXT:;.JS;=;%\r
)\r
\r
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*\r
`;

/**
 * Writes the tool `name` into `directory`, running `source` (CommonJS) with
 * Node, and returns the path the broker finds it at: `name.cmd` on Windows,
 * `name` elsewhere. `node` is the shebang's interpreter outside Windows, by
 * default the first `node` on PATH.
 */
async function writeFakeTool(directory, name, source, { node } = {}) {
  await fs.mkdir(directory, { recursive: true });
  if (process.platform === "win32") {
    const script = `${name}.cjs`;
    await fs.writeFile(path.join(directory, script), source);
    const launcher = path.join(directory, `${name}.cmd`);
    await fs.writeFile(launcher, cmdShim(script));
    return launcher;
  }
  const launcher = path.join(directory, name);
  await fs.writeFile(launcher, `#!${node ?? "/usr/bin/env node"}\n${source}`);
  await fs.chmod(launcher, 0o755);
  return launcher;
}

module.exports = { writeFakeTool, cmdShim };

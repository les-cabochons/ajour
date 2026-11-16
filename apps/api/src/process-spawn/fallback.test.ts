import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

// Research-only candidate B. Never exported or used by resolveSpawn.
// Algorithm compared with cross-spawn lib/util/escape.js and lib/parse.js.
function escapeArgument(value: string, double: boolean) {
  let quoted = '"';
  let slashes = 0;
  for (const char of value) {
    if (char === "\\") {
      slashes++;
      continue;
    }
    quoted += "\\".repeat(char === '"' ? slashes * 2 + 1 : slashes) + char;
    slashes = 0;
  }
  quoted += "\\".repeat(slashes * 2) + '"';
  const caret = (s: string) => s.replace(/[()\][%!^"`<>&|;, *?\t]/g, "^$&");
  return double ? caret(caret(quoted)) : caret(quoted);
}

// cmd.exe parsing can only be measured on Windows.
it.skipIf(process.platform !== "win32")(
  "Measures a restricted CRT plus caret fallback with one and two parsing passes",
  () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ajour-cmd-fallback-"));
    try {
      const marker = path.join(root, "CANARY");
      const output = path.join(root, "argv.json");
      const script = path.join(root, "argv.mjs");
      const shim = path.join(root, "shim.cmd");
      writeFileSync(
        script,
        `import fs from 'node:fs';fs.writeFileSync(process.env.ARGV_OUTPUT,JSON.stringify(process.argv.slice(2)));`,
      );
      writeFileSync(
        shim,
        `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
      );
      const values = [
        "",
        "plain",
        "a b",
        "a\tb",
        'a"b',
        'a\\"b',
        "tail\\",
        "&|<>^()",
        ";,=",
        "é中😀",
        "＂＆｜",
        `x" & echo HIT>"${marker}" & "`,
        "%PATH%",
        "!VAR!",
        "\r",
        "\n",
        "\0",
        "a".repeat(8500),
      ];
      for (const double of [false, true]) {
        let exact = 0,
          refused = 0;
        const failures: string[] = [];
        for (const value of values) {
          if (/[%!\r\n\0]/.test(value) || value.length > 7000) {
            refused++;
            continue;
          }
          const line = `${shim.replace(/[()\][%!^"`<>&|;, *?]/g, "^$&")} ${escapeArgument(value, double)}`;
          const result = spawnSync(
            path.join(process.env.SystemRoot!, "System32", "cmd.exe"),
            ["/d", "/s", "/c", `"${line}"`],
            {
              shell: false,
              windowsVerbatimArguments: true,
              env: { ...process.env, ARGV_OUTPUT: output },
              encoding: "utf8",
              timeout: 5000,
            },
          );
          expect(existsSync(marker)).toBe(false);
          const received: unknown =
            result.status === 0 && existsSync(output)
              ? JSON.parse(readFileSync(output, "utf8"))
              : undefined;
          if (JSON.stringify(received) === JSON.stringify([value])) exact++;
          else failures.push(value);
          if (existsSync(output)) rmSync(output);
        }
        console.log(
          JSON.stringify({
            strategy: "B-experiment",
            double,
            exact,
            refused,
            failures,
          }),
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30000,
);

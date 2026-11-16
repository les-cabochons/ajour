import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { afterAll, describe, expect, it } from "vitest";
import { resolveSpawn } from "./index.ts";

// Templates are independent fixtures transcribed from upstream generators.
const root = mkdtempSync(path.join(os.tmpdir(), "ajour cmd & unicode-é-"));
const script = path.join(root, "argv.mjs");
const output = path.join(root, "argv.json");
const marker = path.join(root, "CANARY");
const exploitRoot = mkdtempSync(path.join(os.tmpdir(), "ajour-exploit-"));
afterAll(() => rmSync(exploitRoot, { recursive: true, force: true }));
writeFileSync(
  script,
  `import fs from 'node:fs'; fs.writeFileSync(process.env.ARGV_OUTPUT, JSON.stringify({argv:process.argv.slice(2),env:process.env}));`,
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const npm = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\argv.mjs" %*
`;
// Generated verbatim by npm 11.20's cmd-shim 8.0.0, with only the script path
// changed: it moves the PATHEXT change inside the ELSE block.
const npmCmdShim8 = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\argv.mjs" %*
`;
const pnpm = `@SETLOCAL
@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\argv.mjs" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\\argv.mjs" %*
)
`;
const pnpmEnv = pnpm.replace(
  "@SETLOCAL\n",
  `@SETLOCAL
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=%~dp0\\deps;%~dp0\\..\\shared"
) ELSE (
  @SET "NODE_PATH=%~dp0\\deps;%~dp0\\..\\shared;%NODE_PATH%"
)
`,
);
const t3Executable = path.join(root, "T3 Code.exe");
linkSync(process.execPath, t3Executable);
const t3 = `@echo off
rem Written by T3 Code: runs the desktop app's bundled t3 CLI.
setlocal EnableExtensions DisableDelayedExpansion
set "T3CODE_CLI_PATH=${path.join(root, "t3.cmd")}"
if not defined T3CODE_HOME set "T3CODE_HOME=${root}"
set "ELECTRON_RUN_AS_NODE=1"
set "T3CODE_DESKTOP_CLI_LAUNCHER=1"
if exist "${t3Executable}" goto run
echo T3 Code has moved or been removed. Open the app once to update this command. 1>&2
exit /b 127
:run
"${t3Executable}" "${script}" %*
set "t3_exit=%ERRORLEVEL%"
exit /b %t3_exit%
`;
const fixtures = {
  npm,
  "npm-cmd-shim-8": npmCmdShim8,
  pnpm,
  "pnpm-env": pnpmEnv,
  "yarn-classic": `@"${process.execPath}"  "${script}"  %*\n`,
  "yarn-berry": `@goto #_undefined_# 2>NUL || @title %COMSPEC% & @setlocal & @"${process.execPath}" "${script}" %*`,
  t3,
};
const env = {
  ...process.env,
  ARGV_OUTPUT: output,
  PATH: path.dirname(process.execPath),
  NODE_PATH: "old-node-path",
  PATHEXT: ".COM;.EXE;.BAT;.CMD;.JS;",
  VAR: "expanded",
};
const atoms = [
  "&",
  "|",
  "<",
  ">",
  "^",
  "%",
  "%PATH%",
  "!VAR!",
  '"',
  '\\"',
  "\\",
  "()",
  ";",
  ",",
  "=",
  " ",
  "\t",
  "\r",
  "\n",
  "“”",
  "＂＆｜",
  "é中😀",
  "",
  "-flag",
];
const corpus = [
  ...atoms,
  "a".repeat(8500),
  "\\".repeat(8500),
  'Fix login" & echo INJECTED & "',
  `x" & echo HIT>"${marker}" & "`,
  `x\" | echo HIT>"${marker}" & "`,
  `x\" & type nul>"${marker}" & "`,
  "nul\0tail",
  "\ud800",
  "x".repeat(33000),
];
let seed = 706;
for (let i = 0; i < 400; i++) {
  let value = "";
  for (let j = 0; j < 8; j++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    value += atoms[seed % atoms.length];
  }
  corpus.push(value);
}

// Windows process semantics cannot be exercised on other hosts.
describe.skipIf(process.platform !== "win32")(
  "Windows faithful delivery",
  () => {
    it.each([
      [
        "classic-pnp",
        `@"${process.execPath}"  "${root}\\cache.zip\\cli.js"  %*`,
        process.execPath,
        [`${root}\\cache.zip\\cli.js`],
      ],
      [
        "berry-run",
        `@goto #_undefined_# 2>NUL || @title %COMSPEC% & @setlocal & @"${process.execPath}" "${script}" "run" %*`,
        process.execPath,
        [script, "run"],
      ],
      [
        "berry-node-gyp",
        `@goto #_undefined_# 2>NUL || @title %COMSPEC% & @setlocal & @"${process.execPath}" "${script}" "run" "--top-level" "node-gyp" %*`,
        process.execPath,
        [script, "run", "--top-level", "node-gyp"],
      ],
      [
        "berry-native",
        `@goto #_undefined_# 2>NUL || @title %COMSPEC% & @setlocal & @"C:\\tools\\tool.exe"  %*`,
        "C:\\tools\\tool.exe",
        [],
      ],
    ] as const)(
      "Given Yarn %s generator output, preserves its command and prefix",
      (name, source, command, prefix) => {
        const shim = path.join(root, `${name}.cmd`);
        writeFileSync(shim, source);
        expect(resolveSpawn(shim, ["--version"], {})).toEqual({
          command,
          args: [...prefix, "--version"],
          env: {},
        });
      },
    );

    it.each([
      '"--eval=process.exit()"',
      '"relative.js"',
      "",
      '"-C:\\script.js"',
    ])(
      "Given a Yarn Node prefix %s without an absolute script, refuses",
      (prefix) => {
        const shim = path.join(root, "node-option.cmd");
        writeFileSync(shim, `@"${process.execPath}" ${prefix} %*`);
        expect(resolveSpawn(shim, [], {})).toHaveProperty("refused");
      },
    );

    it.each([
      "python",
      "python3",
      "pythonw",
      "py",
      "pyw",
      "ruby",
      "rubyw",
      "perl",
      "php",
      "php-cgi",
      "deno",
      "bun",
      "java",
      "javaw",
      "lua",
      "tclsh",
      "wish",
      "Rscript",
      "python3.12",
      "pythonw3.12",
      "ruby3.3",
      "rubyw3.3",
      "perl5.38",
      "php8.3",
      "php-cgi8.3",
      "deno2.1",
      "bun1.2",
      "java21",
      "javaw21",
      "lua5.4",
      "tclsh8.6",
      "wish8.6",
      "Rscript4.4",
      "PYTHON3.12",
      "RuBy3.3",
      "PeRl5.38",
    ])("Given a no-prefix Yarn wrapper targeting %s.exe, refuses", (name) => {
      const shim = path.join(root, "interpreter-no-prefix.cmd");
      for (const preamble of [
        "@",
        "@goto #_undefined_# 2>NUL || @title %COMSPEC% & @setlocal & @",
      ]) {
        writeFileSync(shim, `${preamble}"C:\\tools\\${name}.exe"  %*`);
        expect(resolveSpawn(shim, ["--version"], {})).toEqual({
          refused: "native_exe_required",
        });
      }
    });

    it("Given a Yarn native wrapper with a prefix, refuses", () => {
      const shim = path.join(root, "native-prefix.cmd");
      writeFileSync(shim, `@"C:\\tools\\tool.exe" "${script}" %*`);
      expect(resolveSpawn(shim, [], {})).toHaveProperty("refused");
    });
    for (const [format, content] of Object.entries(fixtures)) {
      it(`Given ${format}, every hostile value arrives exactly or is refused, and no canary runs`, () => {
        const shim = path.join(root, `${format}.cmd`);
        writeFileSync(shim, content.replace(/\n/g, "\r\n"));
        const resolutionMs: number[] = [];
        const spawnMs: number[] = [];
        let accepted = 0;
        let refused = 0;
        // Group small values to keep real-process fuzzing affordable. Long values run alone.
        let batch: string[] = [];
        const run = () => {
          if (!batch.length) return;
          const plan = resolveSpawn(shim, batch, env);
          expect(plan).not.toHaveProperty("refused");
          if ("refused" in plan) throw new Error(plan.refused);
          const start = performance.now();
          const child = spawnSync(plan.command, plan.args, {
            env: plan.env,
            shell: false,
            timeout: 10000,
            encoding: "utf8",
          });
          spawnMs.push(performance.now() - start);
          expect(child.error).toBeUndefined();
          expect(child.status, child.stderr).toBe(0);
          const result = JSON.parse(readFileSync(output, "utf8"));
          expect(result.argv).toEqual(batch);
          expect(existsSync(marker)).toBe(false);
          if (format === "t3") {
            expect(result.env.ELECTRON_RUN_AS_NODE).toBe("1");
            expect(result.env.T3CODE_DESKTOP_CLI_LAUNCHER).toBe("1");
            expect(result.env.T3CODE_HOME).toBe(root);
            expect(result.env.T3CODE_CLI_PATH).toBe(path.join(root, "t3.cmd"));
          }
          if (format === "pnpm-env")
            expect(result.env.NODE_PATH).toBe(
              `${root}\\\\deps;${root}\\\\..\\shared;old-node-path`,
            );
          // cmd-shim 6 changes PATHEXT after endLocal, so the child keeps the
          // change; cmd-shim 8 changes it inside SETLOCAL, so endLocal drops it.
          if (format === "npm")
            expect(result.env.PATHEXT).toBe(".COM;.EXE;.BAT;.CMD; ");
          if (format === "npm-cmd-shim-8")
            expect(result.env.PATHEXT).toBe(".COM;.EXE;.BAT;.CMD;.JS;");
          batch = [];
        };
        for (const value of corpus) {
          const start = performance.now();
          const plan = resolveSpawn(shim, [value], env);
          resolutionMs.push(performance.now() - start);
          if ("refused" in plan) {
            refused++;
            continue;
          }
          accepted++;
          if (value.length > 1000) {
            run();
            batch = [value];
            run();
          } else {
            batch.push(value);
            if (batch.length === 20) run();
          }
        }
        run();
        expect(accepted).toBe(corpus.length - 3);
        expect(refused).toBe(3);
        const stats = (xs: number[]) => ({
          mean: xs.reduce((a, b) => a + b, 0) / xs.length,
          max: Math.max(...xs),
        });
        console.log(
          JSON.stringify({
            format,
            accepted,
            refused,
            resolutionMs: stats(resolutionMs),
            spawnMs: stats(spawnMs),
            processes: spawnMs.length,
          }),
        );
      }, 60000);

      it(`Given changed ${format} content, refuses instead of running unrecognized commands`, () => {
        const shim = path.join(root, `${format}.bat`);
        writeFileSync(shim, content);
        expect(resolveSpawn(shim, ["--title", "safe"], env)).not.toHaveProperty(
          "refused",
        );
        const plan = resolveSpawn(shim, ["--title", "safe"], env);
        if ("refused" in plan) throw new Error(plan.refused);
        const child = spawnSync(plan.command, plan.args, {
          shell: false,
          env: plan.env,
          timeout: 10000,
        });
        expect(child.status).toBe(0);
        expect(JSON.parse(readFileSync(output, "utf8")).argv).toEqual([
          "--title",
          "safe",
        ]);
        for (const change of [
          `echo HIT>"${marker}"\n${content}`,
          `${content}\necho HIT>"${marker}"`,
          content.replace("%*", '"%*"'),
          content.replace("%*", "%1"),
        ]) {
          writeFileSync(shim, change);
          expect(resolveSpawn(shim, ["safe"], env)).toEqual({
            refused: "unknown_shim",
          });
          expect(existsSync(marker)).toBe(false);
        }
      });
    }

    it.each([
      "cmd",
      "powershell",
      "pwsh",
      "wscript",
      "cscript",
      "mshta",
      "bash",
      "wsl",
      "conhost",
      "rundll32",
      "regsvr32",
      "sh",
      "zsh",
      "msbuild",
    ])("Given interpreter %s, refuses every command path", (name) => {
      const target = path.join(root, `${name}.exe`);
      writeFileSync(target, "");
      expect(resolveSpawn(target, [], env)).toEqual({
        refused: "native_exe_required",
      });
      const shim = path.join(root, "unsafe.cmd");
      for (const content of [
        `@"${target}" "${script}" %*`,
        t3.replaceAll(t3Executable, target),
      ]) {
        writeFileSync(shim, content);
        expect(resolveSpawn(shim, [], env)).toHaveProperty("refused");
      }
    });

    it("Given the reported cmd exploit, refuses and leaves the canary absent", () => {
      const shim = path.join(exploitRoot, "exploit.cmd");
      writeFileSync(path.join(exploitRoot, "real.bat"), "@echo off");
      writeFileSync(
        shim,
        `@"C:\\Windows\\System32\\cmd.exe" "/d" "/c" "${exploitRoot}\\real.bat" %*`,
      );
      const plan = resolveSpawn(
        shim,
        [`Fix login" & type nul> ${exploitRoot}\\CANARY & rem "`],
        env,
      );
      expect(plan).toHaveProperty("refused");
      expect(existsSync(path.join(exploitRoot, "CANARY"))).toBe(false);
    });

    it.each([
      "real.bat",
      "real.cmd",
      "real.ps1",
      "real.vbs",
      "real.wsf",
      "real.hta",
    ])("Given prefix naming %s, refuses", (name) => {
      const target = path.join(root, name);
      writeFileSync(target, "");
      const shim = path.join(root, "prefix.cmd");
      for (const content of [
        `@"${process.execPath}" "${target}" %*`,
        npm.replace("%dp0%\\argv.mjs", target),
        pnpm.replaceAll("%~dp0\\argv.mjs", target),
        t3.replaceAll(script, target),
      ]) {
        writeFileSync(shim, content);
        expect(resolveSpawn(shim, [], env)).toHaveProperty("refused");
      }
    });

    it.each([
      path.join(root, "%VAR%.mjs"),
      path.join(root, "bad!path.mjs"),
      path.join(root, 'bad"path.mjs'),
      path.join(root, "bad\tpath.mjs"),
      path.join(root, "bad\x7fpath.mjs"),
      "relative.mjs",
      "\\Windows\\node.exe",
    ])("Given unsafe captured path %j, refuses", (target) => {
      if (target.includes("%VAR%") || target.includes("!"))
        writeFileSync(target, "");
      const shim = path.join(root, "bad-path.cmd");
      for (const content of [
        `@"${target}" "${script}" %*`,
        npm.replace("%dp0%\\argv.mjs", target),
      ]) {
        writeFileSync(shim, content);
        expect(resolveSpawn(shim, [], env)).toHaveProperty("refused");
      }
    });

    it.each(["tool.cmd", "tool.bat"])(
      "Given Yarn target %s, requires a native executable",
      (name) => {
        const shim = path.join(root, "bad-target.cmd");
        writeFileSync(shim, `@"${path.join(root, name)}" "${script}" %*`);
        expect(resolveSpawn(shim, [], env)).toEqual({
          refused: "native_exe_required",
        });
      },
    );

    it.each(['"a""b"', '"C:\\dir\\"'])(
      "Given ambiguous Yarn prefix %s, refuses",
      (prefix) => {
        const shim = path.join(root, "ambiguous.cmd");
        writeFileSync(shim, `@"${process.execPath}" ${prefix} %*`);
        expect(resolveSpawn(shim, [], env)).toHaveProperty("refused");
      },
    );

    it("Given a percent in pnpm NODE_PATH, refuses", () => {
      const shim = path.join(root, "percent.cmd");
      writeFileSync(shim, pnpmEnv.replaceAll("deps", "%VAR%"));
      expect(resolveSpawn(shim, [], env)).toHaveProperty("refused");
    });

    it("Given duplicate Path and PATH, selects Node's sorted first key", () => {
      const shim = path.join(root, "sorted.cmd");
      writeFileSync(shim, pnpm);
      const plan = resolveSpawn(shim, [], {
        Path: path.join(root, "missing"),
        PATH: path.dirname(process.execPath),
      });
      expect(plan).toHaveProperty("command", process.execPath);
    });

    it("Given root-relative PATH or a node.exe directory, refuses", () => {
      const shim = path.join(root, "directory.cmd");
      writeFileSync(shim, pnpm);
      expect(
        resolveSpawn(shim, [], {
          PATH: path.dirname(process.execPath).slice(2),
        }),
      ).toHaveProperty("refused");
      const bin = path.join(root, "directory-bin");
      mkdirSync(path.join(bin, "node.exe"), { recursive: true });
      expect(resolveSpawn(shim, [], { PATH: bin })).toHaveProperty("refused");
      mkdirSync(path.join(root, "node.exe"));
      try {
        expect(resolveSpawn(shim, [], {})).toHaveProperty("refused");
      } finally {
        rmSync(path.join(root, "node.exe"), { recursive: true });
      }
    });

    it("Given npm or pnpm with an extensionless Node entry point, preserves it", () => {
      const entry = path.join(root, "cli-entry");
      writeFileSync(entry, "");
      const shim = path.join(root, "extensionless.cmd");
      for (const content of [
        npm.replace("%dp0%\\argv.mjs", entry),
        pnpm.replaceAll("%~dp0\\argv.mjs", entry),
      ]) {
        writeFileSync(shim, content);
        const plan = resolveSpawn(shim, [], env);
        expect(plan).toHaveProperty("command", process.execPath);
        expect(plan).toHaveProperty("args", [entry]);
      }
    });

    it("Given the live T3 shim, resolves it without launching the application", () => {
      const live = path.join(os.homedir(), ".t3", "bin", "t3.cmd");
      if (!existsSync(live)) return;
      const plan = resolveSpawn(live, ["--title", 'a" & b'], process.env);
      expect(plan).not.toHaveProperty("refused");
      if ("refused" in plan) throw new Error(plan.refused);
      expect(plan.command).toMatch(/T3 Code.*\.exe$/);
      expect(plan.args[0]).toMatch(/bin\.mjs$/);
    });

    it("Given mixed-case environment keys, preserves T3 home and replaces flags once", () => {
      const shim = path.join(root, "t3.cmd");
      writeFileSync(shim, t3);
      const input = { t3code_home: "custom", electron_run_as_node: "0" };
      const plan = resolveSpawn(shim, [], input);
      expect(plan).not.toHaveProperty("refused");
      if ("refused" in plan) throw new Error(plan.refused);
      expect(plan.env.t3code_home).toBe("custom");
      expect(plan.env.ELECTRON_RUN_AS_NODE).toBe("1");
      expect(plan.env.electron_run_as_node).toBeUndefined();
      expect(input.electron_run_as_node).toBe("0");
    });

    it("Given no node on PATH, refuses; given a colocated node.exe, starts it directly", () => {
      const shim = path.join(root, "colocated.cmd");
      writeFileSync(shim, pnpm);
      expect(resolveSpawn(shim, [], {})).toEqual({ refused: "unknown_shim" });
      const local = path.join(root, "node.exe");
      linkSync(process.execPath, local);
      const plan = resolveSpawn(shim, ["%PATH%", 'a" & b'], {
        ARGV_OUTPUT: output,
      });
      expect(plan).not.toHaveProperty("refused");
      if ("refused" in plan) throw new Error(plan.refused);
      expect(plan.command).toBe(local);
      const child = spawnSync(plan.command, plan.args, {
        shell: false,
        env: plan.env,
        timeout: 10000,
      });
      expect(child.status).toBe(0);
      expect(JSON.parse(readFileSync(output, "utf8")).argv).toEqual([
        "%PATH%",
        'a" & b',
      ]);
      expect(existsSync(marker)).toBe(false);
    });
  },
);

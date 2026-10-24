import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  matchesGlob,
  parseCheck,
  readChecks,
  runChecks,
} from "./code-standards.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const checks = readChecks(
  readFileSync(path.join(root, "docs/agents/code-standards.md"), "utf8"),
);
const consoleCheck = checks.find((check) => check.line.includes("console"));
const ipcCheck = checks.find((check) => check.line.includes("ipcMain"));

/** Writes `files` into a new folder and runs `check` over them. */
function runOver(check, files) {
  const folder = mkdtempSync(path.join(os.tmpdir(), "ajour-standards-"));
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      writeFileSync(path.join(folder, file), text);
    }
    return runChecks(folder, [check], Object.keys(files))[0].matches;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test("reads every check the code standards list, the console and IPC ones among them", () => {
  assert.ok(checks.length >= 10);
  assert.ok(consoleCheck, "the console check");
  assert.ok(ipcCheck, "the raw IPC registration check");
  for (const searched of [
    "apps/api/src",
    "apps/desktop/electron",
    "apps/web/src",
    "packages",
  ]) {
    assert.ok(consoleCheck.paths.includes(searched), searched);
  }
});

test("the console check finds a call in any runtime, and keeps its two exceptions and the tests", () => {
  const matches = runOver(consoleCheck, {
    "apps/api/src/routes.ts": "console.log(request.url);\n",
    "apps/desktop/electron/main.cjs": "  console.warn('quit');\n",
    "apps/desktop/electron/preload.cjs": "console.error(error)\n",
    "apps/web/src/lib/local-store.ts": "const log = console.info;\n",
    "packages/shared/index.ts": "console.debug(value);\n",
    "apps/web/src/vite-env.d.ts": "// prints them in the devtools console.\n",
    "apps/api/src/standalone.ts": "console.error('listening');\n",
    "packages/wide-events/lib/sinks.ts": "console.log(line);\n",
    "apps/web/src/lib/local-store.test.ts": "console.log(state);\n",
    "apps/web/src/test-support/dom.tsx": "console.log(view);\n",
    "packages/wide-events/tests/fixtures.ts": "console.log(event);\n",
    "qa/ui/perf.mjs": "console.log(numbers);\n",
  });
  assert.deepEqual(matches, [
    "apps/api/src/routes.ts:1:console.log(request.url);",
    "apps/desktop/electron/main.cjs:1:console.warn('quit');",
    "apps/desktop/electron/preload.cjs:1:console.error(error)",
    "apps/web/src/lib/local-store.ts:1:const log = console.info;",
    "packages/shared/index.ts:1:console.debug(value);",
  ]);
});

test("the IPC check finds a channel registered outside the wrapper", () => {
  const matches = runOver(ipcCheck, {
    "apps/desktop/electron/main.cjs": [
      'ipc.handle("ajour:get-update-state", getState);',
      'ipcMain.handle("ajour:raw", () => null);',
      'ipcMain.on("ajour:raw-message", () => {});',
      'window.webContents.ipc.handle("ajour:raw-window", () => null);',
    ].join("\n"),
    "apps/desktop/electron/ipc-listeners.cjs":
      "ipcMain.handle(channel, (event, ...args) => call(event, args));\n",
  });
  assert.deepEqual(matches, [
    'apps/desktop/electron/main.cjs:2:ipcMain.handle("ajour:raw", () => null);',
    'apps/desktop/electron/main.cjs:3:ipcMain.on("ajour:raw-message", () => {});',
    'apps/desktop/electron/main.cjs:4:window.webContents.ipc.handle("ajour:raw-window", () => null);',
  ]);
});

test("reads globs as ripgrep does", () => {
  assert.equal(matchesGlob("apps/web/src/lib/a.test.ts", "*.test.*"), true);
  assert.equal(
    matchesGlob("apps/web/src/test-support/dom.tsx", "test-support"),
    true,
  );
  assert.equal(
    matchesGlob("apps/web/src/lib/contest-support.ts", "test-support"),
    false,
  );
  assert.equal(
    matchesGlob(
      "packages/wide-events/lib/sinks.ts",
      "packages/wide-events/lib/sinks.ts",
    ),
    true,
  );
  assert.equal(
    matchesGlob(
      "packages/wide-events/sinks.ts",
      "packages/wide-events/lib/sinks.ts",
    ),
    false,
  );
  assert.equal(matchesGlob("apps/web/src/a/b/c.ts", "apps/**/c.ts"), true);
});

test("refuses a command it can't run the way ripgrep would", () => {
  assert.throws(() => parseCheck("rg -n -i 'console' apps"), /doesn't know -i/);
  assert.throws(
    () => parseCheck("grep -n 'console' apps"),
    /Not an rg command/,
  );
  assert.throws(() => parseCheck("rg -n 'console'"), /pattern and a path/);
});

test("the repository passes every check", () => {
  const failed = runChecks(root, checks).filter(
    (result) => result.matches.length > 0,
  );
  assert.deepEqual(failed, []);
});

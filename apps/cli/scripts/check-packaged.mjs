import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const home = await mkdtemp(path.join(os.tmpdir(), "ajour-packaged-"));
try {
  const name = process.platform === "win32" ? "ajour.exe" : "ajour";
  const binary = path.join(home, name);
  await copyFile(new URL(`../out/${name}`, import.meta.url), binary);
  const invoke = (...args) => {
    const result = spawnSync(binary, args, {
      cwd: home,
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        AJOUR_URL: "http://127.0.0.1:0",
        AJOUR_TOKEN: "packaged-test",
        XDG_CONFIG_HOME: home,
        XDG_CACHE_HOME: home,
        XDG_STATE_HOME: home,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    assert.equal(result.stderr, "");
    return result.stdout;
  };
  assert.match(invoke("--help"), /Running entry/);
  assert.match(invoke("help", "log"), /EXIT STATUS/);
  for (const command of [
    "start",
    "stop",
    "discard",
    "continue",
    "status",
    "add",
    "edit",
    "move",
    "dup",
    "rm",
    "undo",
    "log",
    "projects",
    "connect",
    "completion",
    "help",
  ]) {
    assert.match(invoke(command, "--help"), /SYNOPSIS/);
    assert.match(invoke("help", command), /SYNOPSIS/);
  }
  const started = performance.now();
  assert.equal(invoke("__complete", "tasks"), "");
  assert.ok(
    performance.now() - started < 1600,
    "Completion exceeded its deadline",
  );
  console.log(
    "Packaged manual and offline completion passed outside the checkout",
  );
} finally {
  await rm(home, { recursive: true, force: true });
}

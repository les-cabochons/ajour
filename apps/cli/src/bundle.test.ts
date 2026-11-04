import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFile,
  mkdtemp,
  rm,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ajour, closeTerminals, projects } from "./test-support/terminal.ts";

afterEach(closeTerminals);

it("runs version and help from a lone bundle outside the checkout", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "ajour-bundle-"));
  const manDir = new URL("../dist/man/man1/", import.meta.url);
  const manPage = new URL("bundle-preservation-fixture.1", manDir);
  try {
    await mkdir(manDir, { recursive: true });
    await writeFile(manPage, "manual built before bundling");
    execFileSync(process.execPath, ["scripts/bundle.mjs"], {
      cwd: import.meta.dirname + "/..",
      env: { ...process.env, RELEASE_TAG: "" },
    });
    expect(await readFile(manPage, "utf8")).toBe(
      "manual built before bundling",
    );
    const file = path.join(home, "ajour.cjs");
    await copyFile(new URL("../dist/ajour.cjs", import.meta.url), file);
    const invoke = (...args: string[]) =>
      execFileSync(process.execPath, [file, ...args], {
        cwd: home,
        encoding: "utf8",
        env: {
          ...process.env,
          AJOUR_TOKEN: "bundle-test",
          AJOUR_URL: "http://127.0.0.1:0",
          XDG_CONFIG_HOME: home,
          XDG_CACHE_HOME: home,
        },
        timeout: 5000,
      });
    expect(invoke("--version")).toMatch(/^ajour \d+\.\d+\.\d+/);
    expect(invoke("--help")).toContain("ajour");
    expect(invoke("help", "log")).toContain("EXIT STATUS");
    expect(invoke("log", "--help")).toContain("ajour log");
    expect(invoke("__complete", "tasks")).toBe("");
    const term = await ajour({ list_projects: () => projects });
    const result = await promisify(execFile)(
      process.execPath,
      [file, "__complete", "tasks"],
      {
        cwd: home,
        env: { ...process.env, ...term.io.env, XDG_CACHE_HOME: term.home },
        timeout: 5000,
      },
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("ACME/05 Backend\0");
  } finally {
    await rm(manPage, { force: true });
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);

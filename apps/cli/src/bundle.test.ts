import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("runs version and help from a lone bundle outside the checkout", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "ajour-bundle-"));
  try {
    execFileSync(process.execPath, ["scripts/bundle.mjs"], {
      cwd: import.meta.dirname + "/..",
      env: { ...process.env, RELEASE_TAG: "" },
    });
    const file = path.join(home, "ajour.cjs");
    await copyFile(new URL("../dist/ajour.cjs", import.meta.url), file);
    const invoke = (arg: string) =>
      execFileSync(process.execPath, [file, arg], {
        cwd: home,
        encoding: "utf8",
        env: { ...process.env, AJOUR_TOKEN: "", XDG_CONFIG_HOME: home },
      });
    expect(invoke("--version")).toMatch(/^ajour \d+\.\d+\.\d+/);
    expect(invoke("--help")).toContain("ajour");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);

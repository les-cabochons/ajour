import { execFileSync } from "node:child_process";
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
import { expect, it } from "vitest";

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
    const invoke = (arg: string) =>
      execFileSync(process.execPath, [file, arg], {
        cwd: home,
        encoding: "utf8",
        env: { ...process.env, AJOUR_TOKEN: "", XDG_CONFIG_HOME: home },
      });
    expect(invoke("--version")).toMatch(/^ajour \d+\.\d+\.\d+/);
    expect(invoke("--help")).toContain("ajour");
  } finally {
    await rm(manPage, { force: true });
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);

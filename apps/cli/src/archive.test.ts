import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it.each([false, true])(
  "archives the binary with optional manual assets present: %s",
  async (manual) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-archive-"));
    try {
      await mkdir(path.join(root, "scripts"));
      await mkdir(path.join(root, "out"));
      await copyFile(
        new URL("../scripts/archive.mjs", import.meta.url),
        path.join(root, "scripts/archive.mjs"),
      );
      await writeFile(path.join(root, "package.json"), '{"version":"2.3.4"}');
      const binary = process.platform === "win32" ? "ajour.exe" : "ajour";
      await writeFile(path.join(root, "out", binary), "binary fixture");
      if (manual) {
        for (const dir of ["man", "completions"]) {
          await mkdir(path.join(root, "dist", dir), { recursive: true });
          await writeFile(
            path.join(root, "dist", dir, "fixture"),
            "manual fixture",
          );
        }
      }
      execFileSync(process.execPath, [path.join(root, "scripts/archive.mjs")], {
        env: { ...process.env, RELEASE_TAG: "" },
      });
      const osName = { win32: "windows", darwin: "macos", linux: "linux" }[
        process.platform as "win32" | "darwin" | "linux"
      ];
      const suffix = process.platform === "win32" ? "zip" : "tar.gz";
      const archive = path.join(
        root,
        "out/archives",
        `ajour-2.3.4-${osName}-${process.arch}.${suffix}`,
      );
      const entries = execFileSync("tar", ["-tf", archive], {
        encoding: "utf8",
      });
      expect(entries).toContain(binary);
      expect(entries.includes("man/fixture")).toBe(manual);
      expect(entries.includes("completions/fixture")).toBe(manual);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

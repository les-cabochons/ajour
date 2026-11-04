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
      await copyFile(process.execPath, path.join(root, "out", binary));
      const fixture = path.join(root, "completion.cjs");
      await writeFile(
        fixture,
        `if (process.argv[1]?.endsWith("completion")) { ${
          manual
            ? 'process.stdout.write("completion for " + process.argv[2]); process.exit(0);'
            : `process.stderr.write('Unknown command "completion"'); process.exit(2);`
        } }`,
      );
      if (manual) {
        for (const dir of ["man"]) {
          await mkdir(path.join(root, "dist", dir), { recursive: true });
          await writeFile(
            path.join(root, "dist", dir, "fixture"),
            "manual fixture",
          );
        }
      }
      execFileSync(process.execPath, [path.join(root, "scripts/archive.mjs")], {
        env: {
          ...process.env,
          RELEASE_TAG: "",
          NODE_OPTIONS: `--require="${fixture.replaceAll("\\", "/")}"`,
        },
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
      for (const file of ["ajour.bash", "_ajour", "ajour.fish"]) {
        expect(entries.includes(`completions/${file}`)).toBe(manual);
        if (manual)
          expect(
            execFileSync("tar", ["-xOf", archive, `./completions/${file}`], {
              encoding: "utf8",
            }),
          ).toContain("completion for");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);

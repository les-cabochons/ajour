import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const installer = await readFile(
  new URL("./installer/cli-command.nsh", import.meta.url),
  "utf8",
);

describe("Windows uninstall CLI cleanup", () => {
  it("only defines uninstaller functions during the uninstaller build", () => {
    const installerPass = installer.replace(
      /!ifdef BUILD_UNINSTALLER[\s\S]*?!endif/g,
      "",
    );
    expect(installerPass).not.toMatch(/^Function un\./m);
    expect(installer).toContain("!macro customUnInstall");
  });
  it("allowlists exactly every file the real archive packages", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "ajour-uninstall-layout-"),
    );
    try {
      // Generate the real manuals, then package the entire dist/man tree.
      // Unexpected files in dist/man must fail this contract too.
      execFileSync(process.execPath, [
        "--experimental-strip-types",
        "--no-warnings",
        fileURLToPath(new URL("../cli/scripts/build-man.ts", import.meta.url)),
      ]);
      await mkdir(path.join(root, "scripts"));
      await mkdir(path.join(root, "out"));
      await mkdir(path.join(root, "dist"));
      await copyFile(
        new URL("../cli/scripts/archive.mjs", import.meta.url),
        path.join(root, "scripts/archive.mjs"),
      );
      await cp(
        new URL("../cli/dist/man", import.meta.url),
        path.join(root, "dist/man"),
        { recursive: true },
      );
      await writeFile(path.join(root, "package.json"), '{"version":"2.3.4"}');
      const binary = process.platform === "win32" ? "ajour.exe" : "ajour";
      await copyFile(process.execPath, path.join(root, "out", binary));
      if (process.platform !== "win32")
        await chmod(path.join(root, "out", binary), 0o755);
      // Match archive.test.ts: Node stands in for the binary's completion command.
      const fixture = path.join(root, "completion.cjs");
      await writeFile(
        fixture,
        'if (process.argv[1]?.endsWith("completion")) { process.stdout.write("completion"); process.exit(0); }',
      );
      execFileSync(process.execPath, [path.join(root, "scripts/archive.mjs")], {
        env: {
          ...process.env,
          RELEASE_TAG: "",
          NODE_OPTIONS: `--require="${fixture.replaceAll("\\", "/")}"`,
        },
      });
      const osName =
        process.platform === "win32"
          ? "windows"
          : process.platform === "darwin"
            ? "macos"
            : "linux";
      const suffix = process.platform === "win32" ? "zip" : "tar.gz";
      const archive = path.join(
        root,
        "out/archives",
        `ajour-2.3.4-${osName}-${process.arch}.${suffix}`,
      );
      const packaged = execFileSync("tar", ["-tf", archive], {
        encoding: "utf8",
      })
        .split(/\r?\n/)
        .map((entry) => entry.replace(/^\.\//, ""))
        .filter((entry) => entry && !entry.endsWith("/"))
        .map((entry) => (entry === binary ? "ajour.exe" : entry));
      const docs = installer
        .split("!macro AjourArchiveDocs ROOT")[1]!
        .split("!macroend")[0]!;
      const payload = installer
        .split("!macro AjourPayload ROOT")[1]!
        .split("!macroend")[0]!;
      const deleted = [
        ...(docs + payload).matchAll(/Delete "\$\{ROOT\}\\([^"]+)"/g),
      ].map((match) => match[1]!.replaceAll("\\", "/"));
      expect(deleted.sort()).toEqual(packaged.sort());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    const controller = await readFile(
      new URL("./electron/cli-command.cjs", import.meta.url),
      "utf8",
    );
    expect(controller).toContain('path.join(unpacked, "share")');
    expect(controller).toContain(
      "path.join(unpacked, name), path.join(share, name)",
    );
  }, 30_000);

  it("never recursively deletes or passes a wildcard to deletion", () => {
    const deletions = installer
      .split(/\r?\n/)
      .filter((line) => /^\s*(Delete|RMDir)\b/.test(line));
    expect(deletions.length).toBeGreaterThan(20);
    for (const line of deletions) {
      expect(line).not.toMatch(/\s\/r\b|[*?]/i);
    }
    // Dynamic deletion uses enumerated entries after UUID or archive-name validation.
    expect(installer).toContain('StrCmpS $0 "ajour.exe.old-"');
    expect(installer).toContain('StrCmpS $0 ".staging-"');
    expect(installer).toContain('StrCmpS $0 ".pending-"');
    expect(installer).toContain("StrCmp $0 36 0 uuidDone");
    expect(installer).toContain('StrCpy $4 "0123456789abcdef" 1 $3');
    expect(installer).toContain('StrCmpS $2 "-" 0 uuidDone');
  });

  it("cleans PATH before file guards and protects every entered directory", () => {
    const cleanup = installer.split("Function un.RemoveAjourCommand")[1]!;
    expect(cleanup.indexOf("RegOpenKeyExW")).toBeLessThan(
      cleanup.indexOf("!insertmacro AjourSafeDirectory"),
    );
    expect(cleanup).not.toContain("IfFileExists");
    expect(installer).toContain("IntOp $9 $9 & 0x410");
    expect(installer).toContain("${If} $9 = 0x10");
    for (const folder of [
      "$R2\\Ajour",
      "$8",
      "$8\\$R4",
      "$8\\$R4\\unpacked",
      "${ROOT}\\share",
      "${ROOT}\\man",
      "${ROOT}\\man\\man1",
      "${ROOT}\\completions",
    ]) {
      expect(installer).toContain(
        `!insertmacro AjourSafeDirectory "${folder}"`,
      );
    }
    expect(installer).toContain("${IfNot} ${isUpdated}");
  });
});

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
const { binaryName } = (await import(
  new URL("../cli/scripts/archive.mjs", import.meta.url).href
)) as { binaryName: (platform: NodeJS.Platform) => string };

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
      const binary = binaryName(process.platform);
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
      const entries = execFileSync("tar", ["-tf", archive], {
        encoding: "utf8",
      })
        .split(/\r?\n/)
        .map((entry) => entry.replace(/^\.\//, ""))
        .filter((entry) => entry && !entry.endsWith("/"));
      // A platform's archive is the host's with archive.mjs's name for its
      // binary, the only entry that differs (#605).
      const packaged = (platform: NodeJS.Platform) =>
        entries
          .map((entry) => (entry === binary ? binaryName(platform) : entry))
          .sort();
      const macro = (name: string) =>
        installer
          .split(new RegExp(`!macro ${name} ROOT.*`))[1]!
          .split("!macroend")[0]!;
      /** What AjourPayload deletes in `folder`, with the binary it passes. */
      const deletedIn = (folder: string) => {
        const binaryIn = installer
          .split(`!insertmacro AjourPayload "${folder}" "`)[1]!
          .split('"')[0]!;
        return [
          ...(macro("AjourArchiveDocs") + macro("AjourPayload")).matchAll(
            /Delete "\$\{ROOT\}\\([^"]+)"/g,
          ),
        ]
          .map((match) =>
            match[1]!.replace("${BINARY}", binaryIn).replaceAll("\\", "/"),
          )
          .sort();
      };
      expect(deletedIn("$8")).toEqual(packaged("win32"));
      // bin\linux: the Linux binary, and the same share tree as bin.
      expect(deletedIn("$8\\linux")).toEqual(packaged("linux"));
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
      "$8\\linux",
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

  // The Linux build for WSL (#605). Distros aren't entered: their links stay.
  it("deletes bin\\linux and the Linux build's leftovers before the bin folder", () => {
    const cleanup = installer.split("Function un.RemoveAjourCommand")[1]!;
    const linux = cleanup.indexOf(
      '!insertmacro AjourPayload "$8\\linux" "ajour"',
    );
    expect(linux).toBeGreaterThan(-1);
    expect(cleanup.indexOf('RMDir "$8\\linux"')).toBeGreaterThan(linux);
    expect(cleanup.indexOf('RMDir "$8\\linux"')).toBeLessThan(
      cleanup.indexOf('RMDir "$8"'),
    );
    // linux.old-<uuid>, where a swap sets the previous build aside.
    const asideBlock = cleanup
      .split('StrCmpS $0 "linux.old-"')[1]!
      .split("Goto nextLeftover")[0]!;
    expect(asideBlock).toContain("Call un.AjourUuid");
    expect(asideBlock).toContain('!insertmacro AjourPayload "$8\\$R4" "ajour"');
    // .staging-<uuid>: the Linux archive, and its unpacked build, whose
    // share tree is the Windows build's.
    const unpacked = cleanup
      .split('!insertmacro AjourSafeDirectory "$8\\$R4\\unpacked"')[1]!
      .split('RMDir "$8\\$R4\\unpacked"')[0]!;
    expect(unpacked).toContain('Delete "$8\\$R4\\unpacked\\ajour"');
    expect(unpacked.match(/!insertmacro AjourPayload /g)).toHaveLength(1);
    const names = installer
      .split("Function un.AjourArchiveName")[1]!
      .split("FunctionEnd")[0]!;
    expect(names).toContain('"-linux-x64.tar.gz"');
    expect(cleanup).not.toMatch(/wsl/i);
  });
});

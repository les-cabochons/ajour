import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const installer = await readFile(
  new URL("./installer/cli-command.nsh", import.meta.url),
  "utf8",
);

describe("Windows uninstall CLI cleanup", () => {
  it("allowlists exactly the documentation and completions the archive installs", async () => {
    const pages = await readdir(new URL("../cli/docs/", import.meta.url));
    const man = pages
      .filter((file) => file.endsWith(".md"))
      .map((file) => {
        const name = file.slice(0, -3);
        return `man\\man1\\${name === "ajour" ? name : `ajour-${name}`}.1`;
      });
    const archive = await readFile(
      new URL("../cli/scripts/archive.mjs", import.meta.url),
      "utf8",
    );
    const completions = [
      ...archive.matchAll(/\["(?:bash|zsh|fish)", "([^"]+)"\]/g),
    ].map((match) => `completions\\${match[1]}`);
    expect(completions).toHaveLength(3);
    const allowlist = installer
      .split("!macro AjourArchiveDocs ROOT")[1]!
      .split("!macroend")[0]!;
    const deleted = [
      ...allowlist.matchAll(/Delete "\$\{ROOT\}\\([^"]+)"/g),
    ].map((match) => match[1]);
    expect(deleted.sort()).toEqual([...man, ...completions].sort());
    const controller = await readFile(
      new URL("./electron/cli-command.cjs", import.meta.url),
      "utf8",
    );
    expect(controller).toContain('path.join(unpacked, "share")');
    expect(controller).toContain(
      "path.join(unpacked, name), path.join(share, name)",
    );
  });

  it("never recursively deletes or passes a wildcard to deletion", () => {
    const deletions = installer
      .split(/\r?\n/)
      .filter((line) => /^\s*(Delete|RMDir)\b/.test(line));
    expect(deletions.length).toBeGreaterThan(20);
    for (const line of deletions) {
      expect(line).not.toMatch(/\s\/r\b|[*?]/i);
    }
    // Dynamic deletion only uses the enumerated entry after strict UUID checks.
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

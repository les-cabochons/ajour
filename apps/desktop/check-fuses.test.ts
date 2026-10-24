import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const checkFuses = require.resolve("./scripts/check-fuses.cjs");
const { electronFuses } = require("./electron-builder.config.cjs") as {
  electronFuses: Record<string, boolean>;
};

const SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
/** The fuse wire's order in Electron's binary. */
const WIRE_ORDER = [
  "runAsNode",
  "enableCookieEncryption",
  "enableNodeOptionsEnvironmentVariable",
  "enableNodeCliInspectArguments",
  "enableEmbeddedAsarIntegrityValidation",
  "onlyLoadAppFromAsar",
  "loadBrowserProcessSpecificV8Snapshot",
  "grantFileProtocolExtraPrivileges",
];
const ENABLED = "1".charCodeAt(0);
const DISABLED = "0".charCodeAt(0);
const INHERITED = 144;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-fuses-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** A file holding a fuse wire the way an Electron binary does. */
async function writeBinary(
  file: string,
  overrides: Record<string, number> = {},
) {
  const wire = WIRE_ORDER.map((fuse) => {
    if (fuse in overrides) return overrides[fuse]!;
    if (!(fuse in electronFuses)) return INHERITED;
    return electronFuses[fuse] ? ENABLED : DISABLED;
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    Buffer.concat([
      Buffer.from("leading bytes"),
      Buffer.from(SENTINEL),
      Buffer.from([1, wire.length, ...wire]),
      Buffer.from("trailing bytes"),
    ]),
  );
}

function run(args: string[]) {
  const result = spawnSync(process.execPath, [checkFuses, ...args], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("check-fuses", () => {
  it("passes when every packaged app has the configured fuses", async () => {
    const root = await temporaryDirectory();
    await writeBinary(path.join(root, "win-unpacked/Ajour.exe"));
    await writeBinary(
      path.join(
        root,
        "mac-arm64/Ajour.app/Contents/Frameworks/Electron Framework.framework/Electron Framework",
      ),
    );

    const result = run(["--out", root]);

    expect(result.output).toContain(path.join("win-unpacked", "Ajour.exe"));
    expect(result.output).toContain(path.join("mac-arm64", "Ajour.app"));
    expect(result.status).toBe(0);
  });

  it("fails and names the fuse when a packaged app differs", async () => {
    const root = await temporaryDirectory();
    await writeBinary(path.join(root, "win-unpacked/Ajour.exe"), {
      onlyLoadAppFromAsar: DISABLED,
    });

    const result = run(["--out", root]);

    expect(result.status).toBe(1);
    expect(result.output).toMatch(/onlyLoadAppFromAsar.*expected on.*off/);
  });

  it("fails when a configured fuse is left to Electron's default", async () => {
    const root = await temporaryDirectory();
    await writeBinary(path.join(root, "win-unpacked/Ajour.exe"), {
      enableNodeOptionsEnvironmentVariable: INHERITED,
    });

    const result = run(["--out", root]);

    expect(result.status).toBe(1);
    expect(result.output).toMatch(
      /enableNodeOptionsEnvironmentVariable.*expected off.*inherited/,
    );
  });

  it("fails when the output folder holds no packaged app", async () => {
    const root = await temporaryDirectory();

    const result = run(["--out", root]);

    expect(result.status).toBe(1);
    expect(result.output).toContain("No packaged app");
  });
});

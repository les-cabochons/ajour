import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { loadDesktopBootstrapLocalState } =
  require("./electron/local-state-bootstrap.cjs") as {
    loadDesktopBootstrapLocalState: (options: {
      appDataPath?: string;
      currentUserDataPath?: string;
    }) => Record<string, unknown> | null;
  };

let appDataPath: string;
let legacyLevelDb: string;

beforeEach(async () => {
  appDataPath = await mkdtemp(path.join(os.tmpdir(), "ajour-bootstrap-"));
  legacyLevelDb = path.join(
    appDataPath,
    "@ajour",
    "desktop",
    "Local Storage",
    "leveldb",
  );
});

afterEach(async () => {
  await rm(appDataPath, { recursive: true, force: true });
});

function load() {
  return loadDesktopBootstrapLocalState({
    appDataPath,
    currentUserDataPath: path.join(appDataPath, "Ajour"),
  });
}

describe("desktop bootstrap local state", () => {
  it("recovers the newest state from a legacy profile", async () => {
    await mkdir(legacyLevelDb, { recursive: true });
    await writeFile(
      path.join(legacyLevelDb, "000003.log"),
      'ajour.local-state.v2{"updatedAt":5,"projects":[]}',
    );

    expect(load()).toEqual({ updatedAt: 5, projects: [] });
  });

  it("recovers nothing when the legacy profile folder cannot be listed", async () => {
    await mkdir(path.dirname(legacyLevelDb), { recursive: true });
    await writeFile(legacyLevelDb, "not a folder");

    expect(load()).toBeNull();
  });

  it("recovers nothing when a legacy log cannot be read", async () => {
    await mkdir(path.join(legacyLevelDb, "000004.log"), { recursive: true });

    expect(load()).toBeNull();
  });
});

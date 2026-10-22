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
      report?: BootstrapReport;
    }) => Record<string, unknown> | null;
  };

/** What a read tells the local_state.recover event. */
interface BootstrapReport {
  source?: string;
  legacy_folder_count?: number;
  bytes_scanned?: number;
  record_counts?: Record<string, number>;
  error?: unknown;
}

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

function load(report?: BootstrapReport) {
  return loadDesktopBootstrapLocalState({
    appDataPath,
    currentUserDataPath: path.join(appDataPath, "Ajour"),
    report,
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

describe("what a bootstrap read reports", () => {
  it("says which source the state came from and how many legacy folders it scanned", async () => {
    await mkdir(legacyLevelDb, { recursive: true });
    await writeFile(
      path.join(legacyLevelDb, "000003.log"),
      'ajour.local-state.v2{"updatedAt":5,"projects":[]}',
    );
    const report: BootstrapReport = {};

    load(report);

    expect(report).toMatchObject({
      source: "legacy_profile",
      legacy_folder_count: 1,
    });
  });

  it("says when nothing was found", () => {
    const report: BootstrapReport = {};

    load(report);

    expect(report).toEqual({
      source: "none",
      legacy_folder_count: 0,
      bytes_scanned: 0,
      record_counts: {},
    });
  });

  it("keeps the error a failed read swallowed, for the event's scrubber", async () => {
    await mkdir(path.join(legacyLevelDb, "000004.log"), { recursive: true });
    const report: BootstrapReport = {};

    expect(load(report)).toBeNull();

    expect(report.error).toBeInstanceOf(Error);
  });

  it("counts the bytes it read and the records it found, never their content", async () => {
    const log =
      'ajour.local-state.v2{"updatedAt":5,"projects":[{"name":"Acme"},{"name":"Globex"}],"timeEntries":[{"note":"secret"}],"theme":"dark"}';
    await mkdir(legacyLevelDb, { recursive: true });
    await writeFile(path.join(legacyLevelDb, "000003.log"), log);
    const report: BootstrapReport = {};

    load(report);

    expect(report).toMatchObject({
      bytes_scanned: Buffer.byteLength(log),
      record_counts: { projects: 2, timeEntries: 1 },
    });
    expect(JSON.stringify(report)).not.toMatch(/Acme|secret/);
  });
});

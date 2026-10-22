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
      'ajour.local-state.v2{"updatedAt":5,"projects":[{"name":"Acme"},{"name":"Globex"}],"timesheetEntries":[{"note":"secret"}],"theme":"dark"}';
    await mkdir(legacyLevelDb, { recursive: true });
    await writeFile(path.join(legacyLevelDb, "000003.log"), log);
    const report: BootstrapReport = {};

    load(report);

    expect(report).toMatchObject({
      bytes_scanned: Buffer.byteLength(log),
      record_counts: { projects: 2, timesheetEntries: 1 },
    });
    expect(JSON.stringify(report)).not.toMatch(/Acme|secret/);
  });

  // A key is a name the file chose; only Ajour's own collections are counted.
  it("never counts a collection Ajour does not have", async () => {
    await mkdir(path.join(appDataPath, "Ajour"), { recursive: true });
    await writeFile(
      path.join(appDataPath, "Ajour", "local-state-recovery.json"),
      JSON.stringify({ updatedAt: 1, projects: [], SecretClient: [{}] }),
    );
    const report: BootstrapReport = {};

    load(report);

    expect(report.record_counts).toEqual({ projects: 0 });
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])(
    "knows every collection of the persisted local state, read with %s line endings",
    async (_name, newline) => {
      const { RECORD_COLLECTIONS } =
        require("./electron/local-state-bootstrap.cjs") as {
          RECORD_COLLECTIONS: readonly string[];
        };
      const { readFile } = await import("node:fs/promises");
      const source = (
        await readFile(
          new URL("../web/src/domain/local-state.ts", import.meta.url),
          "utf8",
        )
      ).replace(/\r?\n/gu, newline);

      expect([...RECORD_COLLECTIONS].sort()).toEqual(
        persistedCollections(source).sort(),
      );
    },
  );

  it("refuses a source whose LocalAppState it cannot find the end of", () => {
    expect(() =>
      persistedCollections(
        "export interface LocalAppState {\n  projects: X[];",
      ),
    ).toThrow("LocalAppState");
  });
});

/**
 * The array fields of `LocalAppState` in local-state.ts. Throws when the
 * interface or its end cannot be found, rather than read on past it.
 */
function persistedCollections(source: string) {
  const text = source.replace(/\r\n/gu, "\n");
  const start = text.indexOf("export interface LocalAppState {");
  const end = start < 0 ? -1 : text.indexOf("\n}\n", start);
  if (end < 0) {
    throw new Error("LocalAppState has no end in local-state.ts.");
  }
  const collections = [
    ...text.slice(start, end).matchAll(/^ {2}(\w+)\??: \w+\[\];$/gmu),
  ].map(([, name]) => name!);
  if (collections.length < 15) {
    throw new Error("LocalAppState lists fewer collections than expected.");
  }
  return collections;
}

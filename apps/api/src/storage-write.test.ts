import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppApiStorage } from "./storage.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const connection = (label: string) => ({
  label,
  tenantLabel: "Acme",
  autoSync: false,
  autoSyncIntervalMinutes: 15,
  config: { token: "pat-0a6c2e9f71b4d385" },
  configSummary: {},
});

describe("AppApiStorage writes", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    vi.mocked(rename).mockReset();
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(rename).mockImplementation(actual.rename);
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempStatePath() {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "ajour-storage-write-"),
    );
    tempDirs.push(tempDir);
    return { tempDir, statePath: path.join(tempDir, "app-api-state.json") };
  }

  it("leaves the last complete state file when a write stops before its rename", async () => {
    const { tempDir, statePath } = await tempStatePath();
    const storage = new AppApiStorage(statePath);
    await storage.upsertConnection("jira", connection("Before"));
    const before = await readFile(statePath, "utf8");

    // The process dies once the new state is written, before it replaces the file.
    vi.mocked(rename).mockRejectedValueOnce(
      Object.assign(new Error("Interrupted"), { code: "EIO" }),
    );
    await expect(
      storage.upsertConnection("jira", connection("After")),
    ).rejects.toThrow("Interrupted");

    await expect(readFile(statePath, "utf8")).resolves.toBe(before);
    const reloaded = new AppApiStorage(statePath);
    const overview = await reloaded.getPluginsOverview([]);
    expect(
      overview.connectionGroups.flatMap((group) =>
        group.connections.map((item) => item.label),
      ),
    ).toEqual(["Before"]);
    // No partial copy of the state is left beside it.
    await expect(readdir(tempDir)).resolves.toEqual(["app-api-state.json"]);
    // The storage that failed doesn't claim the state it couldn't save.
    const own = await storage.getPluginsOverview([]);
    expect(
      own.connectionGroups.flatMap((group) =>
        group.connections.map((item) => item.label),
      ),
    ).toEqual(["Before"]);
  });

  it("retries a rename the operating system refuses for a moment, as Windows does while the file is open", async () => {
    const { statePath } = await tempStatePath();
    const storage = new AppApiStorage(statePath);
    await storage.upsertConnection("jira", connection("Before"));

    vi.mocked(rename)
      .mockRejectedValueOnce(
        Object.assign(new Error("Busy"), { code: "EPERM" }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("Busy"), { code: "EBUSY" }),
      );
    await storage.upsertConnection("jira", connection("After"));

    const reloaded = new AppApiStorage(statePath);
    const overview = await reloaded.getPluginsOverview([]);
    expect(
      overview.connectionGroups.flatMap((group) =>
        group.connections.map((item) => item.label),
      ),
    ).toEqual(["After", "Before"]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps the state file readable only by its owner",
    async () => {
      const { statePath } = await tempStatePath();
      await new AppApiStorage(statePath).upsertConnection(
        "jira",
        connection("Before"),
      );
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    },
  );
});

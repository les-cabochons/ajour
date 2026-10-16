import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppApiStorage } from "./storage.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

describe("AppApiStorage first load", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    vi.mocked(readFile).mockReset();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("never lets a late first load replace state a mutation saved", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "ajour-storage-load-"),
    );
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    await new AppApiStorage(statePath).setPluginSystemEnabled(true);
    const actualReadFile = (
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      )
    ).readFile;

    // The first read sees the file before the turn-off, and returns only once
    // the turn-off has had every chance to finish.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(readFile)
      .mockImplementationOnce(async (...args) => {
        const contents = await actualReadFile(
          ...(args as Parameters<typeof actualReadFile>),
        );
        await held;
        return contents;
      })
      .mockImplementation((...args) =>
        actualReadFile(...(args as Parameters<typeof actualReadFile>)),
      );

    const storage = new AppApiStorage(statePath);
    const available = new Set(["github"]);
    const firstRead = storage.isPluginCapabilityEnabled(
      "github",
      "codeHost",
      available,
    );
    const turnOff = storage.setPluginCapabilityEnabled(
      "github",
      "codeHost",
      false,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await Promise.all([firstRead, turnOff]);

    await expect(
      storage.isPluginCapabilityEnabled("github", "codeHost", available),
    ).resolves.toBe(false);
  });
});

import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  clearDevelopmentPluginDirectories,
  loadDevelopmentPluginDirectories,
  normalizeDevelopmentPluginDirectories,
  saveDevelopmentPluginDirectories,
  selectDevelopmentPluginDirectory,
} = require("./electron/development-plugin-settings.cjs") as {
  clearDevelopmentPluginDirectories: (settingsPath: string) => void;
  loadDevelopmentPluginDirectories: (settingsPath: string) => string[] | null;
  normalizeDevelopmentPluginDirectories: (value: unknown) => string[];
  saveDevelopmentPluginDirectories: (
    settingsPath: string,
    directories: string[],
  ) => void;
  selectDevelopmentPluginDirectory: (
    dialog: { showOpenDialog: ReturnType<typeof vi.fn> },
    parentWindow: object,
    dependencies?: { stat: ReturnType<typeof vi.fn> },
  ) => Promise<string | null>;
};

describe("desktop development plugin settings", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("persists only normalized absolute plugin directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "harday-dev-plugin-"));
    tempDirs.push(root);
    const settingsPath = path.join(root, "settings", "plugins.json");
    const pluginDirectory = path.join(root, "plugin");

    saveDevelopmentPluginDirectories(settingsPath, [pluginDirectory]);
    expect(loadDevelopmentPluginDirectories(settingsPath)).toEqual([
      pluginDirectory,
    ]);

    clearDevelopmentPluginDirectories(settingsPath);
    expect(loadDevelopmentPluginDirectories(settingsPath)).toBeNull();
    expect(() => normalizeDevelopmentPluginDirectories(["relative/plugin"])).toThrow(
      "absolute paths",
    );
  });

  it("accepts one user-selected directory containing a plugin manifest", async () => {
    const parentWindow = {};
    const selectedDirectory = path.resolve(path.sep, "tmp", "example-plugin");
    const dialog = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: [selectedDirectory],
      }),
    };
    const stat = vi.fn().mockResolvedValue({ isFile: () => true });

    await expect(
      selectDevelopmentPluginDirectory(dialog, parentWindow, { stat }),
    ).resolves.toBe(selectedDirectory);
    expect(stat).toHaveBeenCalledWith(
      path.join(selectedDirectory, "plugin.json"),
    );
  });

  it("does not change settings when directory selection is cancelled", async () => {
    const dialog = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: true,
        filePaths: [],
      }),
    };

    await expect(
      selectDevelopmentPluginDirectory(dialog, {}),
    ).resolves.toBeNull();
  });
});

import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  loadPluginCatalogSettings,
  normalizePluginCatalogSettings,
  savePluginCatalogSettings,
} = require("./electron/plugin-catalog-settings.cjs") as {
  loadPluginCatalogSettings(file: string): { refreshMinutes: number };
  normalizePluginCatalogSettings(value: unknown): { refreshMinutes: number };
  savePluginCatalogSettings(file: string, value: unknown): { refreshMinutes: number };
};

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("plugin catalog settings", () => {
  it("defaults to a fifteen-minute refresh and accepts supported intervals", () => {
    expect(normalizePluginCatalogSettings(undefined)).toEqual({
      refreshMinutes: 15,
    });
    expect(normalizePluginCatalogSettings({ refreshMinutes: 60 })).toEqual({
      refreshMinutes: 60,
    });
    expect(normalizePluginCatalogSettings({ refreshMinutes: 7 })).toEqual({
      refreshMinutes: 15,
    });
  });

  it("persists the launch-only refresh choice", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-catalog-settings-"));
    tempDirectories.push(directory);
    const file = path.join(directory, "settings.json");

    expect(savePluginCatalogSettings(file, { refreshMinutes: 0 })).toEqual({
      refreshMinutes: 0,
    });
    expect(loadPluginCatalogSettings(file)).toEqual({ refreshMinutes: 0 });
  });
});

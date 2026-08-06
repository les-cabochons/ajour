import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

function loadBuilderConfig() {
  const configPath = require.resolve("./electron-builder.config.cjs");
  const packagePath = require.resolve("./package.json");
  delete require.cache[configPath];
  delete require.cache[packagePath];
  return require(configPath);
}

describe("desktop electron-builder config", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("builds NSIS updater artifacts without Squirrel packages", () => {
    const config = loadBuilderConfig();

    expect(config.appId).toBe("com.timetracker.harday");
    expect(config.electronVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.win.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
    expect(config.nsis).toMatchObject({
      artifactName: "HarDay-${version}-${arch}.${ext}",
      oneClick: true,
      perMachine: false,
    });
    expect(JSON.stringify(config)).not.toMatch(/squirrel|nupkg/i);
  });

  it("publishes stable builds on the latest update channel", () => {
    const config = loadBuilderConfig();

    expect(config.publish).toEqual([
      expect.objectContaining({
        provider: "github",
        owner: "les-cabochons",
        repo: "ajour",
        channel: "latest",
      }),
    ]);
    expect(config.mac.target).toEqual([
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] },
    ]);
    expect(config.mac.artifactName).toBe(
      "HarDay-${version}-${arch}.${ext}",
    );
  });

  it("publishes prereleases on the nightly update channel", () => {
    vi.stubEnv("HARDAY_UPDATE_CHANNEL", "nightly");

    const config = loadBuilderConfig();

    expect(config.publish[0].channel).toBe("nightly");
  });
});

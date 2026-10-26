import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

/** The commit fallback reads git; a source tree without git has none to read. */
const inGitCheckout =
  spawnSync("git", ["rev-parse", "HEAD"], { cwd: __dirname }).status === 0;

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

    expect(config.appId).toBe("com.lescabochons.ajour");
    expect(config.electronVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.win.target).toEqual([{ target: "nsis", arch: ["x64"] }]);
    expect(config.nsis).toMatchObject({
      artifactName: "Ajour-${version}-${arch}.${ext}",
      oneClick: true,
      perMachine: false,
    });
    expect(JSON.stringify(config)).not.toMatch(/squirrel|nupkg/i);
  });

  it("overrides the packaged package name, which names the Windows install folder", () => {
    const config = loadBuilderConfig();

    expect(config.extraMetadata.name).toBe("ajour");
  });

  it("keeps local builds on the configured release core", () => {
    // Release builds rewrite package.json from the tag, but local builds ship
    // this version as-is. A higher core than VERSION would look newer than
    // every published release and block switching tracks.
    const configuredVersion = readFileSync(
      path.resolve(__dirname, "../../VERSION"),
      "utf8",
    ).trim();

    expect(require("./package.json").version).toBe(configuredVersion);
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
    expect(config.mac.artifactName).toBe("Ajour-${version}-${arch}.${ext}");
  });

  // main.cjs reads it from the packaged package.json for the launch context.
  it("injects the build's commit into the packaged package.json", () => {
    vi.stubEnv(
      "AJOUR_BUILD_COMMIT",
      "0b3404ce0b3404ce0b3404ce0b3404ce0b3404ce",
    );

    expect(loadBuilderConfig().extraMetadata.buildCommit).toBe(
      "0b3404ce0b3404ce0b3404ce0b3404ce0b3404ce",
    );
  });

  it.skipIf(!inGitCheckout)(
    "takes the checked-out commit when the build names none (needs a git checkout)",
    () => {
      vi.stubEnv("AJOUR_BUILD_COMMIT", "");

      expect(loadBuilderConfig().extraMetadata.buildCommit).toMatch(
        /^[0-9a-f]{40}$/,
      );
    },
  );

  it("names no commit when the build names none outside a git checkout", () => {
    vi.stubEnv("AJOUR_BUILD_COMMIT", "");
    vi.stubEnv("PATH", "");
    vi.stubEnv("Path", "");

    expect(loadBuilderConfig().extraMetadata).not.toHaveProperty("buildCommit");
  });

  // Decided in #231. Run as Node stays on until Playwright MCP stops using
  // ELECTRON_RUN_AS_NODE; see the fuse comment in the config.
  it("flips the release fuses, with asar integrity", () => {
    const config = loadBuilderConfig();

    expect(config.asar).toBe(true);
    expect(config.electronFuses).toEqual({
      runAsNode: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      grantFileProtocolExtraPrivileges: false,
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
      resetAdHocDarwinSignature: true,
    });
  });

  it("publishes prereleases on the nightly update channel", () => {
    vi.stubEnv("AJOUR_UPDATE_CHANNEL", "nightly");

    const config = loadBuilderConfig();

    expect(config.publish[0].channel).toBe("nightly");
  });
});

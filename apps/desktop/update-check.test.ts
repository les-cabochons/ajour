import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  GITHUB_RELEASES_API_URL,
  checkForUpdates,
  isAllowedReleaseUrl,
  isUpdateAvailable,
  normalizeReleases,
  packageVersionForTag,
  selectLatestTrackRelease,
} = require("./electron/update-check.cjs") as {
  GITHUB_RELEASES_API_URL: string;
  checkForUpdates: (options: {
    track: "stable" | "nightly";
    currentVersion: string;
    fetchImpl: ReturnType<typeof vi.fn>;
    now?: () => number;
  }) => Promise<Record<string, unknown>>;
  isAllowedReleaseUrl: (value: unknown) => boolean;
  isUpdateAvailable: (
    currentVersion: string,
    latestRelease: Release,
    releases: Release[],
  ) => boolean;
  normalizeReleases: (value: unknown) => Release[];
  packageVersionForTag: (tag: string) => string | null;
  selectLatestTrackRelease: (
    releases: Release[],
    track: "stable" | "nightly",
  ) => Release | null;
};

interface Release {
  tagName: string;
  packageVersion: string;
  track: "stable" | "nightly";
  name: string;
  releaseUrl: string;
  publishedAt: string;
  publishedTimestamp: number;
}

function githubRelease(
  tag: string,
  publishedAt: string,
  prerelease = tag.includes("-nightly-"),
) {
  return {
    tag_name: tag,
    name: `HarDay ${tag}`,
    html_url: `https://github.com/les-cabochons/ajour/releases/tag/${tag}`,
    draft: false,
    prerelease,
    published_at: publishedAt,
  };
}

describe("desktop update checks", () => {
  it("maps stable and nightly tags to packaged versions", () => {
    expect(packageVersionForTag("v1.4.2")).toBe("1.4.2");
    expect(packageVersionForTag("v1.4.2-nightly-20260805.017")).toBe(
      "1.4.2-nightly-20260805-017",
    );
    expect(packageVersionForTag("unrelated-tag")).toBeNull();
  });

  it("selects the newest published release for the requested track", () => {
    const releases = normalizeReleases([
      githubRelease("v1.2.0-nightly-20260805.003", "2026-08-05T14:00:00Z"),
      githubRelease("v1.1.0", "2026-08-04T14:00:00Z", false),
      githubRelease("v1.2.0-nightly-20260805.004", "2026-08-05T15:00:00Z"),
      githubRelease("v1.0.0", "2026-08-01T14:00:00Z", false),
    ]);

    expect(selectLatestTrackRelease(releases, "stable")?.tagName).toBe("v1.1.0");
    expect(selectLatestTrackRelease(releases, "nightly")?.tagName).toBe(
      "v1.2.0-nightly-20260805.004",
    );
  });

  it("ignores drafts, mismatched prerelease flags, unsupported tags, and unsafe URLs", () => {
    expect(
      normalizeReleases([
        { ...githubRelease("v1.0.0", "2026-08-01T14:00:00Z", false), draft: true },
        githubRelease("v1.0.1", "2026-08-02T14:00:00Z", true),
        githubRelease("build-12", "2026-08-03T14:00:00Z", false),
        {
          ...githubRelease("v1.0.2", "2026-08-04T14:00:00Z", false),
          html_url: "https://example.com/releases/v1.0.2",
        },
      ]),
    ).toEqual([]);
    expect(isAllowedReleaseUrl("https://github.com/les-cabochons/ajour/releases/tag/v1.0.0")).toBe(true);
    expect(isAllowedReleaseUrl("https://github.com/other/repo/releases/tag/v1.0.0")).toBe(false);
  });

  it("uses publication order when switching between release tracks", () => {
    const releases = normalizeReleases([
      githubRelease("v1.0.0-nightly-20260806.002", "2026-08-06T14:00:00Z"),
      githubRelease("v1.0.0", "2026-08-05T14:00:00Z", false),
      githubRelease("v1.0.0-nightly-20260804.001", "2026-08-04T14:00:00Z"),
    ]);

    expect(isUpdateAvailable("1.0.0", releases[0]!, releases)).toBe(true);
    expect(isUpdateAvailable("1.0.0", releases[2]!, releases)).toBe(false);
    expect(isUpdateAvailable("1.0.0-nightly-20260804-001", releases[1]!, releases)).toBe(true);
  });

  it("checks GitHub releases and returns a renderer-safe result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        githubRelease("v1.3.0-nightly-20260805.009", "2026-08-05T18:00:00Z"),
      ]),
    });

    await expect(
      checkForUpdates({
        track: "nightly",
        currentVersion: "1.3.0-nightly-20260805-008",
        fetchImpl,
        now: () => Date.parse("2026-08-05T19:00:00Z"),
      }),
    ).resolves.toMatchObject({
      track: "nightly",
      currentVersion: "1.3.0-nightly-20260805-008",
      latestVersion: "1.3.0-nightly-20260805-009",
      latestTag: "v1.3.0-nightly-20260805.009",
      updateAvailable: true,
      checkedAt: "2026-08-05T19:00:00.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      GITHUB_RELEASES_API_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
        }),
      }),
    );
  });

  it("reports GitHub and empty-track failures clearly", async () => {
    await expect(
      checkForUpdates({
        track: "stable",
        currentVersion: "1.0.0",
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }),
      }),
    ).rejects.toThrow("GitHub release check failed (503)");

    await expect(
      checkForUpdates({
        track: "stable",
        currentVersion: "1.0.0",
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue([
            githubRelease("v1.0.1-nightly-20260805.001", "2026-08-05T18:00:00Z"),
          ]),
        }),
      }),
    ).rejects.toThrow("No published stable release is available");
  });
});

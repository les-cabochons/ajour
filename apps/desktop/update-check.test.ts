import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  GITHUB_LATEST_STABLE_API_URL,
  GITHUB_RELEASES_API_URL,
  checkForUpdates,
  createUpdateCheckCoordinator,
  isAllowedReleaseUrl,
  isUpdateAvailable,
  normalizeReleases,
  packageVersionForTag,
  selectLatestTrackRelease,
  tagForPackageVersion,
} = require("./electron/update-check.cjs") as {
  GITHUB_LATEST_STABLE_API_URL: string;
  GITHUB_RELEASES_API_URL: string;
  checkForUpdates: (options: {
    track: "stable" | "nightly";
    currentVersion: string;
    fetchImpl: ReturnType<typeof vi.fn>;
    now?: () => number;
  }) => Promise<Record<string, unknown>>;
  createUpdateCheckCoordinator: (options?: {
    checkForUpdatesImpl?: ReturnType<typeof vi.fn>;
    now?: () => number;
    successTtlMs?: number;
    failureTtlMs?: number;
  }) => (options: {
    track: "stable" | "nightly";
    currentVersion: string;
    fetchImpl?: ReturnType<typeof vi.fn>;
  }) => Promise<unknown>;
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
  tagForPackageVersion: (version: string) => string | null;
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
  prerelease = tag.includes("-nightly"),
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
    expect(packageVersionForTag("v1.4.2-nightly.20260805.17")).toBe(
      "1.4.2-nightly.20260805.17",
    );
    expect(packageVersionForTag("v1.4.2-nightly-20260805.017")).toBe(
      "1.4.2-nightly-20260805-017",
    );
    expect(packageVersionForTag("unrelated-tag")).toBeNull();
    expect(tagForPackageVersion("1.4.2")).toBe("v1.4.2");
    expect(tagForPackageVersion("1.4.2-nightly.20260805.17")).toBe(
      "v1.4.2-nightly.20260805.17",
    );
  });

  it("selects the highest release version even when builds publish out of order", () => {
    const releases = normalizeReleases([
      githubRelease("v1.2.0-nightly.20260805.3", "2026-08-05T16:00:00Z"),
      githubRelease("v1.1.0", "2026-08-05T17:00:00Z", false),
      githubRelease("v1.2.0-nightly.20260805.4", "2026-08-05T15:00:00Z"),
      githubRelease("v1.2.0", "2026-08-05T14:00:00Z", false),
    ]);

    expect(selectLatestTrackRelease(releases, "stable")?.tagName).toBe("v1.2.0");
    expect(selectLatestTrackRelease(releases, "nightly")?.tagName).toBe(
      "v1.2.0-nightly.20260805.4",
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
      githubRelease("v1.0.0-nightly.20260806.2", "2026-08-06T14:00:00Z"),
      githubRelease("v1.0.0", "2026-08-05T14:00:00Z", false),
      githubRelease("v1.0.0-nightly.20260804.1", "2026-08-04T14:00:00Z"),
    ]);

    expect(isUpdateAvailable("1.0.0", releases[0]!, releases)).toBe(true);
    expect(isUpdateAvailable("1.0.0", releases[2]!, releases)).toBe(false);
    expect(isUpdateAvailable("1.0.0-nightly.20260804.1", releases[1]!, releases)).toBe(true);
  });

  it("checks GitHub releases and returns a renderer-safe result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        githubRelease("v1.3.0-nightly.20260805.9", "2026-08-05T18:00:00Z"),
      ]),
    });

    await expect(
      checkForUpdates({
        track: "nightly",
        currentVersion: "1.3.0-nightly.20260805.8",
        fetchImpl,
        now: () => Date.parse("2026-08-05T19:00:00Z"),
      }),
    ).resolves.toMatchObject({
      track: "nightly",
      currentVersion: "1.3.0-nightly.20260805.8",
      latestVersion: "1.3.0-nightly.20260805.9",
      latestTag: "v1.3.0-nightly.20260805.9",
      updateAvailable: true,
      checkedAt: "2026-08-05T19:00:00.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      GITHUB_RELEASES_API_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("uses the unpaginated latest endpoint for stable releases", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(
        githubRelease("v2.1.0", "2026-08-05T18:00:00Z", false),
      ),
    });

    await expect(
      checkForUpdates({
        track: "stable",
        currentVersion: "2.0.0",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      latestVersion: "2.1.0",
      latestTag: "v2.1.0",
      updateAvailable: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      GITHUB_LATEST_STABLE_API_URL,
      expect.any(Object),
    );
  });

  it("looks up the installed release when cross-track ordering needs it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue([
          githubRelease("v1.0.0-nightly.20260806.11", "2026-08-06T18:00:00Z"),
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(
          githubRelease("v1.0.0", "2026-08-05T18:00:00Z", false),
        ),
      });

    await expect(
      checkForUpdates({
        track: "nightly",
        currentVersion: "1.0.0",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      latestTag: "v1.0.0-nightly.20260806.11",
      updateAvailable: true,
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/repos/les-cabochons/ajour/releases/tags/v1.0.0",
    );
  });

  it("coalesces in-flight checks and caches each track with failure backoff", async () => {
    let currentTime = 1_000;
    let resolveFirst: ((value: { latestTag: string }) => void) | undefined;
    const checkForUpdatesImpl = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ latestTag: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ latestTag: "v1.0.1" })
      .mockRejectedValue(new Error("offline"));
    const coordinatedCheck = createUpdateCheckCoordinator({
      checkForUpdatesImpl,
      now: () => currentTime,
      successTtlMs: 5_000,
      failureTtlMs: 1_000,
    });
    const stableOptions = {
      track: "stable" as const,
      currentVersion: "1.0.0",
    };

    const first = coordinatedCheck(stableOptions);
    const coalesced = coordinatedCheck(stableOptions);
    expect(coalesced).toBe(first);
    await Promise.resolve();
    expect(resolveFirst).toBeTypeOf("function");
    resolveFirst?.({ latestTag: "v1.0.0" });
    await expect(first).resolves.toEqual({ latestTag: "v1.0.0" });
    await expect(coordinatedCheck(stableOptions)).resolves.toEqual({
      latestTag: "v1.0.0",
    });
    expect(checkForUpdatesImpl).toHaveBeenCalledTimes(1);

    currentTime += 5_001;
    await expect(coordinatedCheck(stableOptions)).resolves.toEqual({
      latestTag: "v1.0.1",
    });
    await expect(
      coordinatedCheck({ track: "nightly", currentVersion: "1.0.0" }),
    ).rejects.toThrow("offline");
    await expect(
      coordinatedCheck({ track: "nightly", currentVersion: "1.0.0" }),
    ).rejects.toThrow("offline");
    expect(checkForUpdatesImpl).toHaveBeenCalledTimes(3);

    currentTime += 1_001;
    await expect(
      coordinatedCheck({ track: "nightly", currentVersion: "1.0.0" }),
    ).rejects.toThrow("offline");
    expect(checkForUpdatesImpl).toHaveBeenCalledTimes(4);
  });

  it("reports GitHub failures and an unpublished track clearly", async () => {
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
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 404 }),
      }),
    ).resolves.toMatchObject({
      track: "stable",
      currentVersion: "1.0.0",
      latestVersion: null,
      latestTag: null,
      updateAvailable: false,
    });

    await expect(
      checkForUpdates({
        track: "nightly",
        currentVersion: "1.0.0-nightly.20260805.1",
        fetchImpl: vi.fn().mockRejectedValue(
          Object.assign(new Error("aborted"), { name: "TimeoutError" }),
        ),
      }),
    ).rejects.toThrow("GitHub release check timed out");
  });
});

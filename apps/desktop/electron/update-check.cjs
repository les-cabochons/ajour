const GITHUB_REPOSITORY = "les-cabochons/ajour";
const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=100`;
const GITHUB_LATEST_STABLE_API_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;
const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const UPDATE_CHECK_CACHE_TTL_MS = 5 * 60_000;
const UPDATE_CHECK_FAILURE_TTL_MS = 30_000;
const STABLE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const NIGHTLY_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.([1-9]\d*)$/;
const LEGACY_NIGHTLY_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)-nightly-(\d{8})\.(\d{3,})$/;
const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const NIGHTLY_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.([1-9]\d*)$/;
const LEGACY_NIGHTLY_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)-nightly-(\d{8})-(\d{3,})$/;

function matchNightlyTag(tag) {
  return NIGHTLY_TAG_PATTERN.exec(tag) ?? LEGACY_NIGHTLY_TAG_PATTERN.exec(tag);
}

function matchNightlyVersion(version) {
  return NIGHTLY_VERSION_PATTERN.exec(version) ?? LEGACY_NIGHTLY_VERSION_PATTERN.exec(version);
}

function assertUpdateTrack(track) {
  if (track !== "stable" && track !== "nightly") {
    throw new Error("Update track must be stable or nightly.");
  }
}

function packageVersionForTag(tag) {
  const stable = STABLE_TAG_PATTERN.exec(tag);
  if (stable) {
    return `${stable[1]}.${stable[2]}.${stable[3]}`;
  }

  const nightly = NIGHTLY_TAG_PATTERN.exec(tag);
  if (nightly) {
    return tag.slice(1);
  }

  const legacyNightly = LEGACY_NIGHTLY_TAG_PATTERN.exec(tag);
  if (legacyNightly) {
    return `${legacyNightly[1]}.${legacyNightly[2]}.${legacyNightly[3]}-nightly-${legacyNightly[4]}-${legacyNightly[5]}`;
  }

  return null;
}

function tagForPackageVersion(version) {
  const stable = STABLE_VERSION_PATTERN.exec(version);
  if (stable) {
    return `v${version}`;
  }

  const nightly = NIGHTLY_VERSION_PATTERN.exec(version);
  if (nightly) {
    return `v${version}`;
  }

  const legacyNightly = LEGACY_NIGHTLY_VERSION_PATTERN.exec(version);
  if (legacyNightly) {
    return `v${legacyNightly[1]}.${legacyNightly[2]}.${legacyNightly[3]}-nightly-${legacyNightly[4]}.${legacyNightly[5]}`;
  }

  return null;
}

function releaseTrackForTag(tag) {
  if (STABLE_TAG_PATTERN.test(tag)) {
    return "stable";
  }
  if (matchNightlyTag(tag)) {
    return "nightly";
  }
  return null;
}

function isAllowedReleaseUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith(`/${GITHUB_REPOSITORY}/releases/`)
    );
  } catch {
    return false;
  }
}

function normalizeRelease(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const tagName = typeof value.tag_name === "string" ? value.tag_name : "";
  const track = releaseTrackForTag(tagName);
  const packageVersion = packageVersionForTag(tagName);
  const publishedAt = typeof value.published_at === "string" ? value.published_at : "";
  const publishedTimestamp = Date.parse(publishedAt);

  if (
    !track ||
    !packageVersion ||
    value.draft !== false ||
    value.prerelease !== (track === "nightly") ||
    !Number.isFinite(publishedTimestamp) ||
    !isAllowedReleaseUrl(value.html_url)
  ) {
    return null;
  }

  return {
    tagName,
    packageVersion,
    track,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim()
        : tagName,
    releaseUrl: value.html_url,
    publishedAt,
    publishedTimestamp,
  };
}

function normalizeReleases(value) {
  if (!Array.isArray(value)) {
    throw new Error("GitHub returned an invalid releases response.");
  }

  return value.map(normalizeRelease).filter(Boolean);
}

function selectLatestTrackRelease(releases, track) {
  assertUpdateTrack(track);
  return releases
    .filter((release) => release.track === track)
    .reduce((latest, release) => {
      if (!latest) {
        return release;
      }

      const versionComparison = comparePackageVersions(
        release.packageVersion,
        latest.packageVersion,
      );
      if (versionComparison !== 0) {
        return versionComparison > 0 ? release : latest;
      }

      return release.publishedTimestamp > latest.publishedTimestamp
        ? release
        : latest;
    }, null);
}

function parsePackageVersion(value) {
  const stable = STABLE_VERSION_PATTERN.exec(value);
  if (stable) {
    return {
      track: "stable",
      base: stable.slice(1).map(Number),
    };
  }

  const nightly = matchNightlyVersion(value);
  if (nightly) {
    return {
      track: "nightly",
      base: nightly.slice(1, 4).map(Number),
      date: Number(nightly[4]),
      build: Number(nightly[5]),
    };
  }

  return null;
}

function compareNumberParts(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function comparePackageVersions(leftVersion, rightVersion) {
  const left = parsePackageVersion(leftVersion);
  const right = parsePackageVersion(rightVersion);
  if (!left || !right || left.track !== right.track) {
    return 0;
  }

  const baseComparison = compareNumberParts(left.base, right.base);
  if (baseComparison !== 0 || left.track === "stable") {
    return baseComparison;
  }

  return compareNumberParts([left.date, left.build], [right.date, right.build]);
}

function isFallbackUpdateAvailable(currentVersion, latestRelease) {
  const current = parsePackageVersion(currentVersion);
  const latest = parsePackageVersion(latestRelease.packageVersion);
  if (!current || !latest) {
    return currentVersion !== latestRelease.packageVersion;
  }

  const baseComparison = compareNumberParts(latest.base, current.base);
  if (baseComparison !== 0) {
    return baseComparison > 0;
  }

  if (current.track !== latest.track) {
    return latest.track === "stable";
  }

  if (latest.track === "stable") {
    return false;
  }

  return (
    compareNumberParts(
      [latest.date, latest.build],
      [current.date, current.build],
    ) > 0
  );
}

function isUpdateAvailable(currentVersion, latestRelease, releases) {
  if (currentVersion === latestRelease.packageVersion) {
    return false;
  }

  const currentRelease = releases.find(
    (release) => release.packageVersion === currentVersion,
  );
  const current = parsePackageVersion(currentVersion);
  const latest = parsePackageVersion(latestRelease.packageVersion);
  if (current && latest && current.track === latest.track) {
    return comparePackageVersions(latestRelease.packageVersion, currentVersion) > 0;
  }
  if (currentRelease) {
    return latestRelease.publishedTimestamp > currentRelease.publishedTimestamp;
  }

  return isFallbackUpdateAvailable(currentVersion, latestRelease);
}

async function fetchGithubJson(fetchImpl, url, { allowNotFound = false } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new Error("GitHub release check timed out.");
    }
    throw error;
  }

  if (allowNotFound && response?.status === 404) {
    return null;
  }
  if (!response?.ok) {
    const status = typeof response?.status === "number" ? ` (${response.status})` : "";
    throw new Error(`GitHub release check failed${status}.`);
  }

  return await response.json();
}

async function fetchTrackReleases(fetchImpl, track) {
  if (track === "stable") {
    const value = await fetchGithubJson(fetchImpl, GITHUB_LATEST_STABLE_API_URL, {
      allowNotFound: true,
    });
    const release = normalizeRelease(value);
    return release?.track === "stable" ? [release] : [];
  }

  return normalizeReleases(
    await fetchGithubJson(fetchImpl, GITHUB_RELEASES_API_URL),
  );
}

async function fetchCurrentRelease(fetchImpl, currentVersion, releases) {
  const includedRelease = releases.find(
    (release) => release.packageVersion === currentVersion,
  );
  if (includedRelease) {
    return includedRelease;
  }

  const currentTag = tagForPackageVersion(currentVersion);
  if (!currentTag) {
    return null;
  }

  const value = await fetchGithubJson(
    fetchImpl,
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(currentTag)}`,
    { allowNotFound: true },
  );
  const release = normalizeRelease(value);
  return release?.packageVersion === currentVersion ? release : null;
}

async function checkForUpdates({ track, currentVersion, fetchImpl, now = Date.now }) {
  assertUpdateTrack(track);
  if (typeof currentVersion !== "string" || !currentVersion.trim()) {
    throw new Error("The running app version is unavailable.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Update checking is unavailable.");
  }

  const releases = await fetchTrackReleases(fetchImpl, track);
  const latestRelease = selectLatestTrackRelease(releases, track);
  if (!latestRelease) {
    return {
      track,
      currentVersion,
      latestVersion: null,
      latestTag: null,
      releaseName: null,
      releaseUrl: null,
      publishedAt: null,
      updateAvailable: false,
      checkedAt: new Date(now()).toISOString(),
    };
  }

  const current = parsePackageVersion(currentVersion);
  const latest = parsePackageVersion(latestRelease.packageVersion);
  if (current && latest && current.track !== latest.track) {
    const currentRelease = await fetchCurrentRelease(
      fetchImpl,
      currentVersion,
      releases,
    );
    if (currentRelease) {
      releases.push(currentRelease);
    }
  }

  return {
    track,
    currentVersion,
    latestVersion: latestRelease.packageVersion,
    latestTag: latestRelease.tagName,
    releaseName: latestRelease.name,
    releaseUrl: latestRelease.releaseUrl,
    publishedAt: latestRelease.publishedAt,
    updateAvailable: isUpdateAvailable(currentVersion, latestRelease, releases),
    checkedAt: new Date(now()).toISOString(),
  };
}

function createUpdateCheckCoordinator({
  checkForUpdatesImpl = checkForUpdates,
  now = Date.now,
  successTtlMs = UPDATE_CHECK_CACHE_TTL_MS,
  failureTtlMs = UPDATE_CHECK_FAILURE_TTL_MS,
} = {}) {
  const inFlight = new Map();
  const cache = new Map();

  return function checkForUpdatesCoordinated(options) {
    assertUpdateTrack(options?.track);
    const key = `${options.track}:${options.currentVersion}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      return cached.error
        ? Promise.reject(cached.error)
        : Promise.resolve(cached.result);
    }
    if (cached) {
      cache.delete(key);
    }

    const activeRequest = inFlight.get(key);
    if (activeRequest) {
      return activeRequest;
    }

    const request = Promise.resolve()
      .then(() => checkForUpdatesImpl(options))
      .then((result) => {
        cache.set(key, {
          result,
          expiresAt: now() + successTtlMs,
        });
        return result;
      })
      .catch((error) => {
        cache.set(key, {
          error,
          expiresAt: now() + failureTtlMs,
        });
        throw error;
      })
      .finally(() => {
        if (inFlight.get(key) === request) {
          inFlight.delete(key);
        }
      });

    inFlight.set(key, request);
    return request;
  };
}

module.exports = {
  GITHUB_LATEST_STABLE_API_URL,
  GITHUB_RELEASES_API_URL,
  checkForUpdates,
  comparePackageVersions,
  createUpdateCheckCoordinator,
  isAllowedReleaseUrl,
  isUpdateAvailable,
  normalizeReleases,
  packageVersionForTag,
  selectLatestTrackRelease,
  tagForPackageVersion,
};

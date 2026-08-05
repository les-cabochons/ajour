const GITHUB_REPOSITORY = "les-cabochons/ajour";
const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=100`;
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases/`;
const STABLE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const NIGHTLY_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)-nightly-(\d{8})\.(\d{3,})$/;
const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const NIGHTLY_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)-nightly-(\d{8})-(\d{3,})$/;

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
    return `${nightly[1]}.${nightly[2]}.${nightly[3]}-nightly-${nightly[4]}-${nightly[5]}`;
  }

  return null;
}

function releaseTrackForTag(tag) {
  if (STABLE_TAG_PATTERN.test(tag)) {
    return "stable";
  }
  if (NIGHTLY_TAG_PATTERN.test(tag)) {
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
  return (
    releases
      .filter((release) => release.track === track)
      .sort((left, right) => right.publishedTimestamp - left.publishedTimestamp)[0] ??
    null
  );
}

function parsePackageVersion(value) {
  const stable = STABLE_VERSION_PATTERN.exec(value);
  if (stable) {
    return {
      track: "stable",
      base: stable.slice(1).map(Number),
    };
  }

  const nightly = NIGHTLY_VERSION_PATTERN.exec(value);
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
  if (currentRelease) {
    return latestRelease.publishedTimestamp > currentRelease.publishedTimestamp;
  }

  return isFallbackUpdateAvailable(currentVersion, latestRelease);
}

async function checkForUpdates({ track, currentVersion, fetchImpl, now = Date.now }) {
  assertUpdateTrack(track);
  if (typeof currentVersion !== "string" || !currentVersion.trim()) {
    throw new Error("The running app version is unavailable.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Update checking is unavailable.");
  }

  const response = await fetchImpl(GITHUB_RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });

  if (!response?.ok) {
    const status = typeof response?.status === "number" ? ` (${response.status})` : "";
    throw new Error(`GitHub release check failed${status}.`);
  }

  const releases = normalizeReleases(await response.json());
  const latestRelease = selectLatestTrackRelease(releases, track);
  if (!latestRelease) {
    throw new Error(`No published ${track} release is available.`);
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

module.exports = {
  GITHUB_RELEASES_API_URL,
  checkForUpdates,
  isAllowedReleaseUrl,
  isUpdateAvailable,
  normalizeReleases,
  packageVersionForTag,
  selectLatestTrackRelease,
};

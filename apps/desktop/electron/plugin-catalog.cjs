const { randomUUID } = require("node:crypto");
const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");
const YAML = require("yaml");
const {
  BUILT_IN_PLUGIN_CATALOG_ENTRIES,
} = require("./plugin-catalog-seed.cjs");

const CATALOG_BASE_URL =
  "https://raw.githubusercontent.com/les-cabochons/ajour-plugins-index/main/";
const CATALOG_URL = new URL("catalog.yaml", CATALOG_BASE_URL).toString();
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_RELEASE_RESPONSE_BYTES = 2 * 1024 * 1024;
const RELEASES_PER_PAGE = 100;
const MAX_RELEASE_PAGES = 10;
const MAX_PLUGIN_ARCHIVE_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const CATALOG_ENTRY_PATH = /^plugins\/([a-z0-9][a-z0-9_-]*)\/plugin\.yaml$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REPOSITORY_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const IMAGE_PATH = /^(thumbnail|hero)\.(png|jpe?g|webp|avif)$/u;
const IMAGE_CONTENT_TYPES = {
  ".avif": "image/avif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertExactKeys(value, allowedKeys, requiredKeys, label) {
  const record = assertRecord(value, label);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label}.${key} is not supported.`);
    }
  }
  for (const key of requiredKeys) {
    if (!(key in record)) {
      throw new Error(`${label}.${key} is required.`);
    }
  }
  return record;
}

function assertString(value, label, options = {}) {
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? 500;
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    (options.pattern && !options.pattern.test(value))
  ) {
    throw new Error(`${label} has an invalid value.`);
  }
  return value;
}

function assertHttpsUrl(value, label) {
  const text = assertString(value, label);
  const url = new URL(text);
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  return url.toString();
}

const CATALOG_SCHEMA_VERSION = 2;
const PLUGIN_CAPABILITIES = new Set([
  "connector",
  "codeHost",
  "calendar",
  "team",
  "agentTask",
  "schema",
]);

function assertCapabilityList(value, id) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error(
      `Plugin "${id}" must declare between 1 and 3 capabilities.`,
    );
  }
  if (
    value.some((capability) => !PLUGIN_CAPABILITIES.has(capability)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`Plugin "${id}" declares an unsupported capability.`);
  }
  return [...value];
}

const RELEASE_VERSION_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

/** Parses "v1.2.3-main.10.abc1234" into numbers and prerelease identifiers. */
function parseReleaseVersion(tagName) {
  if (typeof tagName !== "string") {
    return null;
  }
  const match = RELEASE_VERSION_PATTERN.exec(tagName.trim());
  if (!match) {
    return null;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrereleaseIdentifiers(left, right) {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Semantic version precedence: negative when `left` is older. */
function compareReleaseVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left.core[index] - right.core[index];
    if (difference !== 0) {
      return difference;
    }
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const difference = comparePrereleaseIdentifiers(
      left.prerelease[index],
      right.prerelease[index],
    );
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** Newest version first; tags without a version last, in GitHub's order. */
function compareReleaseCandidates(left, right) {
  if (left.version && right.version) {
    return (
      compareReleaseVersions(right.version, left.version) ||
      left.index - right.index
    );
  }
  if (left.version || right.version) {
    return left.version ? -1 : 1;
  }
  return left.index - right.index;
}

function assertSlugList(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new Error(`${label} must contain between 1 and 12 values.`);
  }
  const values = value.map((item, index) =>
    assertString(item, `${label}[${index}]`, { maximum: 80, pattern: SLUG }),
  );
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicate values.`);
  }
  return values;
}

function normalizeNamedLink(value, label) {
  const record = assertExactKeys(
    value,
    ["name", "url"],
    ["name", "url"],
    label,
  );
  return {
    name: assertString(record.name, `${label}.name`, { maximum: 100 }),
    url: assertHttpsUrl(record.url, `${label}.url`),
  };
}

function normalizeCatalogEntry(value, expectedId) {
  const allowed = [
    "schemaVersion",
    "id",
    "title",
    "description",
    "author",
    "license",
    "website",
    "repository",
    "status",
    "compatibility",
    "capabilities",
    "features",
    "install",
    "images",
    "tags",
  ];
  const required = allowed.filter(
    (key) => key !== "install" && key !== "images",
  );
  const raw = assertExactKeys(value, allowed, required, `plugin ${expectedId}`);
  if (raw.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new Error(
      `Plugin "${expectedId}" uses an unsupported catalog schema.`,
    );
  }
  const id = assertString(raw.id, "plugin.id", {
    maximum: 64,
    pattern: /^[a-z0-9][a-z0-9_-]{1,63}$/u,
  });
  if (id !== expectedId) {
    throw new Error(
      `Plugin id "${id}" does not match catalog path "${expectedId}".`,
    );
  }
  const capabilities = assertCapabilityList(raw.capabilities, id);
  if (!["available", "coming-soon", "deprecated"].includes(raw.status)) {
    throw new Error(`Plugin "${id}" has an unsupported status.`);
  }

  const license = assertExactKeys(
    raw.license,
    ["name", "spdxId", "url"],
    ["name", "spdxId", "url"],
    "plugin.license",
  );
  const repository = assertExactKeys(
    raw.repository,
    ["provider", "slug", "url"],
    ["provider", "slug", "url"],
    "plugin.repository",
  );
  if (repository.provider !== "github") {
    throw new Error(`Plugin "${id}" must use a GitHub repository.`);
  }
  const repositorySlug = assertString(
    repository.slug,
    "plugin.repository.slug",
    {
      maximum: 200,
      pattern: REPOSITORY_SLUG,
    },
  );
  const repositoryUrl = assertHttpsUrl(repository.url, "plugin.repository.url");
  if (repositoryUrl !== `https://github.com/${repositorySlug}`) {
    throw new Error(`Plugin "${id}" repository URL does not match its slug.`);
  }

  const compatibility = assertExactKeys(
    raw.compatibility,
    ["pluginApiVersion"],
    ["pluginApiVersion"],
    "plugin.compatibility",
  );
  if (
    !Number.isInteger(compatibility.pluginApiVersion) ||
    compatibility.pluginApiVersion < 1
  ) {
    throw new Error(`Plugin "${id}" has an invalid API version.`);
  }

  let install;
  if (raw.install !== undefined) {
    const installRecord = assertExactKeys(
      raw.install,
      ["method", "allowPrereleases", "assetPattern"],
      ["method", "allowPrereleases", "assetPattern"],
      "plugin.install",
    );
    if (
      installRecord.method !== "github-release" ||
      typeof installRecord.allowPrereleases !== "boolean"
    ) {
      throw new Error(`Plugin "${id}" has an invalid install method.`);
    }
    const assetPattern = assertString(
      installRecord.assetPattern,
      "plugin.install.assetPattern",
      { minimum: 3, maximum: 200 },
    );
    if (!assetPattern.startsWith("^") || !assetPattern.endsWith("$")) {
      throw new Error(`Plugin "${id}" asset pattern must be anchored.`);
    }
    const compiledPattern = new RegExp(assetPattern, "u");
    if (compiledPattern.test("")) {
      throw new Error(
        `Plugin "${id}" asset pattern must not match an empty name.`,
      );
    }
    install = {
      method: "github-release",
      allowPrereleases: installRecord.allowPrereleases,
      assetPattern,
    };
  }
  if (raw.status === "available" && !install) {
    throw new Error(`Available plugin "${id}" is missing install metadata.`);
  }
  if (raw.status === "coming-soon" && install) {
    throw new Error(`Coming-soon plugin "${id}" must not be installable.`);
  }

  let imagePaths;
  if (raw.images !== undefined) {
    const images = assertExactKeys(
      raw.images,
      ["thumbnail", "hero"],
      [],
      "plugin.images",
    );
    imagePaths = {};
    for (const [role, imagePath] of Object.entries(images)) {
      imagePaths[role] = assertString(imagePath, `plugin.images.${role}`, {
        maximum: 100,
        pattern: IMAGE_PATH,
      });
    }
    if (Object.keys(imagePaths).length === 0) {
      throw new Error(`Plugin "${id}" image metadata is empty.`);
    }
  }

  return {
    entry: {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      id,
      title: assertString(raw.title, "plugin.title", { maximum: 80 }),
      description: assertString(raw.description, "plugin.description", {
        maximum: 500,
      }),
      author: normalizeNamedLink(raw.author, "plugin.author"),
      license: {
        name: assertString(license.name, "plugin.license.name", {
          maximum: 80,
        }),
        spdxId: assertString(license.spdxId, "plugin.license.spdxId", {
          maximum: 80,
          pattern: /^[A-Za-z0-9-.+]+$/u,
        }),
        url: assertHttpsUrl(license.url, "plugin.license.url"),
      },
      website: assertHttpsUrl(raw.website, "plugin.website"),
      repository: {
        provider: "github",
        slug: repositorySlug,
        url: repositoryUrl,
      },
      status: raw.status,
      compatibility: { pluginApiVersion: compatibility.pluginApiVersion },
      capabilities,
      features: assertSlugList(raw.features, "plugin.features"),
      ...(install ? { install } : {}),
      tags: assertSlugList(raw.tags, "plugin.tags"),
    },
    imagePaths,
  };
}

function parseCatalog(value) {
  const raw = assertExactKeys(
    value,
    ["schemaVersion", "entries"],
    ["schemaVersion", "entries"],
    "catalog",
  );
  if (
    raw.schemaVersion !== CATALOG_SCHEMA_VERSION ||
    !Array.isArray(raw.entries) ||
    raw.entries.length < 1
  ) {
    throw new Error("The plugin catalog has an unsupported schema.");
  }
  if (raw.entries.length > 256) {
    throw new Error("The plugin catalog contains too many entries.");
  }
  const seen = new Set();
  return raw.entries.map((entry, index) => {
    const text = assertString(entry, `catalog.entries[${index}]`, {
      maximum: 120,
    });
    const match = text.match(CATALOG_ENTRY_PATH);
    if (!match || seen.has(text)) {
      throw new Error(`Catalog entry "${text}" is invalid or duplicated.`);
    }
    seen.add(text);
    return { path: text, id: match[1] };
  });
}

async function readBoundedResponse(response, maximumBytes) {
  const contentLength = Number(response.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error(`Download exceeds the ${maximumBytes}-byte limit.`);
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new Error(`Download exceeds the ${maximumBytes}-byte limit.`);
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error(`Download exceeds the ${maximumBytes}-byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function conditionalHeaders(resource) {
  const headers = {};
  if (resource?.etag) headers["If-None-Match"] = resource.etag;
  if (resource?.lastModified)
    headers["If-Modified-Since"] = resource.lastModified;
  return headers;
}

async function fetchWithTimeout(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function atomicWrite(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, file);
}

async function loadCache(cacheFile) {
  try {
    const parsed = JSON.parse(await readFile(cacheFile, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.resources))
      return { resources: {} };
    return parsed;
  } catch {
    return { resources: {} };
  }
}

/** A plugin the catalog cannot offer this Ajour, which plugin.install records as `not_available`. */
function notAvailable(message) {
  return Object.assign(new Error(message), { code: "not_available" });
}

function createPluginCatalogService(options) {
  const fetchImpl = options.fetchImpl;
  const cacheDirectory = path.resolve(options.cacheDirectory);
  const cacheFile = path.join(cacheDirectory, "catalog-cache.json");
  const imageDirectory = path.join(cacheDirectory, "images");
  const now = options.now ?? (() => new Date());
  /** @type {Record<string, any>} */
  let currentCatalog = {
    entries: BUILT_IN_PLUGIN_CATALOG_ENTRIES,
    checkedAt: now().toISOString(),
    source: "cache",
    warning:
      "Showing the built-in plugin catalog until the Ajour plugin index can be refreshed.",
  };
  /** Whether the current catalog is still the built-in snapshot. */
  let builtIn = true;

  /**
   * Fetches the index (`counter` absent) or an entry's definition, and counts
   * what happened to the request in `stats`.
   */
  async function fetchText(url, cache, warnings, stats, counter) {
    const previous = cache.resources[url];
    try {
      const headers = conditionalHeaders(previous);
      if (!counter) stats.revalidated = Object.keys(headers).length > 0;
      const response = await fetchWithTimeout(fetchImpl, url, { headers });
      if (!counter) stats.status = response.status;
      if (response.status === 304 && typeof previous?.body === "string") {
        if (counter) stats[`${counter}_revalidated`] += 1;
        return previous.body;
      }
      if (!response.ok) {
        throw new Error(`Request returned HTTP ${response.status}.`);
      }
      const bytes = await readBoundedResponse(response, MAX_CATALOG_BYTES);
      stats.bytes += bytes.byteLength;
      const body = bytes.toString("utf8");
      cache.resources[url] = {
        body,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
      };
      if (counter) stats[`${counter}_fetched`] += 1;
      return body;
    } catch (error) {
      if (counter) stats[`${counter}_failed`] += 1;
      else delete stats.status;
      if (typeof previous?.body === "string") {
        warnings.push(
          `Using cached catalog metadata for ${url}: ${error.message}`,
        );
        return previous.body;
      }
      throw error;
    }
  }

  async function fetchImage(
    url,
    pluginId,
    role,
    imagePath,
    cache,
    warnings,
    stats,
  ) {
    const previous = cache.resources[url];
    const extension = path.extname(imagePath).toLowerCase();
    const contentType = IMAGE_CONTENT_TYPES[extension];
    const fileName = `${pluginId}-${role}${extension}`;
    const file = path.join(imageDirectory, fileName);
    let bytes;
    try {
      const response = await fetchWithTimeout(fetchImpl, url, {
        headers: conditionalHeaders(previous),
      });
      if (response.status === 304 && previous?.fileName === fileName) {
        bytes = await readFile(file);
        stats.images_revalidated += 1;
      } else {
        if (!response.ok) {
          throw new Error(`Request returned HTTP ${response.status}.`);
        }
        const responseType = response.headers
          .get("content-type")
          ?.split(";", 1)[0];
        if (responseType && responseType !== contentType) {
          throw new Error(
            `Image response used unexpected type ${responseType}.`,
          );
        }
        bytes = await readBoundedResponse(response, MAX_IMAGE_BYTES);
        stats.bytes += bytes.byteLength;
        await atomicWrite(file, bytes);
        cache.resources[url] = {
          fileName,
          contentType,
          etag: response.headers.get("etag") ?? undefined,
          lastModified: response.headers.get("last-modified") ?? undefined,
        };
        stats.images_fetched += 1;
      }
    } catch (error) {
      stats.images_failed += 1;
      if (previous?.fileName === fileName) {
        try {
          bytes = await readFile(file);
          warnings.push(
            `Using cached artwork for ${pluginId}: ${error.message}`,
          );
        } catch {
          throw error;
        }
      } else {
        throw error;
      }
    }
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`Artwork for ${pluginId} has an invalid size.`);
    }
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  }

  async function refreshFromNetwork(stats) {
    await mkdir(imageDirectory, { recursive: true });
    const cache = await loadCache(cacheFile);
    const warnings = [];
    const skippedPluginIds = [];
    const catalogText = await fetchText(CATALOG_URL, cache, warnings, stats);
    const catalogEntries = parseCatalog(
      YAML.parse(catalogText, {
        schema: "core",
        strict: true,
        uniqueKeys: true,
      }),
    );
    const entries = [];
    for (const catalogEntry of catalogEntries) {
      const definitionUrl = new URL(
        catalogEntry.path,
        CATALOG_BASE_URL,
      ).toString();
      const definitionText = await fetchText(
        definitionUrl,
        cache,
        warnings,
        stats,
        "definitions",
      );
      let normalized;
      try {
        normalized = normalizeCatalogEntry(
          YAML.parse(definitionText, {
            schema: "core",
            strict: true,
            uniqueKeys: true,
          }),
          catalogEntry.id,
        );
      } catch {
        // One entry this Ajour version cannot read, such as a newer
        // capability, must not hide the rest of the catalog. It is not a
        // cache fallback, so it stays out of the warnings; the refresh's
        // event lists it.
        skippedPluginIds.push(catalogEntry.id);
        continue;
      }
      const images = {};
      for (const [role, imagePath] of Object.entries(
        normalized.imagePaths ?? {},
      )) {
        const imageUrl = new URL(
          `${path.posix.dirname(catalogEntry.path)}/${imagePath}`,
          CATALOG_BASE_URL,
        ).toString();
        try {
          images[`${role}DataUrl`] = await fetchImage(
            imageUrl,
            normalized.entry.id,
            role,
            imagePath,
            cache,
            warnings,
            stats,
          );
        } catch (error) {
          warnings.push(
            `Artwork unavailable for ${normalized.entry.id}: ${error.message}`,
          );
        }
      }
      entries.push({
        ...normalized.entry,
        ...(Object.keys(images).length > 0 ? { images } : {}),
      });
    }
    const checkedAt = now().toISOString();
    await atomicWrite(
      cacheFile,
      JSON.stringify({ resources: cache.resources, checkedAt }, null, 2),
    );
    currentCatalog = {
      entries,
      checkedAt,
      source: warnings.length > 0 ? "cache" : "network",
      ...(warnings.length > 0
        ? { warning: warnings.join(" ").slice(0, 1_000) }
        : {}),
      ...(skippedPluginIds.length > 0
        ? { skippedPluginIds: skippedPluginIds.slice(0, 100) }
        : {}),
    };
    builtIn = false;
    return currentCatalog;
  }

  /**
   * Refreshes the catalog. Never rejects: a refresh that fails keeps the
   * current catalog, the cached one or the built-in snapshot. So `unit`, the
   * refresh's `catalog.refresh` event, gets its outcome here: what came from
   * the network, the cache and the snapshot, and the error when it failed.
   */
  /** @param {{ unit?: any }} [options] */
  async function refresh({ unit } = {}) {
    const stats = {
      bytes: 0,
      definitions_fetched: 0,
      definitions_revalidated: 0,
      definitions_failed: 0,
      images_fetched: 0,
      images_revalidated: 0,
      images_failed: 0,
    };
    const record = () =>
      unit?.set({
        catalog: {
          ...stats,
          source: builtIn
            ? "built_in"
            : currentCatalog.source === "network"
              ? "network"
              : "cache",
          entry_count: currentCatalog.entries.length,
          ...(currentCatalog.skippedPluginIds
            ? { skipped_plugin_ids: currentCatalog.skippedPluginIds }
            : {}),
        },
      });
    try {
      const catalog = await refreshFromNetwork(stats);
      record();
      return catalog;
    } catch (error) {
      unit?.fail(error);
      currentCatalog = {
        ...currentCatalog,
        checkedAt: now().toISOString(),
        source: "cache",
        warning:
          `The Ajour plugin index could not be refreshed. ${error.message}`.slice(
            0,
            1_000,
          ),
      };
      record();
      return currentCatalog;
    }
  }

  async function fetchJson(url) {
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Ajour-plugin-catalog",
      },
    });
    if (!response.ok) {
      throw new Error(
        `GitHub release lookup returned HTTP ${response.status}.`,
      );
    }
    return JSON.parse(
      (
        await readBoundedResponse(response, MAX_RELEASE_RESPONSE_BYTES)
      ).toString("utf8"),
    );
  }

  async function downloadPluginArchive(pluginId) {
    const catalog = currentCatalog ?? (await refresh());
    const entry = catalog.entries.find(
      (candidate) => candidate.id === pluginId,
    );
    if (!entry || entry.status !== "available" || !entry.install) {
      throw notAvailable(`Plugin "${pluginId}" is not available for download.`);
    }
    if (
      !entry.capabilities.includes("connector") &&
      !entry.capabilities.includes("codeHost") &&
      !entry.capabilities.includes("calendar") &&
      !entry.capabilities.includes("team") &&
      !entry.capabilities.includes("agentTask")
    ) {
      throw notAvailable(
        "This Ajour version cannot install packaged schema plugins yet.",
      );
    }
    const pattern = new RegExp(entry.install.assetPattern, "u");
    // GitHub lists releases by creation time, which follows build completion
    // order, not version order. Pick the highest version instead.
    const candidates = [];
    // Several plugins can publish from one repository, so the newest page may
    // hold none of this plugin's releases. Read older pages until one does.
    for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
      const releasesUrl = `https://api.github.com/repos/${entry.repository.slug}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`;
      const releases = await fetchJson(releasesUrl);
      if (!Array.isArray(releases)) {
        throw new Error("GitHub returned an invalid release list.");
      }
      releases.forEach((release, pageIndex) => {
        if (
          !isRecord(release) ||
          release.draft === true ||
          (release.prerelease === true && !entry.install.allowPrereleases) ||
          !Array.isArray(release.assets)
        ) {
          return;
        }
        const matchingAssets = release.assets.filter(
          (asset) =>
            isRecord(asset) &&
            typeof asset.name === "string" &&
            pattern.test(asset.name),
        );
        if (matchingAssets.length === 0) {
          return;
        }
        candidates.push({
          release,
          index: (page - 1) * RELEASES_PER_PAGE + pageIndex,
          matchingAssets,
          version: parseReleaseVersion(release.tag_name),
        });
      });
      if (candidates.length > 0 || releases.length < RELEASES_PER_PAGE) {
        break;
      }
    }
    candidates.sort(compareReleaseCandidates);
    const best = candidates[0];
    if (best && best.matchingAssets.length > 1) {
      throw new Error(
        `Release ${best.release.tag_name ?? "unknown"} has multiple matching plugin assets.`,
      );
    }
    const selectedAsset = best?.matchingAssets[0];
    if (!selectedAsset) {
      throw notAvailable(
        `No compatible release asset is available for ${entry.title}.`,
      );
    }
    const archiveFilename = assertString(
      selectedAsset.name,
      "release asset name",
      { maximum: 240 },
    );
    const downloadUrl = assertHttpsUrl(
      selectedAsset.browser_download_url,
      "release download URL",
    );
    const expectedPrefix = `https://github.com/${entry.repository.slug}/releases/download/`;
    if (!downloadUrl.startsWith(expectedPrefix)) {
      throw new Error("GitHub returned an unexpected plugin download URL.");
    }
    const response = await fetchWithTimeout(fetchImpl, downloadUrl, {
      headers: { "User-Agent": "Ajour-plugin-catalog" },
    });
    if (!response.ok) {
      throw new Error(`Plugin download returned HTTP ${response.status}.`);
    }
    const archiveBytes = await readBoundedResponse(
      response,
      MAX_PLUGIN_ARCHIVE_BYTES,
    );
    if (archiveBytes.byteLength < 1) {
      throw new Error("The downloaded plugin archive is empty.");
    }
    return { archiveBytes, archiveFilename, entry };
  }

  return {
    refresh,
    getCurrentCatalog: () => currentCatalog,
    downloadPluginArchive,
  };
}

module.exports = {
  CATALOG_URL,
  MAX_IMAGE_BYTES,
  MAX_PLUGIN_ARCHIVE_BYTES,
  createPluginCatalogService,
};

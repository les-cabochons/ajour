// The plugin catalog: every plugin the person's plugin sources list. The
// main process reads the sources (plugin-sources.cjs), keeps the last good
// listing of each on disk, and hands the renderer normalized entries.
const { createHash, randomUUID } = require("node:crypto");
const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const path = require("node:path");
const {
  BUILT_IN_PLUGIN_CATALOG_ENTRIES,
} = require("./plugin-catalog-seed.cjs");
const {
  BLOCKED_TRUST_STATES,
  OFFICIAL_SOURCE_PUBLIC_KEYS,
  assessSourceTrust,
  createPluginArchive,
  createSourceReader,
  isOfficialSourceUrl,
  keyFingerprint,
  normalizeSourceUrl,
  parseSourceManifest,
  parseSourceSignature,
  sourceParts,
  verifySourceSignature,
} = require("./plugin-sources.cjs");

const MAX_PLUGIN_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1_000_000;
const INSTALLABLE_CAPABILITIES = new Set([
  "connector",
  "codeHost",
  "calendar",
  "team",
  "agentTask",
]);
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|avif)$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const BLOCKED_MESSAGES = {
  key_changed:
    "This source is now signed with a different key. Check with its publisher before you approve the new key.",
  signature_missing:
    "This source used to be signed and its signature is gone. Its plugins are hidden until it is signed again.",
  bad_signature:
    "This source's signature does not match its listing. Its plugins are hidden.",
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    return isRecord(parsed) && isRecord(parsed.sources)
      ? parsed
      : { sources: {} };
  } catch {
    return { sources: {} };
  }
}

/** A plugin the catalog cannot offer this Ajour, which plugin.install records as `not_available`. */
function notAvailable(message) {
  return Object.assign(new Error(message), { code: "not_available" });
}

/** The plugin entry the renderer shows, from one plugin of a listing. */
function catalogEntry(source, listing, plugin, images) {
  const { repoPath } = sourceParts(source.url);
  return {
    id: plugin.id,
    title: plugin.name,
    description: plugin.description,
    version: plugin.version,
    author: plugin.author,
    license: plugin.license,
    ...(plugin.website ? { website: plugin.website } : {}),
    repository: { slug: repoPath, url: source.url },
    source: {
      url: source.url,
      name: listing.manifest.name,
      official: isOfficialSourceUrl(source.url),
      signed: listing.trust.signed,
      ...(listing.trust.fingerprint
        ? { keyFingerprint: listing.trust.fingerprint }
        : {}),
    },
    status: plugin.status,
    compatibility: { pluginApiVersion: plugin.pluginApiVersion },
    capabilities: plugin.capabilities,
    features: plugin.features,
    tags: plugin.tags,
    ...(plugin.status !== "coming-soon" && plugin.files
      ? { install: { method: "source" } }
      : {}),
    ...(Object.keys(images).length > 0 ? { images } : {}),
  };
}

/**
 * @param {{
 *   fetchImpl: typeof fetch,
 *   cacheDirectory: string,
 *   getSources: () => Array<{ url: string, hostKind?: string, publicKey?: string }>,
 *   onHostKind?: (url: string, hostKind: string) => void,
 *   officialKeys?: readonly string[],
 *   now?: () => Date,
 * }} options
 */
function createPluginCatalogService(options) {
  const reader = createSourceReader({ fetchImpl: options.fetchImpl });
  const cacheDirectory = path.resolve(options.cacheDirectory);
  const cacheFile = path.join(cacheDirectory, "sources-cache.json");
  const imageDirectory = path.join(cacheDirectory, "images");
  const officialKeys = options.officialKeys ?? OFFICIAL_SOURCE_PUBLIC_KEYS;
  const now = options.now ?? (() => new Date());
  /** @type {Record<string, any>} */
  let currentCatalog = {
    entries: BUILT_IN_PLUGIN_CATALOG_ENTRIES,
    sources: [],
    checkedAt: now().toISOString(),
    source: "cache",
    warning:
      "Showing the built-in plugin list until Ajour can read your plugin sources.",
  };
  /** Whether the current catalog is still the built-in snapshot. */
  let builtIn = true;
  /** The listings of the last refresh, by source URL, for downloads. */
  let listings = new Map();

  function trustOf(source, manifestBytes, signatureBytes) {
    return assessSourceTrust({
      manifestBytes,
      signatureBytes,
      pinnedPublicKey: source.publicKey,
      official: isOfficialSourceUrl(source.url),
      officialKeys,
    });
  }

  async function hostKindOf(source) {
    if (source.hostKind) return source.hostKind;
    const hostKind = await reader.detectHostKind(source.url);
    options.onHostKind?.(source.url, hostKind);
    return hostKind;
  }

  /** Artwork from the image cache by hash, or the source, checked either way. */
  async function imageDataUrl(source, plugin, role, stats) {
    const image = plugin.images?.[role];
    if (!image || !SHA256.test(image.sha256)) return undefined;
    const extension = (
      image.path.match(IMAGE_EXTENSION)?.[0] ?? ""
    ).toLowerCase();
    const file = path.join(imageDirectory, `${image.sha256}${extension}`);
    try {
      const cached = await readFile(file);
      if (
        cached.byteLength === image.size &&
        cached.byteLength <= MAX_IMAGE_BYTES &&
        createHash("sha256").update(cached).digest("hex") === image.sha256
      ) {
        stats.images_cached += 1;
        const type = extension === ".jpg" ? ".jpeg" : extension;
        return `data:image/${type.slice(1)};base64,${cached.toString("base64")}`;
      }
    } catch {
      // Not cached yet.
    }
    const dataUrl = await reader.readImage(source, plugin, role);
    stats.images_fetched += 1;
    await atomicWrite(
      file,
      Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
    );
    return dataUrl;
  }

  /**
   * Reads one source, or its saved listing when it is unreachable, and how
   * far Ajour trusts it.
   * @returns {Promise<{ status: Record<string, any>, listing?: any, hostKind?: string }>}
   */
  async function readSource(source, cache, stats, warnings) {
    let hostKind;
    let manifestBytes;
    let signatureBytes;
    try {
      hostKind = await hostKindOf(source);
      ({ manifestBytes, signatureBytes } = await reader.readListing({
        url: source.url,
        hostKind,
      }));
      stats.sources_read += 1;
      stats.bytes +=
        manifestBytes.byteLength + (signatureBytes?.byteLength ?? 0);
      cache.sources[source.url] = {
        hostKind,
        manifest: manifestBytes.toString("base64"),
        ...(signatureBytes
          ? { signature: signatureBytes.toString("base64") }
          : {}),
      };
    } catch (error) {
      const cached = cache.sources[source.url];
      if (!isRecord(cached) || typeof cached.manifest !== "string") {
        stats.sources_unreachable += 1;
        return { status: { state: "unreachable", message: error.message } };
      }
      stats.sources_cached += 1;
      warnings.push(
        `Using the saved listing of ${source.url}: ${error.message}`,
      );
      hostKind = source.hostKind ?? cached.hostKind;
      manifestBytes = Buffer.from(cached.manifest, "base64");
      signatureBytes =
        typeof cached.signature === "string"
          ? Buffer.from(cached.signature, "base64")
          : null;
    }

    // A cached listing goes through the same checks as a fresh one.
    const trust = trustOf(source, manifestBytes, signatureBytes);
    if (BLOCKED_TRUST_STATES.has(trust.state)) {
      stats.sources_blocked += 1;
      return {
        status: {
          state: trust.state,
          hostKind,
          ...(trust.fingerprint ? { keyFingerprint: trust.fingerprint } : {}),
          message: BLOCKED_MESSAGES[trust.state],
        },
      };
    }
    let manifest;
    try {
      manifest = parseSourceManifest(manifestBytes, {
        skipInvalidPlugins: true,
      });
    } catch (error) {
      stats.sources_unreachable += 1;
      return {
        status: {
          state: "unreachable",
          hostKind,
          message: `Its ajour.json can't be read. ${error.message}`,
        },
      };
    }
    stats[trust.signed ? "sources_signed" : "sources_unsigned"] += 1;
    return {
      hostKind,
      listing: { manifest, trust, hostKind },
      status: {
        state: trust.state,
        name: manifest.name,
        hostKind,
        ...(trust.fingerprint ? { keyFingerprint: trust.fingerprint } : {}),
      },
    };
  }

  async function refreshFromNetwork(stats) {
    await mkdir(imageDirectory, { recursive: true });
    const cache = await loadCache(cacheFile);
    const warnings = [];
    const skippedPluginIds = [];
    const entries = [];
    const statuses = [];
    const nextListings = new Map();
    const configured = options.getSources();
    stats.sources_total = configured.length;

    for (const source of configured) {
      const official = isOfficialSourceUrl(source.url);
      const read = await readSource(source, cache, stats, warnings);
      const approvedKeyFingerprint = source.publicKey
        ? keyFingerprint(Buffer.from(source.publicKey, "base64"))
        : undefined;
      let pluginCount = 0;
      if (!read.listing && official && read.status.state === "unreachable") {
        // Until the official source was read once, show what Ajour ships with.
        for (const entry of BUILT_IN_PLUGIN_CATALOG_ENTRIES) {
          if (!entries.some((candidate) => candidate.id === entry.id)) {
            entries.push(entry);
            pluginCount += 1;
          }
        }
        warnings.push(
          "Showing the built-in list of the official plugins until Ajour can read their source.",
        );
      }
      if (read.listing) {
        nextListings.set(source.url, read.listing);
        skippedPluginIds.push(...read.listing.manifest.skippedPluginIds);
        for (const plugin of read.listing.manifest.plugins) {
          // The first source that lists an id wins; the person orders sources.
          if (entries.some((entry) => entry.id === plugin.id)) {
            skippedPluginIds.push(plugin.id);
            continue;
          }
          const images = {};
          for (const role of ["thumbnail", "hero"]) {
            try {
              const dataUrl = await imageDataUrl(
                { url: source.url, hostKind: read.hostKind },
                plugin,
                role,
                stats,
              );
              if (dataUrl) images[`${role}DataUrl`] = dataUrl;
            } catch (error) {
              stats.images_failed += 1;
              warnings.push(
                `Artwork unavailable for ${plugin.id}: ${error.message}`,
              );
            }
          }
          entries.push(catalogEntry(source, read.listing, plugin, images));
          pluginCount += 1;
        }
      }
      statuses.push({
        url: source.url,
        official,
        pluginCount,
        ...read.status,
        ...(approvedKeyFingerprint &&
        approvedKeyFingerprint !== read.status.keyFingerprint
          ? { approvedKeyFingerprint }
          : {}),
        ...(read.status.message
          ? { message: read.status.message.slice(0, 500) }
          : {}),
      });
    }

    if (
      configured.length > 0 &&
      stats.sources_read + stats.sources_cached + stats.sources_blocked === 0
    ) {
      // Nothing read and nothing saved: keep what the catalog showed.
      throw Object.assign(
        new Error(
          statuses.find((status) => status.message)?.message ??
            "No plugin source could be read.",
        ),
        { statuses },
      );
    }

    const checkedAt = now().toISOString();
    // Only listings of sources still configured stay cached.
    const keptSources = Object.fromEntries(
      Object.entries(cache.sources).filter(([url]) =>
        configured.some((source) => source.url === url),
      ),
    );
    await atomicWrite(
      cacheFile,
      JSON.stringify({ sources: keptSources, checkedAt }, null, 2),
    );
    listings = nextListings;
    const usedCache = warnings.length > 0;
    currentCatalog = {
      entries,
      sources: statuses,
      checkedAt,
      source: usedCache ? "cache" : "network",
      ...(usedCache ? { warning: warnings.join(" ").slice(0, 1_000) } : {}),
      ...(skippedPluginIds.length > 0
        ? { skippedPluginIds: [...new Set(skippedPluginIds)].slice(0, 100) }
        : {}),
    };
    builtIn = false;
    return currentCatalog;
  }

  /**
   * Refreshes the catalog from every source. Never rejects: a refresh that
   * fails keeps the current catalog or the built-in snapshot. `unit`, the
   * refresh's `catalog.refresh` event, gets its outcome here.
   */
  /** @param {{ unit?: any }} [refreshOptions] */
  async function refresh({ unit } = {}) {
    const stats = {
      bytes: 0,
      sources_total: 0,
      sources_read: 0,
      sources_cached: 0,
      sources_unreachable: 0,
      sources_signed: 0,
      sources_unsigned: 0,
      sources_blocked: 0,
      images_fetched: 0,
      images_cached: 0,
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
        ...(Array.isArray(error?.statuses) ? { sources: error.statuses } : {}),
        checkedAt: now().toISOString(),
        source: "cache",
        warning:
          `Ajour could not read the plugin sources. ${error.message}`.slice(
            0,
            1_000,
          ),
      };
      record();
      return currentCatalog;
    }
  }

  /**
   * Reads a source before it is added, so the person sees its name, its
   * plugins and the key that signs it. `publicKey` stays in the main process.
   */
  async function inspectSource(input) {
    const url = normalizeSourceUrl(input);
    const official = isOfficialSourceUrl(url);
    const configured = options
      .getSources()
      .find((source) => source.url === url);
    const hostKind = await hostKindOf({ url, hostKind: configured?.hostKind });
    const { manifestBytes, signatureBytes } = await reader.readListing({
      url,
      hostKind,
    });
    const manifest = parseSourceManifest(manifestBytes, {
      skipInvalidPlugins: true,
    });
    let publicKey;
    let fingerprint;
    if (signatureBytes) {
      const signature = parseSourceSignature(signatureBytes);
      if (!verifySourceSignature(manifestBytes, signature)) {
        throw new Error(
          "This source's signature does not match its listing. Don't add it.",
        );
      }
      publicKey = signature.publicKey.toString("base64");
      fingerprint = keyFingerprint(signature.publicKey);
      if (
        official &&
        officialKeys.length > 0 &&
        !officialKeys.includes(publicKey)
      ) {
        throw new Error(
          "The official source is signed with a key this Ajour does not know. Don't add it.",
        );
      }
    }
    return {
      url,
      name: manifest.name,
      official,
      hostKind,
      signed: Boolean(publicKey),
      ...(fingerprint ? { keyFingerprint: fingerprint } : {}),
      publicKey,
      plugins: manifest.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
      })),
      alreadyAdded: Boolean(configured),
    };
  }

  /**
   * Downloads a plugin from the source that lists it, at the commit the
   * listing names, checks every file, and packs them for the installer.
   * `origin` is what the API records, so the person can tell signed from
   * unsigned later.
   */
  async function downloadPluginArchive(pluginId, sourceUrl) {
    const entry = currentCatalog.entries.find(
      (candidate) =>
        candidate.id === pluginId &&
        (sourceUrl === undefined || candidate.source.url === sourceUrl),
    );
    if (!entry || entry.status !== "available" || !entry.install) {
      throw notAvailable(`Plugin "${pluginId}" is not available for download.`);
    }
    if (
      !entry.capabilities.some((capability) =>
        INSTALLABLE_CAPABILITIES.has(capability),
      )
    ) {
      throw notAvailable(
        "This Ajour version cannot install packaged schema plugins yet.",
      );
    }
    const listing = listings.get(entry.source.url);
    const plugin = listing?.manifest.plugins.find(
      (candidate) => candidate.id === pluginId,
    );
    if (!listing || !plugin?.files) {
      throw notAvailable(
        `Ajour has not read ${entry.title}'s source yet. Refresh and try again.`,
      );
    }
    const source = { url: entry.source.url, hostKind: listing.hostKind };
    const files = await reader.readPluginFiles(source, plugin);
    const manifestFile = files.find((file) => file.path === "plugin.json");
    let manifest;
    try {
      manifest = JSON.parse(manifestFile.bytes.toString("utf8"));
    } catch {
      throw new Error(`${entry.title}'s plugin.json is not valid JSON.`);
    }
    if (manifest?.id !== plugin.id || manifest?.version !== plugin.version) {
      throw new Error(
        `${entry.title}'s plugin.json does not match its listing in ajour.json.`,
      );
    }
    const archiveBytes = createPluginArchive(files);
    if (archiveBytes.byteLength > MAX_PLUGIN_ARCHIVE_BYTES) {
      throw new Error(`${entry.title} is larger than Ajour installs.`);
    }
    return {
      archiveBytes,
      archiveFilename: `${plugin.id}-${plugin.version}.ajour-connector`,
      entry,
      signed: listing.trust.signed,
      origin: {
        kind: "source",
        signed: listing.trust.signed,
        sourceUrl: entry.source.url,
        sourceName: listing.manifest.name,
        official: isOfficialSourceUrl(entry.source.url),
        ...(listing.trust.signed && listing.trust.fingerprint
          ? { keyFingerprint: listing.trust.fingerprint }
          : {}),
        commit: plugin.commit,
        installedAt: now().toISOString(),
      },
    };
  }

  return {
    refresh,
    getCurrentCatalog: () => currentCatalog,
    inspectSource,
    downloadPluginArchive,
  };
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_PLUGIN_ARCHIVE_BYTES,
  createPluginCatalogService,
};

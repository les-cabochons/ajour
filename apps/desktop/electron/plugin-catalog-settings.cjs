const {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");
const {
  HOST_KINDS,
  OFFICIAL_PLUGIN_SOURCE_URL,
  normalizeSourceUrl,
} = require("./plugin-sources.cjs");

const MAX_PLUGIN_SOURCES = 50;
const PUBLIC_KEY = /^[A-Za-z0-9+/]{43}=$/u;

/** The official source, as a fresh install lists it. It can be removed. */
const OFFICIAL_PLUGIN_SOURCE = Object.freeze({
  url: OFFICIAL_PLUGIN_SOURCE_URL,
  hostKind: "github",
});

const DEFAULT_PLUGIN_CATALOG_SETTINGS = Object.freeze({
  refreshMinutes: 15,
  allowUnsignedInstalls: false,
  sources: Object.freeze([OFFICIAL_PLUGIN_SOURCE]),
});
const ALLOWED_REFRESH_MINUTES = new Set([0, 15, 30, 60, 240]);

/**
 * A source as saved: its canonical URL, the host family found when it was
 * added, and the key the person approved, base64 of the raw 32 bytes.
 */
function normalizePluginSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let url;
  try {
    url = normalizeSourceUrl(value.url);
  } catch {
    return null;
  }
  return {
    url,
    ...(HOST_KINDS.has(value.hostKind) ? { hostKind: value.hostKind } : {}),
    ...(typeof value.publicKey === "string" && PUBLIC_KEY.test(value.publicKey)
      ? { publicKey: value.publicKey }
      : {}),
  };
}

function normalizePluginSources(value) {
  // A file saved before sources existed lists the official one.
  if (!Array.isArray(value)) {
    return DEFAULT_PLUGIN_CATALOG_SETTINGS.sources.map((source) => ({
      ...source,
    }));
  }
  const sources = [];
  for (const candidate of value) {
    const source = normalizePluginSource(candidate);
    if (source && !sources.some((saved) => saved.url === source.url)) {
      sources.push(source);
    }
  }
  return sources.slice(0, MAX_PLUGIN_SOURCES);
}

function normalizePluginCatalogSettings(value) {
  const record =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    refreshMinutes: ALLOWED_REFRESH_MINUTES.has(record.refreshMinutes)
      ? record.refreshMinutes
      : DEFAULT_PLUGIN_CATALOG_SETTINGS.refreshMinutes,
    allowUnsignedInstalls:
      typeof record.allowUnsignedInstalls === "boolean"
        ? record.allowUnsignedInstalls
        : DEFAULT_PLUGIN_CATALOG_SETTINGS.allowUnsignedInstalls,
    sources: normalizePluginSources(record.sources),
  };
}

function loadPluginCatalogSettings(file) {
  try {
    return normalizePluginCatalogSettings(
      JSON.parse(readFileSync(file, "utf8")),
    );
  } catch {
    return normalizePluginCatalogSettings(undefined);
  }
}

function savePluginCatalogSettings(file, value) {
  const settings = normalizePluginCatalogSettings(value);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, file);
  return settings;
}

module.exports = {
  ALLOWED_REFRESH_MINUTES,
  DEFAULT_PLUGIN_CATALOG_SETTINGS,
  MAX_PLUGIN_SOURCES,
  OFFICIAL_PLUGIN_SOURCE,
  loadPluginCatalogSettings,
  normalizePluginCatalogSettings,
  savePluginCatalogSettings,
};

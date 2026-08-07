const { mkdirSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const DEFAULT_PLUGIN_CATALOG_SETTINGS = Object.freeze({
  refreshMinutes: 15,
});
const ALLOWED_REFRESH_MINUTES = new Set([0, 15, 30, 60, 240]);

function normalizePluginCatalogSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_PLUGIN_CATALOG_SETTINGS };
  }
  return {
    refreshMinutes: ALLOWED_REFRESH_MINUTES.has(value.refreshMinutes)
      ? value.refreshMinutes
      : DEFAULT_PLUGIN_CATALOG_SETTINGS.refreshMinutes,
  };
}

function loadPluginCatalogSettings(file) {
  try {
    return normalizePluginCatalogSettings(
      JSON.parse(readFileSync(file, "utf8")),
    );
  } catch {
    return { ...DEFAULT_PLUGIN_CATALOG_SETTINGS };
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
  loadPluginCatalogSettings,
  normalizePluginCatalogSettings,
  savePluginCatalogSettings,
};

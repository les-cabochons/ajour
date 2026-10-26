const {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");

/**
 * The local log file's settings (ADR 0014), stored in main. Logging is off
 * until the user turns it on, and sensitive fields stay out unless allowed.
 */
const DEFAULT_LOCAL_LOG_SETTINGS = Object.freeze({
  enabled: false,
  retention_days: 7,
  size_limit_mb: 250,
  include_sensitive: false,
});
const ALLOWED_RETENTION_DAYS = new Set([1, 7, 30, 90]);
const ALLOWED_SIZE_LIMITS_MB = new Set([100, 250, 1000]);

/** Settings from anything: a value outside its closed set takes its default. */
function normalizeLocalLogSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_LOCAL_LOG_SETTINGS };
  }
  return {
    enabled: value.enabled === true,
    retention_days: ALLOWED_RETENTION_DAYS.has(value.retention_days)
      ? value.retention_days
      : DEFAULT_LOCAL_LOG_SETTINGS.retention_days,
    size_limit_mb: ALLOWED_SIZE_LIMITS_MB.has(value.size_limit_mb)
      ? value.size_limit_mb
      : DEFAULT_LOCAL_LOG_SETTINGS.size_limit_mb,
    include_sensitive: value.include_sensitive === true,
  };
}

/** The stored settings, or the defaults when none are stored or they can't be read. */
function loadLocalLogSettings(file) {
  try {
    return normalizeLocalLogSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_LOCAL_LOG_SETTINGS };
  }
}

function saveLocalLogSettings(file, value) {
  const settings = normalizeLocalLogSettings(value);
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
  ALLOWED_RETENTION_DAYS,
  ALLOWED_SIZE_LIMITS_MB,
  DEFAULT_LOCAL_LOG_SETTINGS,
  loadLocalLogSettings,
  normalizeLocalLogSettings,
  saveLocalLogSettings,
};

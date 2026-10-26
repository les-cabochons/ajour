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

/**
 * Settings from anything: a value outside its closed set takes its default.
 * That is for the stored file, which a user or another version may have
 * edited. A call that asks for new settings goes through
 * `applyLocalLogSettings`, which refuses such a value instead.
 */
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

/** The error for settings that ask for a value outside its closed set. */
function invalidSettings(message) {
  return Object.assign(new Error(`Invalid local log settings: ${message}`), {
    code: INVALID_LOCAL_LOG_SETTINGS,
  });
}

const INVALID_LOCAL_LOG_SETTINGS = "invalid_local_log_settings";

/**
 * `current` with the settings `changes` asks for; those it leaves out stay.
 * A key it does not know is ignored: it is not stored and does not refuse the
 * call. A value outside its closed set is not replaced by the default: the
 * whole change is refused, and throws, so a bad call from the renderer
 * changes nothing.
 */
function applyLocalLogSettings(current, changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw invalidSettings("expected an object of settings.");
  }
  const next = { ...current };
  const has = (key) =>
    Object.hasOwn(changes, key) && changes[key] !== undefined;
  for (const key of ["enabled", "include_sensitive"]) {
    if (!has(key)) continue;
    if (typeof changes[key] !== "boolean") {
      throw invalidSettings(`${key} must be true or false.`);
    }
    next[key] = changes[key];
  }
  /** @type {[string, Set<number>][]} */
  const closed = [
    ["retention_days", ALLOWED_RETENTION_DAYS],
    ["size_limit_mb", ALLOWED_SIZE_LIMITS_MB],
  ];
  for (const [key, allowed] of closed) {
    if (!has(key)) continue;
    if (!allowed.has(changes[key])) {
      throw invalidSettings(
        `${key} must be one of ${[...allowed].join(", ")}.`,
      );
    }
    next[key] = changes[key];
  }
  return next;
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
  INVALID_LOCAL_LOG_SETTINGS,
  applyLocalLogSettings,
  ALLOWED_RETENTION_DAYS,
  ALLOWED_SIZE_LIMITS_MB,
  DEFAULT_LOCAL_LOG_SETTINGS,
  loadLocalLogSettings,
  normalizeLocalLogSettings,
  saveLocalLogSettings,
};

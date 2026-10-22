const { existsSync, readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");

const STORAGE_KEY = "ajour.local-state.v2";
const RECOVERY_FILE_NAME = "local-state-recovery.json";

function readJsonFile(filePath, report) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const bytes = readFileSync(filePath);
    report.bytes_scanned += bytes.length;
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
}

/** How many records each collection of a state holds: its names and counts only. */
function recordCountsOf(state) {
  const counts = {};
  if (!state || typeof state !== "object") return counts;
  for (const [key, value] of Object.entries(state)) {
    if (Object.keys(counts).length >= 40) break;
    if (Array.isArray(value) && /^[A-Za-z][A-Za-z0-9]{0,39}$/u.test(key)) {
      counts[key] = value.length;
    }
  }
  return counts;
}

function extractBalancedJson(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractJsonFromBytes(bytes, searchStart) {
  const asciiStart = bytes.indexOf(0x7b, searchStart);
  const utf16Start = bytes.indexOf(Buffer.from("{\x00"), searchStart);
  const candidates = [asciiStart, utf16Start]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);

  for (const start of candidates) {
    const slice = bytes.subarray(start);
    const decoded =
      start === utf16Start ? slice.toString("utf16le") : slice.toString("utf8");
    const jsonText = extractBalancedJson(decoded, 0);
    if (!jsonText) {
      continue;
    }

    try {
      return JSON.parse(jsonText);
    } catch {
      continue;
    }
  }

  return null;
}

function readLatestLocalStateFromLevelDb(levelDbPath, report) {
  if (!existsSync(levelDbPath)) {
    return null;
  }

  const candidateFiles = readdirSync(levelDbPath)
    .filter((name) => name.endsWith(".log"))
    .map((name) => path.join(levelDbPath, name));

  let latestState = null;
  let latestUpdatedAt = -1;

  for (const filePath of candidateFiles) {
    const bytes = readFileSync(filePath);
    report.bytes_scanned += bytes.length;
    let cursor = 0;
    while (cursor < bytes.length) {
      const keyIndex = bytes.indexOf(STORAGE_KEY, cursor, "utf8");
      if (keyIndex < 0) {
        break;
      }

      const parsed = extractJsonFromBytes(bytes, keyIndex + STORAGE_KEY.length);
      if (parsed && typeof parsed === "object") {
        const updatedAt =
          typeof parsed.updatedAt === "number" &&
          Number.isFinite(parsed.updatedAt)
            ? parsed.updatedAt
            : -1;
        if (updatedAt >= latestUpdatedAt) {
          latestState = parsed;
          latestUpdatedAt = updatedAt;
        }
      }

      cursor = keyIndex + STORAGE_KEY.length;
    }
  }

  return latestState;
}

/**
 * The newest local state left in the recovery file or a legacy profile, or
 * null. A profile that cannot be read gives null too: the renderer recovers
 * nothing this launch and asks again at the next one, instead of merging a
 * state older than the one it could not read.
 *
 * `options.report`, when given, learns where the state came from, how many
 * legacy folders and bytes were scanned, the record count of each collection
 * it found, and the error a failed read swallowed, for the read's event. That error can hold the user data path, which the event's
 * scrubber removes.
 */
function loadDesktopBootstrapLocalState(options = {}) {
  try {
    return readNewestLocalState(options);
  } catch (error) {
    if (options.report) options.report.error = error;
    return null;
  }
}

function readNewestLocalState(options) {
  const appDataPath = options.appDataPath;
  const currentUserDataPath = options.currentUserDataPath;
  if (!appDataPath) {
    return null;
  }

  const legacyUserDataCandidates = [
    path.join(appDataPath, "@ajour", "desktop"),
    path.join(appDataPath, "Ajour"),
  ].filter((candidate) => candidate !== currentUserDataPath);

  const report = options.report ?? {};
  report.source = "none";
  report.legacy_folder_count = 0;
  report.bytes_scanned = 0;
  report.record_counts = {};
  let latestState = currentUserDataPath
    ? readJsonFile(path.join(currentUserDataPath, RECOVERY_FILE_NAME), report)
    : null;
  if (latestState) report.source = "recovery_file";
  let latestUpdatedAt =
    typeof latestState?.updatedAt === "number" &&
    Number.isFinite(latestState.updatedAt)
      ? latestState.updatedAt
      : -1;

  for (const userDataPath of legacyUserDataCandidates) {
    const levelDb = path.join(userDataPath, "Local Storage", "leveldb");
    if (existsSync(levelDb)) report.legacy_folder_count += 1;
    const state = readLatestLocalStateFromLevelDb(levelDb, report);
    const updatedAt =
      typeof state?.updatedAt === "number" && Number.isFinite(state.updatedAt)
        ? state.updatedAt
        : -1;
    if (updatedAt >= latestUpdatedAt) {
      if (state) report.source = "legacy_profile";
      else if (latestState) report.source = "none";
      latestState = state;
      latestUpdatedAt = updatedAt;
    }
  }

  report.record_counts = recordCountsOf(latestState);
  return latestState;
}

module.exports = {
  loadDesktopBootstrapLocalState,
};

const { open } = require("node:fs/promises");
const path = require("node:path");

const MAX_PLUGIN_ARCHIVE_BYTES = 25 * 1024 * 1024;

/** A picked archive that is empty or too large: an invalid archive. */
function invalidArchiveSize() {
  return Object.assign(
    new Error(
      `Plugin archives must be between 1 byte and ${MAX_PLUGIN_ARCHIVE_BYTES} bytes.`,
    ),
    { code: "invalid_archive" },
  );
}

async function selectPluginArchive(
  dialog,
  parentWindow,
  dependencies = { open },
) {
  const selection = await dialog.showOpenDialog(parentWindow, {
    title: "Install plugin",
    properties: ["openFile"],
    filters: [
      {
        name: "Ajour plugins",
        extensions: ["ajour-connector"],
      },
    ],
  });
  if (selection.canceled || selection.filePaths.length !== 1) {
    return null;
  }

  const archivePath = selection.filePaths[0];
  const archive = await dependencies.open(archivePath, "r");
  try {
    const archiveStat = await archive.stat();
    if (
      !archiveStat.isFile() ||
      archiveStat.size === 0 ||
      archiveStat.size > MAX_PLUGIN_ARCHIVE_BYTES
    ) {
      throw invalidArchiveSize();
    }

    const chunks = [];
    let totalBytes = 0;
    while (totalBytes <= MAX_PLUGIN_ARCHIVE_BYTES) {
      const buffer = Buffer.allocUnsafe(
        Math.min(64 * 1024, MAX_PLUGIN_ARCHIVE_BYTES + 1 - totalBytes),
      );
      const { bytesRead } = await archive.read(
        buffer,
        0,
        buffer.byteLength,
        null,
      );
      if (bytesRead === 0) {
        break;
      }
      chunks.push(buffer.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
    if (totalBytes === 0 || totalBytes > MAX_PLUGIN_ARCHIVE_BYTES) {
      throw invalidArchiveSize();
    }

    return {
      archiveBytes: Buffer.concat(chunks, totalBytes),
      archiveFilename: path.basename(archivePath),
    };
  } finally {
    await archive.close();
  }
}

/** A Node system error's code, such as `EACCES` or `ENOSPC`. */
const SYSTEM_ERROR_CODE = /^E[A-Z0-9]+$/u;

// The local API's installer throws plain errors (apps/api/src/plugin-host.ts
// and apps/api/src/plugin-package.ts), so its refusals are told apart by
// their messages until it gives them codes. Only its archive validation
// counts as an invalid archive.
const BUSY =
  /^(Another plugin package change is already in progress|Wait for active plugin operations to finish)/u;
const INVALID_ARCHIVE = [
  /^Plugin archives? /u,
  /^Plugin files must use the /u,
  /^Plugin "[^"]*" (runs no code|entrypoint )/u,
  / (must be a regular file|must not traverse symbolic links|must be relative|leaves its plugin directory|is over 64 KB|which Ajour does not fill)\.$/u,
];

/** The manifest the installer reads from the extracted archive. */
const MANIFEST_FILE = "plugin.json";

/** The last segment of a file path, on Windows or POSIX. */
function baseName(filePath) {
  return typeof filePath === "string"
    ? (filePath.split(/[\\/]/u).pop() ?? "")
    : "";
}

/**
 * A failed install's result for its `plugin.install` event, from the step it
 * failed at (`select`, `download` or `install`) and the error's structure:
 * the code desktop's own errors carry, tar's codes, a Node system error's
 * code and path, or the type of the local API's validation error.
 */
function pluginInstallResultOf(error, step) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "invalid_archive" || code === "not_available") return code;
  if (step === "install") {
    // tar refuses what is not a gzipped tar, with its own codes.
    if (code.startsWith("TAR_")) return "invalid_archive";
    // The extracted archive holds no manifest.
    if (
      SYSTEM_ERROR_CODE.test(code) &&
      baseName(error?.path) === MANIFEST_FILE
    ) {
      return "invalid_archive";
    }
  }
  if (SYSTEM_ERROR_CODE.test(code)) return "failed";
  if (step !== "install") return "failed";
  // The manifest is the one file the installer parses as JSON, and zod checks
  // what it holds.
  if (
    error?.name === "SyntaxError" ||
    error?.name === "ZodError" ||
    error?.name === "IncompatiblePluginError"
  ) {
    return "invalid_archive";
  }
  const message = typeof error?.message === "string" ? error.message : "";
  if (BUSY.test(message)) return "busy";
  if (INVALID_ARCHIVE.some((pattern) => pattern.test(message))) {
    return "invalid_archive";
  }
  return "failed";
}

module.exports = {
  MAX_PLUGIN_ARCHIVE_BYTES,
  pluginInstallResultOf,
  selectPluginArchive,
};

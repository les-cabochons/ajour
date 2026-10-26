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

/**
 * The codes an install failure carries when its cause is known: the
 * package itself, or the plugin host being busy.
 */
const KNOWN_RESULTS = new Set([
  "invalid_archive",
  "not_available",
  "busy",
  "unsigned_not_allowed",
]);

/**
 * A failed install's result for its `plugin.install` event, from the code
 * the error carries: `invalid_archive` from the local API's installer
 * (apps/api/src/plugin-package.ts) or from picking an archive here,
 * `not_available` from the catalog, `busy` from the plugin host while
 * plugin operations run (apps/api/src/plugin-host.ts), and
 * `unsigned_not_allowed` when unsigned installs are off. Anything else is the
 * machine or Ajour failing.
 */
function pluginInstallResultOf(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  return KNOWN_RESULTS.has(code) ? code : "failed";
}

module.exports = {
  MAX_PLUGIN_ARCHIVE_BYTES,
  pluginInstallResultOf,
  selectPluginArchive,
};

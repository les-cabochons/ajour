const { open } = require("node:fs/promises");
const path = require("node:path");

const MAX_PLUGIN_ARCHIVE_BYTES = 25 * 1024 * 1024;

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
      throw new Error(
        `Plugin archives must be between 1 byte and ${MAX_PLUGIN_ARCHIVE_BYTES} bytes.`,
      );
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
      throw new Error(
        `Plugin archives must be between 1 byte and ${MAX_PLUGIN_ARCHIVE_BYTES} bytes.`,
      );
    }

    return {
      archiveBytes: Buffer.concat(chunks, totalBytes),
      archiveFilename: path.basename(archivePath),
    };
  } finally {
    await archive.close();
  }
}

// What the catalog download and the local API's installer say when they
// refuse, as apps/desktop/electron/plugin-catalog.cjs, apps/api/src/plugin-host.ts
// and apps/api/src/plugin-package.ts throw it.
const NOT_AVAILABLE =
  /is not available for download|No compatible release asset|cannot install packaged schema plugins/u;
const BUSY =
  /package change is already in progress|Wait for active plugin operations/u;
const INVALID_ARCHIVE =
  /archive|manifest|plugin\.json|entrypoint|unsafe path|runs no code|regular file|symbolic link|leaves its plugin directory|over 64 KB/iu;

/**
 * A failed install's result for its `plugin.install` event, from the step it
 * failed at (`download` or `install`) and the error, never its message.
 */
function pluginInstallResultOf(error, step) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (step === "download") {
    return NOT_AVAILABLE.test(message) ? "not_available" : "failed";
  }
  if (BUSY.test(message)) return "busy";
  if (
    error?.name === "ZodError" ||
    error?.name === "IncompatiblePluginError" ||
    INVALID_ARCHIVE.test(message)
  ) {
    return "invalid_archive";
  }
  return "failed";
}

module.exports = {
  MAX_PLUGIN_ARCHIVE_BYTES,
  pluginInstallResultOf,
  selectPluginArchive,
};

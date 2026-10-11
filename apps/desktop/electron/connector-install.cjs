const { open } = require("node:fs/promises");
const path = require("node:path");

const MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES = 25 * 1024 * 1024;

async function selectConnectorPluginArchive(
  dialog,
  parentWindow,
  dependencies = { open },
) {
  const selection = await dialog.showOpenDialog(parentWindow, {
    title: "Install connector plugin",
    properties: ["openFile"],
    filters: [
      {
        name: "Ajour connector plugins",
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
      archiveStat.size > MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES
    ) {
      throw new Error(
        `Connector plugin archives must be between 1 byte and ${MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES} bytes.`,
      );
    }

    const chunks = [];
    let totalBytes = 0;
    while (totalBytes <= MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES) {
      const buffer = Buffer.allocUnsafe(
        Math.min(
          64 * 1024,
          MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES + 1 - totalBytes,
        ),
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
    if (totalBytes === 0 || totalBytes > MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES) {
      throw new Error(
        `Connector plugin archives must be between 1 byte and ${MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES} bytes.`,
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

module.exports = {
  MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES,
  selectConnectorPluginArchive,
};

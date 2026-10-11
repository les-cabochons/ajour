const {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { stat } = require("node:fs/promises");
const path = require("node:path");

const MAX_DEVELOPMENT_PLUGIN_DIRECTORIES = 32;

function normalizeDevelopmentPluginDirectories(value) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_DEVELOPMENT_PLUGIN_DIRECTORIES
  ) {
    throw new Error(
      "Development plugin settings contain an invalid directory list.",
    );
  }

  return Array.from(
    new Set(
      value.map((directory) => {
        if (
          typeof directory !== "string" ||
          !path.isAbsolute(directory.trim())
        ) {
          throw new Error(
            "Development plugin directories must use absolute paths.",
          );
        }
        return path.resolve(directory.trim());
      }),
    ),
  );
}

function loadDevelopmentPluginDirectories(settingsPath) {
  try {
    const payload = JSON.parse(readFileSync(settingsPath, "utf8"));
    return normalizeDevelopmentPluginDirectories(payload.directories);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function saveDevelopmentPluginDirectories(settingsPath, directories) {
  const normalizedDirectories =
    normalizeDevelopmentPluginDirectories(directories);
  mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${settingsPath}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ directories: normalizedDirectories }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(temporaryPath, settingsPath);
}

function clearDevelopmentPluginDirectories(settingsPath) {
  rmSync(settingsPath, { force: true });
}

async function selectDevelopmentPluginDirectory(
  dialog,
  parentWindow,
  dependencies = {},
) {
  const statPath = dependencies.stat ?? stat;
  const selection = await dialog.showOpenDialog(parentWindow, {
    title: "Choose a development plugin directory",
    properties: ["openDirectory"],
  });
  if (selection.canceled || selection.filePaths.length !== 1) {
    return null;
  }

  const directory = path.resolve(selection.filePaths[0]);
  const manifestStat = await statPath(path.join(directory, "plugin.json"));
  if (!manifestStat.isFile()) {
    throw new Error(
      "The selected directory does not contain a plugin.json file.",
    );
  }

  return directory;
}

module.exports = {
  clearDevelopmentPluginDirectories,
  loadDevelopmentPluginDirectories,
  normalizeDevelopmentPluginDirectories,
  saveDevelopmentPluginDirectories,
  selectDevelopmentPluginDirectory,
};

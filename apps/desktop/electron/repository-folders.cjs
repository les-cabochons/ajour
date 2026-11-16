const path = require("node:path");
const { cliInstallDirectory } = require("./cli-command.cjs");

/** The one list used by the chooser and the process broker's FolderResolver. */
function protectedRepositoryFolders({
  platform,
  packaged,
  userData,
  exe,
  resources,
  runtimeRoot,
  home,
  env,
}) {
  const roots = {
    userData,
    install: packaged
      ? platform === "darwin"
        ? path.resolve(resources, "../..")
        : path.dirname(exe)
      : runtimeRoot,
  };
  roots.cli = cliInstallDirectory({ platform, packaged, home, env });
  if (env.AJOUR_APP_API_STATE_PATH)
    roots.stateOverride = path.dirname(
      path.resolve(env.AJOUR_APP_API_STATE_PATH),
    );
  if (env.AJOUR_USER_DATA_PATH)
    roots.dataOverride = path.resolve(env.AJOUR_USER_DATA_PATH);
  return roots;
}
function createFolderChooser({ window, assertSender, show, add, cancel }) {
  return async (event, projectId) => {
    assertSender(event);
    if (
      typeof projectId !== "string" ||
      !projectId.trim() ||
      projectId.length > 200
    )
      throw new Error("Choose a project.");
    const selected = await show(window(), {
      title: "Add repository folder",
      properties: ["openDirectory"],
    });
    if (selected.canceled || selected.filePaths.length !== 1) {
      cancel();
      return null;
    }
    return add(projectId, selected.filePaths[0]);
  };
}
module.exports = { protectedRepositoryFolders, createFolderChooser };

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
/**
 * Deck's clone chooser (#795): the native dialog picks the folder, and the
 * local API keeps it only once git says it is a clone of the repository.
 * The window names the repository; only this dialog names a new folder.
 * Answers `{ clone }`, `{ refused }` with the sentence the picker shows, or
 * null when the user cancelled.
 */
function createCloneChooser({ window, assertSender, show, choose, cancel }) {
  const text = (value, max) =>
    typeof value === "string" && value.trim() && value.length <= max;
  return async (event, request) => {
    assertSender(event);
    if (
      typeof request !== "object" ||
      request === null ||
      !text(request.pluginId, 200) ||
      !text(request.connectionId, 200) ||
      !text(request.repository, 240) ||
      typeof request.clone !== "object" ||
      request.clone === null
    )
      throw new Error("Choose a repository.");
    const selected = await show(window(), {
      title: `Choose your clone of ${request.repository}`,
      properties: ["openDirectory"],
    });
    if (selected.canceled || selected.filePaths.length !== 1) {
      cancel();
      return null;
    }
    return choose(
      {
        pluginId: request.pluginId,
        connectionId: request.connectionId,
        repository: request.repository,
      },
      request.clone,
      selected.filePaths[0],
    );
  };
}
module.exports = {
  protectedRepositoryFolders,
  createFolderChooser,
  createCloneChooser,
};

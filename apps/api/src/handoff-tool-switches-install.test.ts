import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { create } from "tar";
import { expect, it, onTestFinished } from "vitest";
import {
  createAppApiServer,
  installPluginForServer,
  stopAppApiServer,
} from "./server.ts";
import { AppApiStorage } from "./storage.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { turnOnServerHandoffTools } from "./test-support/handoff-tool-switches.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

const ID = "handoff";

/** An archive of a handoff plugin with one tool, at `version`. */
async function archive(root: string, version: string) {
  const directory = path.join(root, `source-${version}`);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: ID,
      version,
      apiVersion: 4,
      displayName: "Tools",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      connectionFields: [],
      capabilities: {
        handoff: {
          tools: [{ id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] }],
        },
      },
    }),
  );
  await writeFile(path.join(directory, "plugin.mjs"), "export {};");
  const file = path.join(root, `tools-${version}.ajour-connector`);
  await create({ cwd: directory, file, gzip: true }, [
    "plugin.json",
    "plugin.mjs",
  ]);
  return { bytes: await readFile(file), name: path.basename(file) };
}

it("starts a freshly installed plugin's tools off, even with switches left from before, and keeps them on an update", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-install-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const statePath = path.join(root, "state.json");
  // The version 13 migration turns on the tools of the handoffs a device
  // keeps, and an uninstall keeps handoffs: a plugin removed before the
  // upgrade can leave switches on for its id.
  await new AppApiStorage(statePath).setHandoffToolEnabled(ID, "t3", true);
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath,
    installedPluginDirectory: path.join(root, "installed"),
    developmentPluginDirectories: [],
    projectDataShapePluginDirectories: [],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
  });
  onTestFinished(() => stopAppApiServer(server));
  const switches = async () =>
    (
      await dispatchJsonRequest(server, {
        method: "GET",
        path: `/api/plugins/${ID}/handoffs/tools`,
      })
    ).body;

  const first = await archive(root, "1.0.0");
  await installPluginForServer(server, first.bytes, first.name);
  expect(await switches()).toEqual({ enabled: [] });

  await turnOnServerHandoffTools(server, { [ID]: ["t3"] });
  const update = await archive(root, "1.1.0");
  await installPluginForServer(server, update.bytes, update.name);
  expect(await switches()).toEqual({ enabled: ["t3"] });
});

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  createAppApiServer,
  addRepositoryFolderForServer,
  stopAppApiServer,
} from "./server.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { turnOnServerHandoffTools } from "./test-support/handoff-tool-switches.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

// A start the tool refuses can say why (#819): the branch exists, or one of
// the tool's settings. The start route answers it beside the reason, so the
// window can offer the item's thread or ask for the setting, and a start
// that succeeds with a setting it named remembers it for the folder.

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A plugin whose `t3` tool needs a base branch: none, `main` and the title
 * `stale` are refused as its `base` setting, a `taken` branch exists, and
 * the titles `model` and `nope` refuse a select setting and an undeclared
 * one. A start that succeeds echoes the settings it got in its native state.
 */
async function startServer() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-refusals-"));
  const plugin = path.join(root, "plugin");
  await mkdir(plugin);
  await mkdir(path.join(root, "repo"));
  await mkdir(path.join(root, "other"));
  await writeFile(
    path.join(plugin, "plugin.json"),
    JSON.stringify({
      id: "handoff",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Tools",
      description: "Test tools",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      connectionFields: [],
      capabilities: {
        handoff: {
          tools: [
            {
              id: "t3",
              label: "T3 Code",
              iconSvg: "<svg/>",
              settings: [
                {
                  id: "base",
                  label: "Worktree base",
                  type: "text",
                  defaultValue: "main",
                  helpText: "The branch the worktree starts from.",
                },
                {
                  id: "model",
                  label: "Model",
                  type: "select",
                  options: [{ value: "a", label: "A" }],
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    path.join(plugin, "plugin.mjs"),
    `
const refuse = (message, hint) => { throw Object.assign(new Error(message), hint); };
export function startHandoff(request) {
  const base = request.settings.base;
  // The title template makes "[PAY-12] <item title>".
  const title = request.title.replace('[PAY-12] ', '');
  if (request.branch === 'taken') refuse('Branch "taken" already exists.', { branchExists: true });
  if (title === 'model') refuse('That model is gone.', { setting: 'model' });
  if (title === 'nope') refuse('Not a setting.', { setting: 'nope' });
  if (base === undefined || base === 'main' || title === 'stale')
    refuse('Base ref "' + (base ?? 'main') + '" does not resolve.', { setting: 'base' });
  return { threadId: title + '-thread', native: { settings: JSON.stringify(request.settings) } };
}
`,
  );
  const sink = createRecordingSink();
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath: path.join(root, "data", "state.json"),
    protectedRepositoryFolders: {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    },
    developmentPluginDirectories: [plugin],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
    eventSink: sink,
  });
  cleanups.push(async () => {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  });
  const call = (method: string, route: string, body?: unknown) =>
    dispatchJsonRequest(server, {
      method,
      path: route,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const folder = await addRepositoryFolderForServer(
    server,
    "p",
    path.join(root, "repo"),
  );
  const other = await addRepositoryFolderForServer(
    server,
    "p",
    path.join(root, "other"),
  );
  await turnOnServerHandoffTools(server, { handoff: ["t3"] });
  /** Starts a hand off of item PAY-12, titled `title`, in `folderId`. */
  const start = (
    title: string,
    options: {
      settings?: Record<string, string>;
      folderId?: string;
      branch?: string;
    } = {},
  ) =>
    call("POST", "/api/handoffs", {
      pluginId: "handoff",
      toolId: "t3",
      workItemId: `item-${title}`,
      projectId: "p",
      folderId: options.folderId ?? folder.id,
      projectName: "Project",
      item: { key: "PAY-12", title, type: "Bug", url: "" },
      settings: options.settings ?? {},
      // The default branch template would make every start ask for one.
      branchOverride: options.branch ?? "pay-12",
      promptOverride: "Fix it",
    });
  return { start, folder, other, sink };
}

/** The settings the plugin got, from a started handoff's native state. */
const settingsOf = (body: unknown) =>
  JSON.parse((body as { native: { settings: string } }).native.settings);

it("asks for a refused text setting with its label, and remembers the answer the tool took for the folder", async () => {
  const { start, other, sink } = await startServer();

  const refused = await start("first");
  expect(refused.status).toBe(409);
  expect(refused.body).toEqual({
    error: 'Base ref "main" does not resolve.',
    setting: {
      id: "base",
      label: "Worktree base",
      helpText: "The branch the worktree starts from.",
    },
  });
  expect(
    sink.events.find(
      (event) => event.name === "handoff.start" && event.kind === "request",
    ),
  ).toMatchObject({
    outcome: "refused",
    outcome_reason: "handoff_refused",
    handoff: { refusal: "setting", refused_setting: "base" },
  });

  const answered = await start("answered", { settings: { base: "develop" } });
  expect(answered.status).toBe(200);
  expect(settingsOf(answered.body)).toEqual({ base: "develop" });

  // The folder's next start uses the answer without being given it.
  const later = await start("later");
  expect(later.status).toBe(200);
  expect(settingsOf(later.body)).toEqual({ base: "develop" });

  // Another folder of the project keeps asking.
  expect((await start("elsewhere", { folderId: other.id })).status).toBe(409);

  // A remembered value the tool refuses comes back filled in.
  const stale = await start("stale");
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({
    setting: { id: "base", value: "develop" },
  });
});

it("says the branch exists only when the start asked for one", async () => {
  const { start, sink } = await startServer();

  const taken = await start("taken", {
    settings: { base: "develop" },
    branch: "taken",
  });
  expect(taken.status).toBe(409);
  expect(taken.body).toEqual({
    error: 'Branch "taken" already exists.',
    branchExists: true,
  });
  expect(
    sink.events.find(
      (event) => event.name === "handoff.start" && event.kind === "request",
    ),
  ).toMatchObject({ handoff: { refusal: "branch_exists" } });
});

it("drops a hint the window couldn't ask for: a setting that isn't text, or one the tool doesn't declare", async () => {
  const { start } = await startServer();

  for (const title of ["model", "nope"]) {
    const refused = await start(title, { settings: { base: "develop" } });
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: expect.any(String) });
  }
});

it("never sends or remembers a setting the tool doesn't declare", async () => {
  const { start } = await startServer();

  const started = await start("extra", {
    settings: { base: "develop", other: "x" },
  });
  expect(started.status).toBe(200);
  expect(settingsOf(started.body)).toEqual({ base: "develop" });
  expect(settingsOf((await start("again")).body)).toEqual({ base: "develop" });
});

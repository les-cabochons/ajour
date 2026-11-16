import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createAppApiServer, stopAppApiServer } from "./server.ts";
import { AppApiStorage } from "./storage.ts";
import { pluginProcessPackageKey } from "./plugin-package.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { windowServerOptions } from "./test-support/window-token.ts";
it("Given command access, only a window can change the mode and remove an exact approval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "command-access-"));
  const directory = path.join(root, "plugin");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "test",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Test",
      iconSvg: "<svg/>",
      entrypoint: "index.mjs",
      connectionFields: [{ id: "site", label: "Site", type: "text" }],
      capabilities: { connector: {} },
      processes: {
        undeclaredCommands: true,
        executables: { git: { names: ["git"] } },
        commands: [],
      },
    }),
  );
  await writeFile(
    path.join(directory, "index.mjs"),
    "export const validateConnection = async ({config}) => ({normalizedConfig: config, connectionSummary: {}})",
  );
  const statePath = path.join(root, "state.json");
  const storage = new AppApiStorage(statePath);
  const identity = JSON.stringify([
    "1.0.0",
    await pluginProcessPackageKey(directory),
    true,
  ]);
  await storage.saveCommandPolicy("test", {
    identity,
    signed: false,
    mode: "always-ask",
    approvals: [
      {
        id: "approval",
        executable: "git",
        argv: ["status"],
        cwdFolder: "repo",
      },
    ],
  });
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath,
    vault: new MemorySecretVault(),
    allowDevelopmentPlugins: true,
    developmentPluginDirectories: [directory],
    pluginRuntime: new InProcessPluginRuntime(),
  });
  const request = (body?: unknown, headers?: Record<string, string>) =>
    dispatchJsonRequest(server, {
      method: body === undefined ? "GET" : "POST",
      path: "/api/plugins/test/command-access",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers,
    });
  try {
    expect(await request()).toMatchObject({
      status: 200,
      body: {
        mode: "always-ask",
        approvals: [{ id: "approval", argv: ["status"] }],
      },
    });
    expect(
      (
        await request(
          { mode: "accept-everything" },
          { "x-ajour-window-token": "" },
        )
      ).status,
    ).toBe(401);
    expect(await request()).toMatchObject({ body: { mode: "always-ask" } });
    expect(await request({ mode: "auto" })).toMatchObject({
      status: 200,
      body: { mode: "auto", approvals: [{ id: "approval" }] },
    });
    expect(await request({ remove: "approval" })).toMatchObject({
      status: 200,
      body: { mode: "auto", approvals: [] },
    });
  } finally {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { createAppApiServer } from "../../../../api/src/server";
import { InProcessPluginRuntime } from "../../../../api/src/test-support/in-process-plugin-runtime";
import { MemorySecretVault } from "../../../../api/src/test-support/memory-secret-vault";
import {
  windowServerOptions,
  windowTokenHeader,
  TEST_WINDOW_ORIGIN,
} from "../../../../api/src/test-support/window-token";
import { projectSourceManifest } from "../../../../../packages/example/project-source";

const { When } = createBdd();

// Exercise the real HTTP route, host and fixture export. No source service or UI yet.
When(
  "the example project source is synced twice through the local API",
  async ({ request }) => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "ajour-project-source-acceptance-"),
    );
    const pluginDirectory = path.join(root, "plugin");
    await mkdir(pluginDirectory);
    await writeFile(
      path.join(pluginDirectory, "plugin.json"),
      JSON.stringify({ ...projectSourceManifest, entrypoint: "plugin.mjs" }),
    );
    const fixture = await readFile(
      path.resolve("../../packages/example/project-source.ts"),
      "utf8",
    );
    await writeFile(
      path.join(pluginDirectory, "plugin.mjs"),
      ts.transpile(fixture, {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      }),
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
      pluginRuntime: new InProcessPluginRuntime(),
    });
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing API address");
      const base = `http://127.0.0.1:${address.port}/api/plugins/example-project-source`;
      const headers = { ...windowTokenHeader, origin: TEST_WINDOW_ORIGIN };
      const saved = await request.post(`${base}/connections`, {
        headers,
        data: {
          values: {
            label: "Work",
            tenantLabel: "Planning",
            autoSync: false,
            autoSyncIntervalMinutes: 10,
          },
        },
      });
      expect(saved.status()).toBe(200);
      const { connection } = await saved.json();
      const route = `${base}/connections/${connection.id}/sync-projects`;
      const first = await request.post(route, { headers, data: {} });
      expect(first.status()).toBe(200);
      expect(await first.json()).toMatchObject({
        snapshot: {
          source: { label: "Example planning" },
          projects: [
            { remoteId: "project-1", tasks: [{ remoteId: "task-1" }] },
          ],
        },
        cursor: "fixture-1",
      });
      const second = await request.post(route, { headers, data: {} });
      expect(second.status()).toBe(200);
      expect(await second.json()).toEqual({ unchanged: true });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
);

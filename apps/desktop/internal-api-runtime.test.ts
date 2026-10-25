import { readFile } from "node:fs/promises";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordingEvents } from "./recording-events.ts";

const require = createRequire(import.meta.url);
const {
  createIpcListeners,
  refusedSender,
} = require("./electron/ipc-listeners.cjs");
const { pluginInstallResultOf } = require("./electron/plugin-install.cjs");

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          if (!server.listening) return resolve();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function listen(status = 200, port = 0) {
  const server = http.createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: status === 200 }));
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

function portOf(server: Server) {
  return (server.address() as AddressInfo).port;
}

async function runtime(
  port: number,
  ownedServer: Server | null = null,
  { select }: { select?: () => Promise<unknown> } = {},
) {
  const source = await readFile(
    new URL("./electron/main.cjs", import.meta.url),
    "utf8",
  );
  function section(start: string, end: string) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
  }

  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const start = vi.fn(async () => listen(200, port));
  const install = vi.fn(async (_server: Server, ..._args: unknown[]) => ({
    installed: true,
  }));
  const uninstall = vi.fn(async () => ({ uninstalled: true }));
  const archive = {
    archiveBytes: Buffer.from("fixture archive"),
    archiveFilename: "fixture.ajour-connector",
  };
  const { events, recorded } = recordingEvents();
  const context = vm.createContext({
    http,
    path,
    setTimeout,
    events,
    launch: { launch_id: "launch-1" },
    apiLaunchOf: () => ({ id: "launch-1" }),
    refusedSender,
    process: { env: {} },
    INTERNAL_APP_API_HOST: "127.0.0.1",
    INTERNAL_APP_API_PORT: port,
    windowApiToken: "launch-token",
    internalAppApiServer: ownedServer,
    internalAppApiStartPromise: null,
    internalAppApiStopPromise: null,
    internalAppApiModulePromise: Promise.resolve({
      startAppApiServer: start,
      installPluginForServer: install,
      uninstallPluginForServer: uninstall,
    }),
    internalAppApiEntryPath: "fixture/server.ts",
    internalAppApiVault: () => undefined,
    internalAppApiBrokerNetwork: () => ({
      transport: "broker-transport",
      resolver: "broker-resolver",
    }),
    internalAppApiPluginApi4Runtime: () => "plugin-renderer-runtime",
    existsSync: () => true,
    app: { isPackaged: true, getPath: () => "/fixture" },
    mainWindow: { webContents: "active-window" },
    dialog: {},
    selectPluginArchive: select ?? (async () => archive),
    pluginInstallResultOf,
    assertActiveDesktopWindow: () => {},
    pluginCatalogService: { downloadPluginArchive: async () => archive },
    ipc: createIpcListeners(
      {
        handle(
          name: string,
          handler: (...args: unknown[]) => Promise<unknown>,
        ) {
          handlers.set(name, handler);
        },
      },
      { events },
    ),
  });

  // Execute the real startup and IPC paths without launching an Electron window.
  vm.runInContext(
    section("function delay(ms)", "async function stopInternalAppApi()") +
      section(
        "function pluginIdForEvent(",
        'ipc.handle("ajour:get-plugin-catalog"',
      ) +
      section(
        'ipc.handle("ajour:download-catalog-plugin"',
        'ipc.handle("ajour:get-development-plugin-settings"',
      ),
    context,
  );
  return {
    context,
    recorded,
    start,
    install,
    uninstall,
    invoke: (channel: string) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
      return handler({ sender: "active-window" }, "azure_devops");
    },
  };
}

describe("desktop plugin runtime ownership", () => {
  it.each([
    "ajour:download-catalog-plugin",
    "ajour:install-plugin",
    "ajour:uninstall-plugin",
  ])(
    "reports an occupied port instead of adopting a development API for %s",
    async (channel) => {
      const foreign = await listen();
      const app = await runtime(portOf(foreign));

      await expect(app.invoke(channel)).rejects.toThrow(/already in use/);
      expect(app.context.internalAppApiServer).toBeNull();
      expect(app.install).not.toHaveBeenCalled();
      expect(app.uninstall).not.toHaveBeenCalled();
    },
  );

  it("reports a port occupied by a service that fails the health check", async () => {
    const foreign = await listen(404);
    const app = await runtime(portOf(foreign));

    await expect(app.invoke("ajour:download-catalog-plugin")).rejects.toThrow(
      /Close the other app or development server/,
    );
    expect(app.start).toHaveBeenCalledOnce();
    expect(app.install).not.toHaveBeenCalled();
  });

  it("retries installation after the foreign server releases the port", async () => {
    const foreign = await listen();
    const app = await runtime(portOf(foreign));
    await expect(app.invoke("ajour:download-catalog-plugin")).rejects.toThrow(
      /already in use/,
    );
    await new Promise<void>((resolve) => foreign.close(() => resolve()));

    await expect(app.invoke("ajour:download-catalog-plugin")).resolves.toEqual({
      type: "plugin",
      result: { installed: true },
    });
    expect(app.install.mock.calls[0]?.[0]).toBe(
      app.context.internalAppApiServer,
    );
  });

  it("starts the API with the launch's window token", async () => {
    const free = await listen();
    const port = portOf(free);
    await new Promise<void>((resolve) => free.close(() => resolve()));
    const app = await runtime(port);

    await app.invoke("ajour:download-catalog-plugin");

    expect(app.start).toHaveBeenCalledWith(
      expect.objectContaining({ windowToken: "launch-token" }),
    );
  });

  it("gives the API's broker main's network stack", async () => {
    const free = await listen();
    const port = portOf(free);
    await new Promise<void>((resolve) => free.close(() => resolve()));
    const app = await runtime(port);

    await app.invoke("ajour:download-catalog-plugin");

    expect(app.start).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerTransport: "broker-transport",
        brokerResolver: "broker-resolver",
      }),
    );
  });

  it("gives the API the sandboxed renderer runtime for plugin API 4", async () => {
    const free = await listen();
    const port = portOf(free);
    await new Promise<void>((resolve) => free.close(() => resolve()));
    const app = await runtime(port);

    await app.invoke("ajour:download-catalog-plugin");

    expect(app.start).toHaveBeenCalledWith(
      expect.objectContaining({ pluginApi4Runtime: "plugin-renderer-runtime" }),
    );
  });

  // selectPluginArchive refuses an empty or oversized archive itself.
  it("records an archive refused when it was picked, with the dialog's time", async () => {
    const owned = await listen();
    const app = await runtime(portOf(owned), owned, {
      select: async () => {
        throw Object.assign(
          new Error(
            "Plugin archives must be between 1 byte and 26214400 bytes.",
          ),
          { code: "invalid_archive" },
        );
      },
    });

    await expect(app.invoke("ajour:install-plugin")).rejects.toThrow(
      "between 1 byte",
    );

    expect(app.recorded).toMatchObject([
      {
        name: "plugin.install",
        outcome: "error",
        plugin: {
          source: "archive",
          result: "invalid_archive",
          dialog_ms: expect.any(Number),
        },
      },
    ]);
    expect(app.install).not.toHaveBeenCalled();
  });

  it("records a refused install with the occupied port's code", async () => {
    const foreign = await listen();
    const app = await runtime(portOf(foreign));

    await expect(app.invoke("ajour:install-plugin")).rejects.toThrow(
      /already in use/,
    );

    expect(app.recorded).toMatchObject([
      {
        name: "plugin.install",
        kind: "ipc",
        outcome: "error",
        error: { code: "port_in_use" },
        ipc: { channel: "ajour:install-plugin", sender_accepted: true },
        plugin: { source: "archive", archive_bytes: 15 },
      },
    ]);
  });

  it("records a catalog install: the plugin, its version and the times", async () => {
    const owned = await listen();
    const app = await runtime(portOf(owned), owned);
    app.install.mockResolvedValueOnce({
      plugin: { id: "azure_devops", version: "1.2.3" },
      replaced: true,
    } as never);

    await app.invoke("ajour:download-catalog-plugin");

    expect(app.recorded).toMatchObject([
      {
        name: "plugin.install",
        outcome: "ok",
        plugin: {
          id: "azure_devops",
          version: "1.2.3",
          source: "catalog",
          replaced: true,
          result: "updated",
          archive_bytes: 15,
          download_ms: expect.any(Number),
          install_ms: expect.any(Number),
        },
      },
    ]);
  });

  it("uses its owned healthy runtime without starting another server", async () => {
    const owned = await listen();
    const app = await runtime(portOf(owned), owned);

    await expect(app.invoke("ajour:download-catalog-plugin")).resolves.toEqual({
      type: "plugin",
      result: { installed: true },
    });
    expect(app.start).not.toHaveBeenCalled();
    expect(app.install.mock.calls[0]?.[0]).toBe(owned);
  });
});

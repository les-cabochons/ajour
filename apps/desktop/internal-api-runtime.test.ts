import { readFile } from "node:fs/promises";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

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

async function runtime(port: number, ownedServer: Server | null = null) {
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
  const context = vm.createContext({
    http,
    path,
    setTimeout,
    process: { env: {} },
    INTERNAL_APP_API_HOST: "127.0.0.1",
    INTERNAL_APP_API_PORT: port,
    internalAppApiServer: ownedServer,
    internalAppApiStartPromise: null,
    internalAppApiStopPromise: null,
    internalAppApiModulePromise: Promise.resolve({
      startAppApiServer: start,
      installPluginForServer: install,
      uninstallPluginForServer: uninstall,
    }),
    internalAppApiEntryPath: "fixture/server.ts",
    existsSync: () => true,
    app: { isPackaged: true, getPath: () => "/fixture" },
    mainWindow: { webContents: "active-window" },
    dialog: {},
    selectPluginArchive: async () => archive,
    assertActiveDesktopWindow: () => {},
    pluginCatalogService: { downloadPluginArchive: async () => archive },
    ipcMain: {
      handle(name: string, handler: (...args: unknown[]) => Promise<unknown>) {
        handlers.set(name, handler);
      },
    },
  });

  // Execute the real startup and IPC paths without launching an Electron window.
  vm.runInContext(
    section("function delay(ms)", "async function stopInternalAppApi()") +
      section(
        'ipcMain.handle("ajour:install-plugin"',
        'ipcMain.handle("ajour:get-plugin-catalog"',
      ) +
      section(
        'ipcMain.handle("ajour:download-catalog-plugin"',
        'ipcMain.handle("ajour:uninstall-plugin"',
      ) +
      section(
        'ipcMain.handle("ajour:uninstall-plugin"',
        'ipcMain.handle("ajour:get-development-plugin-settings"',
      ),
    context,
  );
  return {
    context,
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

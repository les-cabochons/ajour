import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { create } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import type { BrokerCaller } from "./broker-port.ts";
import { PluginManager } from "./plugin-host.ts";
import { pluginProcessPackageKey } from "./plugin-package.ts";
import { ProcessBroker, type ProcessBrokerOptions } from "./process-broker.ts";
import {
  createAppApiServer,
  installPluginForServer,
  stopAppApiServer,
  uninstallPluginForServer,
} from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/*
 * The server's part in process sessions (#743): what ends a plugin's
 * sessions, and the gate the broker rechecks while one is open.
 */

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => stopAppApiServer(s)));
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

const manifestJson = (id: string, version = "1.0.0") => ({
  id,
  version,
  apiVersion: 4,
  displayName: "Session server",
  iconSvg: "<svg/>",
  entrypoint: "plugin.mjs",
  connectionFields: [{ id: "site", label: "Site", type: "text" }],
  capabilities: { connector: {} },
  processes: {
    executables: { node: { names: ["node"] } },
    commands: [
      {
        id: "server",
        executable: "node",
        args: ["--version"],
        mode: "session",
        idleTimeoutSeconds: 60,
      },
    ],
  },
});

async function writePackage(directory: string, value: object) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "plugin.json"), JSON.stringify(value));
  await writeFile(path.join(directory, "plugin.mjs"), "export {};");
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-session-server-"));
  roots.push(root);
  const development = path.join(root, "dev");
  await writePackage(development, manifestJson("dev-session"));
  const endSessions = vi.spyOn(ProcessBroker.prototype, "endSessions");
  const server = createAppApiServer({
    ...windowServerOptions,
    vault: new MemorySecretVault(),
    pluginRuntime: new InProcessPluginRuntime(),
    statePath: path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    developmentPluginDirectories: [development],
    projectDataShapePluginDirectories: [],
    allowDevelopmentPlugins: true,
    brokerActivityWindowMs: 0,
  });
  servers.push(server);
  const install = async (id: string, version: string) => {
    const source = path.join(root, `source-${id}-${version}`);
    await writePackage(source, manifestJson(id, version));
    const file = path.join(root, `${id}-${version}.ajour-connector`);
    await create({ cwd: source, file, gzip: true }, [
      "plugin.json",
      "plugin.mjs",
    ]);
    return installPluginForServer(
      server,
      await readFile(file),
      path.basename(file),
    );
  };
  const turnOff = (id: string) =>
    dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/${id}/activation`,
      body: JSON.stringify({ enabled: false }),
    });
  /** The broker the server built, with the gate it gave it. */
  const sessionGate = async () => {
    endSessions.mockClear();
    expect((await turnOff("dev-session")).status).toBe(200);
    const broker = endSessions.mock.contexts[0] as unknown as {
      options: ProcessBrokerOptions;
    };
    return broker.options.sessionGate!;
  };
  return {
    root,
    development,
    server,
    endSessions,
    install,
    turnOff,
    sessionGate,
  };
}

const callerOf = (
  id: string,
  version: string,
  packageKey: string,
  development: boolean,
): BrokerCaller => ({
  pluginId: id,
  manifest: pluginApi4ManifestSchema.parse(manifestJson(id, version)),
  packageKey,
  development,
  method: "syncConnection",
});

describe("Given a plugin with process sessions on the server", () => {
  it("turning it off ends its sessions", async () => {
    const { turnOff, endSessions } = await setup();
    expect((await turnOff("dev-session")).status).toBe(200);
    expect(endSessions).toHaveBeenCalledWith("dev-session");
  });

  it("replacing or uninstalling its package ends its sessions", async () => {
    const { server, install, endSessions } = await setup();
    await install("installed-session", "1.0.0");
    expect(endSessions).not.toHaveBeenCalledWith("installed-session");
    await install("installed-session", "2.0.0");
    expect(endSessions).toHaveBeenCalledWith("installed-session");
    endSessions.mockClear();
    await uninstallPluginForServer(server, "installed-session");
    expect(endSessions).toHaveBeenCalledWith("installed-session");
  });

  it("the session gate finds the package once, and again after a replace or an uninstall", async () => {
    const { server, install, sessionGate } = await setup();
    const gate = await sessionGate();
    await install("installed-session", "1.0.0");
    // An unsigned installed package's key is its version and install time.
    const packages = vi.spyOn(PluginManager.prototype, "processPackage");
    expect(
      await gate(callerOf("installed-session", "1.0.0", "unknown", false)),
    ).toBe("plugin_off");
    const { packageKey } = await packages.mock.results.at(-1)!.value;
    const caller = callerOf("installed-session", "1.0.0", packageKey, false);
    expect(await gate(caller)).toBe(undefined);
    const inspect = vi.spyOn(PluginManager.prototype, "inspectPlugins");
    for (let n = 0; n < 5; n++) expect(await gate(caller)).toBe(undefined);
    expect(inspect).not.toHaveBeenCalled();
    await install("installed-session", "2.0.0");
    expect(await gate(caller)).toBe("plugin_off");
    await uninstallPluginForServer(server, "installed-session");
    expect(await gate(callerOf("installed-session", "2.0.0", "", false))).toBe(
      "plugin_off",
    );
  });

  it("the session gate ends a development package's sessions when its files change, or it is suspended", async () => {
    const { development, sessionGate } = await setup();
    const gate = await sessionGate();
    const caller = callerOf(
      "dev-session",
      "1.0.0",
      await pluginProcessPackageKey(development),
      true,
    );
    expect(await gate(caller)).toBe(undefined);
    const inspect = vi.spyOn(PluginManager.prototype, "inspectPlugins");
    for (let n = 0; n < 5; n++) expect(await gate(caller)).toBe(undefined);
    expect(inspect).not.toHaveBeenCalled();
    const suspension = vi
      .spyOn(PluginManager.prototype, "suspension")
      .mockReturnValue({ cause: "crash", stops: 3, at: 0 } as never);
    expect(await gate(caller)).toBe("plugin_off");
    suspension.mockRestore();
    await writeFile(
      path.join(development, "plugin.mjs"),
      "export const x = 1;",
    );
    await vi.waitFor(async () => expect(await gate(caller)).toBe("plugin_off"));
  });
});

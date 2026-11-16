import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import type { BrokerCaller } from "./broker-port.ts";
import type { ResolvedPlugin } from "./plugin-package.ts";
import {
  createSessionPackageGate,
  identityOf,
} from "./session-package-gate.ts";

const manifest = (version = "1.0.0") =>
  pluginApi4ManifestSchema.parse({
    id: "gate",
    version,
    apiVersion: 4,
    displayName: "Gate",
    iconSvg: "<svg/>",
    entrypoint: "index.js",
    connectionFields: [{ id: "site", label: "Site", type: "text" }],
    capabilities: { connector: {} },
  });

function setup(source: "installed" | "development" = "development") {
  let version = "1.0.0";
  let key = "key-1";
  let present = true;
  let suspended = false;
  let folder: string | undefined = "dev:1";
  const changes: (() => void)[] = [];
  const closed = vi.fn();
  const find = vi.fn(async () =>
    present
      ? ({
          manifest: manifest(version),
          directory: "/plugins/gate",
          source,
          access: {},
        } as unknown as ResolvedPlugin)
      : undefined,
  );
  const processPackage = vi.fn(async () => ({
    packageKey: key,
    development: source === "development",
  }));
  const watch = vi.fn((_directory: string, changed: () => void) => {
    changes.push(changed);
    return { close: closed };
  });
  const identify = vi.fn(
    async (): Promise<string | null | undefined> => folder,
  );
  const gate = createSessionPackageGate({
    suspended: () => suspended,
    find,
    processPackage,
    watch,
    identify,
  });
  const caller = (v = "1.0.0", packageKey = "key-1"): BrokerCaller => ({
    pluginId: "gate",
    manifest: manifest(v),
    packageKey,
    development: source === "development",
    method: "syncConnection",
  });
  return {
    gate,
    find,
    processPackage,
    watch,
    identify,
    closed,
    caller,
    change: () => changes.at(-1)!(),
    set: (next: {
      version?: string;
      key?: string;
      present?: boolean;
      suspended?: boolean;
      /** The folder's identity, or null once it is gone. */
      folder?: string | null;
    }) => {
      if (next.folder !== undefined) folder = next.folder ?? undefined;
      version = next.version ?? version;
      key = next.key ?? key;
      present = next.present ?? present;
      suspended = next.suspended ?? suspended;
    },
  };
}

describe("Given a session's package gate", () => {
  it("finds the package once, however often a session calls", async () => {
    const { gate, find, processPackage, caller } = setup();
    for (let n = 0; n < 5; n++)
      expect(await gate.check(caller())).toBe(undefined);
    expect(find).toHaveBeenCalledOnce();
    expect(processPackage).toHaveBeenCalledOnce();
  });

  it("finds it again after an install, a replace or an uninstall says so", async () => {
    const { gate, find, caller, set } = setup("installed");
    await gate.check(caller());
    set({ version: "2.0.0" });
    // Unsaid, the change isn't seen.
    expect(await gate.check(caller())).toBe(undefined);
    gate.invalidate("gate");
    expect(await gate.check(caller())).toBe("plugin_off");
    expect(await gate.check(caller("2.0.0"))).toBe(undefined);
    gate.invalidate("gate");
    set({ present: false });
    expect(await gate.check(caller("2.0.0"))).toBe("plugin_off");
    expect(find).toHaveBeenCalledTimes(3);
  });

  it("finds a development package again when its folder changes", async () => {
    const { gate, watch, closed, caller, change, set } = setup();
    await gate.check(caller());
    expect(watch).toHaveBeenCalledWith("/plugins/gate", expect.any(Function));
    set({ key: "key-2" });
    change();
    expect(closed).toHaveBeenCalled();
    expect(await gate.check(caller())).toBe("plugin_off");
    expect(await gate.check(caller("1.0.0", "key-2"))).toBe(undefined);
  });

  it("finds a development package again when its folder moves or goes, though no change was heard", async () => {
    const { gate, find, closed, caller, set } = setup();
    await gate.check(caller());
    // Windows hears nothing when the watched folder itself is renamed.
    set({ folder: "dev:2" });
    expect(await gate.check(caller())).toBe(undefined);
    expect(find).toHaveBeenCalledTimes(2);
    expect(closed).toHaveBeenCalledOnce();
    set({ folder: null, present: false });
    expect(await gate.check(caller())).toBe("plugin_off");
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it("doesn't trust a folder with no identity, and finds it again every 10 s", async () => {
    vi.useFakeTimers();
    try {
      const { gate, find, identify, caller, set } = setup();
      // Some file systems give no file id: a stat says inode 0.
      identify.mockResolvedValue(null);
      expect(await gate.check(caller())).toBe(undefined);
      expect(await gate.check(caller())).toBe(undefined);
      expect(find).toHaveBeenCalledOnce();
      // Replaced with no change heard, and no identity to tell.
      set({ key: "key-2" });
      await vi.advanceTimersByTimeAsync(9000);
      expect(await gate.check(caller())).toBe(undefined);
      expect(find).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await gate.check(caller())).toBe("plugin_off");
      expect(find).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finds a package whose folder identity changes on every check at most every 10 s", async () => {
    vi.useFakeTimers();
    try {
      const { gate, find, identify, caller } = setup();
      let next = 0;
      identify.mockImplementation(async () => `dev:${next++}`);
      for (let i = 0; i < 20; i += 1)
        expect(await gate.check(caller())).toBe(undefined);
      // Found, then found again once at the first change.
      expect(find).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(9999);
      await gate.check(caller());
      expect(find).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      for (let i = 0; i < 20; i += 1) await gate.check(caller());
      expect(find).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks nothing of an installed package's folder", async () => {
    const { gate, identify, caller } = setup("installed");
    await gate.check(caller());
    await gate.check(caller());
    expect(identify).not.toHaveBeenCalled();
  });

  it("watches no installed package", async () => {
    const { gate, watch, caller } = setup("installed");
    await gate.check(caller());
    expect(watch).not.toHaveBeenCalled();
  });

  it("checks suspension on every call, without finding the package", async () => {
    const { gate, find, caller, set } = setup();
    await gate.check(caller());
    set({ suspended: true });
    expect(await gate.check(caller())).toBe("plugin_off");
    set({ suspended: false });
    expect(await gate.check(caller())).toBe(undefined);
    expect(find).toHaveBeenCalledOnce();
  });

  it("keeps no answer for a package it couldn't find", async () => {
    const { gate, find, caller, set } = setup();
    set({ present: false });
    expect(await gate.check(caller())).toBe("plugin_off");
    set({ present: true });
    expect(await gate.check(caller())).toBe(undefined);
    find.mockRejectedValueOnce(new Error("Plugin host stopped."));
    gate.invalidate("gate");
    expect(await gate.check(caller())).toBe("plugin_off");
    expect(await gate.check(caller())).toBe(undefined);
  });

  it("a change while the package is being found is not lost", async () => {
    const { gate, processPackage, caller, change, set } = setup();
    let release!: () => void;
    processPackage.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return { packageKey: "key-1", development: true };
    });
    const first = gate.check(caller());
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    set({ key: "key-2" });
    change();
    release();
    expect(await first).toBe(undefined);
    expect(await gate.check(caller())).toBe("plugin_off");
  });

  it("forgets a plugin and stops watching when told, and on close", async () => {
    const { gate, closed, caller } = setup();
    await gate.check(caller());
    gate.invalidate("gate");
    expect(closed).toHaveBeenCalledOnce();
    await gate.check(caller());
    gate.close();
    expect(closed).toHaveBeenCalledTimes(2);
  });
});

describe("Given a development package's real folder", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
    );
  });

  it("turns the plugin off once its folder is renamed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-gate-"));
    roots.push(root);
    const directory = path.join(root, "gate");
    await mkdir(directory);
    // Found as the host finds it: only while its folder is there.
    const find = vi.fn(async () =>
      existsSync(directory)
        ? ({
            manifest: manifest(),
            directory,
            source: "development",
            access: {},
          } as unknown as ResolvedPlugin)
        : undefined,
    );
    const gate = createSessionPackageGate({
      suspended: () => false,
      find,
      processPackage: async () => ({ packageKey: "key-1", development: true }),
    });
    const caller: BrokerCaller = {
      pluginId: "gate",
      manifest: manifest(),
      packageKey: "key-1",
      development: true,
      method: "syncConnection",
    };
    try {
      expect(await gate.check(caller)).toBe(undefined);
      await rename(directory, path.join(root, "moved"));
      expect(await gate.check(caller)).toBe("plugin_off");
    } finally {
      gate.close();
    }
  });
});

describe("Given a folder's stat", () => {
  const stats = (ino: bigint, directory = true) => ({
    dev: 7n,
    ino,
    isDirectory: () => directory,
  });

  it("is the folder's device and inode", () => {
    expect(identityOf(stats(42n))).toBe("7:42");
  });

  it("is no identity to trust when the inode is 0", () => {
    expect(identityOf(stats(0n))).toBe(null);
  });

  it("is nothing for what isn't a folder", () => {
    expect(identityOf(stats(42n, false))).toBe(undefined);
  });
});

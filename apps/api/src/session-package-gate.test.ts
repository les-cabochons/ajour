import { describe, expect, it, vi } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import type { BrokerCaller } from "./broker-port.ts";
import type { ResolvedPlugin } from "./plugin-package.ts";
import { createSessionPackageGate } from "./session-package-gate.ts";

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
  const gate = createSessionPackageGate({
    suspended: () => suspended,
    find,
    processPackage,
    watch,
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
    closed,
    caller,
    change: () => changes.at(-1)!(),
    set: (next: {
      version?: string;
      key?: string;
      present?: boolean;
      suspended?: boolean;
    }) => {
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

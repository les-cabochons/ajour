import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AppApiStorage } from "./storage.ts";
import { ProcessBroker } from "./process-broker.ts";
import { processConsentGate } from "./plugin-consent.ts";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { summarizePluginAccess } from "../../../packages/shared/plugin-access.ts";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-gates-"));
  roots.push(root);
  const storage = new AppApiStorage(path.join(root, "state.json"));
  const manifest = pluginApi4ManifestSchema.parse({
    id: "gate-test",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "Gate test",
    iconSvg: "<svg/>",
    entrypoint: "index.js",
    connectionFields: [{ id: "url", label: "URL", type: "url" }],
    capabilities: { connector: {} },
    processes: {
      executables: { node: { names: ["node"] } },
      commands: [
        {
          id: "version",
          executable: "node",
          args: ["--version"],
          mode: "capture",
          timeoutSeconds: 10,
        },
      ],
    },
  });
  await storage.recordPluginConsent(manifest.id, {
    version: manifest.version,
    access: summarizePluginAccess(manifest, { agentPrompts: {} }),
    at: 1,
  });
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    gate: (c) => processConsentGate(storage, c),
    executableOverride: async () => process.execPath,
  });
  const caller = { pluginId: manifest.id, manifest, method: "syncConnection" };
  const op = broker.forOperation(caller);
  return { root, storage, manifest, broker, caller, op };
}
it.each([
  ["switch off", false, false, "unsigned_processes_off"],
  ["no acceptance", true, false, "process_acceptance_required"],
  ["both on", true, true, undefined],
] as const)(
  "Given %s, the broker enforces the unsigned gates with real storage",
  async (_, enabled, accepted, reason) => {
    const { storage, manifest, op } = await fixture();
    await storage.setUnsignedPluginProcessesEnabled(enabled);
    if (accepted)
      await storage.setPluginProcessAcceptance(
        manifest.id,
        manifest.version,
        true,
      );
    const run = op.run({ command: "version", args: {} });
    if (reason) await expect(run).rejects.toMatchObject({ reason });
    else expect((await run).exitCode).toBe(0);
  },
);
it("Given gates changed during an operation, the next broker call rechecks them", async () => {
  const { storage, manifest, op } = await fixture();
  await storage.setUnsignedPluginProcessesEnabled(true);
  await storage.setPluginProcessAcceptance(manifest.id, manifest.version, true);
  expect((await op.run({ command: "version", args: {} })).exitCode).toBe(0);
  await storage.setUnsignedPluginProcessesEnabled(false);
  await expect(op.run({ command: "version", args: {} })).rejects.toMatchObject({
    reason: "unsigned_processes_off",
  });
});
it.each(["version", "package"] as const)(
  "Given a changed %s, old acceptance cannot start a process",
  async (kind) => {
    const { storage, manifest, broker, caller } = await fixture();
    await storage.setUnsignedPluginProcessesEnabled(true);
    await storage.setPluginProcessAcceptance(
      manifest.id,
      manifest.version,
      true,
    );
    if (kind === "version") manifest.version = "2.0.0";
    else
      await storage.setPluginOrigin(manifest.id, {
        kind: "file",
        signed: false,
        installedAt: new Date().toISOString(),
      });
    await expect(
      broker.forOperation(caller).run({ command: "version", args: {} }),
    ).rejects.toMatchObject({ reason: "process_acceptance_required" });
  },
);
it("Given a signed source plugin, unsigned process gates do not apply", async () => {
  const { storage, manifest, op } = await fixture();
  await storage.setPluginOrigin(manifest.id, {
    kind: "source",
    signed: true,
    installedAt: new Date().toISOString(),
  });
  expect((await op.run({ command: "version", args: {} })).exitCode).toBe(0);
});
it("Given a development directory shadowing a signed plugin, both gates still apply", async () => {
  const { storage, manifest, caller, broker } = await fixture();
  await storage.setPluginOrigin(manifest.id, {
    kind: "source",
    signed: true,
    installedAt: new Date().toISOString(),
  });
  const dev = broker.forOperation({
    ...caller,
    development: true,
    packageKey: "dev-a",
  });
  await expect(dev.run({ command: "version", args: {} })).rejects.toMatchObject(
    { reason: "unsigned_processes_off" },
  );
  await storage.setUnsignedPluginProcessesEnabled(true);
  await expect(dev.run({ command: "version", args: {} })).rejects.toMatchObject(
    { reason: "process_acceptance_required" },
  );
  await storage.setPluginProcessAcceptance(manifest.id, "dev-a", true);
  expect((await dev.run({ command: "version", args: {} })).exitCode).toBe(0);
  await expect(
    broker
      .forOperation({ ...caller, development: true, packageKey: "dev-b" })
      .run({ command: "version", args: {} }),
  ).rejects.toMatchObject({ reason: "process_acceptance_required" });
});
it("Given saved gates, an API reload preserves acceptance", async () => {
  const { root, storage, manifest, caller } = await fixture();
  await storage.setUnsignedPluginProcessesEnabled(true);
  await storage.setPluginProcessAcceptance(manifest.id, manifest.version, true);
  const reloaded = new AppApiStorage(path.join(root, "state.json"));
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    gate: (c) => processConsentGate(reloaded, c),
    executableOverride: async () => process.execPath,
  });
  expect(
    (await broker.forOperation(caller).run({ command: "version", args: {} }))
      .exitCode,
  ).toBe(0);
});

it("a late operation with an old key cannot revoke a newer acceptance", async () => {
  const { storage, manifest } = await fixture();
  await storage.setPluginProcessAcceptance(manifest.id, "new-package", true);
  expect(
    (await storage.getPluginProcessGate(manifest.id, "old-package")).accepted,
  ).toBe(false);
  expect(
    (await storage.getPluginProcessGate(manifest.id, "new-package")).accepted,
  ).toBe(true);
});

it("an unverifiable package refuses only its process broker calls", async () => {
  const { caller, broker } = await fixture();
  await expect(
    broker
      .forOperation({ ...caller, packageVerificationFailed: true })
      .run({ command: "version", args: {} }),
  ).rejects.toMatchObject({ reason: "package_unverified" });
});

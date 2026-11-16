import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { secretManifestOf } from "./connection-credentials.ts";
import { handoffConnectionAddress } from "./handoff-connection-address.ts";
import { ProcessBroker } from "./process-broker.ts";
import { FolderResolver } from "./repository-folders.ts";
import { AppApiStorage } from "./storage.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";

// A `connection-url` argument reads the connection as it is now, at each
// command, without decrypting its secrets: what pauses the connection for
// the credential broker refuses the address too.

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

async function fixture(options: { allowOnPremises?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-handoff-address-"));
  roots.push(root);
  const script = path.join(root, "tool.cjs");
  await writeFile(
    script,
    "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
  );
  const manifest = pluginApi4ManifestSchema.parse({
    id: "opencode",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "OpenCode",
    iconSvg: "<svg/>",
    entrypoint: "index.js",
    connectionFields: [
      { id: "serverUrl", label: "Server URL", type: "url", required: true },
      {
        id: "token",
        label: "Token",
        type: "password",
        secret: true,
        required: true,
      },
    ],
    network: {
      baseAddress: {
        field: "serverUrl",
        allowOnPremises: options.allowOnPremises ?? true,
      },
    },
    capabilities: {
      handoff: {
        tools: [
          {
            id: "opencode",
            label: "OpenCode",
            iconSvg: "<svg/>",
            settings: [],
            connection: "required",
          },
        ],
      },
    },
    processes: {
      executables: { node: { names: ["node"] } },
      commands: [
        {
          id: "attach",
          executable: "node",
          args: [
            { kind: "literal", value: script },
            "attach",
            "{server:connection-url}",
          ],
          mode: "capture",
        },
      ],
    },
  });
  const vault = new MemorySecretVault();
  const storage = new AppApiStorage(path.join(root, "state.json"), { vault });
  const connection = await storage.upsertConnection(
    manifest.id,
    {
      label: "Local",
      tenantLabel: "",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      onPremises: true,
      config: { serverUrl: "http://127.0.0.1:4096", token: "tok-5e1f" },
      configSummary: {},
    },
    { fields: secretManifestOf(manifest).connectionFields },
  );
  const broker = new ProcessBroker({
    folders: new FolderResolver(storage, {}),
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
    connectionAddress: (caller) => handoffConnectionAddress(storage, caller),
  });
  const operation = broker.forOperation({
    pluginId: manifest.id,
    manifest,
    method: "startHandoff",
    projectId: "p",
    connectionId: connection.id,
  });
  const attach = () => operation.run({ command: "attach", args: {} });
  return { storage, vault, connection, attach };
}

it("fills the address from the saved connection without decrypting its secrets", async () => {
  const { vault, attach } = await fixture();
  const before = vault.decryptAttempts;

  const result = await attach();

  expect(JSON.parse(result.stdout!)).toEqual([
    "attach",
    "http://127.0.0.1:4096",
  ]);
  expect(vault.decryptAttempts).toBe(before);
});

it.each([
  [
    "its required token is removed",
    (f: Awaited<ReturnType<typeof fixture>>) =>
      f.storage.removeConnectionSecrets("opencode", f.connection.id, ["token"]),
  ],
  [
    "its token is rejected",
    (f: Awaited<ReturnType<typeof fixture>>) =>
      f.storage.markSecretsRejected("opencode", f.connection.id),
  ],
  [
    "a broker request found its token unreadable",
    async (f: Awaited<ReturnType<typeof fixture>>) => {
      const key = {
        pluginId: "opencode",
        connectionId: f.connection.id,
        fieldId: "token",
      };
      f.vault.corrupt(key);
      await f.vault.read([key]);
    },
  ],
  [
    "it is deleted",
    (f: Awaited<ReturnType<typeof fixture>>) =>
      f.storage.deleteConnection("opencode", f.connection.id),
  ],
])(
  "refuses the next connection-url command of an operation once %s",
  async (_case, change) => {
    const f = await fixture();
    await expect(f.attach()).resolves.toMatchObject({ exitCode: 0 });

    await change(f);

    await expect(f.attach()).rejects.toMatchObject({
      reason: "connection_refused",
    });
  },
);

it("refuses a private address once the manifest no longer allows on-premises", async () => {
  const { attach } = await fixture({ allowOnPremises: false });
  await expect(attach()).rejects.toMatchObject({
    reason: "connection_refused",
  });
});

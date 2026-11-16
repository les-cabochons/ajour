import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AppApiStorage } from "./storage.ts";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup(signed = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "command-policy-"));
  roots.push(root);
  const storage = new AppApiStorage(path.join(root, "state.json"));
  await storage.setPluginOrigin("p", {
    kind: "file",
    signed,
    installedAt: "2026-11-16T00:00:00Z",
  });
  return storage;
}
it.each([
  [true, false, "auto"],
  [false, false, "always-ask"],
  [true, true, "always-ask"],
] as const)(
  "Given signed %s and development %s, default is %s",
  async (signed, dev, mode) => {
    expect(
      (await (await setup(signed)).commandPolicy("p", "v1", dev)).mode,
    ).toBe(mode);
  },
);
it("Given a lost signature, mode stays Always ask after a later signed install", async () => {
  const s = await setup(true);
  await s.saveCommandPolicy("p", {
    ...(await s.commandPolicy("p", "v1", false)),
    mode: "accept-everything",
  });
  await s.setPluginOrigin("p", {
    kind: "file",
    signed: false,
    installedAt: "2026-11-16T01:00:00Z",
  });
  expect((await s.commandPolicy("p", "v2", false)).mode).toBe("always-ask");
  await s.setPluginOrigin("p", {
    kind: "file",
    signed: true,
    installedAt: "2026-11-16T02:00:00Z",
  });
  expect((await s.commandPolicy("p", "v3", false)).mode).toBe("always-ask");
});
it.each(["version-change", "package-change", "development-directory-change"])(
  "Given %s, remembered approvals stop counting",
  async (identity) => {
    const s = await setup();
    const policy = await s.commandPolicy("p", "v1", true);
    await s.saveCommandPolicy("p", {
      ...policy,
      approvals: [
        { id: "a", executable: "git", argv: ["status"], cwdFolder: "folder" },
      ],
    });
    expect((await s.commandPolicy("p", "v1", true)).approvals).toHaveLength(1);
    expect((await s.commandPolicy("p", identity, true)).approvals).toEqual([]);
    expect((await s.commandPolicy("p", "v1", true)).approvals).toEqual([]);
  },
);

it("Given concurrent user mode and approval writes, both survive", async () => {
  const storage = await setup(true);
  await Promise.all([
    storage.changeCommandPolicy("p", "v1", false, (policy) => ({
      ...policy,
      mode: "always-ask",
    })),
    storage.changeCommandPolicy("p", "v1", false, (policy) => ({
      ...policy,
      approvals: [
        ...policy.approvals,
        { id: "a", executable: "git", argv: ["status"] },
      ],
    })),
  ]);
  expect(await storage.commandPolicy("p", "v1", false)).toMatchObject({
    mode: "always-ask",
    approvals: [{ id: "a" }],
  });
});

it("Given a stale ask, it cannot overwrite a newer policy identity", async () => {
  const s = await setup(true);
  const old = await s.commandPolicy("p", "v1", false);
  await s.changeCommandPolicy("p", "v2", false, (p) => ({
    ...p,
    approvals: [{ id: "new", executable: "git", argv: ["status"] }],
  }));
  await s.changeCommandPolicy(
    "p",
    "v1",
    false,
    (p) => ({
      ...p,
      approvals: [{ id: "stale", executable: "git", argv: [] }],
    }),
    old,
  );
  expect(
    (await s.commandPolicy("p", "v2", false)).approvals.map((a) => a.id),
  ).toEqual(["new"]);
});
it("Given an invalid saved policy, preserves process overrides, acceptance and activity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "command-policy-"));
  roots.push(root);
  const file = path.join(root, "state.json");
  const initial = new AppApiStorage(file);
  await initial.setPluginOrigin("p", {
    kind: "file",
    signed: false,
    installedAt: "2026-11-16T00:00:00Z",
  });
  const raw = JSON.parse(await readFile(file, "utf8"));
  raw.pluginProcesses = {
    p: {
      overrides: { git: "C:/git.exe" },
      acceptance: "accepted",
      lastRunAt: 123,
      refusedCount: 7,
      commandPolicy: { mode: "bad" },
    },
  };
  await writeFile(file, JSON.stringify(raw));
  const s = new AppApiStorage(file);
  expect(await s.getPluginProcessSettings("p")).toMatchObject({
    overrides: { git: "C:/git.exe" },
    lastRunAt: 123,
    refusedCount: 7,
  });
});

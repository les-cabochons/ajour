import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppApiStorage } from "./storage.ts";
import {
  holdVersion,
  runStateMigrations,
  STATE_MIGRATIONS,
  STATE_VERSION,
  storedStateVersion,
  type StateMigration,
} from "./state-migrations.ts";

describe("state migrations", () => {
  it("adds handoffs at version 12 without changing existing folders or connections", async () => {
    const state = {
      version: 11,
      connections: [{ id: "connection" }],
      repositoryFolders: [{ id: "folder" }],
    };
    expect(await runStateMigrations(state, 11)).toEqual({
      ...state,
      version: 14,
      handoffs: [],
      handoffEnabledTools: {},
      worktrees: [],
      worktreeSettings: { startIn: "worktree" },
    });
  });

  it("turns on at version 13 only the tools this device already handed off to", async () => {
    const state = {
      version: 12,
      handoffs: [
        { id: "a", pluginId: "agent-handoff", toolId: "t3" },
        { id: "b", pluginId: "agent-handoff", toolId: "t3" },
        { id: "c", pluginId: "agent-handoff", toolId: "codex" },
        { id: "d", pluginId: "other", toolId: "cli" },
        { id: "e", pluginId: "__proto__", toolId: "t3" },
        { id: "f", pluginId: "agent-handoff" },
        null,
      ],
    };
    expect(await runStateMigrations(state, 12)).toEqual({
      ...state,
      version: 14,
      handoffEnabledTools: {
        "agent-handoff": ["t3", "codex"],
        other: ["cli"],
      },
      worktrees: [],
      worktreeSettings: { startIn: "worktree" },
    });
  });

  it("starts every tool off at version 13 on a device that never handed off", async () => {
    expect(await runStateMigrations({ version: 12, handoffs: [] }, 12)).toEqual(
      {
        version: 14,
        handoffs: [],
        handoffEnabledTools: {},
        worktrees: [],
        worktreeSettings: { startIn: "worktree" },
      },
    );
  });

  it("opens a version 13 file at version 14 with no worktrees and hand offs starting in a new worktree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "state-v13-"));
    try {
      const file = path.join(root, "state.json");
      const folder = { id: "folder", projectId: "p", name: "repo", path: root };
      await writeFile(
        file,
        JSON.stringify({
          version: 13,
          connections: [],
          handoffs: [],
          handoffEnabledTools: { "agent-handoff": ["codex"] },
          repositoryFolders: [folder],
        }),
      );
      const storage = new AppApiStorage(file);
      expect(await storage.listWorktrees()).toEqual([]);
      // With the clean-up rules of a fresh install (#864).
      expect(await storage.getWorktreeSettings()).toEqual({
        startIn: "worktree",
        cleanUp: {
          finished: { enabled: true, days: 3 },
          unused: { enabled: false, days: 30 },
        },
      });
      // What the file held stays, and the file is saved at the new version.
      expect(await storage.listRepositoryFolders()).toEqual([folder]);
      expect(await storage.getEnabledHandoffTools("agent-handoff")).toEqual([
        "codex",
      ]);
      await storage.setWorktreeSettings({ startIn: "main" });
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
        version: 14,
        worktrees: [],
        worktreeSettings: { startIn: "main" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads a version 14 file written before #861 with no source picked, keeps Ask each time, and forgets a removed folder's source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "state-v14-"));
    try {
      const file = path.join(root, "state.json");
      const folder = { id: "folder", projectId: "p", name: "repo", path: root };
      await writeFile(
        file,
        JSON.stringify({
          version: 14,
          connections: [],
          handoffs: [],
          repositoryFolders: [folder],
          worktrees: [],
          worktreeSettings: { startIn: "worktree" },
        }),
      );
      const storage = new AppApiStorage(file);
      expect(await storage.getWorktreeSource("folder")).toBeUndefined();

      await storage.setWorktreeSettings({ startIn: "ask" });
      await storage.rememberWorktreeSource("p", "folder", "develop");
      // A folder the project doesn't have keeps nothing.
      await storage.rememberWorktreeSource("p", "gone", "develop");
      const reopened = new AppApiStorage(file);
      expect(await reopened.getWorktreeSettings()).toMatchObject({
        startIn: "ask",
      });
      expect(await reopened.getWorktreeSource("folder")).toBe("develop");
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
        version: 14,
        worktreeSources: { folder: "develop" },
      });

      await reopened.removeRepositoryFolder("p", "folder");
      expect(await reopened.getWorktreeSource("folder")).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads a version 14 file written before #864 with its Start in, the two clean-up rules at their defaults and no project choice", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "state-v14-clean-up-"));
    try {
      const file = path.join(root, "state.json");
      await writeFile(
        file,
        JSON.stringify({
          version: 14,
          connections: [],
          handoffs: [],
          repositoryFolders: [],
          worktrees: [],
          // As #860 wrote it: Start in alone.
          worktreeSettings: { startIn: "main" },
          worktreeSources: {},
        }),
      );
      const storage = new AppApiStorage(file);
      expect(await storage.getWorktreeSettings()).toEqual({
        startIn: "main",
        cleanUp: {
          finished: { enabled: true, days: 3 },
          unused: { enabled: false, days: 30 },
        },
      });
      expect(await storage.getProjectStartIn("p")).toEqual({
        settings: "main",
      });

      // A change names what it changes, and the rest stays.
      await storage.setWorktreeSettings({
        cleanUp: { unused: { enabled: true, days: 14 } },
      });
      await storage.setProjectStartIn("p", "ask");
      const reopened = new AppApiStorage(file);
      expect(await reopened.getWorktreeSettings()).toEqual({
        startIn: "main",
        cleanUp: {
          finished: { enabled: true, days: 3 },
          unused: { enabled: true, days: 14 },
        },
      });
      expect(await reopened.getProjectStartIn("p")).toEqual({
        override: "ask",
        settings: "main",
      });
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
        version: 14,
        worktreeProjectStartIn: { p: "ask" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a rule Ajour can read and gives the other its default when the state file holds one malformed rule", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "state-v14-rules-"));
    try {
      const file = path.join(root, "state.json");
      await writeFile(
        file,
        JSON.stringify({
          version: 14,
          connections: [],
          handoffs: [],
          repositoryFolders: [],
          worktreeSettings: {
            startIn: "ask",
            cleanUp: {
              finished: { enabled: false, days: 7 },
              unused: { enabled: "yes", days: -1 },
            },
          },
          worktreeProjectStartIn: { p: "main", q: "nowhere" },
        }),
      );
      const storage = new AppApiStorage(file);
      expect(await storage.getWorktreeSettings()).toEqual({
        startIn: "ask",
        cleanUp: {
          finished: { enabled: false, days: 7 },
          unused: { enabled: false, days: 30 },
        },
      });
      expect(await storage.getProjectStartIn("p")).toMatchObject({
        override: "main",
      });
      expect(await storage.getProjectStartIn("q")).toEqual({ settings: "ask" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  const trail = (version: number): StateMigration => ({
    version,
    migrate: (state) => ({
      ...state,
      trail: [...(state.trail as number[]), version],
    }),
  });

  it("runs each step above the stored version, in order, and stamps the version it reached", async () => {
    await expect(
      runStateMigrations({ trail: [] }, 2, [trail(2), trail(3), trail(5)]),
    ).resolves.toEqual({ version: 5, trail: [3, 5] });
  });

  it("runs no step for a file at the current version, or above it", async () => {
    for (const version of [5, 10]) {
      await expect(
        runStateMigrations({ version, trail: [] }, version, [
          trail(2),
          trail(5),
        ]),
      ).resolves.toEqual({ version: 5, trail: [] });
    }
  });

  it("keeps the version before a step that holds it, with what the step did, and runs no later step", async () => {
    const held: StateMigration = {
      version: 4,
      migrate: async (state) =>
        holdVersion({ ...state, trail: [...(state.trail as number[]), 4] }),
    };
    await expect(
      runStateMigrations({ trail: [] }, 2, [trail(3), held, trail(5)]),
    ).resolves.toEqual({ version: 3, trail: [3, 4] });
    // The next load runs the held step again.
    await expect(
      runStateMigrations({ version: 3, trail: [3, 4] }, 3, [
        trail(3),
        trail(4),
        trail(5),
      ]),
    ).resolves.toEqual({ version: 5, trail: [3, 4, 4, 5] });
  });

  it("gives every step the load's context", async () => {
    const seen: unknown[] = [];
    const context = { manifests: new Map() };
    await runStateMigrations(
      {},
      1,
      [
        {
          version: 2,
          migrate: (state, given) => {
            seen.push(given);
            return state;
          },
        },
      ],
      context,
    );
    expect(seen).toEqual([context]);
  });

  it("ends at the current version, the last step's", () => {
    expect(STATE_VERSION).toBe(14);
    expect(STATE_MIGRATIONS.at(-1)?.version).toBe(STATE_VERSION);
    const versions = STATE_MIGRATIONS.map((step) => step.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it("makes every connection read only at version 9, and keeps access a user already chose", async () => {
    // Version 8 can be held while secrets move, and the user may change a
    // connection's access meanwhile: running step 9 again keeps that choice.
    const toVersion9 = STATE_MIGRATIONS.find((step) => step.version === 9)!;
    const migrated = await runStateMigrations(
      {
        version: 8,
        connections: [
          { id: "old" },
          { id: "chosen", access: ["editWorkItems"] },
          { id: "broken", access: "editWorkItems" },
        ],
      },
      8,
      [toVersion9],
    );

    expect(migrated.connections).toEqual([
      { id: "old", access: [] },
      { id: "chosen", access: ["editWorkItems"] },
      { id: "broken", access: [] },
    ]);
    expect(await runStateMigrations(migrated, 8, [toVersion9])).toEqual(
      migrated,
    );
  });

  describe("the GitHub address rewrite at version 10 (#403)", () => {
    const toVersion10 = STATE_MIGRATIONS.find((step) => step.version === 10)!;
    const connection = (
      pluginId: string,
      hostUrl: unknown,
      extra: Record<string, unknown> = {},
    ) => ({
      id: `${pluginId}_main`,
      pluginId,
      label: "Work",
      config: { hostUrl, include: "acme" },
      configSummary: { host: "www.github.com", login: "octocat" },
      ...extra,
    });
    const run = (state: Record<string, unknown>) =>
      runStateMigrations({ version: 9, ...state }, 9, [toVersion10]);

    it.each([
      "http://github.com",
      "http://www.github.com",
      "https://www.github.com",
      "https://WWW.GITHUB.COM:8443/ignored/path?query=1#fragment",
      "https://github.com:8443",
      "HTTP://GitHub.com:80/",
      "https://GITHUB.COM:443/ignored/path?query=1#fragment",
    ])(
      "saves %s as https://github.com, keeping the rest of the connection",
      async (saved) => {
        const migrated = await run({
          connections: [connection("github", saved)],
        });

        expect(migrated.connections).toEqual([
          connection("github", "https://github.com", {
            configSummary: { host: "github.com", login: "octocat" },
          }),
        ]);
      },
    );

    it("leaves GitHub Enterprise, other plugins, other fields and unreadable values alone", async () => {
      const connections = [
        connection("github", "https://github.acme.com"),
        connection("github", "https://api.github.com"),
        connection("github", "https://github.com"),
        connection("github", undefined),
        connection("github", "not a url"),
        connection("jira", "http://www.github.com"),
        { id: "odd" },
        "odd",
      ];

      expect((await run({ connections })).connections).toEqual(connections);
    });

    it("rewrites only the official GitHub plugin, not one from another source", async () => {
      const connections = [connection("github", "http://github.com")];
      const origin = (
        official?: boolean,
        kind: "source" | "file" = "source",
      ) => ({
        kind,
        signed: official === true,
        installedAt: "2026-11-01T00:00:00.000Z",
        ...(official === undefined ? {} : { official }),
      });

      for (const pluginOrigins of [
        {},
        { github: origin(true) },
        { github: origin(undefined, "file") },
      ]) {
        expect(
          (await run({ connections, pluginOrigins })).connections,
        ).toMatchObject([{ config: { hostUrl: "https://github.com" } }]);
      }
      expect(
        (await run({ connections, pluginOrigins: { github: origin(false) } }))
          .connections,
      ).toEqual(connections);
    });

    it("is idempotent", async () => {
      const once = await run({
        connections: [connection("github", "http://www.github.com")],
      });
      expect(await runStateMigrations(once, 9, [toVersion10])).toEqual(once);
    });
  });

  it("tells a file's version by its number from version 5, and by its shape before", () => {
    expect(storedStateVersion({ version: 6, connections: [] })).toBe(6);
    expect(storedStateVersion({ version: 7, connections: [] })).toBe(7);
    expect(storedStateVersion({ version: 8, connections: [] })).toBe(8);
    // Plugin connections came with version 5.
    expect(storedStateVersion({ connections: [] })).toBe(5);
    expect(storedStateVersion({ version: 3, connections: [] })).toBe(5);
    expect(storedStateVersion({ version: 2, stagedImports: [] })).toBe(2);
    expect(storedStateVersion({ stagedImports: [] })).toBe(2);
    expect(storedStateVersion({ version: 2 })).toBe(2);
    expect(storedStateVersion({})).toBe(1);
    expect(storedStateVersion({ version: 7 })).toBe(1);
    // A later version than this build knows keeps its own number.
    expect(storedStateVersion({ version: 12, connections: [] })).toBe(12);
  });
});

import { describe, expect, it } from "vitest";
import {
  holdVersion,
  runStateMigrations,
  STATE_MIGRATIONS,
  STATE_VERSION,
  storedStateVersion,
  type StateMigration,
} from "./state-migrations.ts";

describe("state migrations", () => {
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
    expect(STATE_VERSION).toBe(10);
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

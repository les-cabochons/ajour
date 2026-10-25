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
    for (const version of [5, 9]) {
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
    expect(STATE_VERSION).toBe(8);
    expect(STATE_MIGRATIONS.at(-1)?.version).toBe(STATE_VERSION);
    const versions = STATE_MIGRATIONS.map((step) => step.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
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

import { describe, expect, it } from "vitest";
import {
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

  it("runs each step above the stored version, in order, and stamps the version it reached", () => {
    expect(
      runStateMigrations({ trail: [] }, 2, [trail(2), trail(3), trail(5)]),
    ).toEqual({ version: 5, trail: [3, 5] });
  });

  it("runs no step for a file at the current version, or above it", () => {
    for (const version of [5, 9]) {
      expect(
        runStateMigrations({ version, trail: [] }, version, [
          trail(2),
          trail(5),
        ]),
      ).toEqual({ version: 5, trail: [] });
    }
  });

  it("ends at the current version, the last step's", () => {
    expect(STATE_VERSION).toBe(7);
    expect(STATE_MIGRATIONS.at(-1)?.version).toBe(STATE_VERSION);
    const versions = STATE_MIGRATIONS.map((step) => step.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it("tells a file's version by its number from version 5, and by its shape before", () => {
    expect(storedStateVersion({ version: 6, connections: [] })).toBe(6);
    expect(storedStateVersion({ version: 7, connections: [] })).toBe(7);
    // Plugin connections came with version 5.
    expect(storedStateVersion({ connections: [] })).toBe(5);
    expect(storedStateVersion({ version: 3, connections: [] })).toBe(5);
    expect(storedStateVersion({ version: 2, stagedImports: [] })).toBe(2);
    expect(storedStateVersion({ stagedImports: [] })).toBe(2);
    expect(storedStateVersion({ version: 2 })).toBe(2);
    expect(storedStateVersion({})).toBe(1);
    expect(storedStateVersion({ version: 7 })).toBe(1);
    // A later version than this build knows reads as the current one.
    expect(storedStateVersion({ version: 12, connections: [] })).toBe(12);
  });
});

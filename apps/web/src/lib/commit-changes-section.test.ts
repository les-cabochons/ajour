import { describe, expect, it } from "vitest";
import {
  COMMIT_CHANGES_SECTION_STORAGE_KEY,
  readCommitChangesSectionPreference,
  writeCommitChangesSectionPreference,
} from "./commit-changes-section";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("commit changes section preference", () => {
  it("defaults to expanded when nothing or something unknown is saved", () => {
    expect(readCommitChangesSectionPreference(memoryStorage())).toBe(
      "expanded",
    );
    expect(
      readCommitChangesSectionPreference(
        memoryStorage({ [COMMIT_CHANGES_SECTION_STORAGE_KEY]: "closed" }),
      ),
    ).toBe("expanded");
  });

  it("reads back the saved collapsed section", () => {
    const storage = memoryStorage();
    writeCommitChangesSectionPreference(storage, "collapsed");
    expect(readCommitChangesSectionPreference(storage)).toBe("collapsed");
    writeCommitChangesSectionPreference(storage, "expanded");
    expect(readCommitChangesSectionPreference(storage)).toBe("expanded");
  });

  it("falls back to expanded when storage is blocked", () => {
    expect(readCommitChangesSectionPreference(throwingStorage)).toBe(
      "expanded",
    );
    expect(() =>
      writeCommitChangesSectionPreference(throwingStorage, "collapsed"),
    ).not.toThrow();
  });
});

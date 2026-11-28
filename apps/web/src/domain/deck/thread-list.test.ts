import { describe, expect, it } from "vitest";
import type { CodeHostReviewThread } from "@ajour/shared";
import type { DeckDraftComment } from "./draft-review";
import {
  filterThreadList,
  threadListCounts,
  threadListEntries,
  threadListLocation,
} from "./thread-list";

const thread = (
  id: string,
  path: string,
  line: number | undefined,
  overrides: Partial<CodeHostReviewThread> = {},
): CodeHostReviewThread => ({
  id,
  path,
  side: "head",
  ...(line !== undefined ? { line } : {}),
  resolved: false,
  outdated: false,
  comments: [
    {
      id: `${id}-1`,
      author: { login: "ana", isBot: false },
      body: `First on ${id}`,
      createdAt: 10,
    },
  ],
  ...overrides,
});

const draft = (id: string, path: string, line: number): DeckDraftComment => ({
  id,
  path,
  side: "head",
  line,
  body: `Draft ${id}`,
  lineText: "",
  createdAt: 5,
  updatedAt: 5,
});

describe("threadListEntries", () => {
  it("lists open threads, then drafts, then resolved ones, each in file and line order", () => {
    const entries = threadListEntries(
      [
        thread("t1", "b.ts", 4, { resolved: true }),
        thread("t2", "b.ts", 9),
        thread("t3", "a.ts", 20),
      ],
      [draft("d1", "a.ts", 2)],
    );
    expect(entries.map((entry) => entry.key)).toEqual([
      "thread:t3",
      "thread:t2",
      "draft:d1",
      "thread:t1",
    ]);
    expect(entries[0]).toMatchObject({
      kind: "open",
      body: "First on t3",
      replies: 0,
    });
  });

  it("counts and filters each kind", () => {
    const entries = threadListEntries(
      [thread("t1", "a.ts", 1), thread("t2", "a.ts", 2, { resolved: true })],
      [draft("d1", "a.ts", 3)],
    );
    expect(threadListCounts(entries)).toEqual({
      all: 3,
      open: 1,
      drafts: 1,
      resolved: 1,
    });
    expect(
      filterThreadList(entries, "drafts").map((entry) => entry.key),
    ).toEqual(["draft:d1"]);
    expect(filterThreadList(entries, "all")).toHaveLength(3);
  });
});

describe("threadListLocation", () => {
  it("names a line, a range or a whole file", () => {
    expect(threadListLocation({ path: "a.ts", line: 4 })).toBe("a.ts:4");
    expect(threadListLocation({ path: "a.ts", line: 6, startLine: 4 })).toBe(
      "a.ts:4–6",
    );
    expect(threadListLocation({ path: "a.ts" })).toBe("a.ts");
  });
});

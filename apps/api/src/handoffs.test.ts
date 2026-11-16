import { describe, expect, it } from "vitest";
import {
  startHandoff,
  updateHandoff,
  removeHandoff,
  shouldRefresh,
} from "./handoff-state.ts";

const input = {
  id: "h1",
  pluginId: "agent",
  toolId: "t3",
  workItemId: "item",
  projectId: "project",
  folderId: "folder",
  title: "Fix login",
};
describe("handoff transitions", () => {
  it("starts a thread and records only state changes, keeping the last 50", () => {
    let record = startHandoff(
      input,
      { threadId: "thread", native: { status: "running", label: "Running" } },
      100,
    );
    expect(record.state).toBe("working");
    expect(record.history).toEqual([]);
    record = updateHandoff(
      record,
      { id: "h1", state: "working", native: { status: "busy", label: "Busy" } },
      200,
    );
    expect(record.history).toEqual([]);
    for (let i = 0; i < 55; i++)
      record = updateHandoff(
        record,
        { id: "h1", state: i % 2 === 0 ? "ready" : "working", native: {} },
        300 + i,
      );
    expect(record.history).toHaveLength(50);
    expect(record.changedAt).toBe(354);
    expect(removeHandoff([record], "h1")).toEqual([]);
  });
  it("stops automatic refresh of done and gone after 24 hours since their change", () => {
    const record = updateHandoff(
      startHandoff(input, { threadId: "thread", native: {} }, 100),
      { id: "h1", state: "done", native: {} },
      200,
    );
    expect(shouldRefresh(record, 200 + 86_400_000 - 1)).toBe(true);
    expect(shouldRefresh(record, 200 + 86_400_000)).toBe(false);
    expect(shouldRefresh({ ...record, state: "gone" }, 200 + 86_400_000)).toBe(
      false,
    );
    expect(
      shouldRefresh({ ...record, state: "failed" }, 200 + 86_400_000),
    ).toBe(true);
  });
});

it("stores bounded history summaries rather than opaque native objects", () => {
  const record = updateHandoff(
    startHandoff(input, { threadId: "t", native: {} }, 0),
    {
      id: "h1",
      state: "ready",
      native: {
        status: "s".repeat(100),
        label: "l".repeat(300),
        payload: "x".repeat(3000),
      },
    },
    1,
  );
  expect(record.history).toEqual([
    { state: "ready", at: 1, status: "s".repeat(64), label: "l".repeat(200) },
  ]);
  expect(JSON.stringify(record.history).length).toBeLessThan(350);
});

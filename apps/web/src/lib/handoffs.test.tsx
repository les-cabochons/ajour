// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Handoff } from "@ajour/shared/handoffs";
import { setHandoffs, useHandoffs } from "./handoffs";
const record: Handoff = {
  id: "h",
  pluginId: "p",
  toolId: "t",
  workItemId: "i",
  projectId: "p",
  folderId: "f",
  title: "Title",
  threadId: "t",
  native: {},
  state: "working",
  startedAt: 1,
  checkedAt: 1,
  changedAt: 1,
  history: [],
};
it("keeps global, item and record identities across unchanged snapshots", () => {
  setHandoffs([record, { ...record, id: "h2", workItemId: "i2" }]);
  const all = renderHook(() => useHandoffs());
  const item = renderHook(() => useHandoffs("i"));
  const initial = all.result.current;
  const initialItem = item.result.current;
  act(() => setHandoffs(JSON.parse(JSON.stringify(initial))));
  expect(all.result.current).toBe(initial);
  expect(item.result.current).toBe(initialItem);
  act(() => setHandoffs(initial.map((h) => ({ ...h, checkedAt: 2 }))));
  expect(all.result.current).toBe(initial);
  act(() =>
    setHandoffs(
      initial.map((h) => (h.id === "h2" ? { ...h, state: "ready" } : { ...h })),
    ),
  );
  expect(all.result.current).not.toBe(initial);
  expect(all.result.current[0]).toBe(initial[0]);
  expect(item.result.current).toBe(initialItem);
  all.unmount();
  item.unmount();
});

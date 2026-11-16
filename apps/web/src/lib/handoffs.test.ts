// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setHandoffs, upsertHandoff, useHandoffMarks } from "./handoffs";
import * as api from "./app-api";
import { handoffRecord } from "../../tests/fixtures/handoffs";

vi.mock("./app-api", () => ({
  listHandoffs: vi.fn(),
  isPluginApiMissing: () => false,
}));

afterEach(() => act(() => setHandoffs([])));

it("keeps one marks map for every backlog row, replaced only when a mark changes", () => {
  let renders = 0;
  const { result } = renderHook(() => {
    renders++;
    return useHandoffMarks();
  });
  expect(result.current.size).toBe(0);
  act(() =>
    setHandoffs([
      handoffRecord({ id: "a", workItemId: "one", state: "working" }),
    ]),
  );
  const first = result.current;
  expect([...first]).toEqual([["one", "working"]]);
  const rendersAfterMark = renders;

  // A new check, a new title or a done thread elsewhere changes no mark.
  act(() =>
    setHandoffs([
      handoffRecord({
        id: "a",
        workItemId: "one",
        state: "working",
        title: "Renamed",
        checkedAt: 99,
      }),
      handoffRecord({ id: "b", workItemId: "two", state: "done" }),
    ]),
  );
  expect(result.current).toBe(first);
  expect(renders).toBe(rendersAfterMark);

  act(() =>
    upsertHandoff(
      handoffRecord({ id: "b", workItemId: "two", state: "needs-you" }),
    ),
  );
  expect([...result.current]).toEqual([
    ["one", "working"],
    ["two", "needs-you"],
  ]);
});

it("asks the API for nothing, since the window's bridge sends the snapshots", () => {
  renderHook(() => useHandoffMarks());
  expect(api.listHandoffs).not.toHaveBeenCalled();
});

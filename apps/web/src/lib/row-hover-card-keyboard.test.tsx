// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROW_HOVER_CARD_DELAYS as delays,
  useRowHoverCard,
} from "./row-hover-card";

/*
 * The task menu's card follows the arrow keys through `highlightRow`, and the
 * keyboard scrolls the list to its highlight, so only the wheel closes it.
 */

function createList() {
  const list = document.createElement("div");
  for (const id of ["a", "b"]) {
    const row = document.createElement("div");
    row.dataset.row = id;
    list.append(row);
  }
  document.body.append(list);
  return list;
}

const readId = (row: HTMLElement) => row.dataset.row;

describe("a row hover card that follows the keyboard", () => {
  let list: HTMLElement;
  const row = (id: string) =>
    list.querySelector<HTMLElement>(`[data-row="${id}"]`);

  beforeEach(() => {
    vi.useFakeTimers();
    list = createList();
  });
  afterEach(() => {
    cleanup();
    list.remove();
    vi.useRealTimers();
  });

  function renderCard() {
    // Like a ref, the container stays the same object across renders.
    const container = { current: list };
    return renderHook(() =>
      useRowHoverCard(container, "[data-row]", readId, {
        closeOnScroll: "wheel",
      }),
    );
  }

  it("opens on the highlighted row with the pointer's timing, and follows it", () => {
    const { result } = renderCard();

    act(() => result.current.highlightRow(row("a")));
    act(() => vi.advanceTimersByTime(delays.open - 1));
    expect(result.current.shown).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.shown?.id).toBe("a");

    act(() => result.current.highlightRow(row("b")));
    act(() => vi.advanceTimersByTime(delays.move));
    expect(result.current.shown).toMatchObject({ id: "b", element: row("b") });

    act(() => result.current.highlightRow(null));
    act(() => vi.advanceTimersByTime(delays.close));
    expect(result.current.shown).toBeNull();
  });

  it("stays while the keyboard scrolls the list, and closes on the wheel", () => {
    const { result } = renderCard();
    act(() => result.current.highlightRow(row("a")));
    act(() => vi.advanceTimersByTime(delays.open));

    act(() => void list.dispatchEvent(new Event("scroll")));
    expect(result.current.shown?.id).toBe("a");
    act(() => void list.dispatchEvent(new Event("wheel")));
    expect(result.current.shown).toBeNull();
  });
});

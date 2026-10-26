import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROW_HOVER_CARD_DELAYS as delays,
  createRowHoverIntent,
} from "./row-hover-card";

describe("row hover card timing", () => {
  let shown: string | null;
  let intent: ReturnType<typeof createRowHoverIntent<string>>;

  beforeEach(() => {
    vi.useFakeTimers();
    shown = null;
    intent = createRowHoverIntent<string>((target) => {
      shown = target;
    });
  });
  afterEach(() => {
    intent.dispose();
    vi.useRealTimers();
  });

  it("opens once the pointer rests on a row", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open - 1);
    expect(shown).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown).toBe("a");
  });

  it("does not open for a row the pointer passes over", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open / 2);
    intent.enterRow("b", "b");
    vi.advanceTimersByTime(delays.open / 2);
    expect(shown).toBeNull();
    intent.leaveRows();
    vi.advanceTimersByTime(delays.open);
    expect(shown).toBeNull();
  });

  it("keeps waiting while the pointer moves within one row", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open / 2);
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open / 2);
    expect(shown).toBe("a");
  });

  it("follows the pointer to another row at once while open", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.enterRow("b", "b");
    vi.advanceTimersByTime(0);
    expect(shown).toBe("b");
  });

  it("stays open while the pointer crosses over to the card", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.leaveRows();
    vi.advanceTimersByTime(delays.close - 1);
    intent.enterCard();
    vi.advanceTimersByTime(delays.close);
    expect(shown).toBe("a");
    intent.leaveCard();
    vi.advanceTimersByTime(delays.close);
    expect(shown).toBeNull();
  });

  it("stays open when the card hears the pointer before the list does", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.enterCard();
    intent.leaveRows();
    vi.advanceTimersByTime(delays.close);
    expect(shown).toBe("a");
  });

  it("moves to the row the pointer goes to from the card, in either order", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.leaveRows();
    intent.enterCard();
    intent.enterRow("b", "b");
    intent.leaveCard();
    vi.advanceTimersByTime(delays.move);
    expect(shown).toBe("b");

    intent.leaveRows();
    intent.enterCard();
    intent.leaveCard();
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.move);
    expect(shown).toBe("a");
  });

  it("keeps the card when the pointer leaves the rows before the move lands", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.enterRow("b", "b");
    intent.leaveRows();
    intent.enterCard();
    vi.advanceTimersByTime(delays.open);
    expect(shown).toBe("a");
  });

  it("closes when its row goes while the pointer is over the card", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.leaveRows();
    intent.enterCard();
    intent.rowGone("a");
    expect(shown).toBeNull();

    // The new row under the pointer opens after the full wait.
    intent.enterRow("b", "b");
    vi.advanceTimersByTime(delays.open - 1);
    expect(shown).toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown).toBe("b");
  });

  it("keeps the card coming for the row the pointer moved to when the shown row goes", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.enterRow("b", "b");
    intent.rowGone("a");
    expect(shown).toBeNull();
    vi.advanceTimersByTime(delays.move);
    expect(shown).toBe("b");
  });

  it("opens again on the row that replaced the shown one", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.rowGone("a");
    intent.enterRow("a", "a-replaced");
    vi.advanceTimersByTime(delays.open);
    expect(shown).toBe("a-replaced");
  });

  it("closes when the pointer leaves, and on dismiss until it leaves the row", () => {
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.leaveRows();
    vi.advanceTimersByTime(delays.close);
    expect(shown).toBeNull();

    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    intent.dismiss();
    expect(shown).toBeNull();
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    expect(shown).toBeNull();
    intent.leaveRows();
    intent.enterRow("a", "a");
    vi.advanceTimersByTime(delays.open);
    expect(shown).toBe("a");
  });
});

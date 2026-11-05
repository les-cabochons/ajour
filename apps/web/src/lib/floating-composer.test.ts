import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  placeFloatingComposer,
  placeFloatingComposerFor,
} from "./floating-composer";

/** A box at fixed coordinates, as the browser would lay it out. */
function box(top: number, bottom: number, left = 0, right = 2000) {
  return {
    isConnected: true,
    getBoundingClientRect: () => ({ top, bottom, left, right }) as DOMRect,
  } as unknown as Element;
}

/**
 * The card: `height` tall and `width` wide at the top right of a 1440px
 * window, drawn at `scale` as during the dialog's open animation. Its `top`
 * moves its box, as `position: fixed` would.
 */
function card({ height = 300, width = 480, scale = 1 } = {}) {
  const style: Record<string, string> = { top: "", maxHeight: "" };
  const right = 1424;
  const left = right - width;
  const center = (left + right) / 2;
  const top = () => (style.top ? Number.parseFloat(style.top) : 64);
  return {
    style,
    isConnected: true,
    offsetHeight: height,
    offsetWidth: width,
    getBoundingClientRect: () =>
      ({
        top: top(),
        bottom: top() + height * scale,
        left: center - (width * scale) / 2,
        right: center + (width * scale) / 2,
      }) as DOMRect,
  } as unknown as HTMLElement & { style: Record<string, string> };
}

beforeEach(() => {
  vi.stubGlobal("window", { innerHeight: 900 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("placing a floating composer", () => {
  it("rests at the top right when nothing is in its way", () => {
    const popup = card();
    placeFloatingComposer(popup, null);
    expect(popup.style.top).toBe("");
    expect(popup.style.maxHeight).toBe("");
  });

  it("rests below the day strip, and stops short of the window's bottom", () => {
    const popup = card();
    placeFloatingComposer(popup, null, { restBelow: box(48, 104) });
    expect(popup.style.top).toBe("112px");
    expect(popup.style.maxHeight).toBe("calc(100dvh - 128px)");
  });

  it("moves below the row it edits when its resting place covers it", () => {
    const popup = card();
    placeFloatingComposer(popup, box(185, 226, 300, 1424));
    expect(popup.style.top).toBe("234px");
    expect(popup.style.maxHeight).toBe("calc(100dvh - 250px)");
  });

  it("measures its full width while the open animation scales it down", () => {
    // The row reaches only the card's final left edge: 2% in, so a card
    // drawn at 95% would miss it.
    const popup = card({ scale: 0.95 });
    placeFloatingComposer(popup, box(185, 226, 0, 950));
    expect(popup.style.top).toBe("234px");
  });

  it("stays put when the row is beside it, not under it", () => {
    const popup = card();
    placeFloatingComposer(popup, box(185, 226, 300, 900));
    expect(popup.style.top).toBe("");
  });
});

describe("placing once per card and target", () => {
  it("places a card once, however often its ref runs, and again for another target", () => {
    const popup = card();
    const findAnchor = vi.fn(() => box(185, 226, 300, 1424));
    placeFloatingComposerFor(popup, "entry-1", findAnchor);
    placeFloatingComposerFor(popup, "entry-1", findAnchor);
    placeFloatingComposerFor(popup, "entry-1", findAnchor);
    expect(findAnchor).toHaveBeenCalledTimes(1);
    placeFloatingComposerFor(popup, "entry-2", findAnchor);
    expect(findAnchor).toHaveBeenCalledTimes(2);
  });
});

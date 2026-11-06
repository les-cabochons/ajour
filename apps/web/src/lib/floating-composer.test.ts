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
 * window, drawn at `scale` as during the dialog's open animation. Its
 * placed top, the `--composer-top` composer.css reads, moves its box.
 */
function card({ height = 300, width = 480, scale = 1 } = {}) {
  const placed = new Map<string, string>();
  const style = {
    setProperty: (name: string, value: string) => placed.set(name, value),
    removeProperty: (name: string) => placed.delete(name),
  };
  const right = 1424;
  const left = right - width;
  const center = (left + right) / 2;
  const top = () => Number.parseFloat(placed.get("--composer-top") ?? "64");
  const card = {
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
  } as unknown as HTMLElement;
  return { card, placedTop: () => placed.get("--composer-top") };
}

beforeEach(() => {
  vi.stubGlobal("window", { innerHeight: 900 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("placing a floating composer", () => {
  it("rests at the top right when nothing is in its way", () => {
    const { card: popup, placedTop } = card();
    placeFloatingComposer(popup, null);
    expect(placedTop()).toBeUndefined();
  });

  it("rests below the day strip", () => {
    const { card: popup, placedTop } = card();
    placeFloatingComposer(popup, null, { restBelow: box(48, 104) });
    expect(placedTop()).toBe("112px");
  });

  it("moves below the row it edits when its resting place covers it", () => {
    const { card: popup, placedTop } = card();
    placeFloatingComposer(popup, box(185, 226, 300, 1424));
    expect(placedTop()).toBe("234px");
  });

  it("measures its full width while the open animation scales it down", () => {
    // The row reaches only the card's final left edge: 2% in, so a card
    // drawn at 95% would miss it.
    const { card: popup, placedTop } = card({ scale: 0.95 });
    placeFloatingComposer(popup, box(185, 226, 0, 950));
    expect(placedTop()).toBe("234px");
  });

  it("stays put when the row is beside it, not under it", () => {
    const { card: popup, placedTop } = card();
    placeFloatingComposer(popup, box(185, 226, 300, 900));
    expect(placedTop()).toBeUndefined();
  });
});

describe("placing once per card and target", () => {
  it("places a card once, however often its ref runs, and again for another target", () => {
    const { card: popup } = card();
    const findAnchor = vi.fn(() => box(185, 226, 300, 1424));
    placeFloatingComposerFor(popup, "entry-1", findAnchor);
    placeFloatingComposerFor(popup, "entry-1", findAnchor);
    placeFloatingComposerFor(popup, "entry-1", findAnchor);
    expect(findAnchor).toHaveBeenCalledTimes(1);
    placeFloatingComposerFor(popup, "entry-2", findAnchor);
    expect(findAnchor).toHaveBeenCalledTimes(2);
  });
});

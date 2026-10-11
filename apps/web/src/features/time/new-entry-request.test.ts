import { describe, expect, it } from "vitest";
import { pickOnScreenAnchor } from "./new-entry-request";

const viewport = { top: 0, left: 0, bottom: 900, right: 1440 };

/** A stand-in row at the given position. */
function row(top: number, bottom: number, left = 0, right = 1200) {
  return { getBoundingClientRect: () => ({ top, bottom, left, right }) };
}

describe("pickOnScreenAnchor", () => {
  it("anchors to a row that shows in the viewport", () => {
    const visible = row(300, 340);

    expect(pickOnScreenAnchor(visible, [viewport])).toBe(visible);
  });

  it("anchors to a row that is only partly on screen", () => {
    const peeking = row(880, 920);

    expect(pickOnScreenAnchor(peeking, [viewport])).toBe(peeking);
  });

  it("falls back to the titlebar when the row is scrolled away", () => {
    expect(pickOnScreenAnchor(row(-80, -40), [viewport])).toBeNull();
    expect(pickOnScreenAnchor(row(900, 940), [viewport])).toBeNull();
  });

  it("falls back to the titlebar when the row is hidden or missing", () => {
    // A row inside a collapsed parent has an empty rect.
    expect(pickOnScreenAnchor(row(0, 0, 0, 0), [viewport])).toBeNull();
    expect(pickOnScreenAnchor(null, [viewport])).toBeNull();
  });

  it("falls back to the titlebar when a scroll container clips the row", () => {
    // The list scrolls between 200 and 600; the row sits just below it, still inside the window.
    const list = { top: 200, left: 0, bottom: 600, right: 1440 };

    expect(pickOnScreenAnchor(row(620, 660), [viewport, list])).toBeNull();
    expect(pickOnScreenAnchor(row(580, 620), [viewport, list])).not.toBeNull();
  });
});

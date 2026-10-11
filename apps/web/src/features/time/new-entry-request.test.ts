import { describe, expect, it } from "vitest";
import { pickOnScreenAnchor } from "./new-entry-request";

const viewport = { width: 1440, height: 900 };

/** A stand-in row at the given position. */
function row(top: number, bottom: number, left = 0, right = 1200) {
  return { getBoundingClientRect: () => ({ top, bottom, left, right }) };
}

describe("pickOnScreenAnchor", () => {
  it("anchors to a row that shows in the viewport", () => {
    const visible = row(300, 340);

    expect(pickOnScreenAnchor(visible, viewport)).toBe(visible);
  });

  it("anchors to a row that is only partly on screen", () => {
    const peeking = row(880, 920);

    expect(pickOnScreenAnchor(peeking, viewport)).toBe(peeking);
  });

  it("falls back to the titlebar when the row is scrolled away", () => {
    expect(pickOnScreenAnchor(row(-80, -40), viewport)).toBeNull();
    expect(pickOnScreenAnchor(row(900, 940), viewport)).toBeNull();
  });

  it("falls back to the titlebar when the row is hidden or missing", () => {
    // A row inside a collapsed parent has an empty rect.
    expect(pickOnScreenAnchor(row(0, 0, 0, 0), viewport)).toBeNull();
    expect(pickOnScreenAnchor(null, viewport)).toBeNull();
  });
});

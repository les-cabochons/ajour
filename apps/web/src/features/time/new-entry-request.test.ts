import { describe, expect, it } from "vitest";
import {
  dropHeldPageRequests,
  isTimePagePath,
  pickOnScreenAnchor,
  registerNewEntryPageHost,
  registerRunningEntryPageHost,
  requestNewEntryOnPage,
  requestRunningEntryOnPage,
} from "./new-entry-request";

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

describe("the Time page as the entry editors' host", () => {
  it("knows the Time page's paths, not its commit page or others", () => {
    expect(isTimePagePath("/time/today")).toBe(true);
    expect(isTimePagePath("/time/2026-10-15")).toBe(true);
    expect(isTimePagePath("/time/2026-10-15/")).toBe(true);
    expect(isTimePagePath("/time/2026-10-15/commit")).toBe(false);
    expect(isTimePagePath("/time-entries")).toBe(false);
    expect(isTimePagePath("/backlog")).toBe(false);
  });

  it("opens a new entry on the page at once once it is ready", () => {
    const opened: unknown[] = [];
    const unregister = registerNewEntryPageHost((values) =>
      opened.push(values ?? "blank"),
    );
    expect(requestNewEntryOnPage("/time/today")).toBe(true);
    expect(opened).toEqual(["blank"]);
    unregister();
  });

  it("holds a new entry asked for while the page loads, and opens it when the page is ready", () => {
    const opened: unknown[] = [];
    expect(requestNewEntryOnPage("/time/today")).toBe(true);
    expect(opened).toEqual([]);
    const unregister = registerNewEntryPageHost((values) =>
      opened.push(values ?? "blank"),
    );
    expect(opened).toEqual(["blank"]);
    unregister();
  });

  it("leaves a new entry to the popover off the Time page", () => {
    const opened: unknown[] = [];
    const unregister = registerNewEntryPageHost((values) =>
      opened.push(values ?? "blank"),
    );
    expect(requestNewEntryOnPage("/backlog")).toBe(false);
    expect(opened).toEqual([]);
    unregister();
  });

  it("drops a held request when the user leaves the Time page first", () => {
    const opened: unknown[] = [];
    expect(requestNewEntryOnPage("/time/today")).toBe(true);
    expect(requestNewEntryOnPage("/backlog")).toBe(false);
    const unregister = registerNewEntryPageHost((values) =>
      opened.push(values ?? "blank"),
    );
    expect(opened).toEqual([]);
    unregister();
  });

  it("holds the running entry the same way while the page loads", () => {
    const opened: string[] = [];
    expect(requestRunningEntryOnPage("/time/today", "timer-1")).toBe(true);
    const unregister = registerRunningEntryPageHost((timerId) =>
      opened.push(timerId),
    );
    expect(opened).toEqual(["timer-1"]);
    expect(requestRunningEntryOnPage("/projects", "timer-1")).toBe(false);
    unregister();
  });
});

describe("leaving the Time page before it loads", () => {
  it("drops the requests it held", () => {
    const opened: unknown[] = [];
    requestNewEntryOnPage("/time/today");
    requestRunningEntryOnPage("/time/today", "timer-1");
    dropHeldPageRequests("/backlog");
    const unregisterNew = registerNewEntryPageHost((values) =>
      opened.push(values ?? "blank"),
    );
    const unregisterRunning = registerRunningEntryPageHost((timerId) =>
      opened.push(timerId),
    );
    expect(opened).toEqual([]);
    unregisterNew();
    unregisterRunning();
  });

  it("keeps them while the path is still the Time page", () => {
    const opened: unknown[] = [];
    requestNewEntryOnPage("/time/today");
    dropHeldPageRequests("/time/today");
    const unregister = registerNewEntryPageHost((values) =>
      opened.push(values ?? "blank"),
    );
    expect(opened).toEqual(["blank"]);
    unregister();
  });
});

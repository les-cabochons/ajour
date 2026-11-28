import { describe, expect, it } from "vitest";
import {
  deckViewsTransition,
  panelTab,
  parseDeckPanelState,
  viewShows,
  type DeckViewsState,
} from "./review-views";

const empty: DeckViewsState = { pins: [], open: false };

describe("deckViewsTransition", () => {
  it("peeks a view that isn't pinned, and closes the peek on a second press", () => {
    const peeking = deckViewsTransition(empty, {
      type: "toggle",
      view: "status",
    });
    expect(peeking.peek).toBe("status");
    expect(panelTab(peeking)).toBeUndefined();
    expect(
      deckViewsTransition(peeking, { type: "toggle", view: "status" }).peek,
    ).toBeUndefined();
  });

  it("moves a pinned view into the panel and closes its peek", () => {
    const peeking = { ...empty, peek: "threads" as const };
    const pinned = deckViewsTransition(peeking, {
      type: "pin",
      view: "threads",
    });
    expect(pinned.pins).toEqual(["threads"]);
    expect(pinned.peek).toBeUndefined();
    expect(panelTab(pinned)).toBe("threads");
  });

  it("adds up pins in the views' order, so all three pinned is three tabs", () => {
    let state = empty;
    for (const view of ["chat", "status", "threads"] as const)
      state = deckViewsTransition(state, { type: "pin", view });
    expect(state.pins).toEqual(["status", "threads", "chat"]);
    expect(panelTab(state)).toBe("threads");
  });

  it("still peeks the views that aren't pinned beside the panel", () => {
    const pinned = deckViewsTransition(empty, { type: "pin", view: "threads" });
    const both = deckViewsTransition(pinned, {
      type: "toggle",
      view: "status",
    });
    expect(panelTab(both)).toBe("threads");
    expect(both.peek).toBe("status");
    expect(viewShows(both, "status")).toBe(true);
    expect(viewShows(both, "chat")).toBe(false);
  });

  it("unpins a closed tab, which peeks again, and removes the panel with its last tab", () => {
    let state = deckViewsTransition(empty, { type: "pin", view: "status" });
    state = deckViewsTransition(state, { type: "pin", view: "chat" });
    state = deckViewsTransition(state, { type: "unpin", view: "chat" });
    expect(state.pins).toEqual(["status"]);
    expect(panelTab(state)).toBe("status");
    expect(
      deckViewsTransition(state, { type: "toggle", view: "chat" }).peek,
    ).toBe("chat");
    state = deckViewsTransition(state, { type: "unpin", view: "status" });
    expect(state.pins).toEqual([]);
    expect(panelTab(state)).toBeUndefined();
  });

  it("collapses the panel and keeps its pins; a pinned launcher opens it on its tab", () => {
    let state = deckViewsTransition(empty, { type: "pin", view: "status" });
    state = deckViewsTransition(state, { type: "pin", view: "threads" });
    state = deckViewsTransition(state, { type: "collapse" });
    expect(panelTab(state)).toBeUndefined();
    expect(state.pins).toEqual(["status", "threads"]);
    state = deckViewsTransition(state, { type: "toggle", view: "status" });
    expect(panelTab(state)).toBe("status");
    expect(state.peek).toBeUndefined();
  });

  it("collapses the panel from the launcher of the tab it shows", () => {
    let state = deckViewsTransition(empty, { type: "pin", view: "chat" });
    state = deckViewsTransition(state, { type: "toggle", view: "chat" });
    expect(panelTab(state)).toBeUndefined();
    expect(state.pins).toEqual(["chat"]);
  });

  it("show leaves a view open where toggle would close it", () => {
    const peeking = { ...empty, peek: "chat" as const };
    expect(
      deckViewsTransition(peeking, { type: "show", view: "chat" }).peek,
    ).toBe("chat");
    const pinned = deckViewsTransition(empty, { type: "pin", view: "chat" });
    expect(
      panelTab(deckViewsTransition(pinned, { type: "show", view: "chat" })),
    ).toBe("chat");
  });
});

describe("parseDeckPanelState", () => {
  it("keeps known pins in order, and the panel open only with a pin", () => {
    expect(
      parseDeckPanelState({
        pins: ["chat", "nope", "status"],
        open: true,
        tab: "chat",
      }),
    ).toEqual({ pins: ["status", "chat"], open: true, tab: "chat" });
    expect(parseDeckPanelState({ pins: [], open: true })).toEqual({
      pins: [],
      open: false,
    });
    expect(parseDeckPanelState("broken")).toEqual({ pins: [], open: false });
  });

  it("drops a tab that isn't pinned", () => {
    expect(
      parseDeckPanelState({ pins: ["status"], open: false, tab: "chat" }),
    ).toEqual({ pins: ["status"], open: false });
  });
});

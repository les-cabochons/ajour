import { describe, expect, it } from "vitest";
import {
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  clampSidePanelWidth,
  parseSidePanelWidths,
} from "./side-panel-width";

describe("parseSidePanelWidths", () => {
  it("restores each page's saved width", () => {
    expect(parseSidePanelWidths('{"backlog":480,"time":360}')).toEqual({
      backlog: 480,
      time: 360,
    });
  });

  it("clamps saved widths to the allowed range", () => {
    expect(parseSidePanelWidths('{"backlog":10,"time":5000}')).toEqual({
      backlog: SIDE_PANEL_MIN_WIDTH,
      time: SIDE_PANEL_MAX_WIDTH,
    });
  });

  it("drops unknown pages and broken values", () => {
    expect(parseSidePanelWidths('{"settings":400,"time":"wide"}')).toEqual({});
    expect(parseSidePanelWidths("not json")).toEqual({});
    expect(parseSidePanelWidths(null)).toEqual({});
  });
});

describe("clampSidePanelWidth", () => {
  it("never goes past half the page, so a drag cannot save a hidden width", () => {
    expect(clampSidePanelWidth(700, 1048)).toBe(524);
  });

  it("keeps the minimum when half the page is narrower", () => {
    expect(clampSidePanelWidth(250, 500)).toBe(SIDE_PANEL_MIN_WIDTH);
  });
});

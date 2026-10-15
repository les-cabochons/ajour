import { describe, expect, it } from "vitest";
import {
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  parseSidePanelWidth,
} from "./side-panel-width";

describe("parseSidePanelWidth", () => {
  it("restores a saved width", () => {
    expect(parseSidePanelWidth("480")).toBe(480);
  });

  it("clamps a saved width to the allowed range", () => {
    expect(parseSidePanelWidth("10")).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(parseSidePanelWidth("5000")).toBe(SIDE_PANEL_MAX_WIDTH);
  });

  it("falls back to the default for missing or broken values", () => {
    expect(parseSidePanelWidth(null)).toBe(SIDE_PANEL_DEFAULT_WIDTH);
    expect(parseSidePanelWidth("")).toBe(SIDE_PANEL_DEFAULT_WIDTH);
    expect(parseSidePanelWidth("wide")).toBe(SIDE_PANEL_DEFAULT_WIDTH);
  });
});

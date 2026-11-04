import { describe, expect, it } from "vitest";
import { getWorkflowStateFills } from "./workflow-state-fill";

const state = (id: string, done = false) => ({
  _id: id,
  name: id,
  color: "#000",
  done,
  createdAt: 0,
});

describe("getWorkflowStateFills", () => {
  it("fills open states by their place, up to three quarters, and done states whole", () => {
    const fills = getWorkflowStateFills([
      state("todo"),
      state("doing"),
      state("review"),
      state("done", true),
    ]);
    expect(fills.get("todo")).toBe(0);
    expect(fills.get("doing")).toBe(0.375);
    expect(fills.get("review")).toBe(0.75);
    expect(fills.get("done")).toBe(1);
  });

  it("leaves a lone open state an empty ring", () => {
    const fills = getWorkflowStateFills([state("open"), state("closed", true)]);
    expect(fills.get("open")).toBe(0);
    expect(fills.get("closed")).toBe(1);
  });
});

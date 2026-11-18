import { describe, expect, it } from "vitest";
import { catalog } from "@ajour/wide-events/catalog.ts";
import {
  EXPLAINED_OUTCOME_REASONS,
  explainOutcomeReason,
} from "./outcome-reasons";

/** Every reason the catalog's events can end with, with the events that use it. */
function catalogReasons() {
  const reasons = new Map<string, string[]>();
  for (const [name, spec] of Object.entries(catalog.events)) {
    for (const reason of (spec as { reasons?: readonly string[] }).reasons ??
      []) {
      reasons.set(reason, [...(reasons.get(reason) ?? []), name]);
    }
  }
  return reasons;
}

describe("the outcome reason explanations", () => {
  it("explain every outcome_reason in the catalog", () => {
    const reasons = catalogReasons();
    expect(reasons.size).toBeGreaterThan(100);

    const unexplained = [...reasons.keys()].filter(
      (reason) => !explainOutcomeReason(reason)?.trim(),
    );
    expect(unexplained).toEqual([]);
  });

  it("explain no reason the catalog doesn't have", () => {
    const reasons = catalogReasons();

    expect(
      EXPLAINED_OUTCOME_REASONS.filter((reason) => !reasons.has(reason)),
    ).toEqual([]);
  });

  it("are sentences", () => {
    for (const reason of catalogReasons().keys()) {
      expect(explainOutcomeReason(reason), reason).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("say what the broker's rate_limited means, and the handoff hook's own", () => {
    expect(explainOutcomeReason("rate_limited", "plugin.request")).toContain(
      "broker",
    );
    expect(explainOutcomeReason("rate_limited", "handoff.hook")).toContain(
      "handoff tool",
    );
  });

  it("have nothing for a reason another version wrote", () => {
    expect(explainOutcomeReason("from_the_future")).toBeNull();
  });
});

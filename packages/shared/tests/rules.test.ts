import { describe, expect, it } from "vitest";
import { evaluateBlockAgainstRules } from "../src/rules/engine";
import type {
  ActivityBlockRecord,
  FeatureStat,
  RuleRecord,
} from "../src/types/domain";

const block: ActivityBlockRecord = {
  userId: "u1",
  teamId: "t1",
  localDate: "2026-04-09",
  startedAt: 0,
  endedAt: 60000,
  durationMs: 60000,
  sourceSegmentIds: ["s1"],
  fingerprint: "github.com|/myorg/payments|payments issue",
  display: { label: "Payments", subtitle: "github.com/myorg/payments" },
  status: "draft",
  assignmentSource: "none",
  confidence: 0,
  isMicroBlock: false,
  locked: false,
  domain: "github.com",
  pathname: "/myorg/payments",
  title: "payments issue",
};

describe("evaluateBlockAgainstRules", () => {
  it("prefers matching manual rules", () => {
    const rules: RuleRecord[] = [
      {
        id: "r1",
        userId: "u1",
        teamId: "t1",
        enabled: true,
        priority: 1,
        source: "manual",
        status: "active",
        action: "suggest",
        targetProjectId: "p1",
        condition: { domain: "github.com", pathnamePrefix: "/myorg/payments" },
        baseConfidence: 0.9,
      },
    ];

    const result = evaluateBlockAgainstRules(block, rules, []);
    expect(result.suggestion?.projectId).toBe("p1");
    expect(result.suggestion?.explanation).toContain("Matched rule");
  });

  it("falls back to history when no rule matches", () => {
    const stats: FeatureStat[] = [
      {
        featureType: "domain+pathnamePrefix",
        featureValue: "github.com|/myorg/payments",
        projectId: "p2",
        matchCount: 6,
      },
      {
        featureType: "domain+pathnamePrefix",
        featureValue: "github.com|/myorg/payments",
        projectId: "p3",
        matchCount: 1,
      },
    ];

    const result = evaluateBlockAgainstRules(block, [], stats);
    expect(result.suggestion?.projectId).toBe("p2");
    expect(result.suggestion?.source).toBe("history");
  });
});

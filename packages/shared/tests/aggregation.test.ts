import { describe, expect, it } from "vitest";
import { aggregateSegmentsToBlocks } from "../index";
import type { ActivitySegmentRecord } from "../index";

function makeSegment(
  overrides: Partial<ActivitySegmentRecord>,
): ActivitySegmentRecord {
  return {
    externalSegmentId: crypto.randomUUID(),
    startedAt: 1000,
    endedAt: 2000,
    activeDurationMs: 1000,
    idleDurationMs: 0,
    isIdleSplit: false,
    context: { url: "https://github.com", title: "GitHub" },
    localDate: "2026-04-09",
    userId: "u1",
    teamId: "t1",
    deviceId: "d1",
    source: "browser_extension",
    capturedUrlMode: "sanitized_path",
    normalized: {
      domain: "github.com",
      pathname: "/myorg/payments",
      url: "github.com/myorg/payments",
      title: "payments",
      pathTokens: ["myorg", "payments"],
      fingerprint: "github.com|/myorg/payments|payments",
      titleTokens: ["payments"],
    },
    createdAt: 1,
    ...overrides,
  };
}

describe("aggregateSegmentsToBlocks", () => {
  it("merges adjacent matching segments", () => {
    const blocks = aggregateSegmentsToBlocks(
      [
        makeSegment({ startedAt: 0, endedAt: 1000 }),
        makeSegment({
          externalSegmentId: "s2",
          startedAt: 1200,
          endedAt: 2000,
        }),
      ],
      { mergeGapMs: 500, microBlockThresholdMs: 3000 },
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.durationMs).toBe(2000);
    expect(blocks[0]?.sourceSegmentIds).toEqual(expect.arrayContaining(["s2"]));
  });

  it("splits on idle boundaries", () => {
    const blocks = aggregateSegmentsToBlocks(
      [
        makeSegment({ startedAt: 0, endedAt: 1000 }),
        makeSegment({
          externalSegmentId: "s2",
          startedAt: 1200,
          endedAt: 2000,
          isIdleSplit: true,
        }),
      ],
      { mergeGapMs: 500, microBlockThresholdMs: 3000 },
    );

    expect(blocks).toHaveLength(2);
  });
});

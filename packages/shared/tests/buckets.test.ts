import { describe, expect, it } from "vitest";
import { buildBrowserActivityBuckets } from "../index";
import type { ActivitySegmentInput } from "../index";

function makeSegment(
  overrides: Partial<ActivitySegmentInput>,
): ActivitySegmentInput {
  return {
    externalSegmentId: crypto.randomUUID(),
    startedAt: 0,
    endedAt: 60_000,
    activeDurationMs: 60_000,
    idleDurationMs: 0,
    isIdleSplit: false,
    localDate: "2026-04-09",
    context: {
      url: "https://github.com/myorg/payments",
      title: "payments",
      domain: "github.com",
      pathname: "/myorg/payments",
    },
    ...overrides,
  };
}

describe("buildBrowserActivityBuckets", () => {
  it("splits a segment across bucket boundaries", () => {
    const buckets = buildBrowserActivityBuckets(
      [
        makeSegment({
          startedAt: 4 * 60_000,
          endedAt: 6 * 60_000,
          activeDurationMs: 2 * 60_000,
        }),
      ],
      {
        from: 0,
        to: 10 * 60_000,
        bucketSizeMs: 5 * 60_000,
      },
    );

    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.durationMs).toBe(60_000);
    expect(buckets[1]?.durationMs).toBe(60_000);
  });

  it("marks mixed buckets when two contexts are close", () => {
    const buckets = buildBrowserActivityBuckets(
      [
        makeSegment({
          externalSegmentId: "github",
          startedAt: 0,
          endedAt: 180_000,
          activeDurationMs: 180_000,
        }),
        makeSegment({
          externalSegmentId: "linear",
          startedAt: 180_000,
          endedAt: 300_000,
          activeDurationMs: 120_000,
          context: {
            url: "https://linear.app/acme",
            title: "growth planning",
            domain: "linear.app",
            pathname: "/acme",
          },
        }),
      ],
      {
        from: 0,
        to: 300_000,
        bucketSizeMs: 300_000,
      },
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.dominant.domain).toBe("github.com");
    expect(buckets[0]?.isMixed).toBe(true);
    expect(buckets[0]?.evidence).toHaveLength(2);
    expect(buckets[0]?.evidence[0]?.percentage).toBeCloseTo(0.6);
  });

  it("returns dominant single-context buckets as not mixed", () => {
    const buckets = buildBrowserActivityBuckets(
      [
        makeSegment({
          startedAt: 0,
          endedAt: 300_000,
          activeDurationMs: 300_000,
        }),
      ],
      {
        from: 0,
        to: 300_000,
        bucketSizeMs: 300_000,
      },
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.isMixed).toBe(false);
    expect(buckets[0]?.confidence).toBe(1);
  });
});

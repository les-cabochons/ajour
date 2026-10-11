import { describe, expect, it } from "vitest";
import {
  buildDominantActivityLog,
  splitSpansByLocalDate,
} from "../src/timeline/dominant-log";
import type { ActivityIdentity, ActivitySpan } from "../src/types/domain";

const BUCKET_MS = 5 * 60 * 1000;

function makeIdentity(overrides: Partial<ActivityIdentity>): ActivityIdentity {
  return {
    kind: "desktop",
    appName: "Cursor",
    mergeKey: "desktop:cursor:payments.tsx",
    displayTitle: "payments.tsx",
    displaySubtitle: "Cursor",
    ...overrides,
  };
}

function makeSpan(overrides: Partial<ActivitySpan>): ActivitySpan {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date("2026-04-09T09:00:00").getTime(),
    endedAt: new Date("2026-04-09T09:05:00").getTime(),
    localDate: "2026-04-09",
    identity: makeIdentity({}),
    source: "macos_agent",
    ...overrides,
  };
}

describe("buildDominantActivityLog", () => {
  it("keeps a bucket when one activity owns the full 5 minutes", () => {
    const entries = buildDominantActivityLog([makeSpan({})], "2026-04-09", {
      bucketMs: BUCKET_MS,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.durationMs).toBe(BUCKET_MS);
  });

  it("keeps the dominant activity for a mixed bucket", () => {
    const entries = buildDominantActivityLog(
      [
        makeSpan({
          startedAt: new Date("2026-04-09T09:00:00").getTime(),
          endedAt: new Date("2026-04-09T09:03:00").getTime(),
        }),
        makeSpan({
          startedAt: new Date("2026-04-09T09:03:00").getTime(),
          endedAt: new Date("2026-04-09T09:05:00").getTime(),
          identity: makeIdentity({
            appName: "Slack",
            mergeKey: "desktop:slack:project room",
            displayTitle: "Project room",
            displaySubtitle: "Slack",
          }),
        }),
      ],
      "2026-04-09",
      { bucketMs: BUCKET_MS },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.identity.mergeKey).toBe("desktop:cursor:payments.tsx");
    expect(entries[0]?.durationMs).toBe(BUCKET_MS);
  });

  it("merges adjacent buckets with the same merge key", () => {
    const entries = buildDominantActivityLog(
      [
        makeSpan({
          startedAt: new Date("2026-04-09T09:00:00").getTime(),
          endedAt: new Date("2026-04-09T09:05:00").getTime(),
        }),
        makeSpan({
          startedAt: new Date("2026-04-09T09:05:00").getTime(),
          endedAt: new Date("2026-04-09T09:10:00").getTime(),
        }),
      ],
      "2026-04-09",
      { bucketMs: BUCKET_MS },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.durationMs).toBe(2 * BUCKET_MS);
    expect(entries[0]?.bucketCount).toBe(2);
  });

  it("merges browser activity across Chrome and Firefox when normalized URL matches", () => {
    const identity = makeIdentity({
      kind: "browser",
      appName: "Google Chrome",
      browserFamily: "chrome",
      normalizedUrl: "github.com/myorg/payments/pulls/123",
      mergeKey: "browser:url:github.com/myorg/payments/pulls/123",
      displayTitle: "Payments Pull Request",
      displaySubtitle: "github.com/myorg/payments/pulls/123",
    });

    const entries = buildDominantActivityLog(
      [
        makeSpan({
          identity,
          startedAt: new Date("2026-04-09T09:00:00").getTime(),
          endedAt: new Date("2026-04-09T09:05:00").getTime(),
        }),
        makeSpan({
          identity: {
            ...identity,
            appName: "Firefox",
            browserFamily: "firefox",
            windowTitle: "Payments Pull Request - Firefox",
          },
          startedAt: new Date("2026-04-09T09:05:00").getTime(),
          endedAt: new Date("2026-04-09T09:10:00").getTime(),
        }),
      ],
      "2026-04-09",
      { bucketMs: BUCKET_MS },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.identity.mergeKey).toBe(
      "browser:url:github.com/myorg/payments/pulls/123",
    );
  });

  it("does not merge desktop entries when app or title differs", () => {
    const entries = buildDominantActivityLog(
      [
        makeSpan({
          startedAt: new Date("2026-04-09T09:00:00").getTime(),
          endedAt: new Date("2026-04-09T09:05:00").getTime(),
        }),
        makeSpan({
          startedAt: new Date("2026-04-09T09:05:00").getTime(),
          endedAt: new Date("2026-04-09T09:10:00").getTime(),
          identity: makeIdentity({
            mergeKey: "desktop:cursor:other.tsx",
            displayTitle: "other.tsx",
          }),
        }),
      ],
      "2026-04-09",
      { bucketMs: BUCKET_MS },
    );

    expect(entries).toHaveLength(2);
  });

  it("does not merge browser fallback entries when titles differ", () => {
    const entries = buildDominantActivityLog(
      [
        makeSpan({
          identity: makeIdentity({
            kind: "browser",
            appName: "Google Chrome",
            mergeKey: "browser:fallback:google chrome:project a",
            displayTitle: "Project A",
            displaySubtitle: "Google Chrome",
          }),
          startedAt: new Date("2026-04-09T09:00:00").getTime(),
          endedAt: new Date("2026-04-09T09:05:00").getTime(),
        }),
        makeSpan({
          identity: makeIdentity({
            kind: "browser",
            appName: "Firefox",
            mergeKey: "browser:fallback:firefox:project b",
            displayTitle: "Project B",
            displaySubtitle: "Firefox",
          }),
          startedAt: new Date("2026-04-09T09:05:00").getTime(),
          endedAt: new Date("2026-04-09T09:10:00").getTime(),
        }),
      ],
      "2026-04-09",
      { bucketMs: BUCKET_MS },
    );

    expect(entries).toHaveLength(2);
  });

  it("breaks on idle gaps", () => {
    const entries = buildDominantActivityLog(
      [
        makeSpan({
          startedAt: new Date("2026-04-09T09:00:00").getTime(),
          endedAt: new Date("2026-04-09T09:05:00").getTime(),
        }),
        makeSpan({
          startedAt: new Date("2026-04-09T09:10:00").getTime(),
          endedAt: new Date("2026-04-09T09:15:00").getTime(),
        }),
      ],
      "2026-04-09",
      { bucketMs: BUCKET_MS },
    );

    expect(entries).toHaveLength(2);
  });
});

describe("splitSpansByLocalDate", () => {
  it("splits a span crossing midnight", () => {
    const split = splitSpansByLocalDate([
      makeSpan({
        startedAt: new Date("2026-04-09T23:58:00").getTime(),
        endedAt: new Date("2026-04-10T00:07:00").getTime(),
        localDate: "2026-04-09",
      }),
    ]);

    expect(split["2026-04-09"]).toHaveLength(1);
    expect(split["2026-04-10"]).toHaveLength(1);
    expect(split["2026-04-09"]?.[0]?.endedAt).toBe(
      new Date("2026-04-10T00:00:00").getTime(),
    );
    expect(split["2026-04-10"]?.[0]?.startedAt).toBe(
      new Date("2026-04-10T00:00:00").getTime(),
    );
  });
});

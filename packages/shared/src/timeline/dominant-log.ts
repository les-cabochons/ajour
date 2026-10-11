import type {
  ActivityIdentity,
  ActivityLogEntry,
  ActivitySpan,
  DominantActivityBucket,
} from "../types/domain";

export interface DominantActivityOptions {
  bucketMs: number;
}

function localDateAt(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date(timestamp));
}

function dayStartAt(localDate: string): number {
  return new Date(`${localDate}T00:00:00`).getTime();
}

function mergeEntryId(
  entry: Pick<ActivityLogEntry, "localDate" | "startedAt" | "identity">,
): string {
  return `${entry.localDate}:${entry.startedAt}:${entry.identity.mergeKey}`;
}

function sumOverlapByMergeKey(
  spans: ActivitySpan[],
  bucketStartAt: number,
  bucketEndAt: number,
): Map<string, { identity: ActivityIdentity; durationMs: number }> {
  const totals = new Map<
    string,
    { identity: ActivityIdentity; durationMs: number }
  >();

  for (const span of spans) {
    const overlapStartAt = Math.max(bucketStartAt, span.startedAt);
    const overlapEndAt = Math.min(bucketEndAt, span.endedAt);
    if (overlapEndAt <= overlapStartAt) {
      continue;
    }

    const current = totals.get(span.identity.mergeKey);
    const durationMs = overlapEndAt - overlapStartAt;
    if (current) {
      current.durationMs += durationMs;
      continue;
    }

    totals.set(span.identity.mergeKey, {
      identity: span.identity,
      durationMs,
    });
  }

  return totals;
}

export function buildDominantActivityBuckets(
  spans: ActivitySpan[],
  localDate: string,
  options: DominantActivityOptions,
): DominantActivityBucket[] {
  const sorted = [...spans].sort(
    (left, right) => left.startedAt - right.startedAt,
  );
  const buckets: DominantActivityBucket[] = [];
  const bucketMs = options.bucketMs;
  const dateStartAt = dayStartAt(localDate);
  const dateEndAt = dateStartAt + 24 * 60 * 60 * 1000;

  for (
    let bucketStartAt = dateStartAt;
    bucketStartAt < dateEndAt;
    bucketStartAt += bucketMs
  ) {
    const bucketEndAt = Math.min(bucketStartAt + bucketMs, dateEndAt);
    const totals = sumOverlapByMergeKey(sorted, bucketStartAt, bucketEndAt);
    if (totals.size === 0) {
      continue;
    }

    const winner = [...totals.entries()].sort(
      (left, right) =>
        right[1].durationMs - left[1].durationMs ||
        left[0].localeCompare(right[0]),
    )[0];

    if (!winner) {
      continue;
    }

    buckets.push({
      bucketStartAt,
      bucketEndAt,
      winningMergeKey: winner[0],
      dominantMs: winner[1].durationMs,
      identity: winner[1].identity,
    });
  }

  return buckets;
}

export function mergeDominantActivityBuckets(
  buckets: DominantActivityBucket[],
  localDate: string,
): ActivityLogEntry[] {
  const entries: ActivityLogEntry[] = [];

  for (const bucket of [...buckets].sort(
    (left, right) => left.bucketStartAt - right.bucketStartAt,
  )) {
    const current = entries.at(-1);

    if (
      current &&
      current.identity.mergeKey === bucket.winningMergeKey &&
      current.endedAt === bucket.bucketStartAt
    ) {
      current.endedAt = bucket.bucketEndAt;
      current.durationMs = current.endedAt - current.startedAt;
      current.bucketCount += 1;
      continue;
    }

    entries.push({
      id: mergeEntryId({
        localDate,
        startedAt: bucket.bucketStartAt,
        identity: bucket.identity,
      }),
      localDate,
      startedAt: bucket.bucketStartAt,
      endedAt: bucket.bucketEndAt,
      durationMs: bucket.bucketEndAt - bucket.bucketStartAt,
      bucketCount: 1,
      identity: bucket.identity,
      source: "macos_agent",
    });
  }

  return entries;
}

export function buildDominantActivityLog(
  spans: ActivitySpan[],
  localDate: string,
  options: DominantActivityOptions,
): ActivityLogEntry[] {
  const filtered = spans.filter(
    (span) =>
      span.startedAt < dayStartAt(localDate) + 24 * 60 * 60 * 1000 &&
      span.endedAt > dayStartAt(localDate),
  );

  return mergeDominantActivityBuckets(
    buildDominantActivityBuckets(filtered, localDate, options),
    localDate,
  );
}

export function splitSpansByLocalDate(
  spans: ActivitySpan[],
): Record<string, ActivitySpan[]> {
  const byDate: Record<string, ActivitySpan[]> = {};

  for (const span of spans) {
    let cursor = span.startedAt;
    while (cursor < span.endedAt) {
      const localDate = localDateAt(cursor);
      const nextDayStartAt = dayStartAt(localDate) + 24 * 60 * 60 * 1000;
      const sliceEndAt = Math.min(span.endedAt, nextDayStartAt);
      const bucket = byDate[localDate] ?? [];
      bucket.push({
        ...span,
        localDate,
        startedAt: cursor,
        endedAt: sliceEndAt,
      });
      byDate[localDate] = bucket;
      cursor = sliceEndAt;
    }
  }

  return byDate;
}

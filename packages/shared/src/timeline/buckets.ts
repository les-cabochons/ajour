import { normalizeActivityContext } from "../normalization/activity";
import type {
  ActivitySegmentInput,
  BrowserActivityBucket,
  BucketEvidenceItem,
  CaptureSettings,
} from "../types/domain";

const defaultCapture: CaptureSettings = {
  urlMode: "sanitized_path",
  titleMode: "normalized",
  blockedDomains: [],
  sensitiveDomains: [],
  maxPathSegments: 4,
};

export interface BrowserBucketOptions {
  from: number;
  to: number;
  bucketSizeMs: number;
  mixedThreshold?: number;
  closeSecondThreshold?: number;
}

interface EvidenceAccumulator {
  fingerprint: string;
  domain: string;
  pathname: string;
  title: string;
  durationMs: number;
  sourceSegmentIds: Set<string>;
}

function localDateAt(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date(timestamp));
}

function bucketKey(localDate: string, bucketStartAt: number) {
  return `${localDate}:${bucketStartAt}`;
}

function displayLabel(title: string, domain: string) {
  const domainLabel = domain.replace(/^www\./, "");
  if (!title) {
    return domainLabel;
  }

  const firstPart = title.split(/[|\-]/)[0] ?? "";
  return (
    firstPart.trim().replace(/\b\w/g, (char: string) => char.toUpperCase()) ||
    domainLabel
  );
}

function displaySubtitle(domain: string, pathname: string) {
  return pathname === "/" ? domain : `${domain}${pathname}`;
}

function normalizeSegment(segment: ActivitySegmentInput) {
  return normalizeActivityContext(
    {
      url: segment.context.url,
      title: segment.context.title,
    },
    { capture: defaultCapture },
  );
}

export function buildBrowserActivityBuckets(
  segments: ActivitySegmentInput[],
  options: BrowserBucketOptions,
): BrowserActivityBucket[] {
  const mixedThreshold = options.mixedThreshold ?? 0.65;
  const closeSecondThreshold = options.closeSecondThreshold ?? 0.2;
  const grouped = new Map<string, Map<string, EvidenceAccumulator>>();

  for (const segment of segments) {
    const overlapStartAt = Math.max(segment.startedAt, options.from);
    const overlapEndAt = Math.min(segment.endedAt, options.to);
    if (overlapEndAt <= overlapStartAt) {
      continue;
    }

    const normalized = normalizeSegment(segment);
    let currentBucketStartAt =
      Math.floor(overlapStartAt / options.bucketSizeMs) * options.bucketSizeMs;

    while (currentBucketStartAt < overlapEndAt) {
      const currentBucketEndAt = currentBucketStartAt + options.bucketSizeMs;
      const sliceStartAt = Math.max(currentBucketStartAt, overlapStartAt);
      const sliceEndAt = Math.min(currentBucketEndAt, overlapEndAt);

      if (sliceEndAt > sliceStartAt) {
        const localDate = localDateAt(currentBucketStartAt);
        const key = bucketKey(localDate, currentBucketStartAt);
        const bucketEvidence =
          grouped.get(key) ?? new Map<string, EvidenceAccumulator>();
        const existing = bucketEvidence.get(normalized.fingerprint);
        const durationMs = sliceEndAt - sliceStartAt;

        if (existing) {
          existing.durationMs += durationMs;
          existing.sourceSegmentIds.add(segment.externalSegmentId);
        } else {
          bucketEvidence.set(normalized.fingerprint, {
            fingerprint: normalized.fingerprint,
            domain: normalized.domain,
            pathname: normalized.pathname,
            title: normalized.title,
            durationMs,
            sourceSegmentIds: new Set([segment.externalSegmentId]),
          });
        }

        grouped.set(key, bucketEvidence);
      }

      currentBucketStartAt = currentBucketEndAt;
    }
  }

  return [...grouped.entries()]
    .map(([key, evidenceByFingerprint]) => {
      const evidence = [...evidenceByFingerprint.values()].sort(
        (left, right) =>
          right.durationMs - left.durationMs ||
          left.fingerprint.localeCompare(right.fingerprint),
      );
      const totalDurationMs = evidence.reduce(
        (sum, item) => sum + item.durationMs,
        0,
      );
      const dominant = evidence[0];
      if (!dominant || totalDurationMs <= 0) {
        return null;
      }

      const evidenceItems: BucketEvidenceItem[] = evidence.map((item) => ({
        fingerprint: item.fingerprint,
        domain: item.domain,
        pathname: item.pathname,
        title: item.title,
        durationMs: item.durationMs,
        percentage: item.durationMs / totalDurationMs,
        sourceSegmentIds: [...item.sourceSegmentIds].sort(),
      }));

      const runnerUp = evidenceItems[1];
      const confidence = dominant.durationMs / totalDurationMs;
      const isMixed =
        confidence < mixedThreshold ||
        Boolean(
          runnerUp && confidence - runnerUp.percentage < closeSecondThreshold,
        );
      const [localDate = "", startedAtValue] = key.split(":");
      const startedAt = Number(startedAtValue);
      const endedAt = startedAt + options.bucketSizeMs;

      return {
        bucketKey: key,
        localDate,
        bucketStartAt: startedAt,
        bucketEndAt: endedAt,
        startedAt,
        endedAt,
        durationMs: totalDurationMs,
        dominant: {
          domain: dominant.domain,
          pathname: dominant.pathname,
          title: dominant.title,
          fingerprint: dominant.fingerprint,
          label: displayLabel(dominant.title, dominant.domain),
          subtitle: displaySubtitle(dominant.domain, dominant.pathname),
        },
        evidence: evidenceItems,
        confidence,
        isMixed,
        importedAt: Date.now(),
      } satisfies BrowserActivityBucket;
    })
    .filter((bucket): bucket is BrowserActivityBucket => bucket !== null)
    .sort((left, right) => left.startedAt - right.startedAt);
}

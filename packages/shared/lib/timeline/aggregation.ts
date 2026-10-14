import type {
  ActivityBlockRecord,
  ActivitySegmentRecord,
  AssignmentSource,
  BlockStatus,
} from "../types/domain";

export interface AggregationOptions {
  mergeGapMs: number;
  microBlockThresholdMs: number;
}

function blockStatusForSuggestion(confidence: number): BlockStatus {
  return confidence > 0 ? "suggested" : "draft";
}

function assignmentSourceForConfidence(confidence: number): AssignmentSource {
  return confidence >= 0.9 ? "auto" : confidence > 0 ? "history" : "none";
}

function displayLabel(segment: ActivitySegmentRecord): string {
  const domainLabel = segment.normalized.domain.replace(/^www\./, "");
  if (!segment.normalized.title) {
    return domainLabel;
  }
  const firstPart = segment.normalized.title.split(/[|\-]/)[0] ?? "";
  return (
    firstPart.trim().replace(/\b\w/g, (char: string) => char.toUpperCase()) ||
    domainLabel
  );
}

function displaySubtitle(segment: ActivitySegmentRecord): string {
  return segment.normalized.pathname === "/"
    ? segment.normalized.domain
    : `${segment.normalized.domain}${segment.normalized.pathname}`;
}

function createBlock(
  segment: ActivitySegmentRecord,
  options: AggregationOptions,
): ActivityBlockRecord {
  const durationMs = segment.endedAt - segment.startedAt;
  return {
    userId: segment.userId,
    teamId: segment.teamId,
    localDate: segment.localDate,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    durationMs,
    sourceSegmentIds: [segment.externalSegmentId],
    fingerprint: segment.normalized.fingerprint,
    display: {
      label: displayLabel(segment),
      subtitle: displaySubtitle(segment),
    },
    status: "draft",
    assignmentSource: "none",
    confidence: 0,
    isMicroBlock: durationMs < options.microBlockThresholdMs,
    locked: false,
    domain: segment.normalized.domain,
    pathname: segment.normalized.pathname,
    title: segment.normalized.title,
  };
}

function canMergeBlock(
  current: ActivityBlockRecord,
  next: ActivitySegmentRecord,
  options: AggregationOptions,
): boolean {
  const gap = next.startedAt - current.endedAt;
  return (
    current.fingerprint === next.normalized.fingerprint &&
    gap <= options.mergeGapMs &&
    !next.isIdleSplit
  );
}

export function aggregateSegmentsToBlocks(
  segments: ActivitySegmentRecord[],
  options: AggregationOptions,
): ActivityBlockRecord[] {
  const sorted = [...segments].sort((a, b) => a.startedAt - b.startedAt);
  const blocks: ActivityBlockRecord[] = [];

  for (const segment of sorted) {
    const current = blocks.at(-1);
    if (!current || !canMergeBlock(current, segment, options)) {
      blocks.push(createBlock(segment, options));
      continue;
    }

    current.endedAt = Math.max(current.endedAt, segment.endedAt);
    current.durationMs = current.endedAt - current.startedAt;
    current.sourceSegmentIds.push(segment.externalSegmentId);
    current.isMicroBlock = current.durationMs < options.microBlockThresholdMs;
  }

  return blocks.map((block) => ({
    ...block,
    status: blockStatusForSuggestion(block.confidence),
    assignmentSource: assignmentSourceForConfidence(block.confidence),
  }));
}

export function mergeBlocks(
  blocks: ActivityBlockRecord[],
  leftIndex: number,
  rightIndex: number,
): ActivityBlockRecord[] {
  const left = blocks[leftIndex];
  const right = blocks[rightIndex];
  if (!left || !right) {
    return blocks;
  }

  const merged: ActivityBlockRecord = {
    ...left,
    endedAt: right.endedAt,
    durationMs: right.endedAt - left.startedAt,
    sourceSegmentIds: [...left.sourceSegmentIds, ...right.sourceSegmentIds],
    display: {
      label: left.display.label,
      subtitle: left.display.subtitle,
    },
    status: "edited",
    locked: true,
  };

  return blocks
    .filter((_, index) => index !== leftIndex && index !== rightIndex)
    .concat(merged)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function splitBlock(
  block: ActivityBlockRecord,
  splitAt: number,
): [ActivityBlockRecord, ActivityBlockRecord] {
  if (splitAt <= block.startedAt || splitAt >= block.endedAt) {
    throw new Error("splitAt must be inside the block range");
  }

  const left: ActivityBlockRecord = {
    ...block,
    endedAt: splitAt,
    durationMs: splitAt - block.startedAt,
    status: "edited",
    locked: true,
  };

  const right: ActivityBlockRecord = {
    ...block,
    startedAt: splitAt,
    durationMs: block.endedAt - splitAt,
    status: "edited",
    locked: true,
  };

  return [left, right];
}

import {
  aggregateSegmentsToBlocks,
  evaluateBlockAgainstRules,
  normalizeActivityContext,
  type ActivityBlockRecord,
  type ActivitySegmentRecord,
  type BrowserActivityBucket,
} from "@timetracker/shared";
import type {
  ImportedBrowserDraft,
  LocalAppState,
  TimelineMutationResult,
} from "@/domain/local-state";
import { formatLocalDateFromTimestamp } from "@/domain/time/duration";

export interface TimelineFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export interface TimelineDefaults {
  mergeGapMs: number;
  microBlockThresholdMs: number;
}

export type TimelineRuleSeed = Pick<
  ActivityBlockRecord,
  "projectId" | "domain" | "pathname"
>;

export type ImportedBrowserDraftPatch = Partial<
  Pick<
    ImportedBrowserDraft,
    | "projectId"
    | "note"
    | "status"
    | "dismissed"
    | "assignmentSource"
    | "explanation"
  >
>;

export function getActivityBlockId(block: ActivityBlockRecord): string {
  return block.id ?? block.sourceSegmentIds.join("__");
}

export function buildSampleActivitySegment(
  state: LocalAppState,
  url: string,
  title: string,
  factories: TimelineFactories,
): ActivitySegmentRecord {
  const endedAt = factories.now();
  const startedAt = endedAt - 20 * 60 * 1000;
  const normalized = normalizeActivityContext(
    { url, title },
    { capture: state.capture },
  );

  return {
    externalSegmentId: factories.createId("segment"),
    userId: state.user._id,
    teamId: state.team?._id ?? "local_team",
    deviceId: "local_web",
    source: "browser_extension",
    capturedUrlMode: state.capture.urlMode,
    localDate: formatLocalDateFromTimestamp(startedAt),
    startedAt,
    endedAt,
    activeDurationMs: endedAt - startedAt,
    idleDurationMs: 0,
    isIdleSplit: false,
    context: { url, title },
    normalized,
    createdAt: factories.now(),
  };
}

function materializeBlocks(
  state: LocalAppState,
  localDate: string,
  defaults: TimelineDefaults,
) {
  const visibleSegments = state.segments.filter(
    (segment) =>
      segment.localDate === localDate &&
      !state.dismissedSegmentIds.includes(segment.externalSegmentId) &&
      !state.editedBlocks.some((block) =>
        block.sourceSegmentIds.includes(segment.externalSegmentId),
      ),
  );
  const draftBlocks = aggregateSegmentsToBlocks(visibleSegments, {
    mergeGapMs: state.team?.settings.mergeGapMs ?? defaults.mergeGapMs,
    microBlockThresholdMs:
      state.team?.settings.microBlockThresholdMs ??
      defaults.microBlockThresholdMs,
  }).map((block) => {
    const suggestion = evaluateBlockAgainstRules(
      block,
      state.rules,
      [],
    ).suggestion;

    return {
      ...block,
      id: getActivityBlockId(block),
      projectId: suggestion?.projectId,
      confidence: suggestion?.confidence ?? 0,
      explanation: suggestion?.explanation,
      assignmentSource: suggestion?.source ?? "none",
      status: suggestion ? "suggested" : "draft",
    } satisfies ActivityBlockRecord;
  });

  return [
    ...state.editedBlocks.filter((block) => block.localDate === localDate),
    ...draftBlocks,
  ].sort((left, right) => left.startedAt - right.startedAt);
}

function createBrowserRuleSeed(
  state: LocalAppState,
  bucket: BrowserActivityBucket,
  defaults: TimelineDefaults,
): ActivityBlockRecord {
  return {
    id: bucket.bucketKey,
    userId: state.user._id,
    teamId: state.team?._id ?? "local_team",
    localDate: bucket.localDate,
    startedAt: bucket.startedAt,
    endedAt: bucket.endedAt,
    durationMs: bucket.durationMs,
    sourceSegmentIds: bucket.evidence.flatMap((item) => item.sourceSegmentIds),
    fingerprint: bucket.dominant.fingerprint,
    display: {
      label: bucket.dominant.label,
      subtitle: bucket.dominant.subtitle,
    },
    status: "suggested",
    assignmentSource: "none",
    confidence: bucket.confidence,
    isMicroBlock:
      bucket.durationMs <
      (state.team?.settings.microBlockThresholdMs ??
        defaults.microBlockThresholdMs),
    locked: false,
    domain: bucket.dominant.domain,
    pathname: bucket.dominant.pathname,
    title: bucket.dominant.title,
  };
}

function createImportedBrowserDraft(
  state: LocalAppState,
  bucket: BrowserActivityBucket,
  defaults: TimelineDefaults,
): ImportedBrowserDraft {
  const suggestion = evaluateBlockAgainstRules(
    createBrowserRuleSeed(state, bucket, defaults),
    state.rules,
    [],
  ).suggestion;
  const explanation =
    suggestion?.explanation ??
    (bucket.isMixed
      ? `Mixed browser bucket. Dominant activity covered ${Math.round(bucket.confidence * 100)}% of this 5-minute window.`
      : "Imported browser activity. No saved rule matched yet.");

  return {
    _id: `browser_${bucket.bucketKey}`,
    bucketKey: bucket.bucketKey,
    localDate: bucket.localDate,
    startedAt: bucket.startedAt,
    endedAt: bucket.endedAt,
    durationMs: bucket.durationMs,
    dominantDomain: bucket.dominant.domain,
    dominantPathname: bucket.dominant.pathname,
    dominantTitle: bucket.dominant.title,
    dominantLabel: bucket.dominant.label,
    dominantSubtitle: bucket.dominant.subtitle,
    dominantFingerprint: bucket.dominant.fingerprint,
    evidence: bucket.evidence,
    dismissed: false,
    status: suggestion?.projectId ? "assigned" : "draft",
    projectId: suggestion?.projectId,
    importedAt: bucket.importedAt,
    source: "extension_bridge",
    confidence: suggestion?.confidence ?? bucket.confidence,
    isMixed: bucket.isMixed,
    assignmentSource: suggestion?.source ?? "none",
    explanation,
    manuallyEdited: false,
  };
}

function preserveImportedBrowserDraft(
  existing: ImportedBrowserDraft | undefined,
  incoming: ImportedBrowserDraft,
) {
  if (!existing) {
    return incoming;
  }

  return {
    ...incoming,
    projectId: existing.manuallyEdited
      ? existing.projectId
      : incoming.projectId,
    note: existing.note,
    dismissed: existing.dismissed,
    status:
      existing.status === "committed" ||
      existing.status === "dismissed" ||
      existing.manuallyEdited
        ? existing.status
        : incoming.status,
    assignmentSource: existing.manuallyEdited
      ? existing.assignmentSource
      : incoming.assignmentSource,
    explanation:
      existing.manuallyEdited && existing.explanation
        ? existing.explanation
        : incoming.explanation,
    manuallyEdited: existing.manuallyEdited,
  };
}

export function importBrowserBuckets(
  state: LocalAppState,
  buckets: BrowserActivityBucket[],
  defaults: TimelineDefaults,
  now: () => number,
): LocalAppState {
  const importedBrowserDrafts = [...state.importedBrowserDrafts];

  for (const bucket of buckets) {
    const incoming = createImportedBrowserDraft(state, bucket, defaults);
    const currentIndex = importedBrowserDrafts.findIndex(
      (draft) => draft.bucketKey === bucket.bucketKey,
    );
    const merged = preserveImportedBrowserDraft(
      currentIndex >= 0 ? importedBrowserDrafts[currentIndex] : undefined,
      incoming,
    );

    if (currentIndex >= 0) {
      importedBrowserDrafts[currentIndex] = merged;
    } else {
      importedBrowserDrafts.push(merged);
    }
  }

  return {
    ...state,
    importedBrowserDrafts,
    lastExtensionImportAt: now(),
  };
}

export function materializeTimeline(
  state: LocalAppState,
  localDate: string,
  defaults: TimelineDefaults,
): TimelineMutationResult & { status: "local"; localDate: string } {
  const blocks = materializeBlocks(state, localDate, defaults);
  const browserDrafts = state.importedBrowserDrafts
    .filter(
      (draft) =>
        draft.localDate === localDate &&
        !draft.dismissed &&
        draft.status !== "dismissed" &&
        draft.status !== "committed",
    )
    .sort((left, right) => left.startedAt - right.startedAt);
  const committedEntries = state.timesheetEntries.filter(
    (entry) => entry.localDate === localDate,
  );

  return {
    status: "local",
    localDate,
    blocks,
    browserDrafts,
    trackedMs:
      blocks.reduce((sum, block) => sum + block.durationMs, 0) +
      browserDrafts.reduce((sum, draft) => sum + draft.durationMs, 0),
    committedMs: committedEntries.reduce(
      (sum, entry) => sum + entry.durationMs,
      0,
    ),
    extensionBridgeStatus: state.extensionBridgeStatus,
  };
}

export function upsertEditedBlock(
  state: LocalAppState,
  block: ActivityBlockRecord,
): LocalAppState {
  const id = getActivityBlockId(block);

  return {
    ...state,
    editedBlocks: [
      ...state.editedBlocks.filter((item) => getActivityBlockId(item) !== id),
      { ...block, id, status: "edited", locked: true },
    ],
  };
}

export function updateImportedBrowserDraft(
  state: LocalAppState,
  draftId: string,
  patch: ImportedBrowserDraftPatch,
): LocalAppState {
  return {
    ...state,
    importedBrowserDrafts: state.importedBrowserDrafts.map((draft) =>
      draft._id === draftId
        ? { ...draft, ...patch, manuallyEdited: true }
        : draft,
    ),
  };
}

export function dismissActivityBlock(
  state: LocalAppState,
  block: ActivityBlockRecord,
): LocalAppState {
  const id = getActivityBlockId(block);

  return {
    ...state,
    editedBlocks: state.editedBlocks.filter(
      (item) => getActivityBlockId(item) !== id,
    ),
    dismissedSegmentIds: [
      ...new Set([...state.dismissedSegmentIds, ...block.sourceSegmentIds]),
    ],
  };
}

export function dismissImportedBrowserDraft(
  state: LocalAppState,
  draftId: string,
) {
  return updateImportedBrowserDraft(state, draftId, {
    dismissed: true,
    status: "dismissed",
    explanation:
      "Dismissed locally. This browser bucket stays on-device and will not appear in review again.",
  });
}

export function commitActivityBlock(
  state: LocalAppState,
  block: ActivityBlockRecord,
  factories: TimelineFactories,
): LocalAppState {
  if (!block.projectId) {
    throw new Error("Assign a project before committing a timesheet entry");
  }

  const id = getActivityBlockId(block);
  if (hasCommittedSource(state, id)) {
    return state;
  }

  return {
    ...state,
    timesheetEntries: [
      ...state.timesheetEntries,
      {
        _id: factories.createId("timesheet"),
        localDate: block.localDate,
        projectId: block.projectId,
        label: block.display.label,
        note: block.note,
        durationMs: block.durationMs,
        sourceBlockIds: [id],
        committedAt: factories.now(),
      },
    ],
    dismissedSegmentIds: [
      ...new Set([...state.dismissedSegmentIds, ...block.sourceSegmentIds]),
    ],
    editedBlocks: state.editedBlocks.filter(
      (item) => getActivityBlockId(item) !== id,
    ),
  };
}

function hasCommittedSource(state: LocalAppState, sourceBlockId: string) {
  return state.timesheetEntries.some((entry) =>
    entry.sourceBlockIds.includes(sourceBlockId),
  );
}

export function commitImportedBrowserDraft(
  state: LocalAppState,
  draftId: string,
  factories: TimelineFactories,
): LocalAppState {
  const draft = state.importedBrowserDrafts.find(
    (item) => item._id === draftId,
  );
  if (
    !draft?.projectId ||
    draft.dismissed ||
    draft.status === "dismissed" ||
    draft.status === "committed"
  ) {
    return state;
  }

  const sourceBlockId = `bucket:${draft.bucketKey}`;
  const importedBrowserDrafts = state.importedBrowserDrafts.map((item) =>
    item._id === draftId
      ? {
          ...item,
          status: "committed" as const,
          manuallyEdited: true,
          explanation: hasCommittedSource(state, sourceBlockId)
            ? item.explanation
            : "Committed to the local timesheet. The original browser bucket remains local-only.",
        }
      : item,
  );

  return hasCommittedSource(state, sourceBlockId)
    ? { ...state, importedBrowserDrafts }
    : {
        ...state,
        timesheetEntries: [
          ...state.timesheetEntries,
          {
            _id: factories.createId("timesheet"),
            localDate: draft.localDate,
            projectId: draft.projectId,
            label: draft.dominantLabel,
            note: draft.note,
            durationMs: draft.durationMs,
            sourceBlockIds: [sourceBlockId],
            committedAt: factories.now(),
          },
        ],
        importedBrowserDrafts,
      };
}

export function saveRuleFromBlock(
  state: LocalAppState,
  block: TimelineRuleSeed,
  factories: TimelineFactories,
): LocalAppState {
  if (!block.projectId) {
    throw new Error("Assign a project before saving a rule");
  }
  const domain = block.domain?.trim();
  if (!domain) {
    throw new Error("A browser domain is required before saving a rule");
  }

  return {
    ...state,
    rules: [
      ...state.rules,
      {
        id: factories.createId("rule"),
        userId: state.user._id,
        teamId: state.team?._id ?? "local_team",
        enabled: true,
        priority: 50,
        source: "manual",
        status: "active",
        action: "suggest",
        targetProjectId: block.projectId,
        condition: {
          domain,
          pathnamePrefix: block.pathname === "/" ? undefined : block.pathname,
        },
        baseConfidence: 0.9,
      },
    ],
  };
}

export function saveRuleFromImportedBrowserDraft(
  state: LocalAppState,
  draftId: string,
  factories: TimelineFactories,
) {
  const draft = state.importedBrowserDrafts.find(
    (item) => item._id === draftId,
  );
  if (!draft?.projectId) {
    throw new Error("Assign a project before saving a rule");
  }

  return saveRuleFromBlock(
    state,
    {
      projectId: draft.projectId,
      domain: draft.dominantDomain,
      pathname: draft.dominantPathname,
    },
    factories,
  );
}

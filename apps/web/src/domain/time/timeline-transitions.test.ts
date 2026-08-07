import { describe, expect, it } from "vitest";
import type {
  ActivityBlockRecord,
  BrowserActivityBucket,
} from "@timetracker/shared";
import type { LocalAppState } from "@/domain/local-state";
import {
  commitActivityBlock,
  commitImportedBrowserDraft,
  dismissActivityBlock,
  importBrowserBuckets,
  materializeTimeline,
  saveRuleFromBlock,
  saveRuleFromImportedBrowserDraft,
  updateImportedBrowserDraft,
  type TimelineDefaults,
  type TimelineFactories,
} from "@/domain/time/timeline-transitions";

const defaults: TimelineDefaults = {
  mergeGapMs: 90_000,
  microBlockThresholdMs: 180_000,
};

function createFactories(): TimelineFactories {
  let nextId = 1;

  return {
    createId: (prefix) => `${prefix}-${nextId++}`,
    now: () => 1_000,
  };
}

function createState(
  overrides: Partial<LocalAppState> = {},
): LocalAppState {
  return {
    user: {
      _id: "local-user",
      name: "Local User",
      email: "local@example.com",
    },
    projects: [],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [],
    timesheetEntries: [],
    timesheetImportDrafts: [],
    workItems: [],
    backlogStatuses: [],
    backlogStatusMappings: [],
    backlogSortMode: "custom",
    capture: {
      urlMode: "sanitized_path",
      titleMode: "normalized",
      blockedDomains: [],
      sensitiveDomains: [],
      maxPathSegments: 4,
    },
    userPreferences: {
      themeMode: "system",
      updateTrack: "stable",
      projectDataShapeId: "default",
    },
    updatedAt: 0,
    ...overrides,
  };
}

function createBucket(
  overrides: Partial<BrowserActivityBucket> = {},
): BrowserActivityBucket {
  return {
    localDate: "2026-07-30",
    bucketStartAt: 100,
    bucketEndAt: 400,
    bucketKey: "bucket-1",
    startedAt: 100,
    endedAt: 400,
    durationMs: 300,
    dominant: {
      domain: "example.com",
      pathname: "/work",
      title: "Example work",
      fingerprint: "example.com/work",
      label: "Example work",
      subtitle: "example.com",
    },
    evidence: [
      {
        fingerprint: "example.com/work",
        domain: "example.com",
        pathname: "/work",
        title: "Example work",
        durationMs: 300,
        percentage: 1,
        sourceSegmentIds: ["segment-1"],
      },
    ],
    confidence: 1,
    isMixed: false,
    importedAt: 500,
    ...overrides,
  };
}

function createBlock(
  overrides: Partial<ActivityBlockRecord> = {},
): ActivityBlockRecord {
  return {
    id: "block-1",
    userId: "local-user",
    teamId: "local-team",
    localDate: "2026-07-30",
    startedAt: 100,
    endedAt: 400,
    durationMs: 300,
    sourceSegmentIds: ["segment-1"],
    fingerprint: "example.com/work",
    display: {
      label: "Example work",
      subtitle: "example.com",
    },
    status: "edited",
    projectId: "project-1",
    assignmentSource: "manual",
    confidence: 1,
    isMicroBlock: false,
    locked: true,
    domain: "example.com",
    pathname: "/work",
    title: "Example work",
    ...overrides,
  };
}

describe("timeline imports", () => {
  it("preserves manual browser review fields across re-imports", () => {
    const imported = importBrowserBuckets(
      createState(),
      [createBucket()],
      defaults,
      () => 600,
    );
    const edited = updateImportedBrowserDraft(
      imported,
      "browser_bucket-1",
      {
        projectId: "project-1",
        note: "Keep this note",
        status: "assigned",
        assignmentSource: "manual",
      },
    );
    const reimported = importBrowserBuckets(
      edited,
      [createBucket({ durationMs: 450 })],
      defaults,
      () => 700,
    );

    expect(reimported.importedBrowserDrafts[0]).toMatchObject({
      durationMs: 450,
      projectId: "project-1",
      note: "Keep this note",
      status: "assigned",
      assignmentSource: "manual",
      manuallyEdited: true,
    });
    expect(reimported.lastExtensionImportAt).toBe(700);
  });
});

describe("timeline commits", () => {
  it("commits an activity block and removes it from review", () => {
    const block = createBlock();
    const state = createState({ editedBlocks: [block] });
    const committed = commitActivityBlock(state, block, createFactories());

    expect(committed.timesheetEntries[0]).toMatchObject({
      _id: "timesheet-1",
      sourceBlockIds: ["block-1"],
      projectId: "project-1",
      durationMs: 300,
    });
    expect(committed.editedBlocks).toEqual([]);
    expect(committed.dismissedSegmentIds).toEqual(["segment-1"]);
  });

  it("requires a project before committing an activity block", () => {
    expect(() =>
      commitActivityBlock(
        createState(),
        createBlock({ projectId: undefined }),
        createFactories(),
      ),
    ).toThrow("Assign a project before committing a timesheet entry");
  });

  it("commits an activity block idempotently", () => {
    const block = createBlock();
    const first = commitActivityBlock(
      createState(),
      block,
      createFactories(),
    );
    const second = commitActivityBlock(first, block, createFactories());

    expect(second).toBe(first);
    expect(second.timesheetEntries).toHaveLength(1);
  });

  it("commits browser drafts idempotently", () => {
    const browserState = updateImportedBrowserDraft(
      importBrowserBuckets(
        createState(),
        [createBucket()],
        defaults,
        () => 500,
      ),
      "browser_bucket-1",
      { projectId: "project-1", status: "assigned" },
    );
    const firstBrowserCommit = commitImportedBrowserDraft(
      browserState,
      "browser_bucket-1",
      createFactories(),
    );
    const secondBrowserCommit = commitImportedBrowserDraft(
      firstBrowserCommit,
      "browser_bucket-1",
      createFactories(),
    );
    expect(secondBrowserCommit.timesheetEntries).toHaveLength(1);
    expect(secondBrowserCommit.importedBrowserDrafts[0]?.status).toBe(
      "committed",
    );
  });

  it("dismisses block sources without duplicating segment IDs", () => {
    const block = createBlock();
    const dismissed = dismissActivityBlock(
      createState({
        editedBlocks: [block],
        dismissedSegmentIds: ["segment-1"],
      }),
      block,
    );

    expect(dismissed.editedBlocks).toEqual([]);
    expect(dismissed.dismissedSegmentIds).toEqual(["segment-1"]);
  });

  it("does not commit dismissed imported drafts", () => {
    const browserState = importBrowserBuckets(
      createState(),
      [createBucket()],
      defaults,
      () => 500,
    );
    browserState.importedBrowserDrafts[0]!.projectId = "project-1";
    browserState.importedBrowserDrafts[0]!.dismissed = true;

    expect(
      commitImportedBrowserDraft(
        browserState,
        "browser_bucket-1",
        createFactories(),
      ),
    ).toBe(browserState);
  });
});

describe("timeline read model and rules", () => {
  it("filters terminal drafts and reports tracked and committed totals", () => {
    const browserState = importBrowserBuckets(
      createState(),
      [createBucket()],
      defaults,
      () => 500,
    );
    browserState.timesheetEntries = [
      {
        _id: "entry-1",
        localDate: "2026-07-30",
        label: "Committed",
        durationMs: 250,
        sourceBlockIds: [],
        committedAt: 800,
      },
    ];

    const timeline = materializeTimeline(
      browserState,
      "2026-07-30",
      defaults,
    );

    expect(timeline.trackedMs).toBe(300);
    expect(timeline.committedMs).toBe(250);
    expect(timeline.browserDrafts).toHaveLength(1);
  });

  it("creates a rule from an assigned imported browser draft", () => {
    const state = updateImportedBrowserDraft(
      importBrowserBuckets(
        createState(),
        [createBucket()],
        defaults,
        () => 500,
      ),
      "browser_bucket-1",
      { projectId: "project-1" },
    );
    const withRule = saveRuleFromImportedBrowserDraft(
      state,
      "browser_bucket-1",
      createFactories(),
    );

    expect(withRule.rules[0]).toMatchObject({
      id: "rule-1",
      targetProjectId: "project-1",
      condition: {
        domain: "example.com",
        pathnamePrefix: "/work",
      },
    });
  });

  it("requires a browser domain before saving a rule", () => {
    expect(() =>
      saveRuleFromBlock(
        createState(),
        {
          projectId: "project-1",
          domain: " ",
          pathname: "/work",
        },
        createFactories(),
      ),
    ).toThrow("A browser domain is required before saving a rule");
  });
});

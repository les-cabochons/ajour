# Commit week, slice 1: committed copies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajour remembers each entry as it was last committed, lists a week's added, updated and deleted entries on a Commit page that replaces the Submit page, commits the checked changes by hand or through an agent, and renames the plugin placement `submit-week` to `commit-week`.

**Architecture:** The committed copy lives on `LocalTimesheetEntry.commit`, and deleted committed entries become `LocalAppState.timesheetTombstones`. A new pure module, `domain/time/timesheet-commit.ts`, derives every change from those copies; `domain/time/timesheet-entry.ts` stays the owner of the transitions (delete leaves a tombstone, mark as committed, migration on load). The Commit page, the agent read tool `get_week_changes` and the write tool `mark_entries_committed` all read the same change list, and the page's checkboxes live in a small `lib/commit-selection.ts` store so agents see what the user unchecked.

**Tech Stack:** pnpm monorepo, TypeScript (`erasableSyntaxOnly`), zod 3, React 19, TanStack Router, Vitest, playwright-bdd. Run commands with `just`.

**Spec:** `docs/superpowers/specs/2026-10-15-commit-week-design.md` (slice 1 only)

## Global Constraints

- `LocalTimesheetEntry.commit?: LocalTimesheetEntryCommit`, with `{ at: number; localDate: string; projectId?: string; taskId?: string; note?: string; durationMs: number }`. Undefined until the entry's first commit.
- `LocalTimesheetEntry` loses `submittedAt`, `submittedFingerprint` and `previousSubmittedAt` (Task 6). `committedAt` keeps its meaning, and both `committedAt` and `commit` get doc comments.
- `LocalAppState.timesheetTombstones: LocalTimesheetTombstone[]`, with `{ entryId: string; commit: LocalTimesheetEntryCommit }`. Default `[]`.
- Change rules: `added` has no `commit`. `updated` has a `commit` that differs on `localDate`, `projectId`, `taskId`, trimmed `note` or `durationMs`. Otherwise no change. `label`, `committedAt`, `workItemId` and `sourceBlockIds` never make a change. A missing note equals an empty or blank one.
- Tombstones: deleting an entry with a `commit` adds its tombstone; deleting one without adds none; Undo of the delete removes the tombstone with the restored entry; committing a deleted change removes its tombstone.
- External ID: `ajour:` and 8 lowercase hex characters of the 32-bit FNV-1a hash (offset basis `0x811c9dc5`, prime `0x01000193`) of the entry `_id`. `externalEntryId("a") === "ajour:e40c292c"`. It depends on the `_id` only. `lineId`, `submitLineId` and `unsubmittedEntryIds` go away.
- MCP tools removed: `get_submit_lines`, `mark_entries_submitted`, `mark_entries_not_submitted`. Added: `get_week_changes { weekOf, onlyChecked = true }` and `mark_entries_committed { entryIds }` (1 to 500 IDs). Change values carry `date`, `projectName`, `projectCode`, `projectFullName`, `projectProperties`, `taskName`, `hours`, `note`. Neither tool carries `pace`. `list_time_entries` states become `saved`, `committed`, `running`.
- `mark_entries_committed` refuses an ID that is neither an entry nor a tombstone with "No entry or deleted entry has the id <id>. Call get_week_changes." It does not refuse running entries (the spec lists unknown IDs and locked weeks only; locking is slice 2).
- Runner prompt rule, exact text: "After the external tool saved a change, call mark_entries_committed with its entry ID. Never mark a change you did not apply."
- Plugin `placement`: `z.literal("commit-week")` in this slice. `submit-week` and `reset-sync` come back in slices 2 and 3.
- Existing data: an entry with a finite `submittedAt` gets a `commit` equal to its current values, with `at = submittedAt`. One with only `previousSubmittedAt` gets none. Both drop the three old fields. No other compatibility: no redirect from `/time/$date/submit`, no alias for old tool names or placements.
- UI copy: top bar popover button "Commit week"; route `/time/$date/commit`; page title "Commit week of Oct 5 to Oct 11"; section headings "Changes" and "Lines"; empty changes text "Everything is committed."; button "Mark as committed"; toast "1 change committed" or "3 changes committed"; kind labels "Added", "Updated", "Deleted"; Week view chip "Committed"; Day row check `aria-label="Committed"`; task settings line "Ready to run from the Commit page."
- `domain/time/week-pace.ts` and the `paceTolerancePercent` and `warnWhenSubmittingUnderCapacity` preferences stay untouched for slice 2. The Commit page asks no under-target question.
- No locking, `isDateLocked`, `get_week_status`, `submit_week`, `delete_entry` or Reset sync in this slice.
- No enums, namespaces or constructor parameter properties (`erasableSyntaxOnly`).
- Repository text in English, plain words, no em dashes. Conventional commits whose message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Acceptance tests run through a temporary `apps/web/playwright.local.config.ts` (see Task 5, Step 4). Never commit it. Do not run `just format` on this plan file, or restore it afterwards.

## Review Focus

- **An entry edited back to its committed values must show no change**, including a note that only gained spaces. Pinned in Task 1 (`getTimesheetEntryChange` tests) and Task 3 (edit, then edit back through `updateTimesheetEntry`).
- **Deleting a committed entry then pressing Undo must not leave a tombstone**, and once the deletion is committed the Undo must be refused instead of restoring a ghost. Pinned in Task 2 (`local-state-undo.test.ts`).
- **A partial commit must leave unchecked changes intact**: their entries keep no new copy, their tombstones stay, and the page keeps them unchecked. Pinned in Task 3 (domain), Task 4 (`get_week_changes` with an unchecked ID) and Task 5 (acceptance: uncheck Deleted, commit, only Deleted remains).
- **An entry moved across weeks** must show as one updated change in both weeks, never as a delete in one and an add in the other, and keep its external ID. Pinned in Task 1 (`listWeekChanges`), Task 3 (move keeps the copy) and Task 4 (read model output for both weeks).
- **A tombstone whose project or task was archived** must still carry the project name, full name, code and task name, for the Commit page and for the agent. `useLocalProjects()` returns active projects only, so the page must pass `state.projects`. Pinned in Task 1 (`describeTimesheetCommitValues`) and Task 4 (deleted change on an archived project).

## File Structure

- `apps/web/src/domain/local-state.ts`: `LocalTimesheetEntryCommit`, `LocalTimesheetTombstone`, `LocalTimesheetEntry.commit`, `LocalAppState.timesheetTombstones`; later drops the submission fields.
- `apps/web/src/domain/time/timesheet-commit.ts` (new): committed copies, change detection, week change list, value descriptions, normalizers.
- `apps/web/src/domain/time/timesheet-entry.ts`: tombstone on delete, `markTimesheetEntriesCommitted`, `keepTimesheetEntryCommit`, migration in `normalizeTimesheetEntry`; later drops the submission helpers.
- `apps/web/src/domain/time/timer-transitions.ts`: a resumed entry keeps its copy.
- `apps/web/src/domain/local-state-undo.ts`: tombstones are an undo collection.
- `apps/web/src/lib/local-store.ts`: default and normalized tombstones, `markTimesheetEntriesCommitted` with an undo token; later drops the submitted commands.
- `apps/web/src/lib/commit-selection.ts` (new): unchecked changes per week, in memory.
- `apps/web/src/domain/agents/external-id.ts` (renamed from `submit-line-id.ts`): `externalEntryId`.
- `apps/web/src/domain/agents/agent-read-model.ts`: `getWeekChangesForAgent`, entry state `committed`.
- `apps/web/src/features/agents/agent-tool-runner.ts`, `agent-write-tools.ts`: the new tools.
- `packages/shared/agent-tools.ts`: tool input and output contracts.
- `apps/api/src/mcp-server.ts`, `apps/api/src/agent-runner/prompts.ts`: tool descriptions and the runner rule.
- `apps/web/src/domain/time/timesheet-submission.ts`: Group by lines and the week summary only.
- `apps/web/src/features/time/commit-page.tsx` (renamed from `submit-page.tsx`), `commit-changes.tsx` (new), `commit-week-controls.tsx` (renamed from `submit-week-controls.tsx`): the Commit page, the change rows, the popover button and the Week chip.
- `apps/web/src/router.tsx`, `features/layout/app-shell.tsx`, `features/time/time-page.tsx`, `features/time/time-page-header.tsx`: route and entry points.
- `apps/web/src/domain/actions/object-actions.ts`, `features/time/time-entry-actions.tsx`, `features/timer/timer-panel.tsx`, `features/time/weekly-time-view.tsx`: entry state and indicators without `submittedAt`.
- `packages/shared/connectors.ts`, `packages/shared/agent-runs.ts`, `apps/web/src/features/agents/agent-task-buttons.tsx`: placement `commit-week`.
- `apps/web/src/styles/time.css`: change rows, renamed page class.
- Acceptance: `apps/web/tests/acceptance/features/commit-week.feature` and `steps/commit-week.steps.ts` (new); `local-workspace.feature` and steps, `agent-runner.feature` and steps updated.
- QA and docs: `qa/ui/seed.mjs`, `qa/ui/docs-shots.mjs`, `qa/routines/local-workspace-smoke.md`, `apps/docs/time/commit.md` (renamed from `submit.md`) and the pages linking to it, `apps/docs/app/agents.md`, `apps/docs/developers/manifest.md`, `apps/docs/plugins/workday-agent.md`, `agents/*.md`.
- `qa/ui/docs-fixtures.mjs` needs no change: its only `submittedAt` is a pull request review time.

---

### Task 1: Committed copy types and change detection

**Files:**
- Modify: `apps/web/src/domain/local-state.ts` (lines 150-169, `LocalTimesheetEntry`)
- Create: `apps/web/src/domain/time/timesheet-commit.ts`
- Test: `apps/web/src/domain/time/timesheet-commit.test.ts` (new)
- Modify: `agents/library-docs.md` (line 49-50, the timesheet modules list)

**Interfaces:**
- Consumes: `LocalTimesheetEntry`, `LocalProject`, `getLocalProjectDisplayName` from `domain/local-state.ts`.
- Produces:
  - `interface LocalTimesheetEntryCommit { at: number; localDate: string; projectId?: string; taskId?: string; note?: string; durationMs: number }`
  - `interface LocalTimesheetTombstone { entryId: string; commit: LocalTimesheetEntryCommit }`
  - `LocalTimesheetEntry.commit?: LocalTimesheetEntryCommit`
  - `type TimesheetCommitValues = Pick<LocalTimesheetEntryCommit, "localDate" | "projectId" | "taskId" | "note" | "durationMs">`
  - `type TimesheetCommitField = keyof TimesheetCommitValues`
  - `const TIMESHEET_COMMIT_FIELDS: readonly TimesheetCommitField[]`
  - `type TimesheetChange` (union of `added`, `updated` with `changedFields`, `deleted`), `type TimesheetChangeKind`
  - `toCommitValues(values: TimesheetCommitValues): TimesheetCommitValues`
  - `toCommittedCopy(entry: LocalTimesheetEntry, at: number): LocalTimesheetEntryCommit`
  - `getChangedCommitFields(committed: TimesheetCommitValues, current: TimesheetCommitValues): TimesheetCommitField[]`
  - `getTimesheetEntryChange(entry: LocalTimesheetEntry): TimesheetChange | undefined`
  - `isTimesheetEntryCommitted(entry: LocalTimesheetEntry): boolean`
  - `listWeekChanges(input: { entries: readonly LocalTimesheetEntry[]; tombstones: readonly LocalTimesheetTombstone[]; weekDates: readonly string[] }): TimesheetChange[]`
  - `interface TimesheetCommitNames { projectName?: string; projectFullName?: string; projectCode?: string; taskName?: string }`
  - `describeTimesheetCommitValues(projects: readonly LocalProject[], values: Pick<TimesheetCommitValues, "projectId" | "taskId">): TimesheetCommitNames`

- [ ] **Step 1: Write the failing tests** in `apps/web/src/domain/time/timesheet-commit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  LocalProject,
  LocalTimesheetEntry,
  LocalTimesheetTombstone,
} from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  describeTimesheetCommitValues,
  getTimesheetEntryChange,
  isTimesheetEntryCommitted,
  listWeekChanges,
  toCommittedCopy,
} from "@/domain/time/timesheet-commit";

const HOUR = 3_600_000;
const WEEK = [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
];
const NEXT_WEEK = [
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
];

function entry(
  overrides: Partial<LocalTimesheetEntry> & { _id: string },
): LocalTimesheetEntry {
  return {
    localDate: "2026-10-05",
    projectId: "project-1",
    taskId: "task-1",
    label: "Build",
    note: "API",
    durationMs: HOUR,
    sourceBlockIds: [],
    committedAt: 10,
    ...overrides,
  };
}

/** The entry with a copy of its own values, as right after a commit at 50. */
function committed(value: LocalTimesheetEntry): LocalTimesheetEntry {
  return { ...value, commit: toCommittedCopy(value, 50) };
}

function tombstone(entryId: string, localDate: string): LocalTimesheetTombstone {
  return {
    entryId,
    commit: {
      at: 50,
      localDate,
      projectId: "project-1",
      taskId: "task-1",
      note: "Gone",
      durationMs: HOUR,
    },
  };
}

describe("timesheet entry change", () => {
  it("is added until the entry has a committed copy", () => {
    expect(getTimesheetEntryChange(entry({ _id: "a" }))).toEqual({
      kind: "added",
      entryId: "a",
      current: {
        localDate: "2026-10-05",
        projectId: "project-1",
        taskId: "task-1",
        note: "API",
        durationMs: HOUR,
      },
    });
  });

  it("is none when the copy matches, so the entry is committed", () => {
    const value = committed(entry({ _id: "a" }));

    expect(getTimesheetEntryChange(value)).toBeUndefined();
    expect(isTimesheetEntryCommitted(value)).toBe(true);
    expect(isTimesheetEntryCommitted(entry({ _id: "b" }))).toBe(false);
  });

  it.each([
    ["localDate", { localDate: "2026-10-06" }],
    ["projectId", { projectId: "project-2" }],
    ["taskId", { taskId: "task-2" }],
    ["note", { note: "Login form" }],
    ["durationMs", { durationMs: 2 * HOUR }],
  ] as const)("is updated when %s changed", (field, edit) => {
    const value = { ...committed(entry({ _id: "a" })), ...edit };

    expect(getTimesheetEntryChange(value)).toMatchObject({
      kind: "updated",
      entryId: "a",
      changedFields: [field],
      committed: { durationMs: HOUR, note: "API" },
    });
  });

  it("ignores spaces around the note, the order and the label", () => {
    const value = {
      ...committed(entry({ _id: "a" })),
      note: "  API ",
      committedAt: 99,
      label: "Renamed",
    };

    expect(getTimesheetEntryChange(value)).toBeUndefined();
  });

  it("treats a blank note as no note", () => {
    const value = committed(entry({ _id: "a", note: undefined }));

    expect(getTimesheetEntryChange({ ...value, note: " " })).toBeUndefined();
  });

  it("shows no change once an edit returns every value to the copy", () => {
    const value = committed(entry({ _id: "a" }));
    const edited = { ...value, durationMs: 2 * HOUR, note: "Other" };

    expect(getTimesheetEntryChange(edited)?.kind).toBe("updated");
    expect(
      getTimesheetEntryChange({ ...edited, durationMs: HOUR, note: "API" }),
    ).toBeUndefined();
  });
});

describe("week changes", () => {
  it("lists the week's changes by day, then added, updated and deleted", () => {
    const changes = listWeekChanges({
      entries: [
        {
          ...committed(entry({ _id: "tue-updated", localDate: "2026-10-06" })),
          durationMs: 2 * HOUR,
        },
        entry({ _id: "tue-added", localDate: "2026-10-06" }),
        committed(entry({ _id: "mon-same" })),
        entry({ _id: "mon-added" }),
        entry({ _id: "next-week", localDate: "2026-10-12" }),
      ],
      tombstones: [
        tombstone("tue-deleted", "2026-10-06"),
        tombstone("last-week", "2026-09-28"),
      ],
      weekDates: WEEK,
    });

    expect(changes.map((change) => [change.kind, change.entryId])).toEqual([
      ["added", "mon-added"],
      ["added", "tue-added"],
      ["updated", "tue-updated"],
      ["deleted", "tue-deleted"],
    ]);
  });

  it("lists an entry moved to another week as one update in both weeks", () => {
    const moved = {
      ...committed(entry({ _id: "moved", localDate: "2026-10-09" })),
      localDate: "2026-10-13",
    };

    for (const weekDates of [WEEK, NEXT_WEEK]) {
      expect(
        listWeekChanges({ entries: [moved], tombstones: [], weekDates }),
      ).toEqual([
        expect.objectContaining({
          kind: "updated",
          entryId: "moved",
          changedFields: ["localDate"],
        }),
      ]);
    }
  });

  it("is empty when every entry is committed", () => {
    expect(
      listWeekChanges({
        entries: [committed(entry({ _id: "a" }))],
        tombstones: [],
        weekDates: WEEK,
      }),
    ).toEqual([]);
  });
});

describe("describing committed values", () => {
  const projects: LocalProject[] = [
    {
      _id: "project-1",
      name: "Acme Corporation",
      displayName: "Acme",
      code: " ACME-1 ",
      color: "#000",
      icon: DEFAULT_PROJECT_ICON,
      status: "archived",
      tasks: [{ _id: "task-1", name: "Build", status: "archived", createdAt: 1 }],
    },
  ];

  it("names an archived project and task, so a deleted entry still reads", () => {
    expect(
      describeTimesheetCommitValues(projects, {
        projectId: "project-1",
        taskId: "task-1",
      }),
    ).toEqual({
      projectName: "Acme",
      projectFullName: "Acme Corporation",
      projectCode: "ACME-1",
      taskName: "Build",
    });
  });

  it("leaves out what it cannot find", () => {
    expect(
      describeTimesheetCommitValues(projects, {
        projectId: "gone",
        taskId: "task-1",
      }),
    ).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/web && npx vitest run src/domain/time/timesheet-commit.test.ts`
Expected: FAIL, `Failed to resolve import "@/domain/time/timesheet-commit"`.

- [ ] **Step 3: Add the types** to `apps/web/src/domain/local-state.ts`. Put the two new interfaces right before `export interface LocalTimesheetEntry`, and replace the entry's `committedAt` line with the documented one plus `commit`. Leave `submittedAt`, `submittedFingerprint` and `previousSubmittedAt` in place until Task 6.

```ts
/**
 * An entry as it was last committed: the copy the external timesheet holds.
 * See docs/superpowers/specs/2026-10-15-commit-week-design.md.
 */
export interface LocalTimesheetEntryCommit {
  /** When the copy was saved. */
  at: number;
  localDate: string;
  projectId?: string;
  taskId?: string;
  note?: string;
  durationMs: number;
}

/**
 * A committed entry the user deleted since. It stays until the deletion is
 * committed, so the external timesheet can delete its copy too.
 */
export interface LocalTimesheetTombstone {
  entryId: string;
  commit: LocalTimesheetEntryCommit;
}
```

```ts
  /**
   * When the entry was saved, such as from a running entry. The Day view
   * orders entries by it. Unrelated to `commit`.
   */
  committedAt: number;
  /** The entry as it was last committed. Undefined until its first commit. */
  commit?: LocalTimesheetEntryCommit;
```

- [ ] **Step 4: Write `apps/web/src/domain/time/timesheet-commit.ts`**

```ts
import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalTimesheetEntry,
  type LocalTimesheetEntryCommit,
  type LocalTimesheetTombstone,
} from "@/domain/local-state";

/**
 * Committed copies: what changed in a week since its last commit. An entry
 * with no committed copy is added, one whose copy differs is updated, and a
 * tombstone is a deleted entry. Agents and the Commit page read the same
 * list. See docs/superpowers/specs/2026-10-15-commit-week-design.md.
 */

/** The values a commit compares. Other fields, such as the order, never make a change. */
export type TimesheetCommitValues = Pick<
  LocalTimesheetEntryCommit,
  "localDate" | "projectId" | "taskId" | "note" | "durationMs"
>;

export type TimesheetCommitField = keyof TimesheetCommitValues;

export const TIMESHEET_COMMIT_FIELDS = [
  "localDate",
  "projectId",
  "taskId",
  "note",
  "durationMs",
] as const satisfies readonly TimesheetCommitField[];

export type TimesheetChange =
  | { kind: "added"; entryId: string; current: TimesheetCommitValues }
  | {
      kind: "updated";
      entryId: string;
      current: TimesheetCommitValues;
      committed: LocalTimesheetEntryCommit;
      /** The fields that differ, in `TIMESHEET_COMMIT_FIELDS` order. */
      changedFields: TimesheetCommitField[];
    }
  | { kind: "deleted"; entryId: string; committed: LocalTimesheetEntryCommit };

export type TimesheetChangeKind = TimesheetChange["kind"];

/** The compared values of an entry or a copy, without anything else. */
export function toCommitValues(
  values: TimesheetCommitValues,
): TimesheetCommitValues {
  return {
    localDate: values.localDate,
    projectId: values.projectId,
    taskId: values.taskId,
    note: values.note,
    durationMs: values.durationMs,
  };
}

/** The copy a commit saves: the entry's values as they are now. */
export function toCommittedCopy(
  entry: LocalTimesheetEntry,
  at: number,
): LocalTimesheetEntryCommit {
  return { at, ...toCommitValues(entry) };
}

/** The fields where two sets of values differ. Notes compare trimmed. */
export function getChangedCommitFields(
  committed: TimesheetCommitValues,
  current: TimesheetCommitValues,
): TimesheetCommitField[] {
  return TIMESHEET_COMMIT_FIELDS.filter((field) =>
    field === "note"
      ? (committed.note ?? "").trim() !== (current.note ?? "").trim()
      : committed[field] !== current[field],
  );
}

/** The entry's change since its last commit, or undefined when its copy matches. */
export function getTimesheetEntryChange(
  entry: LocalTimesheetEntry,
): TimesheetChange | undefined {
  const current = toCommitValues(entry);
  if (!entry.commit) {
    return { kind: "added", entryId: entry._id, current };
  }

  const changedFields = getChangedCommitFields(entry.commit, current);
  return changedFields.length === 0
    ? undefined
    : {
        kind: "updated",
        entryId: entry._id,
        current,
        committed: entry.commit,
        changedFields,
      };
}

/** True when the external timesheet holds the entry as it is now. */
export function isTimesheetEntryCommitted(entry: LocalTimesheetEntry) {
  return (
    entry.commit !== undefined && getTimesheetEntryChange(entry) === undefined
  );
}

const KIND_ORDER: Record<TimesheetChangeKind, number> = {
  added: 0,
  updated: 1,
  deleted: 2,
};

/**
 * The week's changes, by day in week order, then added, updated and deleted,
 * then in list order. An entry moved to another week shows in both weeks as
 * one updated change, so committing it from either week moves its external
 * entry instead of deleting and adding it. A deleted entry shows in the week
 * of its committed day.
 */
export function listWeekChanges({
  entries,
  tombstones,
  weekDates,
}: {
  entries: readonly LocalTimesheetEntry[];
  tombstones: readonly LocalTimesheetTombstone[];
  weekDates: readonly string[];
}): TimesheetChange[] {
  const week = new Set(weekDates);
  const changes: { day: string; change: TimesheetChange }[] = [];

  for (const entry of entries) {
    const change = getTimesheetEntryChange(entry);
    if (!change) continue;
    const day = week.has(entry.localDate)
      ? entry.localDate
      : change.kind === "updated" && week.has(change.committed.localDate)
        ? change.committed.localDate
        : undefined;
    if (day) changes.push({ day, change });
  }
  for (const tombstone of tombstones) {
    if (!week.has(tombstone.commit.localDate)) continue;
    changes.push({
      day: tombstone.commit.localDate,
      change: {
        kind: "deleted",
        entryId: tombstone.entryId,
        committed: tombstone.commit,
      },
    });
  }

  // Array.prototype.sort is stable, so equal items keep their list order.
  return changes
    .sort(
      (left, right) =>
        left.day.localeCompare(right.day) ||
        KIND_ORDER[left.change.kind] - KIND_ORDER[right.change.kind],
    )
    .map((item) => item.change);
}

/** The names an external timesheet matches an entry by. */
export interface TimesheetCommitNames {
  /** The project's display name. */
  projectName?: string;
  projectFullName?: string;
  projectCode?: string;
  taskName?: string;
}

/**
 * Names the project and task of an entry or a copy. Pass every project,
 * archived ones too, so a deleted entry on an archived project still reads.
 * A project or task Ajour cannot find leaves its names out.
 */
export function describeTimesheetCommitValues(
  projects: readonly LocalProject[],
  values: Pick<TimesheetCommitValues, "projectId" | "taskId">,
): TimesheetCommitNames {
  const project = projects.find((item) => item._id === values.projectId);
  const task = project?.tasks.find((item) => item._id === values.taskId);
  const projectCode = project?.code?.trim();
  return {
    ...(project
      ? {
          projectName: getLocalProjectDisplayName(project),
          projectFullName: project.name,
        }
      : {}),
    ...(projectCode ? { projectCode } : {}),
    ...(task ? { taskName: task.name } : {}),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && npx vitest run src/domain/time/timesheet-commit.test.ts` then `just typecheck` from the repo root.
Expected: PASS, no type errors.

- [ ] **Step 6: Document the module** in `agents/library-docs.md`, after the `timesheet-entry.ts` line:

```md
- Committed copies, change detection (added, updated, deleted), the week's change list and the names an external timesheet matches: `apps/web/src/domain/time/timesheet-commit.ts`
```

- [ ] **Step 7: Commit**

```sh
git add apps/web/src/domain/local-state.ts apps/web/src/domain/time/timesheet-commit.ts apps/web/src/domain/time/timesheet-commit.test.ts agents/library-docs.md
git commit -m "feat(time): detect changes against committed copies" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tombstones on delete, with Undo

**Files:**
- Modify: `apps/web/src/domain/local-state.ts` (lines 492-523, `LocalAppState`)
- Modify: `apps/web/src/domain/time/timesheet-commit.ts` (append normalizers)
- Modify: `apps/web/src/domain/time/timesheet-entry.ts` (lines 266-288, `deleteTimesheetEntry`)
- Modify: `apps/web/src/domain/local-state-undo.ts` (lines 13-41 collections and keys, `captureUndo` around line 175, `restoreUndo` around line 338)
- Modify: `apps/web/src/lib/local-store.ts` (line 293 default state, lines 410-414 `normalizeState`)
- Modify fixtures that build a full `LocalAppState`, adding `timesheetTombstones: []` next to `timesheetImportDrafts: []`: `apps/web/src/domain/time/timesheet-entry.test.ts:53`, `apps/web/src/domain/local-state-undo.test.ts:98`, `apps/web/src/domain/time/timesheet-import.test.ts:60`, `apps/web/src/domain/time/timeline-transitions.test.ts:46`, `apps/web/src/domain/backlog/workflow-states.test.ts:37`, `apps/web/src/domain/backlog/work-item-connector.test.ts:35`, `apps/web/src/domain/backlog/work-item-transitions.test.ts:32`, `apps/web/src/domain/backlog/backlog-item-lifecycle.test.ts:43`, `apps/web/src/features/backlog/resolve-include-subitems.test.ts:36` (the stored JSON in `local-store.test.ts:1622` and the spread in `timesheet-import.ts:136` need nothing)
- Test: `apps/web/src/domain/time/timesheet-entry.test.ts`, `apps/web/src/domain/local-state-undo.test.ts`, `apps/web/src/domain/time/timesheet-commit.test.ts`, `apps/web/src/lib/local-store.test.ts`

**Interfaces:**
- Consumes: `LocalTimesheetTombstone`, `LocalTimesheetEntryCommit` (Task 1).
- Produces:
  - `LocalAppState.timesheetTombstones: LocalTimesheetTombstone[]`
  - `normalizeTimesheetEntryCommit(value: unknown): LocalTimesheetEntryCommit | undefined`
  - `normalizeTimesheetTombstones(value: unknown): LocalTimesheetTombstone[]`
  - `deleteTimesheetEntry` adds a tombstone for an entry with `commit`.
  - `"timesheetTombstones"` in `UNDO_COLLECTIONS`, keyed by `entryId`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/domain/time/timesheet-entry.test.ts`, add `timesheetTombstones: [],` after `timesheetImportDrafts: [],` in `createState`, add `LocalTimesheetEntry` to the type import from `@/domain/local-state`, and add at the end of the file:

```ts
describe("tombstones", () => {
  const HOUR = 60 * 60 * 1000;
  const committedEntry: LocalTimesheetEntry = {
    _id: "entry-1",
    localDate: "2026-07-30",
    projectId: "project-1",
    taskId: "task-1",
    label: "Feature work",
    note: "Shipped",
    durationMs: HOUR,
    sourceBlockIds: [],
    committedAt: 10,
    commit: {
      at: 50,
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      note: "Shipped",
      durationMs: HOUR,
    },
  };

  it("leaves a tombstone with the committed copy when a committed entry is deleted", () => {
    const next = deleteTimesheetEntry(
      createState({ timesheetEntries: [committedEntry] }),
      "entry-1",
    );

    expect(next.timesheetEntries).toEqual([]);
    expect(next.timesheetTombstones).toEqual([
      { entryId: "entry-1", commit: committedEntry.commit },
    ]);
  });

  it("leaves no tombstone for an entry never committed", () => {
    const neverCommitted: LocalTimesheetEntry = {
      ...committedEntry,
      commit: undefined,
    };
    const next = deleteTimesheetEntry(
      createState({ timesheetEntries: [neverCommitted] }),
      "entry-1",
    );

    expect(next.timesheetEntries).toEqual([]);
    expect(next.timesheetTombstones).toEqual([]);
  });
});
```

In `apps/web/src/domain/local-state-undo.test.ts`, add `timesheetTombstones: [],` after `timesheetImportDrafts: [],` in `createState`, then add inside `describe("time entry undo", ...)`:

```ts
  /** The fixture with "entry-b" committed as it is. */
  function withCommittedEntryB(): LocalAppState {
    const state = createState();
    return {
      ...state,
      timesheetEntries: state.timesheetEntries.map((item) =>
        item._id === "entry-b"
          ? {
              ...item,
              commit: {
                at: 50,
                localDate: item.localDate,
                projectId: item.projectId,
                taskId: item.taskId,
                note: item.note,
                durationMs: item.durationMs,
              },
            }
          : item,
      ),
    };
  }

  it("takes the tombstone back when a committed entry's delete is undone", () => {
    const before = withCommittedEntryB();
    const { after, undo } = undoAction(before, (state) =>
      deleteTimesheetEntry(state, "entry-b"),
    );
    expect(after.timesheetTombstones).toEqual([
      expect.objectContaining({ entryId: "entry-b" }),
    ]);

    const restored = restoreUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.timesheetTombstones).toEqual([]);
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
  });

  it("refuses to undo a delete whose deletion was committed since", () => {
    const { after, undo } = undoAction(withCommittedEntryB(), (state) =>
      deleteTimesheetEntry(state, "entry-b"),
    );
    // Committing the deleted change clears its tombstone.
    const deletionCommitted = { ...after, timesheetTombstones: [] };

    expect(restoreUndo(deletionCommitted, undo)).toEqual({
      state: deletionCommitted,
      result: "stale",
    });
  });
```

In `apps/web/src/domain/time/timesheet-commit.test.ts`, add `normalizeTimesheetTombstones` to the import and:

```ts
describe("stored tombstones", () => {
  it("keeps valid tombstones and drops malformed ones and repeats", () => {
    const valid = tombstone("a", "2026-10-05");

    expect(
      normalizeTimesheetTombstones([
        valid,
        { entryId: "b", commit: { at: "soon", localDate: "2026-10-05" } },
        { commit: valid.commit },
        { ...valid, commit: { ...valid.commit, at: 60 } },
        null,
      ]),
    ).toEqual([valid]);
  });

  it("reads a missing list as empty", () => {
    expect(normalizeTimesheetTombstones(undefined)).toEqual([]);
  });
});
```

In `apps/web/src/lib/local-store.test.ts`, inside the `describe` that holds "marks selected timesheet entries as submitted" (around line 2673):

```ts
  it("loads a workspace saved before tombstones with none", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({ timesheetEntries: [] }),
    );
    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().timesheetTombstones).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/web && npx vitest run src/domain/time/timesheet-entry.test.ts src/domain/local-state-undo.test.ts src/domain/time/timesheet-commit.test.ts src/lib/local-store.test.ts`
Expected: FAIL. `timesheetTombstones` is `undefined` after a delete and after loading, `normalizeTimesheetTombstones` is not exported.

- [ ] **Step 3: Add the state field** in `apps/web/src/domain/local-state.ts`, after `timesheetEntries`:

```ts
  /** Committed entries deleted since. See `LocalTimesheetTombstone`. */
  timesheetTombstones: LocalTimesheetTombstone[];
```

- [ ] **Step 4: Append the normalizers** to `apps/web/src/domain/time/timesheet-commit.ts`:

```ts
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

/** Reads a stored committed copy. Anything malformed reads as no copy. */
export function normalizeTimesheetEntryCommit(
  value: unknown,
): LocalTimesheetEntryCommit | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    !isFiniteNumber(record.at) ||
    typeof record.localDate !== "string" ||
    !isFiniteNumber(record.durationMs)
  ) {
    return undefined;
  }
  return {
    at: record.at,
    localDate: record.localDate,
    projectId: optionalString(record.projectId),
    taskId: optionalString(record.taskId),
    note: optionalString(record.note),
    durationMs: record.durationMs,
  };
}

/** Reads stored tombstones. Drops malformed ones and repeats of an entry. */
export function normalizeTimesheetTombstones(
  value: unknown,
): LocalTimesheetTombstone[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const commit = normalizeTimesheetEntryCommit(record.commit);
    if (
      typeof record.entryId !== "string" ||
      !commit ||
      seen.has(record.entryId)
    ) {
      return [];
    }
    seen.add(record.entryId);
    return [{ entryId: record.entryId, commit }];
  });
}
```

- [ ] **Step 5: Leave a tombstone on delete** in `deleteTimesheetEntry` (`apps/web/src/domain/time/timesheet-entry.ts`). Replace its return value with:

```ts
  return {
    ...state,
    timesheetEntries: state.timesheetEntries.filter(
      (item) => item._id !== entryId,
    ),
    // A committed entry leaves a tombstone, so its deletion can be committed.
    timesheetTombstones: entry.commit
      ? [
          ...state.timesheetTombstones,
          { entryId: entry._id, commit: entry.commit },
        ]
      : state.timesheetTombstones,
    workItems: applyLoggedTimeToWorkItems(state.workItems, {
      workItemId: entry.workItemId,
      projectId: entry.projectId,
      taskId: entry.taskId,
      durationMsDelta: -entry.durationMs,
    }),
  };
```

- [ ] **Step 6: Make tombstones undoable** in `apps/web/src/domain/local-state-undo.ts`:
  - Add `"timesheetTombstones",` after `"timesheetEntries",` in `UNDO_COLLECTIONS`.
  - Add `timesheetTombstones: (tombstone) => tombstone.entryId,` after the `timesheetEntries` key in `recordKeys`.
  - In `captureUndo`, add `timesheetTombstones: diffCollection("timesheetTombstones", before, after),` after `timesheetEntries`.
  - In `restoreUndo`'s returned state, add `timesheetTombstones: restoreCollection("timesheetTombstones", state, undo),` after `timesheetEntries`.
  - Update the comment on `UNDO_COLLECTIONS`: "The local state lists that undoable actions change. A project's tasks live inside the project record, so archiving a task changes its project. Deleting a committed entry adds a tombstone, so Undo takes it back with the entry."

- [ ] **Step 7: Load and default tombstones** in `apps/web/src/lib/local-store.ts`:
  - In `createDefaultState()`, add `timesheetTombstones: [],` after `timesheetEntries: [],`.
  - Import `normalizeTimesheetTombstones` from `@/domain/time/timesheet-commit`.
  - In `normalizeState`, after the `timesheetEntries` key, add:

```ts
      timesheetTombstones: normalizeTimesheetTombstones(
        persistedState.timesheetTombstones,
      ),
```

- [ ] **Step 8: Fix the fixtures.** Run `just typecheck`. Add `timesheetTombstones: [],` after `timesheetImportDrafts: [],` in every fixture the Files list names that still fails, and in any other full `LocalAppState` literal the checker reports. Fixtures cast with `as LocalAppState` do not fail the checker; leave them unless a test of theirs calls `deleteTimesheetEntry` or `captureUndo`.

- [ ] **Step 9: Run the tests**

Run: `cd apps/web && npx vitest run src/domain src/lib` then `just typecheck`.
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```sh
git add apps/web/src
git commit -m "feat(time): keep a tombstone for deleted committed entries" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Mark as committed, and copies that survive edits

**Files:**
- Modify: `apps/web/src/domain/time/timesheet-entry.ts` (imports lines 1-6, `updateTimesheetEntry` lines 195-264, append `markTimesheetEntriesCommitted` and `keepTimesheetEntryCommit` after `markTimesheetEntriesNotSubmitted`, around line 440)
- Modify: `apps/web/src/domain/time/timer-transitions.ts` (imports lines 7-11, `saveTimer` lines 166-225)
- Modify: `apps/web/src/lib/local-store.ts` (imports lines 80-91, add a command next to `markTimesheetEntriesSubmitted`, around line 1741)
- Test: `apps/web/src/domain/time/timesheet-entry.test.ts`, `apps/web/src/domain/time/timer-transitions.test.ts`, `apps/web/src/lib/local-store.test.ts`

**Interfaces:**
- Consumes: `toCommittedCopy`, `getTimesheetEntryChange` (Task 1), `timesheetTombstones` (Task 2).
- Produces:
  - `markTimesheetEntriesCommitted(state: LocalAppState, entryIds: readonly string[], now: () => number): LocalAppState`
  - `keepTimesheetEntryCommit(existing: LocalTimesheetEntry | undefined, next: LocalTimesheetEntry): LocalTimesheetEntry`
  - `localStore.markTimesheetEntriesCommitted(entryIds: readonly string[]): string | null` (an undo token)

- [ ] **Step 1: Write the failing tests**

At the end of `apps/web/src/domain/time/timesheet-entry.test.ts` (add `markTimesheetEntriesCommitted` to the import from `@/domain/time/timesheet-entry`, and import `getTimesheetEntryChange` from `@/domain/time/timesheet-commit`):

```ts
describe("committed copies", () => {
  const HOUR = 60 * 60 * 1000;
  const values = {
    localDate: "2026-07-30",
    projectId: "project-1",
    taskId: "task-1",
    note: "API",
    durationMs: HOUR,
  };

  /** Two saved entries, "a" and "b", never committed. */
  function savedEntries(): LocalAppState {
    const withA = saveManualTimesheetEntry(createState(), values, {
      createId: () => "a",
      now: () => 100,
    });
    return saveManualTimesheetEntry(withA, values, {
      createId: () => "b",
      now: () => 100,
    });
  }

  function find(state: LocalAppState, entryId: string) {
    return state.timesheetEntries.find((item) => item._id === entryId)!;
  }

  function changeOf(state: LocalAppState, entryId: string) {
    return getTimesheetEntryChange(find(state, entryId))?.kind;
  }

  it("commits only the listed changes", () => {
    const next = markTimesheetEntriesCommitted(savedEntries(), ["a"], () => 500);

    expect(find(next, "a").commit).toEqual({ at: 500, ...values });
    expect(changeOf(next, "a")).toBeUndefined();
    expect(changeOf(next, "b")).toBe("added");
  });

  it("clears a listed tombstone and keeps the unlisted ones", () => {
    const commit = { at: 50, ...values };
    const state = createState({
      timesheetTombstones: [
        { entryId: "gone-1", commit },
        { entryId: "gone-2", commit },
      ],
    });

    expect(
      markTimesheetEntriesCommitted(state, ["gone-1"], () => 500)
        .timesheetTombstones,
    ).toEqual([{ entryId: "gone-2", commit }]);
  });

  it("returns the same state when no listed id has a change", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );

    expect(
      markTimesheetEntriesCommitted(committed, ["a", "unknown"], () => 600),
    ).toBe(committed);
  });

  it("keeps the copy across an edit, and an edit back shows no change", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );
    const edit = (state: LocalAppState, durationMs: number, note: string) =>
      updateTimesheetEntry(
        state,
        "a",
        { projectId: "project-1", taskId: "task-1", note, durationMs },
        factories,
      );

    const edited = edit(committed, 2 * HOUR, "API v2");
    expect(find(edited, "a").commit).toEqual({ at: 500, ...values });
    expect(changeOf(edited, "a")).toBe("updated");

    expect(changeOf(edit(edited, HOUR, "API"), "a")).toBeUndefined();
  });

  it("keeps the copy when the entry moves to another week", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );
    const moved = moveTimesheetEntry(
      committed,
      "a",
      { ...values, localDate: "2026-08-04" },
      factories,
    );

    expect(find(moved, "a")).toMatchObject({
      localDate: "2026-08-04",
      commit: { localDate: "2026-07-30" },
    });
    expect(changeOf(moved, "a")).toBe("updated");
  });

  it("gives a duplicate no copy, so it shows as added", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );
    const duplicated = duplicateTimesheetEntry(committed, "a", values, {
      createId: () => "copy",
      now: () => 600,
    });

    expect(changeOf(duplicated, "copy")).toBe("added");
  });
});
```

In `apps/web/src/domain/time/timer-transitions.test.ts`, inside the `describe` that holds "replaces a restarted entry and clears stale submission state":

```ts
  it("keeps the resumed entry's committed copy, so the added time shows as a change", () => {
    const commit = {
      at: 650,
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      note: "Existing work",
      durationMs: 500,
    };
    const originalEntry = createEntry({ commit });
    const state = createState({
      timesheetEntries: [originalEntry],
      timers: [
        {
          _id: "timer-1",
          startedAt: 900,
          localDate: originalEntry.localDate,
          projectId: originalEntry.projectId,
          taskId: originalEntry.taskId,
          note: originalEntry.note,
          accumulatedDurationMs: originalEntry.durationMs,
          entryId: originalEntry._id,
        },
      ],
    });

    const saved = saveTimer(state, "timer-1", createFactories());

    expect(saved.timesheetEntries[0]).toMatchObject({ durationMs: 600, commit });
  });
```

In `apps/web/src/lib/local-store.test.ts`, next to the Task 2 test:

```ts
  it("marks changes as committed, and Undo takes the commit back", async () => {
    const { localStore } = await import("./local-store");
    const projectId = localStore.snapshot().projects[0]!._id;
    localStore.saveManualTimeEntry({
      localDate: "2026-04-21",
      projectId,
      note: "Weekly sync",
      durationMs: 60 * 60 * 1000,
    });
    const entryId = localStore.snapshot().timesheetEntries[0]!._id;

    const token = localStore.markTimesheetEntriesCommitted([entryId]);

    expect(token).not.toBeNull();
    expect(localStore.snapshot().timesheetEntries[0]!.commit).toMatchObject({
      localDate: "2026-04-21",
      note: "Weekly sync",
    });
    expect(localStore.undo(token!)).toBe("restored");
    expect(localStore.snapshot().timesheetEntries[0]!.commit).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests**

Run: `cd apps/web && npx vitest run src/domain/time/timesheet-entry.test.ts src/domain/time/timer-transitions.test.ts src/lib/local-store.test.ts`
Expected: FAIL. `markTimesheetEntriesCommitted` is not exported, and edits and timer saves drop `commit`.

- [ ] **Step 3: Add the transitions** to `apps/web/src/domain/time/timesheet-entry.ts`. Import `getTimesheetEntryChange` and `toCommittedCopy` from `@/domain/time/timesheet-commit`, then add after `markTimesheetEntriesNotSubmitted`:

```ts
/**
 * Carries the committed copy across a rebuild of the entry, such as an edit
 * or a running entry saved again. Edits never change the copy: the change
 * shows on the Commit page until it is committed.
 */
export function keepTimesheetEntryCommit(
  existing: LocalTimesheetEntry | undefined,
  next: LocalTimesheetEntry,
): LocalTimesheetEntry {
  return existing?.commit ? { ...next, commit: existing.commit } : next;
}

/**
 * Commits the changes of `entryIds`: an added or updated entry gets a copy of
 * its current values, and a deleted entry's tombstone goes. Ids without a
 * change are left alone, so a partial commit leaves every other change as it
 * is. Returns the same state when nothing changed.
 */
export function markTimesheetEntriesCommitted(
  state: LocalAppState,
  entryIds: readonly string[],
  now: () => number,
): LocalAppState {
  const selectedIds = new Set(entryIds);
  const at = now();
  let changed = false;
  const timesheetEntries = state.timesheetEntries.map((entry) => {
    if (!selectedIds.has(entry._id) || !getTimesheetEntryChange(entry)) {
      return entry;
    }

    changed = true;
    return { ...entry, commit: toCommittedCopy(entry, at) };
  });
  const timesheetTombstones = state.timesheetTombstones.filter(
    (tombstone) => !selectedIds.has(tombstone.entryId),
  );
  if (
    !changed &&
    timesheetTombstones.length === state.timesheetTombstones.length
  ) {
    return state;
  }

  return { ...state, timesheetEntries, timesheetTombstones };
}
```

In `updateTimesheetEntry`, wrap the persisted entry so the copy survives the rebuild:

```ts
  const persistedEntry = keepTimesheetEntryCommit(
    entry,
    preserveTimesheetEntrySubmissionState(
      entry,
      nextEntry.taskId
        ? nextEntry
        : {
            ...nextEntry,
            label: entry.taskId ? "" : entry.label,
          },
    ),
  );
```

`moveTimesheetEntry` builds on `updateTimesheetEntry`'s result, so it keeps the copy without a change.

- [ ] **Step 4: Keep the copy when a running entry is saved** in `saveTimer` (`apps/web/src/domain/time/timer-transitions.ts`). Import `keepTimesheetEntryCommit` from `@/domain/time/timesheet-entry` and wrap the entry:

```ts
  const entry = keepTimesheetEntryCommit(
    existingEntry,
    preserveTimesheetEntrySubmissionState(
      existingEntry,
      createTimesheetEntry(
        state.projects,
        {
          localDate: timer.localDate,
          workItemId: timer.workItemId,
          projectId: timer.projectId,
          taskId: timer.taskId,
          note: timer.note,
          durationMs,
          sourceBlockIds: existingEntry?.sourceBlockIds ?? [],
          entryId: timer.entryId,
        },
        factories,
      ),
    ),
  );
```

- [ ] **Step 5: Add the store command** in `apps/web/src/lib/local-store.ts`. Import `markTimesheetEntriesCommitted as applyMarkTimesheetEntriesCommitted` from `@/domain/time/timesheet-entry`, and add next to `markTimesheetEntriesSubmitted`:

```ts
  /**
   * Commits the changes of `entryIds`. See `markTimesheetEntriesCommitted`.
   * Returns an undo token, or null when nothing changed.
   */
  markTimesheetEntriesCommitted(entryIds: readonly string[]) {
    return updateStateWithUndo((state) =>
      applyMarkTimesheetEntriesCommitted(state, entryIds, Date.now),
    );
  },
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/web && npx vitest run src/domain src/lib` then `just typecheck`.
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```sh
git add apps/web/src/domain/time apps/web/src/lib/local-store.ts apps/web/src/lib/local-store.test.ts
git commit -m "feat(time): mark changes as committed and keep copies across edits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Agent tools `get_week_changes` and `mark_entries_committed`

**Files:**
- Modify: `packages/shared/agent-tools.ts` (read inputs lines 120-124, write inputs lines 186-191, `agentTimeEntrySchema` lines 258-266, `submitWarningSchema` lines 285-293, outputs lines 328-378)
- Test: `packages/shared/tests/agent-tools.test.ts`
- Rename: `apps/web/src/domain/agents/submit-line-id.ts` to `external-id.ts`, and its test to `external-id.test.ts`
- Create: `apps/web/src/lib/commit-selection.ts`, test `apps/web/src/lib/commit-selection.test.ts`
- Modify: `apps/web/src/domain/agents/agent-read-model.ts` (imports lines 1-31, `toAgentEntry` lines 86-101, replace `getSubmitLinesForAgent` lines 249-357)
- Test: `apps/web/src/domain/agents/agent-read-model.test.ts` (fixture lines 41-121, replace the submit tests at lines 207-310)
- Modify: `apps/web/src/features/agents/agent-tool-runner.ts` (imports lines 9-35, `get_submit_lines` lines 85-106)
- Modify: `apps/web/src/features/agents/agent-write-tools.ts` (`ENTRY_WRITE_TOOLS` lines 181-191, cases lines 417-462)
- Test: `apps/web/src/features/agents/agent-tool-runner.test.ts` (mocks lines 6-27, replace the tests at lines 299-322, 387-422)
- Modify: `apps/api/src/mcp-server.ts` (descriptions lines 81-101), test `apps/api/src/mcp-server.test.ts` (lines 352-385)
- Modify: `apps/api/src/agent-runner/prompts.ts` (line 10), test `prompts.test.ts`
- Modify: `apps/api/src/agent-runner/adapters/claude-code.test.ts` (line 86)
- Docs: `apps/docs/app/agents.md` (tool table, lines 30-35), `apps/docs/developers/manifest.md` (lines 131 and 159), `agents/architecture.md` (line 15)

**Interfaces:**
- Consumes: `listWeekChanges`, `describeTimesheetCommitValues`, `isTimesheetEntryCommitted`, `getTimesheetEntryChange`, `TimesheetCommitValues` (Task 1); `timesheetTombstones` (Task 2); `localStore.markTimesheetEntriesCommitted` (Task 3).
- Produces:
  - `readToolInputSchemas.get_week_changes`: `{ weekOf: isoDate; onlyChecked: boolean = true }`
  - `writeToolInputSchemas.mark_entries_committed`: `{ entryIds: string[] }` (1 to 500)
  - `agentChangeValuesSchema`, `type AgentChangeValues = { date: string; projectName?; projectCode?; projectFullName?; projectProperties?: Record<string, Record<string, string>>; taskName?; hours: number; note? }`
  - `dataToolOutputSchemas.get_week_changes`: `{ changes: { change: "added" | "updated" | "deleted"; entryId; externalId; checked: boolean; current?: AgentChangeValues; committed?: AgentChangeValues }[] }`
  - `dataToolOutputSchemas.mark_entries_committed`: `{ committed: number }`
  - `agentTimeEntrySchema.state`: `"saved" | "committed" | "running"`
  - `externalEntryId(entryId: string): string`
  - `getUncheckedChangeIds(weekOf: string): ReadonlySet<string>`, `setChangesChecked(weekOf: string, entryIds: readonly string[], checked: boolean): void`, `resetCheckedChanges(weekOf: string): void`, `useUncheckedChangeIds(weekOf: string): ReadonlySet<string>`
  - `getWeekChangesForAgent(state, { weekDates: string[]; onlyChecked: boolean; uncheckedIds: ReadonlySet<string>; projectPropertyPlugins: ProjectPropertyPlugin[] }): DataToolOutput<"get_week_changes">`
  - `RUNNER_PROMPT` rule with the exact sentence from Global Constraints.

- [ ] **Step 1: Write the failing contract tests** in `packages/shared/tests/agent-tools.test.ts`. Add `dataToolOutputSchemas` and `writeToolInputSchemas` to the import, then:

```ts
  it("reads only the checked changes unless asked otherwise", () => {
    expect(
      readToolInputSchemas.get_week_changes.parse({ weekOf: "2026-10-14" }),
    ).toEqual({ weekOf: "2026-10-14", onlyChecked: true });
  });

  it("needs at least one entry id to mark as committed", () => {
    expect(
      writeToolInputSchemas.mark_entries_committed.safeParse({ entryIds: [] })
        .success,
    ).toBe(false);
  });

  it("accepts a deleted change with committed values only", () => {
    expect(
      dataToolOutputSchemas.get_week_changes.parse({
        changes: [
          {
            change: "deleted",
            entryId: "e1",
            externalId: "ajour:00000000",
            checked: true,
            committed: { date: "2026-10-13", hours: 1 },
          },
        ],
      }).changes,
    ).toHaveLength(1);
  });
```

- [ ] **Step 2: Run them**

Run: `cd packages/shared && npx vitest run tests/agent-tools.test.ts`
Expected: FAIL, `Cannot read properties of undefined (reading 'parse')`.

- [ ] **Step 3: Change the contracts** in `packages/shared/agent-tools.ts`:
  - Replace `get_submit_lines` in `readToolInputSchemas` with:

```ts
  get_week_changes: z.object({
    weekOf: isoDateSchema,
    onlyChecked: z.boolean().default(true),
  }),
```

  - Replace `mark_entries_submitted` and `mark_entries_not_submitted` in `writeToolInputSchemas` with:

```ts
  mark_entries_committed: z.object({
    entryIds: z.array(z.string()).min(1).max(500),
  }),
```

  - In `agentTimeEntrySchema`, replace the state line and its comment with:

```ts
  /**
   * Committed when the external timesheet holds the entry as it is now.
   * Running when the running entry continues this saved entry.
   */
  state: z.enum(["saved", "committed", "running"]),
```

  - Delete `submitWarningSchema` and the `get_submit_lines` output. Add before `dataToolOutputSchemas`:

```ts
/** One side of a change: the entry as it is now, or as it was committed. */
export const agentChangeValuesSchema = z.object({
  date: z.string(),
  /** The project's short display name. */
  projectName: z.string().optional(),
  projectCode: z.string().optional(),
  /** The project's full name. */
  projectFullName: z.string().optional(),
  /**
   * Properties that active plugins add to the project, keyed by plugin ID
   * then field ID, with defaults filled in.
   */
  projectProperties: z.record(z.record(z.string())).optional(),
  taskName: z.string().optional(),
  hours: z.number(),
  note: z.string().optional(),
});
export type AgentChangeValues = z.infer<typeof agentChangeValuesSchema>;
```

  - In `dataToolOutputSchemas`, add after `get_work_item`:

```ts
  get_week_changes: z.object({
    changes: z.array(
      z.object({
        change: z.enum(["added", "updated", "deleted"]),
        entryId: z.string(),
        /** "ajour:" and 8 hex characters. Never changes for the entry. */
        externalId: z.string(),
        /** False when the user unchecked it on the Commit page. */
        checked: z.boolean(),
        /** Missing for a deleted entry. */
        current: agentChangeValuesSchema.optional(),
        /** For updated and deleted entries: what the external timesheet holds. */
        committed: agentChangeValuesSchema.optional(),
      }),
    ),
  }),
```

  - Replace the two `mark_entries_*` outputs with `mark_entries_committed: z.object({ committed: z.number() }),`.

- [ ] **Step 4: Run the contract tests**

Run: `cd packages/shared && npx vitest run tests/agent-tools.test.ts`
Expected: PASS. `just typecheck` now fails in `apps/web` and `apps/api`; the next steps fix it.

- [ ] **Step 5: Write the failing web tests**

Rename with history: `git mv apps/web/src/domain/agents/submit-line-id.ts apps/web/src/domain/agents/external-id.ts` and `git mv apps/web/src/domain/agents/submit-line-id.test.ts apps/web/src/domain/agents/external-id.test.ts`. Replace the test file with:

```ts
import { describe, expect, it } from "vitest";
import { externalEntryId } from "@/domain/agents/external-id";

describe("externalEntryId", () => {
  it("is ajour: and 8 hex characters of the FNV-1a hash of the entry id", () => {
    expect(externalEntryId("a")).toBe("ajour:e40c292c");
    expect(externalEntryId("timesheet-123")).toMatch(/^ajour:[0-9a-f]{8}$/);
  });

  it("tells entries apart", () => {
    expect(externalEntryId("a")).not.toBe(externalEntryId("b"));
  });
});
```

Create `apps/web/src/lib/commit-selection.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("commit selection", () => {
  it("keeps unchecked changes per week until the week is reset", async () => {
    const {
      getUncheckedChangeIds,
      resetCheckedChanges,
      setChangesChecked,
    } = await import("@/lib/commit-selection");

    setChangesChecked("2026-10-05", ["a", "b"], false);
    setChangesChecked("2026-10-05", ["b"], true);

    expect([...getUncheckedChangeIds("2026-10-05")]).toEqual(["a"]);
    expect([...getUncheckedChangeIds("2026-10-12")]).toEqual([]);

    resetCheckedChanges("2026-10-05");
    expect([...getUncheckedChangeIds("2026-10-05")]).toEqual([]);
  });

  it("returns the same set until it changes, as React snapshots need", async () => {
    const { getUncheckedChangeIds, setChangesChecked } =
      await import("@/lib/commit-selection");

    setChangesChecked("2026-10-05", ["a"], false);

    expect(getUncheckedChangeIds("2026-10-05")).toBe(
      getUncheckedChangeIds("2026-10-05"),
    );
  });
});
```

In `apps/web/src/domain/agents/agent-read-model.test.ts`:
  - Replace the imports of `getSubmitLinesForAgent` with `getWeekChangesForAgent`, and of `submitLineId` with `import { externalEntryId } from "@/domain/agents/external-id";`.
  - In `createState()`, replace the `e2` line with a committed entry and add tombstones and a code on the archived project:

```ts
      entry({
        _id: "e2",
        note: "Afternoon",
        committedAt: 10,
        commit: {
          at: 5,
          localDate: "2026-10-13",
          projectId: "project-1",
          taskId: "task-1",
          note: "Afternoon",
          durationMs: HOUR,
        },
      }),
```

```ts
    timesheetTombstones: [],
```

  and give `project-2` (`"Gone"`, archived) `code: "GONE-1"`.
  - In "lists entries in a range with their state", expect `["e2", "committed"]` instead of `["e2", "submitted"]`.
  - Delete the four submit line tests ("builds the week's submit lines in decimal hours" through "sends no plugin properties when no plugin adds any") and add:

```ts
  const NEXT_WEEK = [
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ];

  /** e1 added, e2 updated from 1 h to 2 h, and a deleted entry on the archived project. */
  function changesState(): LocalAppState {
    const state = createState();
    return {
      ...state,
      timesheetEntries: state.timesheetEntries.map((item) =>
        item._id === "e2" ? { ...item, durationMs: 2 * HOUR } : item,
      ),
      timesheetTombstones: [
        {
          entryId: "gone",
          commit: {
            at: 5,
            localDate: "2026-10-14",
            projectId: "project-2",
            note: "Old work",
            durationMs: HOUR,
          },
        },
      ],
    };
  }

  const allChecked = {
    weekDates: WEEK,
    onlyChecked: true,
    uncheckedIds: new Set<string>(),
    projectPropertyPlugins: [],
  };

  it("lists the week's changes with external ids, in decimal hours", () => {
    const acme = {
      projectName: "Acme",
      projectFullName: "Acme",
      taskName: "Build",
    };

    expect(getWeekChangesForAgent(changesState(), allChecked).changes).toEqual([
      {
        change: "added",
        entryId: "e1",
        externalId: externalEntryId("e1"),
        checked: true,
        current: { date: "2026-10-13", ...acme, hours: 1, note: "Morning" },
      },
      {
        change: "updated",
        entryId: "e2",
        externalId: externalEntryId("e2"),
        checked: true,
        current: { date: "2026-10-13", ...acme, hours: 2, note: "Afternoon" },
        committed: { date: "2026-10-13", ...acme, hours: 1, note: "Afternoon" },
      },
      {
        change: "deleted",
        entryId: "gone",
        externalId: externalEntryId("gone"),
        checked: true,
        // The project is archived since, and still named.
        committed: {
          date: "2026-10-14",
          projectName: "Gone",
          projectFullName: "Gone",
          projectCode: "GONE-1",
          hours: 1,
          note: "Old work",
        },
      },
    ]);
  });

  it("leaves out unchecked changes unless asked for every change", () => {
    const input = { ...allChecked, uncheckedIds: new Set(["e1"]) };

    expect(
      getWeekChangesForAgent(changesState(), input).changes.map(
        (change) => change.entryId,
      ),
    ).toEqual(["e2", "gone"]);
    expect(
      getWeekChangesForAgent(changesState(), {
        ...input,
        onlyChecked: false,
      }).changes.find((change) => change.entryId === "e1"),
    ).toMatchObject({ checked: false });
  });

  it("shows an entry moved to the next week in both weeks, with one external id", () => {
    const state = createState();
    state.timesheetEntries = state.timesheetEntries.map((item) =>
      item._id === "e2" ? { ...item, localDate: "2026-10-20" } : item,
    );

    for (const weekDates of [WEEK, NEXT_WEEK]) {
      expect(
        getWeekChangesForAgent(state, { ...allChecked, weekDates }).changes.find(
          (change) => change.entryId === "e2",
        ),
      ).toMatchObject({
        change: "updated",
        externalId: externalEntryId("e2"),
        current: { date: "2026-10-20" },
        committed: { date: "2026-10-13" },
      });
    }
  });

  it("sends the resolved plugin properties of active plugins", () => {
    const state = stateWithCodedProject();
    state.projects[0]!.pluginProperties = {
      "workday-agent": { name: "CA004 Tech & Design" },
      inactive: { other: "hidden" },
    };
    const change = getWeekChangesForAgent(state, {
      ...allChecked,
      projectPropertyPlugins: [
        {
          pluginId: "workday-agent",
          capability: {
            section: "Workday",
            fields: [
              { id: "name", label: "Workday name", defaultFrom: "fullName" },
              { id: "code", label: "Workday code", defaultFrom: "code" },
              { id: "empty", label: "Empty" },
            ],
          },
        },
      ],
    }).changes.find((item) => item.entryId === "e1")!;

    expect(change.current).toMatchObject({
      projectFullName: "Acme",
      projectCode: "ACME-1",
      projectProperties: {
        "workday-agent": { name: "CA004 Tech & Design", code: "ACME-1" },
      },
    });
  });

  it("sends no plugin properties when no plugin adds any", () => {
    const change = getWeekChangesForAgent(stateWithCodedProject(), allChecked)
      .changes[0]!;

    expect(change.current).not.toHaveProperty("projectProperties");
  });
```

In `apps/web/src/features/agents/agent-tool-runner.test.ts`:
  - Add after the other `vi.mock` calls: `vi.mock("@/lib/plugin-project-properties", () => ({ listProjectPropertyPlugins: async () => [] }));`
  - Delete "creates an entry and marks it submitted", "marks entries as not submitted, with Undo" and "refuses to unmark the running entry". Add in their place:

```ts
  it("lists a new entry as added, commits it, then lists no change", async () => {
    const { call, project, task } = await setup();
    const created = await call("create_entry", {
      date: "2026-10-13",
      projectId: project._id,
      taskId: task("Build")._id,
      minutes: 90,
      note: "Workshop",
    });
    const entryId = (created as { output: { entryId: string } }).output.entryId;

    expect(await call("get_week_changes", { weekOf: "2026-10-14" })).toMatchObject({
      ok: true,
      output: {
        changes: [
          {
            change: "added",
            entryId,
            externalId: expect.stringMatching(/^ajour:[0-9a-f]{8}$/),
            current: { date: "2026-10-13", hours: 1.5, note: "Workshop" },
          },
        ],
      },
    });
    expect(
      await call("mark_entries_committed", { entryIds: [entryId] }),
    ).toMatchObject({ ok: true, output: { committed: 1 } });
    expect(offerUndo.mock.calls.at(-1)![1].title).toBe(
      "Claude Code: Marked 1 change as committed",
    );
    expect(await call("get_week_changes", { weekOf: "2026-10-14" })).toMatchObject({
      ok: true,
      output: { changes: [] },
    });
    expect(
      await call("list_time_entries", { from: "2026-10-12", to: "2026-10-18" }),
    ).toMatchObject({
      ok: true,
      output: { entries: [{ entryId, state: "committed" }] },
    });
  });

  it("commits a deleted entry by clearing its tombstone", async () => {
    const { call, localStore, project, task } = await setup();
    localStore.saveManualTimeEntry({
      localDate: "2026-10-13",
      projectId: project._id,
      taskId: task("Build")._id,
      durationMs: 30 * 60_000,
    });
    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    await call("mark_entries_committed", { entryIds: [entryId] });
    localStore.deleteTimesheetEntry(entryId);

    expect(await call("get_week_changes", { weekOf: "2026-10-13" })).toMatchObject({
      ok: true,
      output: {
        changes: [{ change: "deleted", entryId, committed: { hours: 0.5 } }],
      },
    });
    expect(
      await call("mark_entries_committed", { entryIds: [entryId] }),
    ).toMatchObject({ ok: true, output: { committed: 1 } });
    expect(localStore.snapshot().timesheetTombstones).toEqual([]);
  });

  it("refuses an id that is neither an entry nor a deleted entry", async () => {
    const { call } = await setup();

    expect(
      await call("mark_entries_committed", { entryIds: ["nope"] }),
    ).toMatchObject({
      ok: false,
      error: "No entry or deleted entry has the id nope. Call get_week_changes.",
    });
  });

  it("leaves out the changes the user unchecked on the Commit page", async () => {
    const { call, localStore, project } = await setup();
    const { setChangesChecked } = await import("@/lib/commit-selection");
    localStore.saveManualTimeEntry({
      localDate: "2026-10-13",
      projectId: project._id,
      durationMs: 30 * 60_000,
    });
    const entryId = localStore.snapshot().timesheetEntries[0]!._id;
    setChangesChecked("2026-10-12", [entryId], false);

    expect(await call("get_week_changes", { weekOf: "2026-10-13" })).toMatchObject({
      ok: true,
      output: { changes: [] },
    });
    expect(
      await call("get_week_changes", { weekOf: "2026-10-13", onlyChecked: false }),
    ).toMatchObject({
      ok: true,
      output: { changes: [{ entryId, checked: false }] },
    });
  });
```

In `apps/api/src/agent-runner/prompts.test.ts`, add:

```ts
  it("tells the agent to mark each applied change as committed", () => {
    const prompt = buildPrompt({
      taskPrompt: "Commit the week.",
      values: { sessionId: "s-1" },
    });

    expect(prompt).toContain(
      "After the external tool saved a change, call mark_entries_committed with its entry ID. Never mark a change you did not apply.",
    );
    expect(prompt).not.toContain("mark_entries_submitted");
  });
```

In `apps/api/src/mcp-server.test.ts`, test "lists the read and write tools and forwards a write with its input": the fake renderer returns `output: { committed: 1 }`, the tool count becomes `28`, the `arrayContaining` list holds `"get_week_changes"` and `"mark_entries_committed"` instead of the two `mark_entries_*submitted` names, the call and the `calls[0]` expectation use `mark_entries_committed`, and add `expect(tools.map((tool) => tool.name)).not.toContain("get_submit_lines");`.

In `apps/api/src/agent-runner/adapters/claude-code.test.ts` line 86, use `"mcp__ajour__get_week_changes"`.

- [ ] **Step 6: Run them**

Run: `cd apps/web && npx vitest run src/domain/agents src/lib/commit-selection.test.ts src/features/agents` and `cd apps/api && npx vitest run src/mcp-server.test.ts src/agent-runner`
Expected: FAIL. `external-id` exports nothing named `externalEntryId`, `commit-selection` does not exist, `get_week_changes` is unknown, the prompt still has the old rule.

- [ ] **Step 7: Write `apps/web/src/domain/agents/external-id.ts`** (replacing the renamed file's content):

```ts
/**
 * The ID an agent writes at the end of an external timesheet entry's comment,
 * so later runs find the entry again: "ajour:" and the 32-bit FNV-1a hash of
 * the Ajour entry ID, as 8 hex characters. It depends on the ID only, so it
 * never changes, whatever the edit. FNV-1a is enough to tell a week's entries
 * apart, and Web Crypto's SHA-256 would need an await the read tools cannot
 * make.
 */
export function externalEntryId(entryId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < entryId.length; index += 1) {
    hash ^= entryId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ajour:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
```

- [ ] **Step 8: Write `apps/web/src/lib/commit-selection.ts`**

```ts
import { useSyncExternalStore } from "react";

/**
 * The changes the user unchecked on the Commit page, by week (its Monday).
 * Memory only: opening a week's Commit page checks every change again, so an
 * unchecked change shows checked the next time. Agent tasks read it through
 * get_week_changes, so they apply only the checked changes.
 */
const uncheckedByWeek = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const NONE: ReadonlySet<string> = new Set();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The week's unchecked changes. The same set until it changes. */
export function getUncheckedChangeIds(weekOf: string): ReadonlySet<string> {
  return uncheckedByWeek.get(weekOf) ?? NONE;
}

/** Checks or unchecks changes of the week. */
export function setChangesChecked(
  weekOf: string,
  entryIds: readonly string[],
  checked: boolean,
) {
  const next = new Set(getUncheckedChangeIds(weekOf));
  for (const entryId of entryIds) {
    if (checked) next.delete(entryId);
    else next.add(entryId);
  }
  uncheckedByWeek.set(weekOf, next);
  notify();
}

/** Checks every change of the week again. */
export function resetCheckedChanges(weekOf: string) {
  if (!uncheckedByWeek.delete(weekOf)) return;
  notify();
}

export function useUncheckedChangeIds(weekOf: string): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => getUncheckedChangeIds(weekOf),
    () => NONE,
  );
}
```

- [ ] **Step 9: Change the read model** in `apps/web/src/domain/agents/agent-read-model.ts`:
  - Remove the imports of `getTimeEntryActionState`, `computeWeekPace`, `groupSubmitLines`, `summarizeSubmitSelection`, `SubmitGroupBy` and `submitLineId`. Add:

```ts
import type { AgentChangeValues } from "@ajour/shared/agent-tools";
import { externalEntryId } from "@/domain/agents/external-id";
import {
  describeTimesheetCommitValues,
  isTimesheetEntryCommitted,
  listWeekChanges,
  type TimesheetCommitValues,
} from "@/domain/time/timesheet-commit";
```

  (merge the `AgentChangeValues` type into the existing `@ajour/shared/agent-tools` import).
  - In `toAgentEntry`, the state becomes:

```ts
    state: state.timers.some((timer) => timer.entryId === entry._id)
      ? "running"
      : isTimesheetEntryCommitted(entry)
        ? "committed"
        : "saved",
```

  - Replace everything from `const toHours` to the end of the file with:

```ts
const toHours = (durationMs: number) =>
  Math.round((durationMs / HOUR) * 100) / 100;

/** Non-empty plugin property values of the project, or undefined when there are none. */
function resolveProjectProperties(
  state: LocalAppState,
  projectId: string | undefined,
  plugins: ProjectPropertyPlugin[],
) {
  const project = state.projects.find((item) => item._id === projectId);
  if (!project) return undefined;
  const byPlugin: Record<string, Record<string, string>> = {};
  for (const plugin of plugins) {
    const fields = Object.fromEntries(
      resolvePluginProperties(project, plugin)
        .filter((property) => property.value !== "")
        .map((property) => [property.field.id, property.value]),
    );
    if (Object.keys(fields).length > 0) byPlugin[plugin.pluginId] = fields;
  }
  return Object.keys(byPlugin).length > 0 ? byPlugin : undefined;
}

function toAgentChangeValues(
  state: LocalAppState,
  values: TimesheetCommitValues,
  plugins: ProjectPropertyPlugin[],
): AgentChangeValues {
  const projectProperties = resolveProjectProperties(
    state,
    values.projectId,
    plugins,
  );
  const note = values.note?.trim();
  return {
    date: values.localDate,
    ...describeTimesheetCommitValues(state.projects, values),
    ...(projectProperties ? { projectProperties } : {}),
    hours: toHours(values.durationMs),
    ...(note ? { note } : {}),
  };
}

/**
 * The week's changes since its last commit, as the Commit page lists them,
 * in decimal hours as Workday wants them. Each one has the entry's external
 * ID. With `onlyChecked`, the changes the user unchecked stay out.
 */
export function getWeekChangesForAgent(
  state: LocalAppState,
  {
    weekDates,
    onlyChecked,
    uncheckedIds,
    projectPropertyPlugins,
  }: {
    weekDates: string[];
    onlyChecked: boolean;
    /** Unchecked on the Commit page. Passed in to keep domain free of `lib/`. */
    uncheckedIds: ReadonlySet<string>;
    /** Active plugins that add project properties. Passed in to keep domain free of `lib/`. */
    projectPropertyPlugins: ProjectPropertyPlugin[];
  },
): DataToolOutput<"get_week_changes"> {
  const describe = (values: TimesheetCommitValues) =>
    toAgentChangeValues(state, values, projectPropertyPlugins);
  return {
    changes: listWeekChanges({
      entries: state.timesheetEntries,
      tombstones: state.timesheetTombstones,
      weekDates,
    })
      .filter((change) => !onlyChecked || !uncheckedIds.has(change.entryId))
      .map((change) => ({
        change: change.kind,
        entryId: change.entryId,
        externalId: externalEntryId(change.entryId),
        checked: !uncheckedIds.has(change.entryId),
        ...(change.kind === "deleted"
          ? {}
          : { current: describe(change.current) }),
        ...(change.kind === "added"
          ? {}
          : { committed: describe(change.committed) }),
      })),
  };
}
```

- [ ] **Step 10: Change the runner** in `apps/web/src/features/agents/agent-tool-runner.ts`: replace the `getSubmitLinesForAgent` import with `getWeekChangesForAgent`, drop the `getPaceTolerancePercent` and `todayIsoDate` imports, import `getUncheckedChangeIds` from `@/lib/commit-selection`, and replace the `get_submit_lines` entry with:

```ts
  get_week_changes: async (rawInput) => {
    const input = readToolInputSchemas.get_week_changes.parse(rawInput);
    // Project properties are optional context; without them the changes still go out.
    const projectPropertyPlugins = await listProjectPropertyPlugins().catch(
      (error: unknown) => {
        console.warn(
          "Plugin project properties unavailable for get_week_changes.",
          error,
        );
        return [];
      },
    );
    const weekDates = getIsoWeekDates(input.weekOf);
    return getWeekChangesForAgent(localStore.snapshot(), {
      weekDates,
      onlyChecked: input.onlyChecked,
      uncheckedIds: getUncheckedChangeIds(weekDates[0]!),
      projectPropertyPlugins,
    });
  },
```

- [ ] **Step 11: Change the write tool** in `apps/web/src/features/agents/agent-write-tools.ts`: import `getTimesheetEntryChange` from `@/domain/time/timesheet-commit`, replace `"mark_entries_submitted", "mark_entries_not_submitted",` in `ENTRY_WRITE_TOOLS` with `"mark_entries_committed",`, and replace both `case` blocks with:

```ts
    case "mark_entries_committed": {
      const input =
        writeToolInputSchemas.mark_entries_committed.parse(rawInput);
      const entryIds = [...new Set(input.entryIds)];
      const tombstoneIds = new Set(
        state.timesheetTombstones.map((tombstone) => tombstone.entryId),
      );
      let count = 0;
      for (const entryId of entryIds) {
        if (tombstoneIds.has(entryId)) {
          count += 1;
          continue;
        }
        const entry = state.timesheetEntries.find(
          (candidate) => candidate._id === entryId,
        );
        if (!entry) {
          throw new AgentToolRefusal(
            `No entry or deleted entry has the id ${entryId}. Call get_week_changes.`,
          );
        }
        if (getTimesheetEntryChange(entry)) count += 1;
      }
      const undoToken = localStore.markTimesheetEntriesCommitted(entryIds);
      const noun = count === 1 ? "change" : "changes";
      return {
        output: { committed: count },
        undoToken,
        action: `Marked ${count} ${noun} as committed`,
        objectId: entryIds[0]!,
        objectTitle: `${count} ${noun}`,
        undoSubject: "entry",
      };
    }
```

- [ ] **Step 12: Change the API side.** In `apps/api/src/mcp-server.ts` `TOOL_DESCRIPTIONS`, remove the three old keys and set:

```ts
  list_time_entries:
    "Time entries between two dates (inclusive, at most 62 days), each with its state: saved, committed when the external timesheet holds it as it is, or running when the running entry continues it. The running entry itself is in `running`.",
  get_week_changes:
    "The week's changes since its last commit, one per entry: added, updated or deleted, with the entry's externalId, its current values and, for updated and deleted ones, its committed values. `weekOf` is any date in the week. By default only the changes the user left checked on the Commit page. Write the externalId at the end of the external entry's comment, so later runs find the entry. An entry moved to another week shows in both weeks.",
  edit_entry:
    "Changes a saved entry. A committed entry then shows as an updated change, as in Ajour.",
  mark_entries_committed:
    "Marks changes as committed once the external timesheet saved them: saves each entry's committed copy, or forgets a deleted entry. Pass entryIds from get_week_changes. Never mark a change you did not apply.",
```

In `apps/api/src/agent-runner/prompts.ts`, replace the `mark_entries_submitted` rule line with:

```text
- After the external tool saved a change, call mark_entries_committed with its entry ID. Never mark a change you did not apply.
```

- [ ] **Step 13: Run the tests**

Run: `cd packages/shared && npx vitest run`, `cd apps/web && npx vitest run src/domain/agents src/lib src/features/agents`, `cd apps/api && npx vitest run`, then `just typecheck`.
Expected: PASS, no type errors. `rg -n "get_submit_lines|mark_entries_submitted|mark_entries_not_submitted|submitLineId|lineId" apps packages --glob '!**/node_modules/**'` finds only the docs fixed in the next step.

- [ ] **Step 14: Update the docs**
  - `apps/docs/app/agents.md`, tool table: Read row "The running entry, time entries, projects, backlog items, and the week's changes since its last commit."; Time row "Start, stop and edit the running entry. Create, edit, move and duplicate entries. Mark changes as committed."
  - `apps/docs/developers/manifest.md` line 131: "Ajour puts its own rules before your prompt. The agent must report in its session, ask the user only when it cannot go on, mark each change as committed once the external tool saved it, and never type a password or a code. Your prompt describes the steps in the external tool. The agent can use the [MCP tools](/app/agents#what-agents-can-do), including `get_week_changes`, which lists the week's added, updated and deleted entries, each with a stable `externalId`, and `mark_entries_committed`." Line 159: replace `get_submit_lines` with `get_week_changes`.
  - `agents/architecture.md` line 15: replace "`get_submit_lines` sends them resolved, with `projectFullName`" with "`get_week_changes` sends them resolved, with `projectFullName`".

- [ ] **Step 15: Commit**

```sh
git add packages/shared apps/web/src apps/api/src apps/docs/app/agents.md apps/docs/developers/manifest.md agents/architecture.md
git commit -m "feat(agents): replace submit tools with get_week_changes and mark_entries_committed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Commit page replaces the Submit page

**Files:**
- Modify: `apps/web/src/domain/time/timesheet-submission.ts` (whole module: drop selection and status, rename the summary), test `timesheet-submission.test.ts`
- Rename: `apps/web/src/features/time/submit-page.tsx` to `commit-page.tsx`; `apps/web/src/features/time/submit-week-controls.tsx` to `commit-week-controls.tsx`
- Create: `apps/web/src/features/time/commit-changes.tsx`
- Modify: `apps/web/src/router.tsx` (lines 20-23, 155-172, 386), `apps/web/src/features/layout/app-shell.tsx` (lines 69, 349-360, 450-455, 513-519, 668, 892-913), `apps/web/src/features/time/time-page.tsx` (lines 273-284), `apps/web/src/features/time/time-page-header.tsx` (lines 11, 134), `apps/web/src/features/agents/agent-task-buttons.tsx` (doc comments lines 37-42, 129-131), `apps/web/src/features/settings/agent-task-settings.tsx` (line 105), `apps/web/src/lib/agent-runner.ts` (line 7), `apps/api/src/agent-runner/runner.ts` (line 175)
- Modify: `apps/web/src/styles/time.css` (lines 985-1110 and 1185)
- Create: `apps/web/tests/acceptance/features/commit-week.feature`, `apps/web/tests/acceptance/steps/commit-week.steps.ts`
- Modify: `apps/web/tests/acceptance/features/local-workspace.feature` (lines 10, 63-91), `apps/web/tests/acceptance/steps/local-workspace.steps.ts` (lines 1627-1636, 2066-2161, 2253-2335), `apps/web/tests/acceptance/features/agent-runner.feature` (lines 9-29), `apps/web/tests/acceptance/steps/agent-runner.steps.ts` (lines 298-303)
- Modify: `qa/ui/seed.mjs` (lines 57-86, 95), `qa/ui/docs-shots.mjs` (line 115), `qa/routines/local-workspace-smoke.md` (lines 32, 51)
- Docs: rename `apps/docs/time/submit.md` to `apps/docs/time/commit.md`; `apps/docs/.vitepress/config.ts` (line 21); `apps/docs/index.md` (lines 21, 31); `apps/docs/start/index.md` (lines 3, 48-54); `apps/docs/app/narrow-windows.md` (line 13); `apps/docs/time/day-view.md` (line 12); `apps/docs/plugins/workday.md` (line 35); `apps/docs/projects/tasks.md` (line 3); `apps/docs/projects/index.md` (line 22); shots `apps/docs/public/shots/submit-week-*.webp` replaced by `commit-week-*.webp`
- Agent docs: `agents/ui-registry.md` (lines 11, 73, 186, 235-252), `agents/ui-rules.md` (lines 15, 89 if present there), `agents/ui-tokens.md` (lines 48-50), `agents/library-docs.md` (line 50), `agents/architecture.md` (line 15)

**Interfaces:**
- Consumes: `listWeekChanges`, `describeTimesheetCommitValues`, `TimesheetChange`, `TimesheetChangeKind`, `TimesheetCommitValues` (Task 1); `localStore.markTimesheetEntriesCommitted` (Task 3); `useUncheckedChangeIds`, `setChangesChecked`, `resetCheckedChanges` (Task 4); `offerUndo` from `features/feedback/undo-toast.ts`.
- Produces:
  - `summarizeWeek({ capacityTargets, weekDates, weekEntries }): SubmitSummary` (replaces `summarizeSubmitSelection`)
  - `groupSubmitLines({ entries, groupBy, projects, weekDates })` without `onlyUnsubmitted`; `SubmitLine` without `unsubmittedEntryIds`
  - `CommitPage({ date, returnView })`, route `/time/$date/commit`
  - `CommitChangeList({ changes, projects, uncheckedIds, onCheckedChange })`, `CHANGE_KIND_LABELS`, `formatShortDay(localDate)`
  - `CommitWeekButton({ onClick })`, `WeekCommittedBadge({ weekDates })`
  - Action request `commit-week`
  - Acceptance step texts: `I have a committed week of entries`, `I open the Commit page for the week of {word}`, `the Commit page says everything is committed`, `I change Monday's {string} entry to {string} hours`, `I duplicate Tuesday's {string} entry`, `the Commit page lists {int} changes`, `each change kind shows its own symbol`, `the {string} change shows {string}`, `I uncheck the {string} change`, `the Commit page lists only the {string} change`, `the week can be committed`, and the renamed local-workspace steps listed in Step 9.

- [ ] **Step 1: Write the failing domain tests** in `apps/web/src/domain/time/timesheet-submission.test.ts`:
  - Import `summarizeWeek` instead of `getSubmitButtonLabel`, `getSubmitSelectionState`, `getSubmitWeekStatus`, `reconcileSubmitSelection`, `setSubmitSelection` and `summarizeSubmitSelection`.
  - In "adds up hours and merges comments per task and day by default", remove `unsubmittedEntryIds: ["mon-dev-2", "mon-dev-1"],` from the expected line. The `toEqual` then fails while the field exists.
  - Delete "keeps submitted entries in the totals of lines that still need submitting", the whole `describe("submit selection")` and the whole `describe("submit week status")`.
  - Replace `describe("submit summary", ...)` with:

```ts
describe("week summary", () => {
  const weekEntries = [
    entry("mon", { localDate: "2026-10-05", durationMs: 8 * HOUR }),
    entry("wed", {
      localDate: "2026-10-07",
      durationMs: 6 * HOUR,
      taskId: undefined,
    }),
    entry("thu", { localDate: "2026-10-08", durationMs: 8 * HOUR }),
  ];

  it("sums every entry of the week and warns about days and tasks", () => {
    const summary = summarizeWeek({ capacityTargets, weekDates, weekEntries });

    expect(summary).toMatchObject({
      totalMs: 22 * HOUR,
      targetMs: 40 * HOUR,
      isUnderTarget: true,
    });
    expect(summary.warnings).toEqual([
      {
        kind: "day-under-target",
        localDate: "2026-10-06",
        loggedMs: 0,
        targetMs: 8 * HOUR,
      },
      {
        kind: "day-under-target",
        localDate: "2026-10-07",
        loggedMs: 6 * HOUR,
        targetMs: 8 * HOUR,
      },
      {
        kind: "day-under-target",
        localDate: "2026-10-09",
        loggedMs: 0,
        targetMs: 8 * HOUR,
      },
      { kind: "missing-task", entryCount: 1 },
    ]);
  });

  it("is not under target once the target is met", () => {
    const summary = summarizeWeek({
      capacityTargets,
      weekDates,
      weekEntries: [
        ...weekEntries,
        entry("tue", { localDate: "2026-10-06", durationMs: 8 * HOUR }),
        entry("fri", { localDate: "2026-10-09", durationMs: 10 * HOUR }),
      ],
    });

    expect(summary.isUnderTarget).toBe(false);
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd apps/web && npx vitest run src/domain/time/timesheet-submission.test.ts`
Expected: FAIL, `summarizeWeek is not a function` and the extra `unsubmittedEntryIds` key.

- [ ] **Step 3: Write the failing acceptance test.** Create `apps/web/tests/acceptance/features/commit-week.feature`:

```gherkin
Feature: Commit the week
  The Commit page lists what changed since the last commit, and marks the
  checked changes as committed.

  Scenario: Commit part of a week's changes
    Given I have a committed week of entries
    When I open the Commit page for the week of 2026-10-05
    Then the Commit page says everything is committed
    When I delete Monday's "Login form" entry
    And I change Monday's "API" entry to "2:30" hours
    And I duplicate Tuesday's "Spec review" entry
    And I open the Commit page for the week of 2026-10-05
    Then the Commit page lists 3 changes
    And each change kind shows its own symbol
    And the "Updated" change shows "2:00 → 2:30"
    When I uncheck the "Deleted" change
    And I press "Mark as committed"
    Then the Commit page lists only the "Deleted" change
    When I undo with the toast button
    Then the Commit page lists 3 changes
```

Create `apps/web/tests/acceptance/steps/commit-week.steps.ts`:

```ts
import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

function changeList(page: Page) {
  return page.getByRole("list", { name: "Changes" });
}

function changeRow(page: Page, kind: string) {
  return changeList(page).getByRole("listitem", {
    name: new RegExp(`^${kind}: `),
  });
}

Given("I have a committed week of entries", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/api/connectors", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: true,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  // Seed on the first load only, so later page loads keep what the app saved.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("commit-week-fixture-ready")) return;
    sessionStorage.setItem("commit-week-fixture-ready", "true");
    const hour = 60 * 60 * 1000;
    const entry = (
      _id: string,
      localDate: string,
      taskId: string,
      durationMs: number,
      note: string,
      committedAt: number,
    ) => ({
      _id,
      localDate,
      projectId: "project-atlas",
      taskId,
      label: "",
      note,
      durationMs,
      sourceBlockIds: [],
      committedAt,
      commit: {
        at: 1,
        localDate,
        projectId: "project-atlas",
        taskId,
        note,
        durationMs,
      },
    });
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        projects: [
          {
            _id: "project-atlas",
            name: "Client Atlas",
            color: "#1f7667",
            icon: { kind: "preset", name: "dot" },
            status: "active",
            tasks: [
              {
                _id: "task-dev",
                name: "Development",
                status: "active",
                createdAt: 1,
              },
              {
                _id: "task-review",
                name: "Code review",
                status: "active",
                createdAt: 1,
              },
            ],
          },
        ],
        timers: [],
        workItems: [],
        timesheetEntries: [
          entry("mon-login", "2026-10-05", "task-dev", hour, "Login form", 1),
          entry("mon-api", "2026-10-05", "task-dev", 2 * hour, "API", 2),
          entry("tue-spec", "2026-10-06", "task-review", hour, "Spec review", 3),
        ],
        timesheetTombstones: [],
        updatedAt: 1,
      }),
    );
  });
});

Then("the Commit page says everything is committed", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Commit week of Oct 5 to Oct 11" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Everything is committed.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark as committed" }),
  ).toHaveCount(0);
});

When(
  "I change Monday's {string} entry to {string} hours",
  async ({ page }, note: string, hours: string) => {
    await page.goto("/time/2026-10-05");
    const row = page.locator(".time-entry-row").filter({ hasText: note });
    await row.click();
    await page.getByRole("textbox", { name: "Hours", exact: true }).fill(hours);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row).toContainText(hours);
  },
);

When(
  "I duplicate Tuesday's {string} entry",
  async ({ page }, note: string) => {
    await page.goto("/time/2026-10-06");
    await page.getByText(note, { exact: true }).click({ button: "right" });
    // "Duplicate to…" also starts with "Duplicate".
    await page
      .getByRole("menuitem")
      .filter({ hasText: /^Duplicate/ })
      .filter({ hasNotText: "to…" })
      .click();
    await expect(page.getByText(note, { exact: true })).toHaveCount(2);
  },
);

Then(
  "the Commit page lists {int} changes",
  async ({ page }, count: number) => {
    await expect(changeList(page).getByRole("listitem")).toHaveCount(count, {
      timeout: 15_000,
    });
  },
);

Then("each change kind shows its own symbol", async ({ page }) => {
  for (const kind of ["Added", "Updated", "Deleted"]) {
    await expect(
      changeRow(page, kind).getByRole("img", { name: kind }),
    ).toBeVisible();
  }
});

Then(
  "the {string} change shows {string}",
  async ({ page }, kind: string, text: string) => {
    await expect(changeRow(page, kind)).toContainText(text);
  },
);

When("I uncheck the {string} change", async ({ page }, kind: string) => {
  await changeRow(page, kind).getByRole("checkbox").click();
  await expect(changeRow(page, kind).getByRole("checkbox")).not.toBeChecked();
});

Then(
  "the Commit page lists only the {string} change",
  async ({ page }, kind: string) => {
    await expect(changeList(page).getByRole("listitem")).toHaveCount(1);
    await expect(changeRow(page, kind)).toBeVisible();
    // An unchecked change stays unchecked after the others are committed.
    await expect(changeRow(page, kind).getByRole("checkbox")).not.toBeChecked();
  },
);
```

In `apps/web/tests/acceptance/steps/agent-runner.steps.ts`, rename the step at lines 298-303 to `"I open the Commit page for the week of {word}"` and its URL to `` `/time/${weekOf}/commit` ``. In `apps/web/tests/acceptance/features/agent-runner.feature`, use that step text in both scenarios, rename the scenario "I start Enter in Workday from the Submit page" to "I start Enter in Workday from the Commit page", and change line 29 to `And the task says "Ready to run from the Commit page."`.

- [ ] **Step 4: Run the acceptance test**

Create the temporary config (never commit it):

```sh
cd apps/web
sed -e 's/const acceptancePort = 4173;/const acceptancePort = 4187;/' \
  -e 's#command: "just acceptance-server",#command: "corepack pnpm dev --host 127.0.0.1 --port 4187 --strictPort --mode test",#' \
  -e 's#reuseExistingServer: !process.env.CI,#reuseExistingServer: false,#' \
  playwright.config.ts > playwright.local.config.ts
npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Commit part of a week"
```

Expected: FAIL. The route `/time/2026-10-05/commit` renders no "Commit week of Oct 5 to Oct 11" heading.

- [ ] **Step 5: Reduce `apps/web/src/domain/time/timesheet-submission.ts` to lines and the summary**
  - Module comment: "Rules for the Commit page's lines: how the week's entries become copyable lines and what the week summary shows. The user copies lines into an external timesheet by hand; committing is in `timesheet-commit.ts`."
  - `SubmitLine` loses `unsubmittedEntryIds` and its comment becomes "One copyable line. Its hours and comments cover every entry in `entryIds`."
  - `toLine` loses the `unsubmittedEntryIds` key.
  - `groupSubmitLines` loses `onlyUnsubmitted`, its `keep` filter and the last sentence of its doc comment.
  - Delete `SubmitSelectionState`, `getSubmitSelectionState`, `setSubmitSelection`, `reconcileSubmitSelection`, `SubmitWeekStatus`, `getSubmitWeekStatus` and `getSubmitButtonLabel`.
  - Replace `summarizeSubmitSelection` with:

```ts
export interface SubmitSummary {
  /** Every entry of the week. */
  totalMs: number;
  targetMs: number;
  isUnderTarget: boolean;
  warnings: SubmitWarning[];
}

/** The week's total against its capacity targets, with its warnings. */
export function summarizeWeek({
  capacityTargets,
  weekDates,
  weekEntries,
}: {
  capacityTargets: WeeklyCapacityTargets;
  weekDates: string[];
  weekEntries: LocalTimesheetEntry[];
}): SubmitSummary {
  const days = weekDates.map((localDate, index) => {
    const key = CAPACITY_KEYS[index];
    return {
      localDate,
      targetMs: key ? capacityTargets[key] : 0,
      loggedMs: weekEntries
        .filter((entry) => entry.localDate === localDate)
        .reduce((sum, entry) => sum + entry.durationMs, 0),
    };
  });
  const totalMs = days.reduce((sum, day) => sum + day.loggedMs, 0);
  const targetMs = days.reduce((sum, day) => sum + day.targetMs, 0);
  const missingTaskCount = weekEntries.filter((entry) => !entry.taskId).length;

  const warnings: SubmitWarning[] = days
    .filter((day) => day.targetMs > 0 && day.loggedMs < day.targetMs)
    .map((day) => ({ kind: "day-under-target", ...day }));
  if (missingTaskCount > 0) {
    warnings.push({ kind: "missing-task", entryCount: missingTaskCount });
  }

  return {
    totalMs,
    targetMs,
    isUnderTarget: targetMs > 0 && totalMs < targetMs,
    warnings,
  };
}
```

- [ ] **Step 6: Write `apps/web/src/features/time/commit-changes.tsx`**

```tsx
import {
  RiAddLine as AddedIcon,
  RiPencilLine as UpdatedIcon,
  RiSubtractLine as DeletedIcon,
} from "@remixicon/react";
import { Checkbox } from "@/components/ui/checkbox";
import { Value } from "@/components/ui/value";
import type { LocalProject } from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import {
  describeTimesheetCommitValues,
  type TimesheetChange,
  type TimesheetChangeKind,
  type TimesheetCommitValues,
} from "@/domain/time/timesheet-commit";
import { cn } from "@/lib/utils";

export const CHANGE_KIND_LABELS: Record<TimesheetChangeKind, string> = {
  added: "Added",
  updated: "Updated",
  deleted: "Deleted",
};

const CHANGE_KIND_ICONS = {
  added: AddedIcon,
  updated: UpdatedIcon,
  deleted: DeletedIcon,
} satisfies Record<TimesheetChangeKind, unknown>;

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

/** "Tue 6". Intl orders weekday and day as "6 Tue" in en-US. */
export function formatShortDay(localDate: string) {
  const date = dateAtNoon(localDate);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
    date,
  );
  return `${weekday} ${date.getDate()}`;
}

/** One side of a change, as the row shows it. */
interface ChangeSide {
  day: string;
  project: string;
  task: string;
  hours: string;
  note: string;
}

function describeSide(
  projects: readonly LocalProject[],
  values: TimesheetCommitValues | undefined,
): ChangeSide | undefined {
  if (!values) return undefined;
  const names = describeTimesheetCommitValues(projects, values);
  return {
    day: formatShortDay(values.localDate),
    project: names.projectName ?? "No project",
    task: names.taskName ?? "No task",
    hours: formatClockDuration(values.durationMs),
    note: values.note?.trim() || "No note",
  };
}

/** A value of the change, as "old → new" when the committed copy differs. */
function ChangeValue({
  before,
  after,
  className,
}: {
  before?: string;
  after?: string;
  className?: string;
}) {
  if (before === undefined || after === undefined || before === after) {
    return <span className={className}>{after ?? before}</span>;
  }
  return (
    <span className={className}>
      <span className="commit-change-old">{before}</span> → {after}
    </span>
  );
}

function CommitChangeRow({
  change,
  projects,
  checked,
  onCheckedChange,
}: {
  change: TimesheetChange;
  projects: readonly LocalProject[];
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const before = describeSide(
    projects,
    change.kind === "added" ? undefined : change.committed,
  );
  const after = describeSide(
    projects,
    change.kind === "deleted" ? undefined : change.current,
  );
  const shown = (after ?? before)!;
  const label = CHANGE_KIND_LABELS[change.kind];
  const title = `${shown.project} / ${shown.task}, ${shown.day}`;
  const Icon = CHANGE_KIND_ICONS[change.kind];

  return (
    <li
      aria-label={`${label}: ${title}`}
      className={cn(
        "commit-change",
        `is-${change.kind}`,
        !checked && "is-excluded",
      )}
    >
      <Checkbox
        checked={checked}
        aria-label={`Include ${label.toLowerCase()} change: ${title}`}
        onCheckedChange={(next) => onCheckedChange(next)}
      />
      <Icon role="img" aria-label={label} className="commit-change-symbol" />
      <ChangeValue
        className="commit-change-day"
        before={before?.day}
        after={after?.day}
      />
      <span className="commit-change-work">
        <ChangeValue before={before?.project} after={after?.project} />
        <span aria-hidden className="commit-change-sep">
          /
        </span>
        <ChangeValue before={before?.task} after={after?.task} />
      </span>
      <Value className="commit-change-hours">
        <ChangeValue before={before?.hours} after={after?.hours} />
      </Value>
      <ChangeValue
        className="commit-change-note"
        before={before?.note}
        after={after?.note}
      />
    </li>
  );
}

/**
 * The week's changes since its last commit, one row each, with its kind's
 * symbol and color and a checkbox. Unchecked changes stay out of the commit.
 */
export function CommitChangeList({
  changes,
  projects,
  uncheckedIds,
  onCheckedChange,
}: {
  changes: TimesheetChange[];
  /** Every project, archived ones too, so a deleted entry keeps its names. */
  projects: readonly LocalProject[];
  uncheckedIds: ReadonlySet<string>;
  onCheckedChange: (entryId: string, checked: boolean) => void;
}) {
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Everything is committed.</p>
    );
  }

  return (
    <ul aria-label="Changes" className="commit-changes">
      {changes.map((change) => (
        <CommitChangeRow
          key={change.entryId}
          change={change}
          projects={projects}
          checked={!uncheckedIds.has(change.entryId)}
          onCheckedChange={(checked) =>
            onCheckedChange(change.entryId, checked)
          }
        />
      ))}
    </ul>
  );
}
```

- [ ] **Step 7: Turn the Submit page into the Commit page.** Run `git mv apps/web/src/features/time/submit-page.tsx apps/web/src/features/time/commit-page.tsx`, then edit it:
  - Remove: `formatShortDay` (import it from `commit-changes.tsx`), `formatSubmittedAt`, `StatusLine`, the `AlertDialog` and its imports, `isConfirmOpen`, `handleMark`, `markSelected`, `selectableEntries`, `selectableIds`, `isReadOnly`, `selectedIds`, `knownSelectableIdsRef`, `changeSelection`, the "Days to submit" group and the `ResultLine` import.
  - `SubmitLineRow` loses `selection` and `onSelectionChange` and the first grid cell with the checkbox; its `li` is `<li className="submit-line">`.
  - Add imports: `useEffect` stays; `CHANGE_KIND_LABELS` is not needed here; import `CommitChangeList`, `formatShortDay` from `@/features/time/commit-changes`; `listWeekChanges` from `@/domain/time/timesheet-commit`; `summarizeWeek` instead of the removed submission functions; `offerUndo` from `@/features/feedback/undo-toast`; `resetCheckedChanges`, `setChangesChecked`, `useUncheckedChangeIds` from `@/lib/commit-selection`.
  - The component, with the unchanged `CopyValue`, `SubmitLineRow`, `formatLongDay`, `formatMonthDay`, `formatWarning` and `GROUP_BY_OPTIONS` above it:

```tsx
/**
 * The Commit page for the week that holds `date`: the changes since the last
 * commit, each with a checkbox, then the week's lines to copy into the
 * external timesheet. Mark as committed saves the checked changes.
 */
export function CommitPage({
  date,
  returnView,
}: {
  date: string;
  /** The Time view to return to. */
  returnView?: "week";
}) {
  const navigate = useNavigate();
  const state = useLocalState();
  const projects = useLocalProjects();
  const weekDates = useMemo(() => getIsoWeekDates(date), [date]);
  const weekOf = weekDates[0]!;
  const [groupBy, setGroupBy] = useState<SubmitGroupBy>("day-task");

  // Opening a week's page checks every change again.
  useEffect(() => resetCheckedChanges(weekOf), [weekOf]);
  const uncheckedIds = useUncheckedChangeIds(weekOf);

  const weekEntries = useMemo(() => {
    const weekDateSet = new Set(weekDates);
    return state.timesheetEntries.filter((entry) =>
      weekDateSet.has(entry.localDate),
    );
  }, [state.timesheetEntries, weekDates]);
  const changes = useMemo(
    () =>
      listWeekChanges({
        entries: state.timesheetEntries,
        tombstones: state.timesheetTombstones,
        weekDates,
      }),
    [state.timesheetEntries, state.timesheetTombstones, weekDates],
  );
  const checkedIds = useMemo(
    () =>
      changes
        .map((change) => change.entryId)
        .filter((entryId) => !uncheckedIds.has(entryId)),
    [changes, uncheckedIds],
  );
  const sections = useMemo(
    () => groupSubmitLines({ entries: weekEntries, groupBy, projects, weekDates }),
    [groupBy, projects, weekDates, weekEntries],
  );
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project._id, project])),
    [projects],
  );
  const summary = useMemo(
    () =>
      summarizeWeek({
        capacityTargets: state.userPreferences.weeklyCapacityTargets,
        weekDates,
        weekEntries,
      }),
    [state.userPreferences.weeklyCapacityTargets, weekDates, weekEntries],
  );
  const progress =
    summary.targetMs > 0
      ? Math.min(100, (summary.totalMs / summary.targetMs) * 100)
      : 100;

  function markCommitted() {
    const count = checkedIds.length;
    offerUndo(localStore.markTimesheetEntriesCommitted(checkedIds), {
      title: `${count} ${count === 1 ? "change" : "changes"} committed`,
      subject: "entry",
    });
  }

  function goBack() {
    void navigate({
      to: "/time/$date",
      params: { date },
      search: { view: returnView } as never,
    });
  }

  const title = `Commit week of ${formatMonthDay(weekDates[0]!)} to ${formatMonthDay(weekDates[6]!)}`;

  return (
    <div className="commit-page">
      {/* PageHeader with the back button: unchanged from the Submit page. */}
      {/* section "Week summary": unchanged, without StatusLine; keeps AgentTaskWeekLinks weekOf={weekOf}. */}

      <section aria-labelledby="commit-changes-heading">
        <SectionHeading
          id="commit-changes-heading"
          trailing={
            changes.length > 0
              ? `${checkedIds.length} of ${changes.length} checked`
              : undefined
          }
        >
          Changes
        </SectionHeading>
        <CommitChangeList
          changes={changes}
          // Every project: a deleted entry may be on an archived one.
          projects={state.projects}
          uncheckedIds={uncheckedIds}
          onCheckedChange={(entryId, checked) =>
            setChangesChecked(weekOf, [entryId], checked)
          }
        />
      </section>

      <div
        role="group"
        aria-label="Commit actions"
        className="flex flex-wrap items-center gap-2 empty:hidden"
      >
        <AgentTaskButtons weekOf={weekOf} />
        {changes.length > 0 ? (
          <Button disabled={checkedIds.length === 0} onClick={markCommitted}>
            Mark as committed
          </Button>
        ) : null}
      </div>

      <section aria-labelledby="commit-lines-heading">
        <SectionHeading id="commit-lines-heading">Lines</SectionHeading>
        {/* weekEntries.length === 0: the existing Empty "No entries this week." */}
        {/* Otherwise: the existing "submit-toolbar" with Group by only (label id "commit-group-by-label"), then the day sections of SubmitLineRow, without selection props. */}
      </section>
    </div>
  );
}
```

  Fill the three JSX comments with the existing Submit page markup they name; only the parts listed above change. The page wrapper class is `commit-page`.

- [ ] **Step 8: Wire the page in.**
  - `git mv apps/web/src/features/time/submit-week-controls.tsx apps/web/src/features/time/commit-week-controls.tsx`, and replace its content with:

```tsx
import { useMemo } from "react";
import {
  RiCheckLine as Check,
  RiSendPlaneLine as Send,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { listWeekChanges } from "@/domain/time/timesheet-commit";
import { useLocalState } from "@/lib/local-hooks";

/** Opens the selected week's Commit page from the titlebar totals popover. */
export function CommitWeekButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      <Send data-icon="inline-start" />
      Commit week
    </Button>
  );
}

/** Shows "Committed" once a week with entries has no change left to commit. */
export function WeekCommittedBadge({ weekDates }: { weekDates: string[] }) {
  const state = useLocalState();
  const isCommitted = useMemo(() => {
    const weekDateSet = new Set(weekDates);
    return (
      state.timesheetEntries.some((entry) =>
        weekDateSet.has(entry.localDate),
      ) &&
      listWeekChanges({
        entries: state.timesheetEntries,
        tombstones: state.timesheetTombstones,
        weekDates,
      }).length === 0
    );
  }, [state.timesheetEntries, state.timesheetTombstones, weekDates]);

  if (!isCommitted) {
    return null;
  }

  return (
    <Chip tone="success">
      <Check />
      Committed
    </Chip>
  );
}
```

  - `apps/web/src/router.tsx`: `const CommitPage = lazy(...)` importing `@/features/time/commit-page` and `module.CommitPage`; `submitRoute` becomes `commitRoute` with `path: "/time/$date/commit"` and `<CommitPage ...>`; the route tree lists `commitRoute`.
  - `apps/web/src/features/layout/app-shell.tsx`: import `CommitWeekButton` from `@/features/time/commit-week-controls`; `DayTotalsPill` and `GlobalTimerBar` rename their prop `onSubmit` to `onCommit` (doc comment "with day and week totals and Commit week"); the popover renders `<CommitWeekButton onClick={() => { setOpen(false); onCommit(); }} />`; the shell passes `onCommit` with `action: "commit-week"` and `to: "/time/$date/commit"`.
  - `apps/web/src/features/time/time-page.tsx`: `openSubmitPage` becomes `openCommitPage` with `to: "/time/$date/commit"`, and the handler reads `if (action === "commit-week") openCommitPage();`.
  - `apps/web/src/features/time/time-page-header.tsx`: import and render `WeekCommittedBadge` instead of `WeekSubmittedBadge`.
  - `apps/web/src/features/settings/agent-task-settings.tsx` line 105: "Ready to run from the Commit page."
  - Comments: `agent-task-buttons.tsx` ("The Commit page's plugin agent tasks", "for the Commit page's week summary"), `lib/agent-runner.ts` line 7 and `apps/api/src/agent-runner/runner.ts` line 175 ("the Commit page").
  - `apps/web/src/styles/time.css`: rename both `.submit-page` selectors to `.commit-page`; change `.submit-line` to `grid-template-columns: minmax(0, 1fr) auto;` and `.submit-line-comments` to `grid-column: 1 / 3;`; delete `.submit-line.is-excluded`; add after `.submit-copy-hours`:

```css
  .commit-changes {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .commit-change {
    display: grid;
    grid-template-columns: 1rem 14px max-content minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.25rem 0.5rem;
    padding: 0.5rem 0.25rem;
    border-bottom: 1px solid var(--border);
  }

  .commit-change.is-excluded {
    opacity: 0.55;
  }

  /* Tailwind's preflight makes every svg a block. */
  .commit-change-symbol {
    display: inline-block;
    width: 14px;
    height: 14px;
    margin-top: 2px;
  }

  .commit-change.is-added .commit-change-symbol {
    color: var(--success);
  }

  .commit-change.is-updated .commit-change-symbol {
    color: var(--warning);
  }

  .commit-change.is-deleted .commit-change-symbol {
    color: var(--destructive);
  }

  .commit-change.is-deleted .commit-change-work,
  .commit-change.is-deleted .commit-change-hours {
    color: var(--text-secondary);
    text-decoration: line-through;
  }

  .commit-change-work {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.25rem;
    min-width: 0;
  }

  .commit-change-sep {
    color: var(--text-tertiary);
  }

  .commit-change-note {
    grid-column: 3 / 6;
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .commit-change-old {
    color: var(--text-tertiary);
    text-decoration: line-through;
  }
```

- [ ] **Step 9: Update the existing acceptance scenarios** in `apps/web/tests/acceptance/features/local-workspace.feature` and `steps/local-workspace.steps.ts`:
  - Line 10 and its step (line 1627): `the week can be committed`, looking for the button "Commit week".
  - Replace the scenario "Submit part of a week from the submit page" with:

```gherkin
  Scenario: Copy a week's lines from the Commit page
    Given I have a week of saved entries
    When I open the Commit page from the Week totals dropdown
    Then the Commit page merges Monday's task entries
    And copying the merged line gives decimal hours and merged comments
```

  - Rename scenarios and steps: "Open the Commit page from the narrow view", "Open the selected week's Commit page from Settings", "Save a valid entry draft before opening the Commit page", "Keep an invalid entry draft open when opening the Commit page"; step texts `I open the Commit page from the Week totals dropdown`, `I open the Commit page from the narrow totals dropdown`, `I open the Commit page from Settings totals`, `the Commit page lists the week's entries`, `I open the Commit page with {string} hours in an open entry`, `the Commit page includes the saved entry draft`, `the invalid entry draft stays open instead of opening the Commit page`. In their bodies, every `"Submit week"` button name becomes `"Commit week"` and every `/\/time\/2026-10-05\/submit/` becomes `/\/time\/2026-10-05\/commit/`.
  - `the Commit page lists the week's entries`:

```ts
Then("the Commit page lists the week's entries", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Commit week of Oct 5 to Oct 11" }),
  ).toBeVisible({ timeout: 15_000 });
  // None of the fixture's entries was ever committed.
  await expect(
    page.getByRole("list", { name: "Changes" }).getByRole("img", { name: "Added" }),
  ).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Mark as committed" }),
  ).toBeEnabled();
});
```

  - `the Commit page merges Monday's task entries`: replace the checkbox count with `await expect(monday.getByRole("listitem")).toHaveCount(2);` and keep the "Copy hours: 3.00" check.
  - Delete the steps `I drop Tuesday from the submission`, `I mark the selected entries as submitted under the target`, `only Monday's entries are submitted` and `the submit page shows the week as partly submitted`.

- [ ] **Step 10: Run the tests**

Run: `cd apps/web && npx vitest run src/domain/time` then `just typecheck`, then `npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Commit|Workday|Open today's workspace|entry draft"`.
Expected: PASS. `rg -n "submit-page|submit-week-controls|SubmitWeekButton|WeekSubmittedBadge|/submit\b|\"submit-week\"" apps/web/src apps/web/tests` finds only `agent-task-buttons.tsx` and the agent-runner fixture, whose placement Task 7 renames.

- [ ] **Step 11: Seed and screenshot.** In `qa/ui/seed.mjs`:
  - After the `e` helper, add:

```js
  // A committed copy of the entry's values. `changes` makes the copy differ, so the entry shows as updated.
  const committed = (entry, at, changes = {}) => ({ ...entry, commit: { at, localDate: entry.localDate, projectId: entry.projectId, taskId: entry.taskId, note: entry.note, durationMs: entry.durationMs, ...changes } });
```

  - Wrap `e1`, `e3`, `e4` as `committed(e(...), t0-4e5)` and `e2` as `committed(e(...), t0-4e5, { durationMs: h(0.5) })`, `e12` to `e17` as `committed(e(...), t0-8e5)`, and the large-workspace entries as `committed(e(...), t0 - 9e5)`. Remove every `submittedAt` from the extras.
  - Before `localStorage.setItem`, add:

```js
  const timesheetTombstones = [{ entryId: "e0", commit: { at: t0 - 4e5, localDate: monday(0), projectId: "p-atlas", taskId: "t-atlas-meet", note: "Sprint retro", durationMs: h(0.5) } }];
```

  and add `timesheetTombstones` to the stored object.
  - `qa/ui/docs-shots.mjs` line 115: `{ name: "commit-week", run: (page) => go(page, "/time/today/commit") },`.
  - `qa/routines/local-workspace-smoke.md` lines 32 and 51: `Commit week`.

- [ ] **Step 12: Update the user docs.**
  - `git mv apps/docs/time/submit.md apps/docs/time/commit.md`, then replace it with:

```md
# Commit your week

Committing copies your week's changes into your company's timesheet tool, such as Workday. Ajour does not connect to that tool. It lists what changed since your last commit, and remembers what you committed. A plugin can add a button that has an agent apply the changes for you, see [Commit with an agent](#commit-with-an-agent).

<Shot name="commit-week" alt="The Commit week page" />

## Open the page

Click the totals at the top right, such as `Today 3:47`, and press **Commit week**. This works on every page and at every window size.

## Review the week

The top of the page shows the week total against your target, with a progress bar. Ajour warns you about:

- Days under their capacity target, such as `Tue 6 has 6:30 of 8:00`.
- Entries with no task.

## Changes

Under **Changes**, each entry that changed since your last commit has a row with a symbol:

| Symbol  | Change      | Meaning                                                                                                                      |
| ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Plus    | **Added**   | An entry you never committed.                                                                                                |
| Pencil  | **Updated** | A committed entry whose day, project, task, hours or note changed. The row shows the old and new values, such as `1:00 → 1:30`. |
| Minus   | **Deleted** | A committed entry you deleted since.                                                                                         |

An entry you edit back to its committed values has no change. A week with no changes says "Everything is committed."

Each change has a checkbox, checked by default. Uncheck a change to leave it out of this commit. It stays on the page, and is checked again the next time you open the page.

## Mark as committed

When the checked changes are in your timesheet tool, press **Mark as committed**. A toast offers **Undo**. The Week view shows a **Committed** chip once the week has no change left.

## Copy the lines

Under **Lines**, the whole week is grouped into lines with the project, the task, the hours and the comments. Click a value to copy it, then paste it in your timesheet tool.

- **Hours** copy as decimals, such as `5.00`, which most timesheet tools expect. The page shows them as clock time.
- **Comments** are the notes of the line's entries, joined with a vertical bar, such as `Standup | Code review`.

**Group by** changes how entries become lines:

| Option           | One line per             |
| ---------------- | ------------------------ |
| **Day and task** | task and day (default)   |
| **Day**          | day                      |
| **Task**         | task, for the whole week |

## Commit with an agent

With a plugin such as [Workday (agent)](/plugins/workday-agent), a button such as **Commit to Workday** sits next to **Mark as committed**. It starts an agent that applies the checked changes in your timesheet tool, one entry per change, and marks each one as committed as soon as the tool saved it. The button is greyed out while something is missing; hover it to see what, such as `Fill in Workday timesheet URL in Settings › Plugins › Workday (agent)`.

A link such as **Open the week in Workday**, under the week summary, opens the week in your browser.
```

  - `apps/docs/.vitepress/config.ts` line 21: `{ text: "Commit your week", link: "/time/commit" },`.
  - `apps/docs/index.md` line 21: "from the first entry to a committed week."; line 31: `{ icon: 'send', title: 'Commit your week', text: 'Copy the changes of your week into your timesheet tool and mark them as committed.', link: '/time/commit' },`.
  - `apps/docs/start/index.md`: line 3 "fix an entry and commit the week."; heading `## 5. Commit the week`; line 50 "At the end of the week, click today's total at the top right, then **Commit week**. Ajour lists the entries you added, changed or deleted, and groups the week into lines with the project, the task, the hours and your notes. Copy them into your company's timesheet tool, then press **Mark as committed**."; `<Shot name="commit-week" alt="The Commit week page with the changes and the lines to copy" />`; "See [Commit your week](/time/commit)."
  - `apps/docs/app/narrow-windows.md` line 13 and `apps/docs/time/day-view.md` line 12: **Commit week**.
  - `apps/docs/plugins/workday.md` line 35: "To report your hours in Workday, use [Commit your week](/time/commit). It lists your changes and prepares lines with the project, task, hours and comments that you copy into Workday."; keep the sentence about Workday (agent).
  - `apps/docs/projects/tasks.md` line 3 and `apps/docs/projects/index.md` line 22: "the Commit page".
  - Take the shot and drop the old one: `just docs-shots commit-week`, then `git rm apps/docs/public/shots/submit-week-dark.webp apps/docs/public/shots/submit-week-light.webp`. Look at `apps/docs/public/shots/commit-week-light.webp`: it shows an Added, an Updated (`0:30 → 1:00`) and a Deleted row.
  - Run `just docs-build`. Expected: no dead links.

- [ ] **Step 13: Update the agent docs.**
  - `agents/ui-registry.md`: line 11 "whose popover still shows the week total and Commit week"; line 73 "`AgentTaskButtons` (`features/agents/agent-task-buttons.tsx`) sits in the Commit page's actions row, next to Mark as committed, one button per task with the commit placement"; line 186 "and the Committed chip once the week has no change left"; replace the "Submit Page" section with:

```md
### Commit Page

Files: `apps/web/src/features/time/commit-page.tsx`, `apps/web/src/features/time/commit-changes.tsx`, `apps/web/src/features/time/commit-week-controls.tsx`

Route `/time/$date/commit` shows the week that holds `$date`. The top bar's
totals popover (`CommitWeekButton`) opens it in both desktop and narrow views.
Opening it saves valid entry drafts and keeps invalid drafts open through the
Time page's action request handler. The page leads with the week summary: the
total as a 28px figure beside the target, a 3px progress bar and amber
warnings. Under a "Changes" `SectionHeading`, `CommitChangeList` shows one row
per change: a `Checkbox`, the kind's symbol (Added, Updated, Deleted; an icon
with its own color, named for screen readers), the day, the project and task,
the hours as a `Value` and the note, each as "old → new" when the committed
copy differs. "Everything is committed." replaces the list when there is none.
The plugin actions and "Mark as committed" (with the Undo toast) sit in a
wrapping row below. "Lines" closes the page: the Group by toolbar and the
copyable lines under day `SectionHeading`s. Every value copies on click with
an always-visible icon; hours copy as decimals. Change rules live in
`domain/time/timesheet-commit.ts`, line grouping and the summary in
`domain/time/timesheet-submission.ts`, and the unchecked changes in
`lib/commit-selection.ts`, which agents read too.
```

  - `agents/ui-rules.md`: line 15 "(Time, Backlog, Commit, Settings pages)"; any "Submit week" in the top bar rule becomes "Commit week".
  - `agents/ui-tokens.md`: append to `--success` "and the Added change symbol on the Commit page", to `--warning` "and the Updated change symbol", to `--destructive` "and the Deleted change symbol".
  - `agents/library-docs.md` line 50: "Commit page lines (grouping, comment merging) and the week summary warnings: `apps/web/src/domain/time/timesheet-submission.ts`".
  - `agents/architecture.md` line 15: "the Commit page's `AgentTaskButtons`".

- [ ] **Step 14: Run everything**

Run from the repo root: `just test`, `just typecheck`, then in `apps/web`: `npx bddgen && npx playwright test --config playwright.local.config.ts`.
Expected: all pass.

- [ ] **Step 15: Commit**

```sh
git add apps/web/src apps/web/tests apps/api/src/agent-runner/runner.ts qa apps/docs agents
git status --short apps/web/playwright.local.config.ts  # must print nothing staged
git commit -m "feat(time): replace the Submit page with the Commit page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Drop the submission fields and migrate stored entries

**Files:**
- Modify: `apps/web/src/domain/local-state.ts` (lines 160-168, the three fields)
- Modify: `apps/web/src/domain/time/timesheet-entry.ts` (delete `createTimesheetEntrySubmissionFingerprint` lines 50-71, rewrite `normalizeTimesheetEntry` lines 73-105, `createTimesheetEntry` lines 119-125, delete `preserveTimesheetEntrySubmissionState` lines 128-166, `updateTimesheetEntry`, `moveTimesheetEntry` lines 362-375, delete `markTimesheetEntriesSubmitted` and `markTimesheetEntriesNotSubmitted` lines 384-440)
- Modify: `apps/web/src/domain/time/timer-transitions.ts` (imports, `saveTimer`)
- Modify: `apps/web/src/lib/local-store.ts` (imports lines 84-85, commands lines 1741-1759)
- Modify: `apps/web/src/domain/actions/object-actions.ts` (lines 29-99), `apps/web/src/features/agents/agent-write-tools.ts` (lines 150-157), `apps/web/src/features/time/time-entry-actions.tsx` (lines 23, 116-119), `apps/web/src/features/timer/timer-panel.tsx` (lines 453, 559-565), `apps/web/src/features/time/weekly-time-view.tsx` (line 628), `apps/web/src/styles/time.css` (line 279)
- Test: `apps/web/src/domain/time/timesheet-entry.test.ts`, `apps/web/src/domain/time/timer-transitions.test.ts` (line 16, lines 284-317), `apps/web/src/domain/local-state-undo.test.ts` (lines 52-82, 183-208), `apps/web/src/lib/local-store.test.ts` (lines 2673-2760), `apps/web/src/domain/actions/object-actions.test.ts` (lines 65-110)
- Docs: `apps/docs/time/entries.md` (line 24), `apps/docs/start/concepts.md` (lines 14, 20), `apps/docs/time/day-view.md` (line 11), `agents/GLOSSARY.md` (lines 101-111), `agents/architecture.md` (line 49), `agents/library-docs.md` (line 49), `agents/ux-spec.md` (lines 30-41, 381)

**Interfaces:**
- Consumes: `toCommittedCopy`, `normalizeTimesheetEntryCommit`, `getChangedCommitFields`, `isTimesheetEntryCommitted` (Tasks 1 and 2), `keepTimesheetEntryCommit` (Task 3).
- Produces:
  - `type PersistedTimesheetEntry = Omit<LocalTimesheetEntry, "commit"> & { commit?: unknown; submittedAt?: unknown; submittedFingerprint?: unknown; previousSubmittedAt?: unknown }`
  - `normalizeTimesheetEntry(stored: PersistedTimesheetEntry): LocalTimesheetEntry` (the migration)
  - `type TimeEntryActionState = "saved" | "running"`; `getTimeEntryActionState(entry: { isRunning?: boolean }): TimeEntryActionState`
  - Removed: `submittedAt`, `submittedFingerprint`, `previousSubmittedAt`, `createTimesheetEntrySubmissionFingerprint`, `preserveTimesheetEntrySubmissionState`, `markTimesheetEntriesSubmitted`, `markTimesheetEntriesNotSubmitted`, `localStore.markTimesheetEntriesSubmitted`, `localStore.markTimesheetEntriesNotSubmitted`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/domain/time/timesheet-entry.test.ts`, replace "hydrates legacy source IDs and preserves a zero submission timestamp" with:

```ts
  it("gives an entry stored as submitted a committed copy of its values", () => {
    const entry = normalizeTimesheetEntry({
      _id: "entry-1",
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      label: "Legacy",
      note: "Shipped",
      durationMs: 100,
      committedAt: 1,
      submittedAt: 0,
      submittedFingerprint: "old",
    } as never);

    expect(entry).toEqual({
      _id: "entry-1",
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      label: "Legacy",
      note: "Shipped",
      durationMs: 100,
      committedAt: 1,
      sourceBlockIds: [],
      commit: {
        at: 0,
        localDate: "2026-07-30",
        projectId: "project-1",
        taskId: "task-1",
        note: "Shipped",
        durationMs: 100,
      },
    });
    expect(entry).not.toHaveProperty("submittedAt");
    expect(entry).not.toHaveProperty("submittedFingerprint");
  });

  it("gives an entry edited since its submission no copy, so it shows as added", () => {
    const entry = normalizeTimesheetEntry({
      _id: "entry-1",
      localDate: "2026-07-30",
      label: "Legacy",
      durationMs: 100,
      committedAt: 1,
      previousSubmittedAt: 5,
    } as never);

    expect(entry.commit).toBeUndefined();
    expect(entry).not.toHaveProperty("previousSubmittedAt");
  });

  it("keeps a stored copy and drops a malformed one", () => {
    const commit = { at: 9, localDate: "2026-07-30", durationMs: 100 };
    const stored = {
      _id: "entry-1",
      localDate: "2026-07-30",
      label: "Stored",
      durationMs: 100,
      sourceBlockIds: [],
      committedAt: 1,
    };

    expect(normalizeTimesheetEntry({ ...stored, commit } as never).commit).toEqual(
      commit,
    );
    expect(
      normalizeTimesheetEntry({ ...stored, commit: { at: "x" } } as never),
    ).not.toHaveProperty("commit");
  });
```

In `apps/web/src/domain/actions/object-actions.test.ts`, replace "keeps every action on a submitted entry and flags the ones that unsubmit it", "does not flag Continue on a submitted entry from another day" and "derives the action state from running and submitted flags" with:

```ts
  it("gives a saved entry every action, without hints", () => {
    const actions = getTimeEntryActions("saved", { isToday: true });

    expect(actions.every((action) => !action.disabledReason)).toBe(true);
    expect(actions.filter((action) => action.hint)).toEqual([]);
  });

  it("derives the action state from the running flag", () => {
    expect(getTimeEntryActionState({ isRunning: true })).toBe("running");
    expect(getTimeEntryActionState({})).toBe("saved");
  });
```

In `apps/web/src/lib/local-store.test.ts`, replace "marks selected timesheet entries as submitted", "keeps submitted state when a timesheet entry is saved without changes" and "clears submitted state when a saved timesheet entry changes" with:

```ts
  it("migrates entries stored as submitted to committed copies on load", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        timesheetEntries: [
          {
            _id: "submitted",
            localDate: "2026-04-21",
            label: "",
            note: "Weekly sync",
            durationMs: 3_600_000,
            sourceBlockIds: [],
            committedAt: 1,
            submittedAt: 7,
            submittedFingerprint: "old",
          },
          {
            _id: "edited",
            localDate: "2026-04-21",
            label: "",
            durationMs: 1_800_000,
            sourceBlockIds: [],
            committedAt: 2,
            previousSubmittedAt: 7,
          },
        ],
      }),
    );
    const { localStore } = await import("./local-store");
    const [submitted, edited] = localStore.snapshot().timesheetEntries;

    expect(submitted).toMatchObject({
      commit: { at: 7, localDate: "2026-04-21", note: "Weekly sync" },
    });
    expect(submitted).not.toHaveProperty("submittedAt");
    expect(edited!.commit).toBeUndefined();
    expect(edited).not.toHaveProperty("previousSubmittedAt");
  });
```

- [ ] **Step 2: Run them**

Run: `cd apps/web && npx vitest run src/domain/time/timesheet-entry.test.ts src/domain/actions src/lib/local-store.test.ts`
Expected: FAIL in `timesheet-entry.test.ts` and `local-store.test.ts`: the entries keep `submittedAt` and get no `commit`. The two `object-actions.test.ts` cases already pass; they pin the contract while Step 7 removes the "submitted" state, and `just typecheck` then fails on any caller still passing `"submitted"` or `submittedAt`.

- [ ] **Step 3: Remove the fields** from `LocalTimesheetEntry` in `apps/web/src/domain/local-state.ts` (`submittedAt`, `submittedFingerprint`, `previousSubmittedAt` and its comment).

- [ ] **Step 4: Rewrite the entry module** `apps/web/src/domain/time/timesheet-entry.ts`:
  - Delete `createTimesheetEntrySubmissionFingerprint`, `preserveTimesheetEntrySubmissionState`, `markTimesheetEntriesSubmitted` and `markTimesheetEntriesNotSubmitted`.
  - Import `getChangedCommitFields`, `normalizeTimesheetEntryCommit` and `toCommittedCopy` from `@/domain/time/timesheet-commit` (with `getTimesheetEntryChange` from Task 3).
  - Replace `normalizeTimesheetEntry` with:

```ts
/** A stored entry, which may still carry the submission fields Ajour used before committed copies. */
export type PersistedTimesheetEntry = Omit<LocalTimesheetEntry, "commit"> & {
  commit?: unknown;
  submittedAt?: unknown;
  submittedFingerprint?: unknown;
  previousSubmittedAt?: unknown;
};

/**
 * Reads a stored entry. An entry stored as submitted gets a committed copy of
 * its current values: an edit used to clear `submittedAt`, so they are the
 * submitted values. One submitted only before an edit (`previousSubmittedAt`)
 * gets none and shows as added; its external entry has an old ID that Reset
 * sync matches later.
 */
export function normalizeTimesheetEntry(
  stored: PersistedTimesheetEntry,
): LocalTimesheetEntry {
  const {
    commit: storedCommit,
    submittedAt,
    submittedFingerprint: _submittedFingerprint,
    previousSubmittedAt: _previousSubmittedAt,
    ...entry
  } = stored;
  const normalized: LocalTimesheetEntry = {
    ...entry,
    sourceBlockIds: Array.isArray(entry.sourceBlockIds)
      ? entry.sourceBlockIds
      : [],
  };
  const commit =
    normalizeTimesheetEntryCommit(storedCommit) ??
    (typeof submittedAt === "number" && Number.isFinite(submittedAt)
      ? toCommittedCopy(normalized, submittedAt)
      : undefined);

  return commit ? { ...normalized, commit } : normalized;
}
```

  - In `createTimesheetEntry`, delete the `submittedAt: undefined,` and `submittedFingerprint: undefined,` lines.
  - In `updateTimesheetEntry`, the persisted entry becomes:

```ts
  const persistedEntry = keepTimesheetEntryCommit(
    entry,
    nextEntry.taskId
      ? nextEntry
      : {
          ...nextEntry,
          label: entry.taskId ? "" : entry.label,
        },
  );
```

  - In `moveTimesheetEntry`, replace the `movedEntry` block and its fingerprint check with:

```ts
  const movedEntry = {
    ...updatedEntry,
    localDate: values.localDate,
    committedAt: factories.now(),
  };
  // Moving an entry to its own day without other changes keeps its place.
  if (
    movedEntry.localDate === entry.localDate &&
    getChangedCommitFields(entry, movedEntry).length === 0
  ) {
    return updated;
  }
```

- [ ] **Step 5: Simplify the timer save.** In `saveTimer` (`apps/web/src/domain/time/timer-transitions.ts`), drop the `preserveTimesheetEntrySubmissionState` import and wrapper, leaving `keepTimesheetEntryCommit(existingEntry, createTimesheetEntry(...))`.

- [ ] **Step 6: Remove the store commands** `markTimesheetEntriesSubmitted` and `markTimesheetEntriesNotSubmitted` and their `apply...` imports from `apps/web/src/lib/local-store.ts`, and in the `undo` doc comment write "Restored records keep their ids, values, committed copies and order."

- [ ] **Step 7: Simplify the entry actions.**
  - `apps/web/src/domain/actions/object-actions.ts`: `export type TimeEntryActionState = "saved" | "running";`; delete `MARKS_NOT_SUBMITTED`, `isSubmitted` and both `hint:` lines in `getTimeEntryActions`; replace `getTimeEntryActionState` with:

```ts
/** Returns the action state shown for a time entry. */
export function getTimeEntryActionState(entry: {
  isRunning?: boolean;
}): TimeEntryActionState {
  return entry.isRunning ? "running" : "saved";
}
```

  - `apps/web/src/features/agents/agent-write-tools.ts` `entryActions`: `getTimeEntryActionState({ isRunning: isEntryRunning(state, entry) })`.
  - `apps/web/src/features/time/time-entry-actions.tsx`: `getTimeEntryActions("saved", { ...options, isToday: target.entry.localDate === todayIsoDate() })`, and the line 23 comment reads "a saved entry, or the running entry".

- [ ] **Step 8: Show the committed state in the Day and Week views.**
  - `apps/web/src/features/timer/timer-panel.tsx`: import `isTimesheetEntryCommitted` from `@/domain/time/timesheet-commit`; `const isCommitted = !isRunningEntry(entry) && isTimesheetEntryCommitted(entry);`; render `<Check className="time-entry-committed" aria-label="Committed" role="img" />` when `isCommitted`.
  - `apps/web/src/styles/time.css` line 279: rename `.time-entry-submitted` to `.time-entry-committed`.
  - `apps/web/src/features/time/weekly-time-view.tsx` line 628: `{isTimesheetEntryCommitted(entry) ? "committed" : "saved"}`, with the same import.

- [ ] **Step 9: Update the remaining tests.**
  - `timesheet-entry.test.ts`: in "creates a labeled entry and applies logged time to mapped work", delete the two `submitted*: undefined` lines. Delete "preserves submission for an unchanged edit and clears it after a change", "remembers the submission time of an edited entry until it is marked again" and the whole `describe("markTimesheetEntriesNotSubmitted")` (Task 3's "committed copies" tests cover edits). In "duplicates visible values without copying submission or source provenance", rename it "duplicates visible values without copying the committed copy or source provenance", give the source entry `commit: { at: 20, localDate: "2026-07-30", projectId: "project-1", taskId: "task-1", note: "Original", durationMs: 60 * 60 * 1000 }` instead of the submitted fields, and expect `commit: undefined` instead of the submitted fields. In "moves an entry without changing logged estimates and clears submission", rename it "moves an entry without changing logged estimates and keeps its committed copy", replace the submitted fields and the fingerprint line with the same `commit` value, and expect `commit: { localDate: "2026-07-30" }` in the `toMatchObject`. Remove the `createTimesheetEntrySubmissionFingerprint`, `markTimesheetEntriesNotSubmitted` and `markTimesheetEntriesSubmitted` imports.
  - `timer-transitions.test.ts`: remove the fingerprint import; rename "replaces a restarted entry and clears stale submission state" to "replaces a restarted entry and keeps its source blocks", drop its `submittedAt` and fingerprint lines and the two `submitted*: undefined` expectations.
  - `local-state-undo.test.ts`: in the fixture, `entry-b` gets `note: "Committed work"` and `commit: { at: 50, localDate: "2026-10-07", projectId: "project-1", taskId: "task-1", note: "Committed work", durationMs: 75_123 }` instead of the submitted fields; the fixture comment reads "the middle one is committed"; "moves a submitted entry back to its day with its submission and order" becomes "moves a committed entry back to its day with its copy and order", with `note: "Committed work"`. Its tombstone tests from Task 2 keep passing because `withCommittedEntryB` overwrites the copy with the same values.

- [ ] **Step 10: Update the docs.**
  - `apps/docs/time/entries.md` line 24: "If the entry was committed, the change shows on the Commit page until you commit it again. See [Commit your week](/time/commit)."
  - `apps/docs/start/concepts.md` line 14: "Time spent on a task on one day, with an optional note. An entry is **running** or **saved**. A saved entry is **committed** when your timesheet tool has it as it is; editing it makes a change to commit." Line 20: "Your entries for one week. Ajour does not send your timesheet anywhere. You copy its changes into your company's tool and mark them as committed."
  - `apps/docs/time/day-view.md` line 11: "A check marks an entry your timesheet tool has as it is."
  - `agents/GLOSSARY.md`: "Saved" becomes "The state of a time entry that is not running." with `_Avoid_: Closed, stopped`. Replace "Submitted" with:

```md
**Committed**:
A saved time entry whose committed copy matches it: the external timesheet holds it as it is in Ajour. Editing it makes an updated change.
_Avoid_: Submitted, synced, sent

**Committed copy**:
The values of a time entry as it was last committed: its day, project, task, note and duration.
_Avoid_: Snapshot, fingerprint

**Change**:
A time entry that differs from its committed copy: added (never committed), updated (its copy differs) or deleted (committed, then deleted, kept as a tombstone).
_Avoid_: Diff, delta, dirty entry
```

  and "Timesheet" becomes "One person's time entries for one week, committed to an external timesheet tool."
  - `agents/architecture.md` line 49: "`domain/time/timesheet-entry.ts` owns manual entry creation, edits, deletion with its tombstone, ordering, marking as committed, the migration of stored submission fields, and the corresponding work-item estimate adjustments."
  - `agents/library-docs.md` line 49: "Timesheet entry creation, editing, deletion and tombstones, ordering, marking as committed, and linked estimate adjustments: `apps/web/src/domain/time/timesheet-entry.ts`".
  - `agents/ux-spec.md`: in the slot table (lines 30-36), the column "Submitted" becomes "Committed" and its cells read "Enabled" (no hint); above `## Submit timesheet` (line 381) add the line "Superseded by the Commit page: `docs/superpowers/specs/2026-10-15-commit-week-design.md`."

- [ ] **Step 11: Run everything**

Run: `just test`, `just typecheck`, then `rg -n "submittedAt|submittedFingerprint|previousSubmittedAt|MarkTimesheetEntriesSubmitted|NotSubmitted|SubmissionState|SubmissionFingerprint" apps/web/src apps/api/src packages qa/ui/seed.mjs | rg -v "pull-request|code-host"`.
Expected: tests and types pass; the search prints nothing.

- [ ] **Step 12: Commit**

```sh
git add apps/web/src apps/docs agents
git commit -m "refactor(time): migrate submitted entries to committed copies" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Rename the plugin placement to `commit-week`

**Files:**
- Modify: `packages/shared/connectors.ts` (line 132), `packages/shared/agent-runs.ts` (line 51)
- Test: `packages/shared/tests/connectors.test.ts` (line 111 and a new case)
- Modify fixtures: `apps/api/src/plugin-host.test.ts:109`, `apps/api/src/server.test.ts:994`, `apps/api/src/agent-runner/runner.test.ts:94`, `apps/web/src/features/settings/plugin-settings-workflow.test.ts:157`, `apps/web/tests/acceptance/steps/agent-runner.steps.ts:26`
- Modify: `apps/web/src/features/agents/agent-task-buttons.tsx` (lines 58, 142)
- Docs: `apps/docs/developers/manifest.md` (lines 85-110), `apps/docs/plugins/workday-agent.md`, `agents/ui-registry.md` (line 73), `agents/progress-tracker.md` (new section at the end)

**Interfaces:**
- Consumes: `AgentTaskButtons` on the Commit page (Task 5).
- Produces: `agentTaskSchema.placement` and `agentTaskStatusSchema.placement` are `z.literal("commit-week")`.

- [ ] **Step 1: Write the failing test.** In `packages/shared/tests/connectors.test.ts`, set the `agentTask` fixture's `placement` to `"commit-week"` and add inside `describe("plugin manifest capabilities", ...)`:

```ts
  it("refuses the old submit-week placement", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: {
          agentTask: { tasks: [{ ...agentTask, placement: "submit-week" }] },
        },
      }),
    ).toThrow(/placement/);
  });
```

In `apps/web/tests/acceptance/steps/agent-runner.steps.ts` line 26, set `placement: "commit-week"`.

- [ ] **Step 2: Run them**

Run: `cd packages/shared && npx vitest run tests/connectors.test.ts`, then in `apps/web` with the Task 5 local config: `npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Agent tasks from plugins"`.
Expected: FAIL. The manifest with `commit-week` does not parse, and the Commit page shows no "Enter in Workday" button for a `commit-week` task.

- [ ] **Step 3: Rename the placement.**
  - `packages/shared/connectors.ts`: `placement: z.literal("commit-week"),` with the comment "Where Ajour shows the task's button: next to Mark as committed on the Commit page."
  - `packages/shared/agent-runs.ts`: `placement: z.literal("commit-week"),`.
  - `apps/web/src/features/agents/agent-task-buttons.tsx`: both filters compare with `"commit-week"`.
  - The four test fixtures in `apps/api` and `apps/web/src`: `placement: "commit-week"`.

- [ ] **Step 4: Run the tests**

Run: `just test`, `just typecheck`, then `npx playwright test --config playwright.local.config.ts --grep "Agent tasks from plugins"` in `apps/web`.
Expected: PASS. `rg -n "submit-week" apps packages qa --glob '!**/node_modules/**'` prints nothing.

- [ ] **Step 5: Update the docs.**
  - `apps/docs/developers/manifest.md`: the example task becomes `"id": "commit-week"`, `"label": "Commit to Workday"`, `"placement": "commit-week"`, `"prompt": "prompts/commit-week.md"`; the `label` row reads "The button label on the Commit page."; the `placement` row reads "`commit-week`, the only value: a button next to **Mark as committed** on the Commit page, for the week on screen."
  - `apps/docs/plugins/workday-agent.md`:
    - Intro: "The Workday (agent) plugin adds a **Commit to Workday** button to the [Commit page](/time/commit). Ajour starts a coding agent, Claude Code, Codex or OpenCode, which reads your week's changes from Ajour and applies them to your Workday timesheet in a Chrome window."
    - Set it up, step 1: "It needs version 0.4.0 or later." Step 4: "The task says **Ready to run from the Commit page.**"
    - Replace "## Enter a week" and its list with:

```md
## Commit a week

On the Commit page, press **Commit to Workday**. The agent panel opens with the run. The agent:

1. Reads the week's checked changes.
2. Opens Workday and goes to the week.
3. Applies each change: adds an added entry, updates an updated one, deletes a deleted one. The comment is the note, then `·` and the entry's ID, such as `Code review · ajour:1a2b3c4d`, so the agent finds its own entries again. It marks each change as committed in Ajour right after Workday saves it.

The panel ends with a summary. Press **Stop** in the panel to end a run at any time.
```

    - Replace "### Run it again" with: "Each entry keeps its ID whatever you edit, so a later run finds the entries an earlier one saved. Only the changes left on the Commit page go to Workday."
    - In "What it asks you", delete the pace item ("The week is off pace") and the totals item; keep the close matches item. Check the rest against the 0.4.0 `prompts/commit-week.md` in `les-cabochons/ajp-workday-agent` and remove any item that prompt does not ask.
  - `agents/ui-registry.md` line 73: "one button per `commit-week` task".
  - `agents/progress-tracker.md`, a new section at the end:

```md
## Commit week, slice 1, 2026-10-15

- [x] Entries keep a committed copy, deleted committed entries leave a tombstone, and the Commit page lists added, updated and deleted changes with partial selection and Mark as committed with Undo. Stored submitted entries migrate to committed copies.
- [x] Agents use `get_week_changes` and `mark_entries_committed`; the external ID is `ajour:` and the FNV-1a hash of the entry ID. Plugin placement `submit-week` is now `commit-week`.
- [ ] Workday (agent) 0.4.0 with `prompts/commit-week.md` in `les-cabochons/ajp-workday-agent`, then a smoke run by Alex.
```

- [ ] **Step 6: Final check**

Run: `just test`, `just typecheck`, `just format-check` (run `just format` first if it fails; then restore this plan file with `git checkout -- docs/superpowers/plans/2026-10-15-commit-week-slice-1.md` if it changed), `just docs-build`, and the whole acceptance suite: `cd apps/web && npx bddgen && npx playwright test --config playwright.local.config.ts`. Then delete `apps/web/playwright.local.config.ts`.
Expected: all pass, no dead links.

- [ ] **Step 7: Commit**

```sh
git add packages/shared apps/api/src apps/web/src apps/web/tests apps/docs agents
git commit -m "feat(plugins): rename the agent task placement to commit-week" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (slice 1):**

| Requirement | Task |
| ----------- | ---- |
| `commit` on entries, doc comments on `commit` and `committedAt` | 1 |
| `submittedAt`, `submittedFingerprint`, `previousSubmittedAt` dropped | 6 |
| Change detection: added, updated on the five fields with a trimmed note, none | 1 |
| `timesheetTombstones`; delete adds one only for committed entries | 2 |
| Undo of a delete removes the tombstone | 2 |
| Committing a deleted change removes its tombstone | 3, 4 |
| External ID `ajour:` + 8 hex FNV-1a of `_id`, never changes; `lineId` and `submitLineId` gone | 4 |
| Existing data: `submittedAt` gives a copy, `previousSubmittedAt` none, nothing else | 6 |
| Commit page replaces Submit page, opened by **Commit week** in the totals popover | 5 |
| Changes list with three symbols and colors, old → new values, "Everything is committed." | 5 |
| Per-change checkboxes, checked by default, partial commit, unchecked shown again next time | 4 (store), 5 (page) |
| **Mark as committed** with Undo | 3 (store), 5 (page) |
| Group by lines below, for copy and paste, one Ajour entry to one external entry in sync | 5 |
| `get_week_changes { weekOf, onlyChecked = true }` with change, entryId, externalId, current and committed values carrying date, projectName, projectCode, projectFullName, projectProperties, taskName, hours, note | 4 |
| `mark_entries_committed { entryIds }`, refuses unknown IDs | 4 |
| Old tools removed; pace not in commit tools; `week-pace.ts` kept | 4 |
| Placement `submit-week` becomes `commit-week` (UI filters, manifest schema, tests, docs) | 7 |
| Runner prompt rule | 4 |
| Testing section: domain units for each field, tombstones and Undo, partial commit, existing data; read model units for `get_week_changes`; acceptance for the three symbols and a partial commit | 1, 2, 3, 4, 5, 6 |

Out of scope and not planned: locked weeks, `isDateLocked`, Submit week, `get_week_status`, `submit_week`, Reopen week, `delete_entry`, `externalId` and `change` in `list_time_entries`, Reset sync, and the Workday plugin's own 0.4.0 release (tracked in the progress tracker).

**Placeholder scan:** every test step has its code; every logic step has its code. The two JSX comments in Task 5 Step 7 point at markup kept verbatim from the current `submit-page.tsx` and list exactly what changes. The Workday docs step asks to check the "What it asks you" list against the plugin's 0.4.0 prompt, which lives in another repository.

**Type consistency:** `LocalTimesheetEntryCommit`, `LocalTimesheetTombstone`, `TimesheetCommitValues`, `TimesheetChange`, `TimesheetChangeKind`, `toCommittedCopy`, `getChangedCommitFields`, `getTimesheetEntryChange`, `isTimesheetEntryCommitted`, `listWeekChanges` and `describeTimesheetCommitValues` come from Task 1; `normalizeTimesheetEntryCommit`, `normalizeTimesheetTombstones` and `timesheetTombstones` from Task 2; `markTimesheetEntriesCommitted`, `keepTimesheetEntryCommit` and `localStore.markTimesheetEntriesCommitted` from Task 3; `externalEntryId`, the `commit-selection` functions, `getWeekChangesForAgent` and `AgentChangeValues` from Task 4; `summarizeWeek`, `CommitChangeList`, `CommitWeekButton` and `WeekCommittedBadge` from Task 5. Each is used only in its own task or a later one. `getWeekChangesForAgent` takes `weekDates: string[]`, and the runner passes `getIsoWeekDates(...)`, which returns `string[]`. `markTimesheetEntriesCommitted` takes `readonly string[]` everywhere.

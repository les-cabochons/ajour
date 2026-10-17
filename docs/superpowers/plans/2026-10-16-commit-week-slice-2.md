# Commit week, slice 2: submit week Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committed week can be submitted from the Commit page, after a pace check, which locks it: its entries are read-only everywhere, for agents too, until the user reopens it. Agents read a week's status with `get_week_status` and lock it with `submit_week`, and a plugin `submit-week` task, such as Workday's "Check Workday and submit", replaces the manual Submit week button.

**Architecture:** `LocalAppState.lockedWeeks` holds the submitted weeks, and `domain/time/locked-weeks.ts` owns the one rule, `isDateLocked`, the Submit and Reopen transitions, and `assertNoLockedWeekWrite`, a check of any state change against the locked weeks. The local store runs that check in `writeState`, the one place every write passes, so no command, Undo or agent tool can change a submitted week; a refused write throws `LockedWeekError`, which agents get as a refusal and the UI shows as a toast through one window listener, while controls with an obvious disabled state (entry actions, Add buttons, drags, the editor) disable themselves with the same reason.

**Tech Stack:** pnpm monorepo, TypeScript (`erasableSyntaxOnly`), zod 3, React 19, TanStack Router, Base UI, Vitest, playwright-bdd. Run commands with `just`. The Workday plugin lives in the separate repo `/Users/a.trepanier/Repos/Personnal/ajp-workday-agent`.

**Spec:** `docs/superpowers/specs/2026-10-15-commit-week-design.md` (slice 2 only). Slice 1 plan: `docs/superpowers/plans/2026-10-15-commit-week-slice-1.md`.

## Global Constraints

- `LocalLockedWeek` is `{ weekOf: string; lockedAt: number }`, `weekOf` is the week's Monday as `YYYY-MM-DD`. `LocalAppState.lockedWeeks: LocalLockedWeek[]`, required, default `[]`.
- On load, `normalizeLockedWeeks` drops malformed records, moves a `weekOf` that is not a Monday to its Monday, keeps the first record of a week, and sorts by `weekOf`.
- Weeks run Monday to Sunday. `getWeekOf(localDate)` in `domain/time/local-date.ts` finds the Monday with UTC date arithmetic, so the time zone and daylight saving time never move a day to another week.
- One rule: `isDateLocked(state, localDate)` in `domain/time/locked-weeks.ts`. `getLockedWeek` and `getDateLockReason` read the same lookup. Outside `locked-weeks.ts`, no code reads `lockedWeeks` directly.
- Refusal message, exact, with the Monday in ISO form: `The week of 2026-10-05 is submitted. Reopen it to change it.` (`lockedWeekMessage(weekOf)`).
- One write check: `writeState` in `lib/local-store.ts` calls `assertNoLockedWeekWrite(cachedState, next)` before every write and throws `LockedWeekError`. A week counts when it is in `lockedWeeks` both before and after the write, so Submit, Reopen and their Undo pass.
- The check refuses a write that adds, changes or removes an entry on a locked day (its day before or after the write), adds or removes a tombstone whose committed day is locked, or adds, changes or removes a running entry on a locked day. Records compare by value with `recordsEqual` from `domain/local-state-undo.ts`.
- Batches are atomic: a delete of a selection, a paste, an import commit, a calendar add or a switch that touches one locked day writes nothing.
- Submit refusals, checked in this order, exact copy for agents:
  - `The week of 2026-10-05 is already submitted.`
  - `Commit your changes first. The week of 2026-10-05 has 1 change that is not committed.` (plural: `has 3 changes that are not committed.`)
  - `Stop the running entry first. It is on 2026-10-11, in the week of 2026-10-05.`
- Submitting does not drop tombstones: a week only locks with no change, and every tombstone of the week is a deleted change, so it has none.
- Commit page copy: buttons "Submit week", "Reopen week"; disabled reasons "Commit your changes first" and "Stop the running entry first"; pace dialog titles "Submit a week under pace?" and "Submit a week over pace?", description "You logged 4:00 of the 40:00 expected by now.", buttons "Review" and "Submit anyway"; toasts "Week submitted" and "Week reopened", both with Undo; chip "Submitted" with a lock icon; summary line "Submitted Oct 16. Its entries are read-only until you reopen the week."
- Pace check on Submit week: `computeWeekPace` with `getPaceTolerancePercent(preferences)`, the week's logged time from every entry of the week, and `todayIsoDate()`. It asks when the status is `over`, or `under` while `warnWhenSubmittingUnderCapacity` is on (`needsPaceConfirmation`).
- How a refusal shows in the UI: a control with a disabled state is disabled with the reason (entry action menus and keys, selection menus, Day list New entry, Days column Add and double-click, Week Grid Add row, Delete row and typed cells, drags and Alt+arrow reorder, Paste here, the Move to and Duplicate to calendar days, the entry editor). Every other write path shows the refusal as a toast through `installLockedWeekToast` (Cmd+V paste, Stop and Start of a running entry, Continue, command palette actions, Undo, imports).
- Locked entries keep Edit (it opens the editor read-only), Duplicate to… (to an open week) and Continue (it starts a new running entry today).
- MCP tools: `get_week_status { weekOf }` returns `{ weekOf, locked, uncommittedChanges, committedHoursByDay: { date, hours }[], committedEntries: { entryId, externalId, committed }[], pace: { loggedHours, targetHours, expectedHours, status } }`; `submit_week { weekOf }` returns `{ weekOf, locked: true }`. The MCP server lists 30 tools.
- MCP instructions get one line, exact: `A submitted week is read-only: Ajour refuses writes to its entries until the user reopens it.`
- Runner prompt gets one rule, exact, after the commit rule, which stays as it is: `- Call submit_week only when the task asks for it, as its last step. It locks the week in Ajour.`
- Plugin placement: `agentTaskPlacementSchema = z.enum(["commit-week", "submit-week"])` in `packages/shared/connectors.ts`, used by the manifest and the runner overview. `submit-week` tasks replace the Submit week button and take its disabled reasons.
- Workday (agent) 0.5.0: task `submit-week`, label "Check Workday and submit", prompt `prompts/submit-week.md`, question choices "Submit anyway" and "Stop", then "Update Workday", "I'll fix Ajour" and "Leave it".
- Open dependencies: Ajour PR #207 changes `mark_entries_committed` to `{ changes: { entryId, version }[] }`, and Workday PR #4 is 0.4.1. Rebase on `origin/main` before Task 8 and Task 10, and follow the variant each task names.
- No enums, namespaces or constructor parameter properties (`erasableSyntaxOnly`). Class fields are declared, then assigned in the constructor.
- Repository text in English, plain words, no em dashes. Conventional commits whose message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Acceptance tests run through a temporary `apps/web/playwright.local.config.ts` (Task 5, Step 1). Never commit it. Do not run `just format` on this plan file, or restore it afterwards with `git checkout -- docs/superpowers/plans/2026-10-16-commit-week-slice-2.md`.

## Review Focus

- **A write path that bypasses the lock.** Every store command, Undo and agent tool writes through `writeState`, so the check there is the one guard. Pinned in Task 2 by a table that runs every entry transition (create, edit, move in and out, duplicate into, delete, delete a selection, paste copy and cut, drop, reorder, mark as not committed, import commit, calendar add, timer start, Continue, timer save) through `findLockedWeekWrite`, a store test that a refused write persists nothing, and in Task 8 by one refusal per agent write tool.
- **A running entry crossing midnight into a locked week.** An entry started Sunday 23:30 keeps Sunday's date. The next week may be submitted at 00:30, Stop must still save on Sunday, and a Switch must be refused whole so the running entry keeps running. Submit must refuse the week that holds the running entry. Pinned in Task 2 ("lets a running entry from Sunday save there") and Task 3 ("refuses while the running entry is in the week, even after midnight").
- **Undo across a submit.** Undo of Submit week must give back exactly the open week (no lock, the same copies and tombstones), and the Undo of a commit made before the week was submitted must be refused, not unlock entries silently. Pinned in Task 3 ("undoes a submit back to the open week" and "refuses the Undo of a commit once the week is submitted") and the store test in Task 3.
- **Reopening, then editing.** Reopen must keep every committed copy, list no change right away, and list an edit made after it as updated. Pinned in Task 3 ("reopens a week, and a later edit shows as a change again") and the acceptance scenario in Task 7.
- **The week boundary.** Sunday belongs to the week before, a `weekOf` on any day locks its Monday's week, and daylight saving time and year ends do not shift days. Pinned in Task 1 (`getWeekOf` table, Sunday and next Monday in `isDateLocked`), Task 3 (`submitWeek(state, "2026-10-11")` locks 2026-10-05) and Task 8 (`submit_week` with a Sunday and `get_week_status` with a Sunday).

## File Structure

- `apps/web/src/domain/local-state.ts`: `LocalLockedWeek`, `LocalAppState.lockedWeeks`.
- `apps/web/src/domain/time/local-date.ts` (+ new `local-date.test.ts`): `getWeekOf`, `getWeekDates`.
- `apps/web/src/domain/time/locked-weeks.ts` (new, + test): the rule, normalization, the write check and `LockedWeekError`, Submit and Reopen.
- `apps/web/src/domain/local-state-undo.ts`: `lockedWeeks` is an undo collection; `recordsEqual` is exported.
- `apps/web/src/domain/time/week-pace.ts`: `WeekPace`, `needsPaceConfirmation`.
- `apps/web/src/lib/local-store.ts`: default and normalized `lockedWeeks`, the check in `writeState`, `submitWeek`, `reopenWeek`.
- `apps/web/src/features/feedback/locked-week-toast.ts` (new, + test), `apps/web/src/main.tsx`: the refusal toast.
- `apps/web/src/components/disabled-reason.tsx` (new): the tooltip wrapper of a disabled control, taken out of `agent-task-buttons.tsx`.
- `apps/web/src/features/time/week-lock.tsx` (new): `WeekLockChip`.
- `apps/web/src/features/time/commit-page.tsx`: Submit week, the pace check, Reopen week, the lock.
- `apps/web/src/features/settings/settings-general-page.tsx`: pace settings copy.
- `apps/web/src/domain/actions/object-actions.ts` (+ test): `lockedReason` on single and selection actions.
- `apps/web/src/features/time/time-entry-actions.tsx`, `use-entry-selection.ts`, `time-entry-editor.ts` (+ test), `time-entry-editor-form.tsx`: read-only entries and locked days in the editor and the date dialog.
- `apps/web/src/features/timer/timer-panel.tsx`, `features/time/weekly-time-view.tsx`, `features/time/week-grid.tsx`: locked days in the Day list, Week Days and Week Grid.
- `apps/web/src/domain/time/calendar-suggestions.ts` (+ test): no suggestion on a locked day.
- `packages/shared/agent-tools.ts` (+ test), `apps/web/src/domain/agents/agent-read-model.ts` (+ test), `apps/web/src/features/agents/agent-tool-runner.ts` (+ test), `agent-write-tools.ts`: `get_week_status`, `submit_week`, lock refusals.
- `apps/api/src/mcp-server.ts` (+ test), `apps/api/src/agent-runner/prompts.ts` (+ test): descriptions, instructions, runner rule.
- `packages/shared/connectors.ts`, `packages/shared/agent-runs.ts` (+ `tests/connectors.test.ts`), `apps/web/src/features/agents/agent-task-buttons.tsx`: the `submit-week` placement.
- Acceptance: `apps/web/tests/acceptance/features/submit-week.feature` and `steps/submit-week.steps.ts` (new); `agent-runner.feature` and its steps.
- Docs: `apps/docs/time/commit.md`, `apps/docs/app/settings.md`, `apps/docs/app/agents.md`, `apps/docs/developers/manifest.md`, `apps/docs/plugins/workday-agent.md`; `agents/GLOSSARY.md`, `agents/library-docs.md`, `agents/architecture.md`, `agents/ui-registry.md`, `agents/progress-tracker.md`.
- Workday plugin repo: `plugin.json`, `package.json`, `prompts/submit-week.md` (new), `tests/manifest.test.mjs`, `README.md`.

---

### Task 1: Locked weeks in local state, and the one rule

**Files:**
- Modify: `apps/web/src/domain/local-state.ts` (after `LocalTimesheetTombstone`; `LocalAppState` after `timesheetTombstones`)
- Modify: `apps/web/src/domain/time/local-date.ts`
- Create: `apps/web/src/domain/time/local-date.test.ts`
- Create: `apps/web/src/domain/time/locked-weeks.ts`, `apps/web/src/domain/time/locked-weeks.test.ts`
- Modify: `apps/web/src/domain/local-state-undo.ts` (`UNDO_COLLECTIONS`, `recordKeys`, `captureUndo`, `restoreUndo`, `recordsEqual`), test `local-state-undo.test.ts`
- Modify: `apps/web/src/lib/local-store.ts` (`createDefaultState`, `normalizeState`), test `local-store.test.ts`
- Modify: every `*.test.ts` under `apps/web/src` that builds a `LocalAppState` with `timesheetTombstones: [],`
- Docs: `agents/GLOSSARY.md`, `agents/library-docs.md`

**Interfaces:**
- Consumes: `isValidLocalDate` from `domain/time/local-date.ts`; `LocalAppState` from `domain/local-state.ts`.
- Produces:
  - `interface LocalLockedWeek { weekOf: string; lockedAt: number }`, `LocalAppState.lockedWeeks: LocalLockedWeek[]`
  - `getWeekOf(localDate: string): string`
  - `lockedWeekMessage(weekOf: string): string`
  - `getLockedWeek(state: Pick<LocalAppState, "lockedWeeks">, localDate: string): LocalLockedWeek | undefined`
  - `isDateLocked(state: Pick<LocalAppState, "lockedWeeks">, localDate: string): boolean`
  - `getDateLockReason(state: Pick<LocalAppState, "lockedWeeks">, localDate: string): string | undefined`
  - `normalizeLockedWeeks(value: unknown): LocalLockedWeek[]`
  - `recordsEqual(left: unknown, right: unknown): boolean`, now exported from `domain/local-state-undo.ts`
  - `"lockedWeeks"` in `UNDO_COLLECTIONS`, keyed by `weekOf`

- [ ] **Step 1: Write the failing date tests** in `apps/web/src/domain/time/local-date.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getWeekOf } from "@/domain/time/local-date";

describe("getWeekOf", () => {
  it.each([
    ["2026-10-05", "2026-10-05"],
    ["2026-10-11", "2026-10-05"],
    ["2026-10-12", "2026-10-12"],
    // Daylight saving time ends on Sunday, November 1, 2026 in North America.
    ["2026-11-01", "2026-10-26"],
    ["2026-11-02", "2026-11-02"],
    // It starts on Sunday, March 8, 2026.
    ["2026-03-08", "2026-03-02"],
    ["2027-01-03", "2026-12-28"],
    ["2028-02-29", "2028-02-28"],
  ])("puts %s in the week of %s", (localDate, monday) => {
    expect(getWeekOf(localDate)).toBe(monday);
  });
});
```

- [ ] **Step 2: Write the failing rule tests** in `apps/web/src/domain/time/locked-weeks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getDateLockReason,
  getLockedWeek,
  isDateLocked,
  lockedWeekMessage,
  normalizeLockedWeeks,
} from "@/domain/time/locked-weeks";

const submitted = { lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 50 }] };

describe("isDateLocked", () => {
  it("locks every day from Monday to Sunday of a submitted week", () => {
    for (const day of ["2026-10-05", "2026-10-08", "2026-10-11"]) {
      expect(isDateLocked(submitted, day)).toBe(true);
    }
    expect(isDateLocked(submitted, "2026-10-04")).toBe(false);
    expect(isDateLocked(submitted, "2026-10-12")).toBe(false);
  });

  it("reads a half-typed or impossible date as not locked", () => {
    expect(isDateLocked(submitted, "2026-10-0")).toBe(false);
    expect(isDateLocked(submitted, "2026-02-30")).toBe(false);
  });

  it("names the week and the way out", () => {
    expect(lockedWeekMessage("2026-10-05")).toBe(
      "The week of 2026-10-05 is submitted. Reopen it to change it.",
    );
    expect(getDateLockReason(submitted, "2026-10-11")).toBe(
      "The week of 2026-10-05 is submitted. Reopen it to change it.",
    );
    expect(getDateLockReason(submitted, "2026-10-12")).toBeUndefined();
    expect(getLockedWeek(submitted, "2026-10-09")).toEqual({
      weekOf: "2026-10-05",
      lockedAt: 50,
    });
  });
});

describe("normalizeLockedWeeks", () => {
  it("keeps valid weeks on their Monday, once each, in week order", () => {
    expect(
      normalizeLockedWeeks([
        { weekOf: "2026-10-14", lockedAt: 7 },
        { weekOf: "2026-10-05", lockedAt: 5 },
        { weekOf: "2026-10-12", lockedAt: 9 },
        { weekOf: "2026-02-30", lockedAt: 1 },
        { weekOf: "2026-10-19" },
        "2026-10-26",
        null,
      ]),
    ).toEqual([
      { weekOf: "2026-10-05", lockedAt: 5 },
      { weekOf: "2026-10-12", lockedAt: 7 },
    ]);
  });

  it("reads anything but a list as no submitted week", () => {
    expect(normalizeLockedWeeks(undefined)).toEqual([]);
    expect(normalizeLockedWeeks({})).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the failing undo test.** In `apps/web/src/domain/local-state-undo.test.ts`, inside `describe("time entry undo", ...)`:

```ts
  it("takes back a change to the submitted weeks", () => {
    const before = createState();
    const after = {
      ...before,
      lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 1 }],
    };

    const undo = captureUndo(before, after)!;
    const restored = restoreUndo(after, undo);

    expect(undo.lockedWeeks).toHaveLength(1);
    expect(restored.result).toBe("restored");
    expect(restored.state.lockedWeeks).toEqual([]);
  });
```

- [ ] **Step 4: Write the failing store tests.** At the end of `apps/web/src/lib/local-store.test.ts`:

```ts
describe("submitted weeks in the store", () => {
  beforeEach(() => {
    vi.resetModules();
    installMockWindow();
  });

  it("starts with no submitted week", async () => {
    const { localStore } = await import("./local-store");
    expect(localStore.snapshot().lockedWeeks).toEqual([]);
  });

  it("reads submitted weeks on their Monday and drops malformed ones", async () => {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        lockedWeeks: [
          { weekOf: "2026-10-07", lockedAt: 5 },
          { weekOf: "soon", lockedAt: 6 },
        ],
      }),
    );
    const { localStore } = await import("./local-store");

    expect(localStore.snapshot().lockedWeeks).toEqual([
      { weekOf: "2026-10-05", lockedAt: 5 },
    ]);
  });
});
```

- [ ] **Step 5: Run them**

Run: `cd apps/web && npx vitest run src/domain/time/local-date.test.ts src/domain/time/locked-weeks.test.ts src/domain/local-state-undo.test.ts src/lib/local-store.test.ts`
Expected: FAIL. `getWeekOf` and `@/domain/time/locked-weeks` do not exist, `undo.lockedWeeks` is undefined, and `lockedWeeks` is missing from the snapshot.

- [ ] **Step 6: Add the type.** In `apps/web/src/domain/local-state.ts`, after `LocalTimesheetTombstone`:

```ts
/**
 * A submitted week: its entries are read-only, for agents too, until the user
 * reopens it. See docs/superpowers/specs/2026-10-15-commit-week-design.md.
 */
export interface LocalLockedWeek {
  /** The week's Monday, `YYYY-MM-DD`. */
  weekOf: string;
  /** When the week was submitted. */
  lockedAt: number;
}
```

In `LocalAppState`, after `timesheetTombstones`:

```ts
  /** Submitted weeks, in week order. See `LocalLockedWeek`. */
  lockedWeeks: LocalLockedWeek[];
```

- [ ] **Step 7: Add `getWeekOf`** at the end of `apps/web/src/domain/time/local-date.ts`:

```ts
/**
 * The Monday of the week that holds `localDate`, `YYYY-MM-DD`. Weeks run
 * Monday to Sunday. The arithmetic is in UTC on the date alone, so the time
 * zone and daylight saving time never move a day to another week. Pass a
 * valid date (see `isValidLocalDate`).
 */
export function getWeekOf(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  // getUTCDay counts from Sunday, 0. Monday starts the week.
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
```

- [ ] **Step 8: Write `apps/web/src/domain/time/locked-weeks.ts`**

```ts
import type { LocalAppState, LocalLockedWeek } from "@/domain/local-state";
import { getWeekOf, isValidLocalDate } from "@/domain/time/local-date";

/**
 * Submitted weeks. Submitting a week locks it: its entries are read-only
 * everywhere, for agents too, until the user reopens it. One rule decides
 * whether a day is locked, `isDateLocked`. See
 * docs/superpowers/specs/2026-10-15-commit-week-design.md.
 */

type LockState = Pick<LocalAppState, "lockedWeeks">;

/** The refusal of every write to a submitted week. `weekOf` is its Monday. */
export function lockedWeekMessage(weekOf: string) {
  return `The week of ${weekOf} is submitted. Reopen it to change it.`;
}

/** The submitted week that holds `localDate`, or undefined. An invalid date is in none. */
export function getLockedWeek(
  state: LockState,
  localDate: string,
): LocalLockedWeek | undefined {
  if (!isValidLocalDate(localDate)) return undefined;
  const weekOf = getWeekOf(localDate);
  return state.lockedWeeks.find((week) => week.weekOf === weekOf);
}

/** The one rule: a day is locked when its week is submitted. */
export function isDateLocked(state: LockState, localDate: string) {
  return getLockedWeek(state, localDate) !== undefined;
}

/** Why entries on `localDate` cannot change, or undefined when they can. */
export function getDateLockReason(
  state: LockState,
  localDate: string,
): string | undefined {
  const week = getLockedWeek(state, localDate);
  return week ? lockedWeekMessage(week.weekOf) : undefined;
}

/**
 * Reads stored submitted weeks. Drops malformed ones, moves a date that is not
 * a Monday to its Monday, keeps the first record of a week, and sorts them.
 */
export function normalizeLockedWeeks(value: unknown): LocalLockedWeek[] {
  if (!Array.isArray(value)) return [];
  const byWeek = new Map<string, LocalLockedWeek>();
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { weekOf, lockedAt } = item as Record<string, unknown>;
    if (
      typeof weekOf !== "string" ||
      !isValidLocalDate(weekOf) ||
      typeof lockedAt !== "number" ||
      !Number.isFinite(lockedAt)
    ) {
      continue;
    }
    const monday = getWeekOf(weekOf);
    if (!byWeek.has(monday)) byWeek.set(monday, { weekOf: monday, lockedAt });
  }
  return [...byWeek.values()].sort((left, right) =>
    left.weekOf.localeCompare(right.weekOf),
  );
}
```

- [ ] **Step 9: Make submitted weeks undoable.** In `apps/web/src/domain/local-state-undo.ts`:
  - The module comment's first sentence gains: "Submitting or reopening a week changes `lockedWeeks`."
  - Add `"lockedWeeks",` to `UNDO_COLLECTIONS` after `"timesheetTombstones",`.
  - Add `lockedWeeks: (week) => week.weekOf,` to `recordKeys` after `timesheetTombstones`.
  - In `captureUndo`, after the `timesheetTombstones` line: `lockedWeeks: diffCollection("lockedWeeks", before, after),`.
  - In `restoreUndo`'s returned state, after `timesheetTombstones`: `lockedWeeks: restoreCollection("lockedWeeks", state, undo),`.
  - Change `function recordsEqual(` to `export function recordsEqual(` and give it the doc comment: "Compares two records by value. A missing key equals an `undefined` one."

- [ ] **Step 10: Default and normalize in the store.** In `apps/web/src/lib/local-store.ts`:
  - Import `normalizeLockedWeeks` from `@/domain/time/locked-weeks`.
  - In `createDefaultState`, after `timesheetTombstones: [],`: `lockedWeeks: [],`.
  - In `normalizeState`, after the `timesheetTombstones: normalizeTimesheetTombstones(...)` entry: `lockedWeeks: normalizeLockedWeeks(persistedState.lockedWeeks),`.

- [ ] **Step 11: Give every test state its submitted weeks**

```sh
cd apps/web
perl -0pi -e 's/^([ \t]*)timesheetTombstones: \[\],\n/$1timesheetTombstones: [],\n$1lockedWeeks: [],\n/mg' $(rg -l "timesheetTombstones: \[\]," src --glob '*.test.ts')
```

Expected: 11 files change, `local-state-undo.test.ts` twice.

- [ ] **Step 12: Run the tests and the type check**

Run: `cd apps/web && npx vitest run src/domain/time/local-date.test.ts src/domain/time/locked-weeks.test.ts src/domain/local-state-undo.test.ts src/lib/local-store.test.ts`, then `just typecheck`.
Expected: PASS, and no type error. `just test` passes.

- [ ] **Step 13: Docs.**
  - `agents/GLOSSARY.md`, after **Committed copy**:

```md
**Submitted week**:
A week the user locked after committing every change: its entries are read-only, for agents too, until the user reopens it. The code calls it a locked week.
_Avoid_: Closed week, finalized week, frozen week
```

  - `agents/library-docs.md`, after the `timesheet-commit.ts` line: "- Submitted weeks: the one rule `isDateLocked`, their normalization, the write check every store write runs, Submit week and Reopen week: `apps/web/src/domain/time/locked-weeks.ts`"

- [ ] **Step 14: Commit**

```sh
git add apps/web/src agents/GLOSSARY.md agents/library-docs.md
git commit -m "feat(time): keep submitted weeks in local state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One write check for every write

**Files:**
- Modify: `apps/web/src/domain/time/locked-weeks.ts`, test `locked-weeks.test.ts`
- Modify: `apps/web/src/lib/local-store.ts` (`writeState`), test `local-store.test.ts`
- Docs: `agents/architecture.md` (Data Flow, the list of deep domain modules)

**Interfaces:**
- Consumes: `getWeekOf`, `isValidLocalDate`, `lockedWeekMessage`, `recordsEqual` (Task 1).
- Produces:
  - `class LockedWeekError extends Error { readonly weekOf: string }`, message `lockedWeekMessage(weekOf)`
  - `type LockCheckState = Pick<LocalAppState, "lockedWeeks" | "timesheetEntries" | "timesheetTombstones" | "timers">`
  - `findLockedWeekWrite(before: LockCheckState, after: LockCheckState): string | undefined`
  - `assertNoLockedWeekWrite(before: LockCheckState, after: LockCheckState): void`, throws `LockedWeekError`

- [ ] **Step 1: Write the failing check tests.** In `apps/web/src/domain/time/locked-weeks.test.ts`, replace the imports with:

```ts
import { describe, expect, it } from "vitest";
import type {
  LocalAppState,
  LocalTimer,
  LocalTimesheetEntry,
  LocalTimesheetImportDraft,
} from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  acceptCalendarSuggestions,
  type CalendarSuggestion,
} from "@/domain/time/calendar-suggestions";
import {
  assertNoLockedWeekWrite,
  findLockedWeekWrite,
  getDateLockReason,
  getLockedWeek,
  isDateLocked,
  LockedWeekError,
  lockedWeekMessage,
  normalizeLockedWeeks,
} from "@/domain/time/locked-weeks";
import { toCommittedCopy } from "@/domain/time/timesheet-commit";
import {
  deleteTimesheetEntries,
  deleteTimesheetEntry,
  dropTimesheetEntries,
  duplicateTimesheetEntry,
  markTimesheetEntriesNotCommitted,
  moveTimesheetEntry,
  pasteTimesheetEntries,
  reorderTimesheetEntries,
  saveManualTimesheetEntry,
  updateTimesheetEntry,
} from "@/domain/time/timesheet-entry";
import { commitTimesheetImportDraft } from "@/domain/time/timesheet-import";
import {
  continueTimesheetEntry,
  saveTimer,
  startTimer,
} from "@/domain/time/timer-transitions";
```

Then append:

```ts
const HOUR = 3_600_000;
const LOCKED = "2026-10-05";

/** A committed entry on Acme · Build whose note is its id. */
function committedEntry(
  _id: string,
  localDate: string,
  committedAt = 10,
): LocalTimesheetEntry {
  const entry: LocalTimesheetEntry = {
    _id,
    localDate,
    projectId: "p1",
    taskId: "t1",
    label: "Build",
    note: _id,
    durationMs: HOUR,
    sourceBlockIds: [],
    committedAt,
  };
  return { ...entry, commit: toCommittedCopy(entry, 5) };
}

/** The week of 2026-10-05 is submitted with "locked" on Tuesday; "open" is on the next Tuesday. */
function createState(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    user: { _id: "local-user", name: "Local User", email: "local@example.com" },
    projects: [
      {
        _id: "p1",
        name: "Acme",
        color: "#123456",
        icon: DEFAULT_PROJECT_ICON,
        status: "active",
        tasks: [{ _id: "t1", name: "Build", status: "active", createdAt: 1 }],
      },
    ],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [],
    timesheetEntries: [
      committedEntry("locked", "2026-10-06"),
      committedEntry("open", "2026-10-13"),
    ],
    timesheetTombstones: [],
    lockedWeeks: [{ weekOf: LOCKED, lockedAt: 50 }],
    timesheetImportDrafts: [],
    workItems: [],
    workflowStates: [],
    workflowStateMappings: [],
    workflowStateWriteRules: [],
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
      weeklyTimeViewStyle: "grid",
      weeklyCapacityTargets: {
        monday: 8 * HOUR,
        tuesday: 8 * HOUR,
        wednesday: 8 * HOUR,
        thursday: 8 * HOUR,
        friday: 8 * HOUR,
        saturday: 0,
        sunday: 0,
      },
      warnWhenOverCapacity: true,
      warnWhenSubmittingUnderCapacity: true,
      closeParentSubitems: "ask",
    },
    updatedAt: 0,
    ...overrides,
  };
}

const factories = {
  createId: (prefix: string) => `${prefix}-new`,
  now: () => 100,
};

/** An entry's own values on `localDate`. */
function valuesOn(localDate: string, note = "locked") {
  return { localDate, projectId: "p1", taskId: "t1", note, durationMs: HOUR };
}

function importDraft(localDate: string): LocalTimesheetImportDraft {
  return {
    _id: "draft-1",
    localDate,
    projectName: "Acme",
    taskName: "Build",
    durationMs: HOUR,
    potentialConflict: false,
    conflictEntryIds: [],
    importedAt: 1,
  };
}

function suggestion(localDate: string): CalendarSuggestion {
  return {
    key: "work:standup",
    pluginId: "ics",
    connectionId: "work",
    connectionLabel: "Work",
    occurrenceKey: "standup",
    localDate,
    startsAt: Date.parse(`${localDate}T09:00:00`),
    endsAt: Date.parse(`${localDate}T09:30:00`),
    durationMs: HOUR / 2,
    title: "Standup",
    untitled: false,
    allDay: false,
  };
}

function runningOn(localDate: string): LocalTimer {
  return {
    _id: "timer-1",
    startedAt: 0,
    localDate,
    projectId: "p1",
    taskId: "t1",
    accumulatedDurationMs: 0,
  };
}

type Write = [string, LocalAppState, (state: LocalAppState) => LocalAppState];

describe("the write check", () => {
  const refused: Write[] = [
    [
      "create an entry on a locked day",
      createState(),
      (s) =>
        saveManualTimesheetEntry(
          s,
          { localDate: "2026-10-07", projectId: "p1", durationMs: HOUR },
          factories,
        ),
    ],
    [
      "edit a locked entry",
      createState(),
      (s) =>
        updateTimesheetEntry(
          s,
          "locked",
          { projectId: "p1", taskId: "t1", note: "Changed", durationMs: HOUR },
          factories,
        ),
    ],
    [
      "move a locked entry out of its week",
      createState(),
      (s) => moveTimesheetEntry(s, "locked", valuesOn("2026-10-14"), factories),
    ],
    [
      "move an entry into a locked week",
      createState(),
      (s) =>
        moveTimesheetEntry(s, "open", valuesOn("2026-10-07", "open"), factories),
    ],
    [
      "duplicate an entry into a locked week",
      createState(),
      (s) =>
        duplicateTimesheetEntry(
          s,
          "open",
          valuesOn("2026-10-07", "open"),
          factories,
        ),
    ],
    [
      "duplicate a locked entry on its own day",
      createState(),
      (s) =>
        duplicateTimesheetEntry(s, "locked", valuesOn("2026-10-06"), factories),
    ],
    [
      "delete a locked entry",
      createState(),
      (s) => deleteTimesheetEntry(s, "locked"),
    ],
    [
      "delete a selection that holds a locked entry",
      createState(),
      (s) => deleteTimesheetEntries(s, ["open", "locked"]),
    ],
    [
      "paste copies on a locked day",
      createState(),
      (s) =>
        pasteTimesheetEntries(
          s,
          [{ entryId: "open", localDate: "2026-10-08" }],
          "copy",
          factories,
        ),
    ],
    [
      "paste a cut locked entry in another week",
      createState(),
      (s) =>
        pasteTimesheetEntries(
          s,
          [{ entryId: "locked", localDate: "2026-10-15" }],
          "cut",
          factories,
        ),
    ],
    [
      "drop a dragged entry on a locked day",
      createState(),
      (s) =>
        dropTimesheetEntries(
          s,
          { entryIds: ["open"], localDate: "2026-10-06", targetIndex: 0 },
          factories,
        ).state,
    ],
    [
      "reorder a locked day",
      createState({
        timesheetEntries: [
          committedEntry("locked", "2026-10-06", 10),
          committedEntry("locked-2", "2026-10-06", 20),
        ],
      }),
      (s) => reorderTimesheetEntries(s, "2026-10-06", ["locked-2", "locked"]),
    ],
    [
      "mark a locked entry as not committed",
      createState(),
      (s) => markTimesheetEntriesNotCommitted(s, ["locked"]),
    ],
    [
      "commit an imported entry on a locked day",
      createState({ timesheetImportDrafts: [importDraft("2026-10-08")] }),
      (s) => commitTimesheetImportDraft(s, "draft-1", factories),
    ],
    [
      "add a calendar suggestion on a locked day",
      createState(),
      (s) =>
        acceptCalendarSuggestions(
          s,
          [{ suggestion: suggestion("2026-10-08"), projectId: "p1" }],
          factories,
        ).state,
    ],
    [
      "start a running entry on a locked today",
      createState(),
      (s) => startTimer(s, { projectId: "p1" }, "2026-10-09", factories),
    ],
    [
      "continue a locked entry on its own day",
      createState(),
      (s) => continueTimesheetEntry(s, "locked", "2026-10-06", factories),
    ],
    [
      "save a running entry into a locked day",
      createState({ timers: [runningOn("2026-10-09")] }),
      (s) => saveTimer(s, "timer-1", factories),
    ],
  ];

  it.each(refused)("refuses to %s", (_name, before, write) => {
    const after = write(before);

    expect(after).not.toBe(before);
    expect(findLockedWeekWrite(before, after)).toBe(LOCKED);
    expect(() => assertNoLockedWeekWrite(before, after)).toThrow(
      new LockedWeekError(LOCKED),
    );
  });

  const allowed: Write[] = [
    [
      "edit an entry of an open week",
      createState(),
      (s) =>
        updateTimesheetEntry(
          s,
          "open",
          { projectId: "p1", taskId: "t1", note: "Changed", durationMs: HOUR },
          factories,
        ),
    ],
    [
      "duplicate a locked entry to an open week",
      createState(),
      (s) =>
        duplicateTimesheetEntry(s, "locked", valuesOn("2026-10-14"), factories),
    ],
    [
      "continue a locked entry today, in an open week",
      createState(),
      (s) => continueTimesheetEntry(s, "locked", "2026-10-16", factories),
    ],
    [
      "submit the week",
      createState({ lockedWeeks: [] }),
      (s) => ({ ...s, lockedWeeks: [{ weekOf: LOCKED, lockedAt: 60 }] }),
    ],
    ["reopen the week", createState(), (s) => ({ ...s, lockedWeeks: [] })],
    [
      "rebuild every entry with the same values",
      createState(),
      (s) => ({
        ...s,
        timesheetEntries: s.timesheetEntries.map((entry) => ({
          ...entry,
          workItemId: undefined,
        })),
      }),
    ],
  ];

  it.each(allowed)("lets through: %s", (_name, before, write) => {
    const after = write(before);

    expect(after).not.toBe(before);
    expect(findLockedWeekWrite(before, after)).toBeUndefined();
    expect(() => assertNoLockedWeekWrite(before, after)).not.toThrow();
  });

  it("refuses any other write that adds an entry on a locked day, such as a browser activity commit", () => {
    const before = createState();
    const activity: LocalTimesheetEntry = {
      _id: "activity",
      localDate: "2026-10-10",
      projectId: "p1",
      label: "github.com",
      durationMs: HOUR,
      sourceBlockIds: ["bucket:1"],
      committedAt: 100,
    };

    expect(
      findLockedWeekWrite(before, {
        ...before,
        timesheetEntries: [...before.timesheetEntries, activity],
      }),
    ).toBe(LOCKED);
  });

  it("lets a running entry from Sunday save there after the next week was submitted", () => {
    // 00:30 on Monday, October 12: the running entry started on Sunday the 11th.
    const before = createState({
      lockedWeeks: [{ weekOf: "2026-10-12", lockedAt: 50 }],
      timers: [runningOn("2026-10-11")],
    });

    const stopped = saveTimer(before, "timer-1", factories);
    expect(stopped.timesheetEntries.at(-1)!.localDate).toBe("2026-10-11");
    expect(findLockedWeekWrite(before, stopped)).toBeUndefined();

    // Switch saves Sunday's entry and starts one on Monday, which is locked.
    const switched = startTimer(before, { projectId: "p1" }, "2026-10-12", factories);
    expect(findLockedWeekWrite(before, switched)).toBe("2026-10-12");
  });
});
```

- [ ] **Step 2: Write the failing store test.** In `describe("submitted weeks in the store", ...)` of `apps/web/src/lib/local-store.test.ts`, add before the first `it`:

```ts
  const HOUR = 60 * 60 * 1000;
  const reason = "The week of 2026-10-05 is submitted. Reopen it to change it.";

  /** "API" on Tuesday, October 6, committed; the week is submitted when `locked`. */
  function seedWeek({ locked }: { locked: boolean }) {
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        timesheetEntries: [
          {
            _id: "api",
            localDate: "2026-10-06",
            label: "",
            note: "API",
            durationMs: HOUR,
            sourceBlockIds: [],
            committedAt: 1,
            commit: { at: 1, localDate: "2026-10-06", note: "API", durationMs: HOUR },
          },
        ],
        lockedWeeks: locked ? [{ weekOf: "2026-10-05", lockedAt: 2 }] : [],
      }),
    );
  }
```

and the tests:

```ts
  it("refuses a write to a submitted week and persists nothing", async () => {
    seedWeek({ locked: true });
    const { localStore } = await import("./local-store");
    const before = localStore.snapshot();
    vi.mocked(window.localStorage.setItem).mockClear();

    expect(() =>
      localStore.updateTimesheetEntry("api", { note: "Changed", durationMs: HOUR }),
    ).toThrow(reason);
    expect(() => localStore.deleteTimesheetEntry("api")).toThrow(reason);
    expect(window.localStorage.setItem).not.toHaveBeenCalled();
    expect(localStore.snapshot()).toBe(before);
  });

  it("refuses to start a running entry when today is in a submitted week", async () => {
    seedWeek({ locked: true });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 9));
    try {
      const { localStore } = await import("./local-store");

      expect(() => localStore.startTimer({})).toThrow(reason);
      expect(localStore.snapshot().timers).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 3: Run them**

Run: `cd apps/web && npx vitest run src/domain/time/locked-weeks.test.ts src/lib/local-store.test.ts`
Expected: FAIL. `findLockedWeekWrite`, `assertNoLockedWeekWrite` and `LockedWeekError` are not exported, and the store writes to the submitted week without throwing.

- [ ] **Step 4: Write the check.** Append to `apps/web/src/domain/time/locked-weeks.ts`, and add `import { recordsEqual } from "@/domain/local-state-undo";` to its imports:

```ts
/** A write Ajour refused because it changes a submitted week. */
export class LockedWeekError extends Error {
  readonly weekOf: string;

  constructor(weekOf: string) {
    super(lockedWeekMessage(weekOf));
    this.name = "LockedWeekError";
    this.weekOf = weekOf;
  }
}

/** The part of the state the write check reads. */
export type LockCheckState = Pick<
  LocalAppState,
  "lockedWeeks" | "timesheetEntries" | "timesheetTombstones" | "timers"
>;

/**
 * The submitted week a write changes, or undefined when it changes none. A
 * week counts when it is submitted before and after the write, so Submit,
 * Reopen and their Undo pass. The write changes it when it adds, changes or
 * removes an entry on one of its days (the entry's day before or after the
 * write), a tombstone whose committed day is in it, or a running entry on one
 * of its days. Records compare by value, so a write that rebuilds an equal
 * record passes.
 */
export function findLockedWeekWrite(
  before: LockCheckState,
  after: LockCheckState,
): string | undefined {
  const lockedAfter = new Set(after.lockedWeeks.map((week) => week.weekOf));
  const locked = new Set(
    before.lockedWeeks
      .map((week) => week.weekOf)
      .filter((weekOf) => lockedAfter.has(weekOf)),
  );
  if (locked.size === 0) return undefined;

  const lockedWeekOf = (localDate: string) => {
    if (!isValidLocalDate(localDate)) return undefined;
    const weekOf = getWeekOf(localDate);
    return locked.has(weekOf) ? weekOf : undefined;
  };
  return (
    findChangedDay(
      before.timesheetEntries,
      after.timesheetEntries,
      (entry) => entry._id,
      (entry) => entry.localDate,
      lockedWeekOf,
    ) ??
    findChangedDay(
      before.timesheetTombstones,
      after.timesheetTombstones,
      (tombstone) => tombstone.entryId,
      (tombstone) => tombstone.commit.localDate,
      lockedWeekOf,
    ) ??
    findChangedDay(
      before.timers,
      after.timers,
      (timer) => timer._id,
      (timer) => timer.localDate,
      lockedWeekOf,
    )
  );
}

/** Throws `LockedWeekError` when the write changes a submitted week. */
export function assertNoLockedWeekWrite(
  before: LockCheckState,
  after: LockCheckState,
) {
  const weekOf = findLockedWeekWrite(before, after);
  if (weekOf) throw new LockedWeekError(weekOf);
}

/**
 * The first locked week among the days of the records a write added, changed
 * or removed. A changed record counts its day before and after the write.
 */
function findChangedDay<T>(
  before: readonly T[],
  after: readonly T[],
  keyOf: (record: T) => string,
  dayOf: (record: T) => string,
  lockedWeekOf: (localDate: string) => string | undefined,
): string | undefined {
  if (before === after) return undefined;
  const beforeByKey = new Map(before.map((record) => [keyOf(record), record]));
  const afterKeys = new Set<string>();
  for (const record of after) {
    const key = keyOf(record);
    afterKeys.add(key);
    const previous = beforeByKey.get(key);
    if (previous === record || recordsEqual(previous, record)) continue;
    const weekOf =
      (previous ? lockedWeekOf(dayOf(previous)) : undefined) ??
      lockedWeekOf(dayOf(record));
    if (weekOf) return weekOf;
  }
  for (const record of before) {
    if (afterKeys.has(keyOf(record))) continue;
    const weekOf = lockedWeekOf(dayOf(record));
    if (weekOf) return weekOf;
  }
  return undefined;
}
```

- [ ] **Step 5: Run the check before every write.** In `apps/web/src/lib/local-store.ts`, import `assertNoLockedWeekWrite` with `normalizeLockedWeeks`, and start `writeState` with:

```ts
function writeState(state: LocalAppState) {
  // Every write passes here, so this one check keeps a submitted week as it
  // is, whatever command, Undo or agent tool made the write.
  if (cachedState) assertNoLockedWeekWrite(cachedState, state);
  const nextState = { ...state, updatedAt: Date.now() };
```

Add to the doc comment of `localStore` (above `export const localStore`): "A command that would change a submitted week throws `LockedWeekError` and writes nothing."

- [ ] **Step 6: Run the tests**

Run: `cd apps/web && npx vitest run src/domain/time/locked-weeks.test.ts src/lib/local-store.test.ts`, then `just test` and `just typecheck`.
Expected: PASS. No other test changes: with no submitted week the check returns at once.

- [ ] **Step 7: Docs.** In `agents/architecture.md`, in the list of deep domain modules, after the `timesheet-entry.ts` bullet: "- `domain/time/locked-weeks.ts` owns submitted weeks: the one rule `isDateLocked`, Submit week and Reopen week, and `assertNoLockedWeekWrite`, which `writeState` in `lib/local-store.ts` runs before every write, so no command, Undo or agent tool changes a submitted week. A refused write throws `LockedWeekError`."

- [ ] **Step 8: Commit**

```sh
git add apps/web/src agents/architecture.md
git commit -m "feat(time): refuse every write to a submitted week" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Submit and reopen a week

**Files:**
- Modify: `apps/web/src/domain/time/local-date.ts`, test `local-date.test.ts`
- Modify: `apps/web/src/domain/time/locked-weeks.ts`, test `locked-weeks.test.ts`
- Modify: `apps/web/src/domain/time/week-pace.ts`, test `week-pace.test.ts`
- Modify: `apps/web/src/lib/local-store.ts`, test `local-store.test.ts`

**Interfaces:**
- Consumes: `getWeekOf` (Task 1); `listWeekChanges` from `domain/time/timesheet-commit.ts`; `updateStateWithUndo`, `updateStateWithUndoResult` in the store.
- Produces:
  - `getWeekDates(localDate: string): string[]`, Monday to Sunday
  - `type SubmitWeekRefusal = { kind: "already-submitted"; message: string } | { kind: "uncommitted-changes"; count: number; message: string } | { kind: "running-entry"; message: string }`
  - `type SubmitWeekResult = { ok: true; weekOf: string } | ({ ok: false } & SubmitWeekRefusal)`
  - `getSubmitWeekRefusal(state: Pick<LocalAppState, "lockedWeeks" | "timesheetEntries" | "timesheetTombstones" | "timers">, weekOf: string): SubmitWeekRefusal | undefined`
  - `submitWeek(state: LocalAppState, weekOf: string, now: () => number): { state: LocalAppState; result: SubmitWeekResult }`
  - `reopenWeek(state: LocalAppState, weekOf: string): LocalAppState`
  - `interface WeekPace { loggedHours: number; targetHours: number; expectedHours: number; status: WeekPaceStatus }`, now the return type of `computeWeekPace`
  - `needsPaceConfirmation(status: WeekPaceStatus, warnWhenUnder: boolean): boolean`
  - `localStore.submitWeek(weekOf: string): { undoToken: string | null; result: SubmitWeekResult }`
  - `localStore.reopenWeek(weekOf: string): string | null`

- [ ] **Step 1: Write the failing tests.** In `apps/web/src/domain/time/local-date.test.ts`, import `getWeekDates` too and add:

```ts
describe("getWeekDates", () => {
  it("lists the seven days of the week, Monday first, across a time change", () => {
    expect(getWeekDates("2026-11-01")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });
});
```

In `apps/web/src/domain/time/week-pace.test.ts`, import `needsPaceConfirmation` and add:

```ts
describe("needsPaceConfirmation", () => {
  it.each([
    ["over", true, true],
    ["over", false, true],
    ["under", true, true],
    ["under", false, false],
    ["on-pace", true, false],
  ] as const)(
    "asks for a week %s with the under-target warning %s: %s",
    (status, warn, asks) => {
      expect(needsPaceConfirmation(status, warn)).toBe(asks);
    },
  );
});
```

In `apps/web/src/domain/time/locked-weeks.test.ts`, add `getSubmitWeekRefusal`, `reopenWeek` and `submitWeek` to the `locked-weeks` import, `markTimesheetEntriesCommitted` to the `timesheet-entry` import, and these imports:

```ts
import { captureUndo, restoreUndo } from "@/domain/local-state-undo";
import { getWeekDates } from "@/domain/time/local-date";
import { listWeekChanges } from "@/domain/time/timesheet-commit";
```

Then append:

```ts
describe("submit and reopen", () => {
  const open = () => createState({ lockedWeeks: [] });
  const changesOf = (state: LocalAppState) =>
    listWeekChanges({
      entries: state.timesheetEntries,
      tombstones: state.timesheetTombstones,
      weekDates: getWeekDates(LOCKED),
    });

  it("locks the week of any of its days, once every change is committed", () => {
    const { state, result } = submitWeek(open(), "2026-10-11", () => 70);

    expect(result).toEqual({ ok: true, weekOf: LOCKED });
    expect(state.lockedWeeks).toEqual([{ weekOf: LOCKED, lockedAt: 70 }]);
    expect(isDateLocked(state, "2026-10-06")).toBe(true);
  });

  it("refuses while a change is not committed, and says how many", () => {
    const added = saveManualTimesheetEntry(
      open(),
      { localDate: "2026-10-07", projectId: "p1", durationMs: HOUR },
      factories,
    );

    expect(submitWeek(added, LOCKED, () => 70)).toEqual({
      state: added,
      result: {
        ok: false,
        kind: "uncommitted-changes",
        count: 1,
        message:
          "Commit your changes first. The week of 2026-10-05 has 1 change that is not committed.",
      },
    });
    expect(
      getSubmitWeekRefusal(deleteTimesheetEntry(added, "locked"), LOCKED)
        ?.message,
    ).toBe(
      "Commit your changes first. The week of 2026-10-05 has 2 changes that are not committed.",
    );
  });

  it("refuses while the running entry is in the week, even after midnight", () => {
    const running = createState({
      lockedWeeks: [],
      timers: [runningOn("2026-10-11")],
    });

    expect(getSubmitWeekRefusal(running, LOCKED)).toEqual({
      kind: "running-entry",
      message:
        "Stop the running entry first. It is on 2026-10-11, in the week of 2026-10-05.",
    });
    expect(submitWeek(running, "2026-10-12", () => 70).result).toEqual({
      ok: true,
      weekOf: "2026-10-12",
    });
  });

  it("refuses a week already submitted", () => {
    expect(getSubmitWeekRefusal(createState(), "2026-10-07")).toEqual({
      kind: "already-submitted",
      message: "The week of 2026-10-05 is already submitted.",
    });
  });

  it("reopens a week, and a later edit shows as a change again", () => {
    const reopened = reopenWeek(createState(), "2026-10-09");
    expect(reopened.lockedWeeks).toEqual([]);
    expect(changesOf(reopened)).toEqual([]);

    const edited = updateTimesheetEntry(
      reopened,
      "locked",
      { projectId: "p1", taskId: "t1", note: "locked", durationMs: 2 * HOUR },
      factories,
    );

    expect(findLockedWeekWrite(reopened, edited)).toBeUndefined();
    expect(changesOf(edited)).toMatchObject([
      { kind: "updated", entryId: "locked", changedFields: ["durationMs"] },
    ]);
  });

  it("leaves the state alone when the week is not submitted", () => {
    const state = open();
    expect(reopenWeek(state, LOCKED)).toBe(state);
  });

  it("undoes a submit back to the open week, copies and tombstones as they were", () => {
    const tombstone = {
      entryId: "gone",
      commit: {
        at: 5,
        localDate: "2026-10-14",
        projectId: "p1",
        taskId: "t1",
        durationMs: HOUR,
      },
    };
    const before = createState({
      lockedWeeks: [],
      timesheetTombstones: [tombstone],
    });
    const after = submitWeek(before, LOCKED, () => 70).state;

    const undo = captureUndo(before, after)!;
    const restored = restoreUndo(after, undo);

    expect(undo.lockedWeeks).toHaveLength(1);
    expect(restored.result).toBe("restored");
    expect(restored.state.lockedWeeks).toEqual([]);
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
    expect(restored.state.timesheetTombstones).toEqual([tombstone]);
  });

  it("refuses the Undo of a commit once the week is submitted", () => {
    const added = saveManualTimesheetEntry(
      open(),
      { localDate: "2026-10-07", projectId: "p1", durationMs: HOUR },
      factories,
    );
    const committed = markTimesheetEntriesCommitted(
      added,
      ["timesheet-new"],
      () => 60,
    );
    const commitUndo = captureUndo(added, committed)!;
    // Another window submitted the week since the commit.
    const submitted = submitWeek(committed, LOCKED, () => 70).state;

    const restored = restoreUndo(submitted, commitUndo);

    expect(restored.result).toBe("restored");
    expect(findLockedWeekWrite(submitted, restored.state)).toBe(LOCKED);
  });
});
```

In the store's `describe("submitted weeks in the store", ...)`:

```ts
  it("submits a committed week with Undo, and reopens it with Undo", async () => {
    seedWeek({ locked: false });
    const { localStore } = await import("./local-store");

    const { undoToken, result } = localStore.submitWeek("2026-10-08");
    expect(result).toEqual({ ok: true, weekOf: "2026-10-05" });
    expect(localStore.snapshot().lockedWeeks).toMatchObject([
      { weekOf: "2026-10-05" },
    ]);
    expect(localStore.undo(undoToken!)).toBe("restored");
    expect(localStore.snapshot().lockedWeeks).toEqual([]);

    localStore.submitWeek("2026-10-05");
    const reopenToken = localStore.reopenWeek("2026-10-05");
    expect(localStore.snapshot().lockedWeeks).toEqual([]);
    expect(localStore.undo(reopenToken!)).toBe("restored");
    expect(localStore.snapshot().lockedWeeks).toMatchObject([
      { weekOf: "2026-10-05" },
    ]);
  });

  it("returns the refusal with no undo token", async () => {
    seedWeek({ locked: true });
    const { localStore } = await import("./local-store");

    expect(localStore.submitWeek("2026-10-05")).toEqual({
      undoToken: null,
      result: {
        ok: false,
        kind: "already-submitted",
        message: "The week of 2026-10-05 is already submitted.",
      },
    });
    expect(localStore.reopenWeek("2026-10-12")).toBeNull();
  });
```

- [ ] **Step 2: Run them**

Run: `cd apps/web && npx vitest run src/domain/time/local-date.test.ts src/domain/time/week-pace.test.ts src/domain/time/locked-weeks.test.ts src/lib/local-store.test.ts`
Expected: FAIL. `getWeekDates`, `needsPaceConfirmation`, `submitWeek`, `reopenWeek`, `getSubmitWeekRefusal` and the store commands do not exist.

- [ ] **Step 3: Add `getWeekDates`** to `apps/web/src/domain/time/local-date.ts`:

```ts
/** The seven days of the week that holds `localDate`, Monday first. */
export function getWeekDates(localDate: string): string[] {
  const monday = new Date(`${getWeekOf(localDate)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}
```

- [ ] **Step 4: Add the pace decision** to `apps/web/src/domain/time/week-pace.ts`. Add the interface and use it as the return type of `computeWeekPace` (replace its inline return type):

```ts
/** The week's pace, in decimal hours. */
export interface WeekPace {
  loggedHours: number;
  targetHours: number;
  expectedHours: number;
  status: WeekPaceStatus;
}
```

and append:

```ts
/**
 * Whether Submit week asks before it locks the week. A week over its pace
 * always asks. A week under it asks while the under-target warning is on.
 */
export function needsPaceConfirmation(
  status: WeekPaceStatus,
  warnWhenUnder: boolean,
) {
  return status === "over" || (status === "under" && warnWhenUnder);
}
```

Update the module comment's second sentence to: "Submit week and the agent tasks ask the user before submitting a week that is not on pace, so the arithmetic lives here, in tested code, not in a prompt."

- [ ] **Step 5: Add Submit and Reopen** to `apps/web/src/domain/time/locked-weeks.ts`. Import `getWeekDates` with `getWeekOf`, and `listWeekChanges` from `@/domain/time/timesheet-commit`. Append:

```ts
/** Why a week cannot be submitted now. `message` is the agents' refusal; the Commit page words each kind its own way. */
export type SubmitWeekRefusal =
  | { kind: "already-submitted"; message: string }
  | { kind: "uncommitted-changes"; count: number; message: string }
  | { kind: "running-entry"; message: string };

export type SubmitWeekResult =
  | { ok: true; weekOf: string }
  | ({ ok: false } & SubmitWeekRefusal);

/**
 * Why the week that holds `weekOf` cannot be submitted, or undefined when it
 * can: it is already submitted, a change is not committed, or the running
 * entry is on one of its days, in that order.
 */
export function getSubmitWeekRefusal(
  state: Pick<
    LocalAppState,
    "lockedWeeks" | "timesheetEntries" | "timesheetTombstones" | "timers"
  >,
  weekOf: string,
): SubmitWeekRefusal | undefined {
  const monday = getWeekOf(weekOf);
  if (state.lockedWeeks.some((week) => week.weekOf === monday)) {
    return {
      kind: "already-submitted",
      message: `The week of ${monday} is already submitted.`,
    };
  }

  const weekDates = getWeekDates(monday);
  const count = listWeekChanges({
    entries: state.timesheetEntries,
    tombstones: state.timesheetTombstones,
    weekDates,
  }).length;
  if (count > 0) {
    const changes =
      count === 1 ? "1 change that is" : `${count} changes that are`;
    return {
      kind: "uncommitted-changes",
      count,
      message: `Commit your changes first. The week of ${monday} has ${changes} not committed.`,
    };
  }

  const running = state.timers.find((timer) =>
    weekDates.includes(timer.localDate),
  );
  if (running) {
    return {
      kind: "running-entry",
      message: `Stop the running entry first. It is on ${running.localDate}, in the week of ${monday}.`,
    };
  }
  return undefined;
}

/**
 * Submits the week that holds `weekOf`: locks it. A week only locks with
 * every change committed, so it has no tombstone left to drop. Returns the
 * same state with the refusal when it cannot.
 */
export function submitWeek(
  state: LocalAppState,
  weekOf: string,
  now: () => number,
): { state: LocalAppState; result: SubmitWeekResult } {
  const refusal = getSubmitWeekRefusal(state, weekOf);
  if (refusal) return { state, result: { ok: false, ...refusal } };

  const monday = getWeekOf(weekOf);
  return {
    state: {
      ...state,
      lockedWeeks: [
        ...state.lockedWeeks,
        { weekOf: monday, lockedAt: now() },
      ].sort((left, right) => left.weekOf.localeCompare(right.weekOf)),
    },
    result: { ok: true, weekOf: monday },
  };
}

/**
 * Reopens the week that holds `weekOf`. Its entries keep their committed
 * copies, so later edits show as changes again. Returns the same state when
 * the week is not submitted.
 */
export function reopenWeek(state: LocalAppState, weekOf: string): LocalAppState {
  const monday = getWeekOf(weekOf);
  const lockedWeeks = state.lockedWeeks.filter(
    (week) => week.weekOf !== monday,
  );
  return lockedWeeks.length === state.lockedWeeks.length
    ? state
    : { ...state, lockedWeeks };
}
```

- [ ] **Step 6: Add the store commands.** In `apps/web/src/lib/local-store.ts`, import `reopenWeek as applyReopenWeek` and `submitWeek as applySubmitWeek` from `@/domain/time/locked-weeks`, and add after `markTimesheetEntriesNotCommitted`:

```ts
  /**
   * Submits the week that holds `weekOf`: locks it. See `submitWeek`. Returns
   * the result with an undo token, null when Ajour refused.
   */
  submitWeek(weekOf: string) {
    return updateStateWithUndoResult((state) =>
      applySubmitWeek(state, weekOf, Date.now),
    );
  },
  /** Reopens a submitted week. Returns an undo token, or null when it was not submitted. */
  reopenWeek(weekOf: string) {
    return updateStateWithUndo((state) => applyReopenWeek(state, weekOf));
  },
```

- [ ] **Step 7: Run the tests**

Run: `cd apps/web && npx vitest run src/domain/time src/lib/local-store.test.ts src/domain/local-state-undo.test.ts`, then `just typecheck`.
Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add apps/web/src
git commit -m "feat(time): submit and reopen a week" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Show refusals, and the disabled reason wrapper

**Files:**
- Create: `apps/web/src/features/feedback/locked-week-toast.ts`, `apps/web/src/features/feedback/locked-week-toast.test.ts`
- Modify: `apps/web/src/main.tsx`
- Create: `apps/web/src/components/disabled-reason.tsx`
- Modify: `apps/web/src/features/agents/agent-task-buttons.tsx` (the tooltip wrapper, lines 98-121)
- Docs: `agents/ui-registry.md` (Foundation list)

**Interfaces:**
- Consumes: `LockedWeekError` (Task 2); `showToast` from `components/ui/toast.tsx`; `Tooltip`, `TooltipTrigger`, `TooltipContent` from `components/ui/tooltip.tsx`.
- Produces:
  - `installLockedWeekToast(target?: Pick<EventTarget, "addEventListener">): void`
  - `DisabledReason({ label, reason, className, children }: { label: string; reason?: string; className?: string; children: ReactNode })`

- [ ] **Step 1: Write the failing test** in `apps/web/src/features/feedback/locked-week-toast.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LockedWeekError } from "@/domain/time/locked-weeks";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ showToast }));

import { installLockedWeekToast } from "@/features/feedback/locked-week-toast";

function errorEvent(type: "error" | "unhandledrejection", value: unknown) {
  const key = type === "error" ? "error" : "reason";
  return Object.assign(new Event(type, { cancelable: true }), { [key]: value });
}

describe("installLockedWeekToast", () => {
  beforeEach(() => showToast.mockClear());

  it("shows a refused write as a toast and stops the error there", () => {
    const target = new EventTarget();
    installLockedWeekToast(target);
    const event = errorEvent("error", new LockedWeekError("2026-10-05"));

    target.dispatchEvent(event);

    expect(showToast).toHaveBeenCalledWith(
      "The week of 2026-10-05 is submitted. Reopen it to change it.",
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows a refusal from an async handler too", () => {
    const target = new EventTarget();
    installLockedWeekToast(target);

    target.dispatchEvent(
      errorEvent("unhandledrejection", new LockedWeekError("2026-10-12")),
    );

    expect(showToast).toHaveBeenCalledWith(
      "The week of 2026-10-12 is submitted. Reopen it to change it.",
    );
  });

  it("leaves every other error alone", () => {
    const target = new EventTarget();
    installLockedWeekToast(target);
    const event = errorEvent("error", new Error("Boom"));

    target.dispatchEvent(event);

    expect(showToast).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd apps/web && npx vitest run src/features/feedback/locked-week-toast.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `apps/web/src/features/feedback/locked-week-toast.ts`**

```ts
import { showToast } from "@/components/ui/toast";
import { LockedWeekError } from "@/domain/time/locked-weeks";

/**
 * Shows Ajour's refusal of a write to a submitted week as a toast. Every local
 * store write runs the lock check and throws `LockedWeekError`, and React
 * reports an error thrown in an event handler to the window. So this one
 * listener covers every write path without a disabled state of its own:
 * Cmd+V, Start and Stop, Continue, the command palette, Undo and imports.
 * Other errors pass through untouched.
 */
export function installLockedWeekToast(
  target: Pick<EventTarget, "addEventListener"> = window,
) {
  const show = (event: Event, error: unknown) => {
    if (!(error instanceof LockedWeekError)) return;
    event.preventDefault();
    showToast(error.message);
  };
  target.addEventListener("error", (event) =>
    show(event, (event as ErrorEvent).error),
  );
  target.addEventListener("unhandledrejection", (event) =>
    show(event, (event as PromiseRejectionEvent).reason),
  );
}
```

- [ ] **Step 4: Install it.** In `apps/web/src/main.tsx`, import `installLockedWeekToast` from `@/features/feedback/locked-week-toast` and call `installLockedWeekToast();` on the line before `ReactDOM.createRoot(...)`.

- [ ] **Step 5: Run the test**

Run: `cd apps/web && npx vitest run src/features/feedback/locked-week-toast.test.ts`
Expected: PASS.

- [ ] **Step 6: Write `apps/web/src/components/disabled-reason.tsx`**

```tsx
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Says why a control is disabled. A disabled button gets no pointer events and
 * no focus, so this wrapper carries the tooltip, takes focus, and names the
 * control with its reason, as "Submit week: Commit your changes first". The
 * caller disables the child. Without a reason it renders the child alone.
 */
export function DisabledReason({
  label,
  reason,
  className,
  children,
}: {
  label: string;
  reason?: string;
  /** Classes for the wrapper, such as a width the child needs. */
  className?: string;
  children: ReactNode;
}) {
  if (!reason) return children;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={`${label}: ${reason}`}
            className={className}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 7: Use it in `AgentTaskButtons`.** In `apps/web/src/features/agents/agent-task-buttons.tsx`, drop the `Tooltip` imports, import `DisabledReason`, and replace the `{reason ? (<Tooltip>...</Tooltip>) : (button)}` block inside the `div.contents` with:

```tsx
            <DisabledReason label={task.label} reason={reason}>
              {button}
            </DisabledReason>
```

- [ ] **Step 8: Check the existing behavior**

Create the temporary acceptance config if it is not there yet, and never commit it:

```sh
cd apps/web
sed -e 's/const acceptancePort = 4173;/const acceptancePort = 4187;/' \
  -e 's#command: "just acceptance-server",#command: "corepack pnpm dev --host 127.0.0.1 --port 4187 --strictPort --mode test",#' \
  -e 's#reuseExistingServer: !process.env.CI,#reuseExistingServer: false,#' \
  playwright.config.ts > playwright.local.config.ts
npx bddgen && npx playwright test --config playwright.local.config.ts --grep "The button says what is missing"
```

Run: `just typecheck`, `just test`, then the command above.
Expected: PASS. "Enter in Workday" is still disabled with its reason.

- [ ] **Step 9: Docs.** In `agents/ui-registry.md`, Foundation list, after the `TooltipButton` rule's pattern (or at the end of Foundation): "- **Disabled reason.** `components/disabled-reason.tsx` wraps a disabled control in a focusable span with a tooltip and the accessible name `<label>: <reason>`. Agent task buttons, Submit week and the controls of a submitted week use it."

- [ ] **Step 10: Commit**

```sh
git add apps/web/src agents/ui-registry.md
git commit -m "feat(time): show refused writes to a submitted week as a toast" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Submit week and Reopen week on the Commit page

**Files:**
- Create: `apps/web/src/features/time/week-lock.tsx`
- Modify: `apps/web/src/features/time/commit-page.tsx`
- Modify: `apps/web/src/features/settings/settings-general-page.tsx` (lines 365-404)
- Create: `apps/web/tests/acceptance/features/submit-week.feature`, `apps/web/tests/acceptance/steps/submit-week.steps.ts`
- Docs: `apps/docs/time/commit.md`, `apps/docs/app/settings.md`, `agents/ui-registry.md` (Commit Page section)

**Interfaces:**
- Consumes: `getLockedWeek`, `getSubmitWeekRefusal`, `SubmitWeekRefusal` (Tasks 1 and 3); `computeWeekPace`, `getPaceTolerancePercent`, `needsPaceConfirmation`, `WeekPace` (Task 3); `localStore.submitWeek`, `localStore.reopenWeek` (Task 3); `DisabledReason` (Task 4); `offerUndo`; acceptance steps `I have a committed week of entries`, `I open the Commit page for the week of {word}`, `I press {string}`, `a toast says {string}`, `I undo with the toast button`, `I change Monday's {string} entry to {string} hours`, `{string} is disabled with the reason {string}`.
- Produces:
  - `WeekLockChip()`: a `Chip` with a lock icon and "Submitted"
  - `getSubmitButtonReason(refusal: SubmitWeekRefusal | undefined): string | undefined`, exported from `commit-page.tsx`
  - Acceptance steps `the pace check says {string}`, `the Commit page shows the week is submitted`, `the Commit page shows the week is not submitted`

- [ ] **Step 1: Write the failing acceptance test.** Create `apps/web/tests/acceptance/features/submit-week.feature`:

```gherkin
Feature: Submit the week
  Submit week locks a committed week, so its entries stay as they went to the
  timesheet tool. Reopen week unlocks it.

  Scenario: Submit a committed week under pace, then undo it
    Given I have a committed week of entries
    When I open the Commit page for the week of 2026-10-05
    And I press "Submit week"
    Then the pace check says "You logged 4:00 of the 40:00 expected by now."
    When I press "Submit anyway"
    Then a toast says "Week submitted"
    And the Commit page shows the week is submitted
    When I undo with the toast button
    Then the Commit page shows the week is not submitted

  Scenario: Submit week waits until every change is committed
    Given I have a committed week of entries
    When I change Monday's "API" entry to "2:30" hours
    And I open the Commit page for the week of 2026-10-05
    Then "Submit week" is disabled with the reason "Commit your changes first"
    When I press "Mark as committed"
    And I press "Submit week"
    And I press "Submit anyway"
    Then the Commit page shows the week is submitted
    When I press "Reopen week"
    Then a toast says "Week reopened"
    And the Commit page shows the week is not submitted
```

Create `apps/web/tests/acceptance/steps/submit-week.steps.ts`:

```ts
import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Then } = createBdd();

function weekSummary(page: Page) {
  return page.getByRole("region", { name: "Week summary" });
}

Then("the pace check says {string}", async ({ page }, text: string) => {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(text);
});

Then("the Commit page shows the week is submitted", async ({ page }) => {
  await expect(
    weekSummary(page).getByText("Submitted", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reopen week", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit week", exact: true }),
  ).toHaveCount(0);
});

Then("the Commit page shows the week is not submitted", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Submit week", exact: true }),
  ).toBeVisible();
  await expect(
    weekSummary(page).getByText("Submitted", { exact: true }),
  ).toHaveCount(0);
});
```

The step texts are new: `rg -n "pace check|shows the week is" apps/web/tests/acceptance/steps` prints only this file.

- [ ] **Step 2: Run it**

Create `apps/web/playwright.local.config.ts` as in Task 4, Step 8, if it is not there.

Run: `cd apps/web && npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Submit the week"`
Expected: FAIL. The Commit page has no "Submit week" button.

- [ ] **Step 3: Write `apps/web/src/features/time/week-lock.tsx`**

```tsx
import { RiLockLine as Lock } from "@remixicon/react";
import { Chip } from "@/components/ui/chip";

/** The lock of a submitted week, on the Commit page, the Week view and the entry editor. */
export function WeekLockChip() {
  return (
    <Chip>
      <Lock aria-hidden />
      Submitted
    </Chip>
  );
}
```

- [ ] **Step 4: Build the Commit page's submit.** In `apps/web/src/features/time/commit-page.tsx`:
  - Imports to add: `RiLockLine as Lock` and `RiLockUnlockLine as Unlock` from `@remixicon/react`; `DisabledReason` from `@/components/disabled-reason`; `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogTitle` from `@/components/ui/alert-dialog`; `showToast` from `@/components/ui/toast`; `getLockedWeek`, `getSubmitWeekRefusal`, `type SubmitWeekRefusal` from `@/domain/time/locked-weeks`; `computeWeekPace`, `getPaceTolerancePercent`, `needsPaceConfirmation`, `type WeekPace` from `@/domain/time/week-pace`; `WeekLockChip` from `@/features/time/week-lock`; `todayIsoDate` with `cn` and `getIsoWeekDates` from `@/lib/utils`.
  - Module-level helpers, after `formatMonthDay`:

```tsx
const HOUR = 3_600_000;

/** Decimal hours as clock time, such as 4:00. */
function formatHours(hours: number) {
  return formatClockDuration(hours * HOUR);
}

/** The day a week was submitted, such as "Oct 16". */
function formatLockedDay(lockedAt: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(lockedAt));
}

/**
 * Why Submit week, or a plugin's submit task, is disabled: the short copy for
 * each refusal. A submitted week shows Reopen week instead.
 */
export function getSubmitButtonReason(
  refusal: SubmitWeekRefusal | undefined,
): string | undefined {
  if (refusal?.kind === "uncommitted-changes") return "Commit your changes first";
  if (refusal?.kind === "running-entry") return "Stop the running entry first";
  return undefined;
}
```

  - The component doc comment gains: "Submit week checks the pace, then locks the week; a submitted week shows its lock and Reopen week instead."
  - In `CommitPage`, after `const summary = useMemo(...)`:

```tsx
  const lockedWeek = getLockedWeek(state, weekOf);
  const submitReason = lockedWeek
    ? undefined
    : getSubmitButtonReason(getSubmitWeekRefusal(state, weekOf));
  // The pace the confirmation shows, or null while it is closed.
  const [paceCheck, setPaceCheck] = useState<WeekPace | null>(null);

  function lockWeek() {
    setPaceCheck(null);
    const { undoToken, result } = localStore.submitWeek(weekOf);
    if (!result.ok) {
      showToast(result.message);
      return;
    }
    offerUndo(undoToken, { title: "Week submitted", subject: "week" });
  }

  /** Submit week: asks first when the week is off pace, then locks it. */
  function requestSubmit() {
    const pace = computeWeekPace({
      weekDates,
      today: todayIsoDate(),
      capacityTargets: state.userPreferences.weeklyCapacityTargets,
      loggedMs: summary.totalMs,
      tolerancePercent: getPaceTolerancePercent(state.userPreferences),
    });
    if (
      needsPaceConfirmation(
        pace.status,
        state.userPreferences.warnWhenSubmittingUnderCapacity,
      )
    ) {
      setPaceCheck(pace);
      return;
    }
    lockWeek();
  }

  function reopen() {
    offerUndo(localStore.reopenWeek(weekOf), {
      title: "Week reopened",
      subject: "week",
    });
  }
```

  - In the "Week summary" section, before `<AgentTaskWeekLinks weekOf={weekOf} />`:

```tsx
        {lockedWeek ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <WeekLockChip />
            Submitted {formatLockedDay(lockedWeek.lockedAt)}. Its entries are
            read-only until you reopen the week.
          </p>
        ) : null}
```

  - Replace the children of the `role="group" aria-label="Commit actions"` div with:

```tsx
        {lockedWeek ? (
          <Button variant="outline" onClick={reopen}>
            <Unlock data-icon="inline-start" />
            Reopen week
          </Button>
        ) : (
          <>
            <AgentTaskButtons weekOf={weekOf} />
            {changes.length > 0 ? (
              <Button
                disabled={checkedIds.length === 0}
                onClick={markCommitted}
              >
                Mark as committed
              </Button>
            ) : null}
            <DisabledReason label="Submit week" reason={submitReason}>
              <Button
                // The next step is the primary button: Mark as committed while
                // changes wait, Submit week after.
                variant={changes.length > 0 ? "outline" : "default"}
                disabled={submitReason !== undefined}
                onClick={requestSubmit}
              >
                <Lock data-icon="inline-start" />
                Submit week
              </Button>
            </DisabledReason>
          </>
        )}
```

  - At the end of the page's root `div`, after the Lines section:

```tsx
      <AlertDialog
        open={paceCheck !== null}
        onOpenChange={(open) => {
          if (!open) setPaceCheck(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {paceCheck?.status === "over"
                ? "Submit a week over pace?"
                : "Submit a week under pace?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {paceCheck
                ? `You logged ${formatHours(paceCheck.loggedHours)} of the ${formatHours(paceCheck.expectedHours)} expected by now.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Review</AlertDialogCancel>
            <AlertDialogAction onClick={lockWeek}>Submit anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 5: The pace settings say what they do now.** In `apps/web/src/features/settings/settings-general-page.tsx`:
  - "Under-target submit warning" description: "Ask before Submit week locks a week that is behind its targets."
  - "Agent pace tolerance" becomes label "Pace tolerance", description: "How far, in percent, the week may run ahead of or behind its targets before Submit week or an agent asks you. Going over the week's target always asks."

- [ ] **Step 6: Run the tests**

Run: `just typecheck`, `just test`, then `cd apps/web && npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Submit the week|Commit the week"`.
Expected: PASS, the two new scenarios and the slice 1 Commit scenarios.

- [ ] **Step 7: Check it in a browser.** `cd apps/web && corepack pnpm dev --host 127.0.0.1 --port 4188 --strictPort`, open `/time/<a past Monday>/commit` with a committed week: Submit week sits after Mark as committed, the pace dialog fits a 390px window, and the summary line wraps without covering the links.

- [ ] **Step 8: Docs.**
  - `apps/docs/time/commit.md`: in the intro, after "remembers what you committed.", add "When the whole week is in your timesheet tool, you submit it, and Ajour keeps it as it is." After "## Mark as not committed" and before "## Copy the lines", add:

```md
## Submit the week

When every change is committed, press **Submit week**. When the week is behind its targets, or over them, Ajour asks first, such as **Submit a week under pace?** with **Review** and **Submit anyway**. **Pace tolerance** in [Settings](/app/settings) sets how far off the week may be, and turning off **Under-target submit warning** skips the question for a week behind its targets. A toast offers **Undo**.

**Submit week** is greyed out with **Commit your changes first** while a change is not committed, and with **Stop the running entry first** while an entry runs in the week.

A submitted week shows **Submitted** with a lock on its Commit page and in the Week view. Its entries stay as they are: you cannot add, edit, move, delete or paste entries on its days, and no entry can start on them. Greyed-out actions say why, such as `The week of 2026-10-05 is submitted. Reopen it to change it.` Agents get the same answer.

## Reopen a week

Press **Reopen week** on the week's Commit page. A toast offers **Undo**. The entries can change again, and each change shows on the Commit page as usual.
```

  - `apps/docs/app/settings.md`: the **Under-target submit warning** row reads "Asks before **Submit week** locks a week behind its targets. On by default." Add a row after it: `| **Pace tolerance** | How far, in percent, a week may be ahead of or behind its targets before **Submit week** or an agent asks you. 20 by default. |` (keep the table aligned; `just format` aligns it).
  - `agents/ui-registry.md`, Commit Page section, after the "Mark as committed" sentence: "Submit week follows in the same row, primary once no change waits, disabled through `DisabledReason` with "Commit your changes first" or "Stop the running entry first". It asks through an `AlertDialog` when `needsPaceConfirmation` says so ("Submit a week under pace?", Review and Submit anyway), then locks the week with the Undo toast "Week submitted". A submitted week shows `WeekLockChip` (`features/time/week-lock.tsx`) and "Submitted Oct 16." in the summary, and Reopen week, with the Undo toast "Week reopened", replaces the row." Add `apps/web/src/features/time/week-lock.tsx` to the section's Files line.

- [ ] **Step 9: Commit**

```sh
git add apps/web/src apps/web/tests apps/docs agents/ui-registry.md
git status --short apps/web/playwright.local.config.ts   # must show it untracked, never staged
git commit -m "feat(time): submit and reopen the week from the Commit page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Read-only entries in the action sets and the editor

**Files:**
- Modify: `apps/web/src/domain/actions/object-actions.ts`, test `object-actions.test.ts`
- Modify: `apps/web/src/features/time/time-entry-actions.tsx`
- Modify: `apps/web/src/features/time/use-entry-selection.ts` (lines 178-186, `selectionActions`)
- Modify: `apps/web/src/features/time/time-entry-editor.ts`, test `time-entry-editor.test.ts`
- Modify: `apps/web/src/features/time/time-entry-editor-form.tsx`
- Modify: `apps/web/src/features/agents/agent-write-tools.ts` (`entryActions`)

**Interfaces:**
- Consumes: `getDateLockReason`, `isDateLocked` (Task 1); `WeekLockChip` (Task 5).
- Produces:
  - `TimeEntryActionOptions.lockedReason?: string`
  - `getTimeEntrySelectionActions({ saved, committed, lockedReason }: { saved: number; committed: number; lockedReason?: string })`
  - `evaluateTimeEntryEditor(fields, { ..., lockReasonFor?: (localDate: string) => string | undefined })`

- [ ] **Step 1: Write the failing action tests.** In `apps/web/src/domain/actions/object-actions.test.ts`, inside `describe("time entry actions", ...)`:

```ts
  it("disables what would change an entry of a submitted week, with the reason", () => {
    const reason = "The week of 2026-10-05 is submitted. Reopen it to change it.";

    expect(
      getTimeEntryActions("committed", { lockedReason: reason }).map(
        (action) => [action.id, action.disabledReason],
      ),
    ).toEqual([
      ["edit", undefined],
      ["continue", undefined],
      ["duplicate", reason],
      ["duplicate-to", undefined],
      ["move-to", reason],
      ["mark-not-committed", reason],
      ["delete", reason],
    ]);
  });
```

Inside `describe("time entry selection actions", ...)`:

```ts
  it("disables the selection's actions on a submitted week, except Duplicate to…", () => {
    const reason = "The week of 2026-10-05 is submitted. Reopen it to change it.";

    expect(
      getTimeEntrySelectionActions({
        saved: 2,
        committed: 2,
        lockedReason: reason,
      }).map((action) => [action.id, action.disabledReason]),
    ).toEqual([
      ["duplicate", reason],
      ["duplicate-to", undefined],
      ["move-to", reason],
      ["mark-not-committed", reason],
      ["delete", reason],
    ]);
  });
```

- [ ] **Step 2: Write the failing editor tests.** In `apps/web/src/features/time/time-entry-editor.test.ts`, inside the `describe`:

```ts
  const reason = "The week of 2026-10-05 is submitted. Reopen it to change it.";
  const lockReasonFor = (localDate: string) =>
    localDate >= "2026-10-05" && localDate <= "2026-10-11" ? reason : undefined;

  it("blocks a new entry on a day of a submitted week, with the reason under Date", () => {
    const editor = evaluateTimeEntryEditor(
      { ...createTimeEntryEditorFields(DAY), durationHours: "1:00" },
      { allowEmptyDuration: true, lockReasonFor },
    );

    expect(editor.dateError).toBe(reason);
    expect(editor.canSave).toBe(false);
    expect(commitTimeEntryDraft(editor, "save")).toEqual({
      kind: "invalid",
      error: reason,
    });
  });

  it("refuses to move an entry into a submitted week", () => {
    const original = { localDate: "2026-10-13", durationMs: 3_600_000 };
    const editor = evaluateTimeEntryEditor(
      { ...createTimeEntryEditorFields("2026-10-13", original), localDate: DAY },
      { original, lockReasonFor },
    );

    expect(editor.canSave).toBe(false);
    expect(editor.dateError).toBe(reason);
  });

  it("leaves an untouched entry of a submitted week alone when switching", () => {
    const original = { localDate: DAY, durationMs: 3_600_000 };
    const editor = evaluateTimeEntryEditor(
      createTimeEntryEditorFields(DAY, original),
      { original, lockReasonFor },
    );

    expect(commitTimeEntryDraft(editor, "switch")).toEqual({
      kind: "unchanged",
    });
  });
```

- [ ] **Step 3: Run them**

Run: `cd apps/web && npx vitest run src/domain/actions/object-actions.test.ts src/features/time/time-entry-editor.test.ts`
Expected: FAIL. The actions ignore `lockedReason`, and `dateError` is null.

- [ ] **Step 4: Add `lockedReason` to the action sets.** In `apps/web/src/domain/actions/object-actions.ts`:
  - `TimeEntryActionOptions` gains:

```ts
  /**
   * Set when the entry's week is submitted. Edit still opens it, read-only,
   * Continue starts a new entry today, and Duplicate to… copies it to an open
   * week; the rest are disabled with this reason.
   */
  lockedReason?: string;
```

  - In `getTimeEntryActions`: Duplicate and Move to… use `disabledReason: options.lockedReason ?? relocationReason`; Mark as not committed gets `disabledReason: options.lockedReason`; Delete gets `disabledReason: options.lockedReason`. Edit, Continue, Stop, Duplicate to… and Discard keep theirs. The doc comment gains: "On a submitted week, the actions that would change the entry are disabled with `lockedReason`."
  - `getTimeEntrySelectionActions` takes `lockedReason?: string` ("set when the selection is on a submitted week"): Duplicate, Move to… and Delete use `reason ?? lockedReason`, Mark as not committed uses `lockedReason`, Duplicate to… keeps `reason`.

- [ ] **Step 5: Show the reason under Date.** In `apps/web/src/features/time/time-entry-editor.ts`, the options of `evaluateTimeEntryEditor` gain:

```ts
    /**
     * Why entries on a day cannot change, from `getDateLockReason`. A draft on
     * such a day shows it under Date and cannot be saved.
     */
    lockReasonFor?: (localDate: string) => string | undefined;
```

and `dateError` becomes:

```ts
  const dateError = !isValidLocalDate(fields.localDate)
    ? "Enter a date"
    : (options.lockReasonFor?.(fields.localDate) ?? null);
```

The function's doc comment gains: "`lockReasonFor` blocks a draft on a day of a submitted week."

- [ ] **Step 6: Run the tests**

Run: `cd apps/web && npx vitest run src/domain/actions/object-actions.test.ts src/features/time/time-entry-editor.test.ts`
Expected: PASS.

- [ ] **Step 7: Every action surface reads the lock.**
  - `apps/web/src/features/time/time-entry-actions.tsx`: import `useLocalState` from `@/lib/local-hooks` and `getDateLockReason`, `isDateLocked` from `@/domain/time/locked-weeks`. In `useTimeEntryActions`, add `const state = useLocalState();` and make `getActions`:

```tsx
  function getActions(
    target: TimeEntryActionTarget,
    options: TimeEntryActionOptions = {},
  ): ObjectAction<TimeEntryActionId>[] {
    return getTimeEntryActions(
      getTimeEntryActionState({
        isRunning: target.kind === "running",
        isCommitted:
          target.kind === "entry" && isTimesheetEntryCommitted(target.entry),
      }),
      {
        ...options,
        lockedReason:
          options.lockedReason ??
          (target.kind === "entry"
            ? getDateLockReason(state, target.entry.localDate)
            : undefined),
      },
    );
  }
```

    In the date dialog, the `Calendar` gets `disabled={(date: Date) => isDateLocked(state, formatIsoDate(date))}`, and the confirm `Button` gets `disabled={isDateLocked(state, formatIsoDate(selectedDate))}`, so Move to… and Duplicate to… never pick a day of a submitted week. The hook's doc comment gains: "Entries of a submitted week list their actions disabled with the lock reason, and the date dialog greys out submitted days."
  - `apps/web/src/features/time/use-entry-selection.ts`: import `getDateLockReason`, and make `selectionActions`:

```ts
  const selectionActions = useMemo(
    () =>
      getTimeEntrySelectionActions({
        saved: selectedEntries.length,
        committed: selectedEntries.filter(isTimesheetEntryCommitted).length,
        lockedReason: selectedEntries
          .map((entry) => getDateLockReason(state, entry.localDate))
          .find((reason) => reason !== undefined),
      }),
    [selectedEntries, state],
  );
```

  - `apps/web/src/features/agents/agent-write-tools.ts`: import `getDateLockReason`, and make `entryActions` pass `{ lockedReason: getDateLockReason(state, entry.localDate) }` as the second argument of `getTimeEntryActions`, so an agent gets the lock reason from the same action set.

- [ ] **Step 8: The editor opens a submitted entry read-only.** In `apps/web/src/features/time/time-entry-editor-form.tsx`:
  - Import `getDateLockReason` from `@/domain/time/locked-weeks` and `WeekLockChip` from `@/features/time/week-lock`.
  - Before `const editor = evaluateTimeEntryEditor(...)`:

```tsx
  // A submitted week's entry opens read-only, and a draft on one of its days
  // cannot be saved. The running entry is never on a submitted day.
  const lockReasonFor = (localDate: string) =>
    getDateLockReason(state, localDate);
  const lockReason = entry ? lockReasonFor(entry.localDate) : undefined;
```

    and pass `lockReasonFor: runningTimer ? undefined : lockReasonFor,` to `evaluateTimeEntryEditor`.
  - The status chip becomes: `runningTimer` → `<Chip tone="success">Running</Chip>`, else `lockReason` → `<WeekLockChip />`, else committed → `<Chip>Committed</Chip>`.
  - The "…" button's options: `invalidDraftReason: lockReason || editor.canSave ? undefined : "Enter a valid duration first"`.
  - `handleAction` passes `resolveValues: lockReason ? undefined : editor.relocationValues`, so Duplicate to… copies the saved entry.
  - Wrap `<TimeEntryFields ... />` in:

```tsx
      {/* A disabled fieldset disables every field, picker and calendar button inside. */}
      <fieldset
        disabled={lockReason !== undefined}
        className="m-0 min-w-0 border-0 p-0"
      >
        <TimeEntryFields ... />
      </fieldset>
```

    The lock reason shows under Date as its error, and Save stays disabled because `canSave` is false. Continue stays: it starts a new entry today.
  - The component's doc comment gains: "An entry of a submitted week opens read-only, with the lock under Date."

- [ ] **Step 9: Run the checks**

Run: `just typecheck`, `just test`, then `cd apps/web && npx bddgen && npx playwright test --config playwright.local.config.ts --grep "entry|Commit|Submit"`.
Expected: PASS. Nothing changes for open weeks.

- [ ] **Step 10: Commit**

```sh
git add apps/web/src
git commit -m "feat(time): open entries of a submitted week read-only" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Submitted days in the Day list, the Week view and calendar suggestions

**Files:**
- Modify: `apps/web/src/features/timer/timer-panel.tsx` (`handleEntryPointerDown` lines 403-416, row `onReorder` lines 699-702, New entry buttons lines 590-596 and 786-796)
- Modify: `apps/web/src/features/time/weekly-time-view.tsx` (toolbar lines 592-610, column paste actions lines 275-286, `handleEntryPointerDown` lines 375-385, `handleColumnDoubleClick` line 569, card `onReorder`, the Add button lines 920-926, `WeekGrid` props)
- Modify: `apps/web/src/features/time/week-grid.tsx` (`getDeleteRowAction` line 129, props, `describeCell` line 413, Add row lines 860-866, call sites lines 552 and 898)
- Modify: `apps/web/src/domain/time/calendar-suggestions.ts` (`buildCalendarSuggestions`), test `calendar-suggestions.test.ts`
- Modify: `apps/web/tests/acceptance/features/submit-week.feature`, `steps/submit-week.steps.ts`
- Docs: `agents/ui-registry.md` (Weekly Time View and the entry editor rule)

**Interfaces:**
- Consumes: `getDateLockReason`, `getLockedWeek`, `isDateLocked`, `lockedWeekMessage` (Task 1); `DisabledReason` (Task 4); `WeekLockChip` (Task 5); the read-only editor and action sets (Task 6); acceptance steps `I open Monday's Day list`, `I double-click the {string} entry`, `I right-click the {string} entry`, `I open the Week Days view`, `the Commit page lists {int} changes`.
- Produces:
  - `WeekGrid` prop `lockReason?: string`
  - `buildCalendarSuggestions(state: Pick<LocalAppState, "projects" | "timesheetEntries" | "calendarDecisions" | "calendarEventRules" | "lockedWeeks">, ...)`
  - Acceptance steps `the entry editor is read-only`, `{string} is disabled in the menu with the reason {string}`, `the Week view shows the week is submitted`

- [ ] **Step 1: Write the failing suggestion test.** In `apps/web/src/domain/time/calendar-suggestions.test.ts`, inside `describe("building suggestions", ...)`:

```ts
  it("suggests nothing on the days of a submitted week", () => {
    const suggestions = suggestionsFor(
      createState({ lockedWeeks: [{ weekOf: "2026-10-12", lockedAt: 1 }] }),
      [
        event(),
        event({
          eventId: "next-week",
          seriesId: undefined,
          startsAt: at(19, 9),
          endsAt: at(19, 10),
        }),
      ],
    );

    expect(suggestions.map((suggestion) => suggestion.localDate)).toEqual([
      "2026-10-19",
    ]);
  });
```

- [ ] **Step 2: Write the failing acceptance scenario.** Append to `apps/web/tests/acceptance/features/submit-week.feature`:

```gherkin
  Scenario: A submitted week is read-only until it is reopened
    Given I have a committed week of entries
    When I open the Commit page for the week of 2026-10-05
    And I press "Submit week"
    And I press "Submit anyway"
    And I open Monday's Day list
    And I double-click the "API" entry
    Then the entry editor is read-only
    When I right-click the "Login form" entry
    Then "Delete" is disabled in the menu with the reason "The week of 2026-10-05 is submitted. Reopen it to change it."
    When I open the Week Days view
    Then the Week view shows the week is submitted
    When I open the Commit page for the week of 2026-10-05
    And I press "Reopen week"
    And I change Monday's "API" entry to "2:30" hours
    And I open the Commit page for the week of 2026-10-05
    Then the Commit page lists 1 changes
```

Append to `apps/web/tests/acceptance/steps/submit-week.steps.ts`:

```ts
const lockReason = "The week of 2026-10-05 is submitted. Reopen it to change it.";

Then("the entry editor is read-only", async ({ page }) => {
  const editor = page.getByRole("complementary", { name: "Time entry editor" });
  await expect(editor.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(editor.getByText(lockReason)).toBeVisible();
  await expect(editor.getByLabel("Note")).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
});

Then(
  "{string} is disabled in the menu with the reason {string}",
  async ({ page }, label: string, reason: string) => {
    const item = page
      .getByRole("menu")
      .getByRole("menuitem")
      .filter({ hasText: label });
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(item).toContainText(reason);
  },
);

Then("the Week view shows the week is submitted", async ({ page }) => {
  const week = page.getByRole("region", { name: "Week", exact: true });
  await expect(week.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(
    week.getByRole("button", { name: "Add", exact: true }).first(),
  ).toBeDisabled();
});
```

`rg -n "is read-only|disabled in the menu|shows the week is submitted" apps/web/tests/acceptance/steps` prints only this file. The existing `{string} is disabled with the reason {string}` cannot match "is disabled in the menu with the reason".

- [ ] **Step 3: Run them**

Run: `cd apps/web && npx vitest run src/domain/time/calendar-suggestions.test.ts`, then `npx bddgen && npx playwright test --config playwright.local.config.ts --grep "read-only until it is reopened"`.
Expected: FAIL. The suggestion on 2026-10-14 is listed, and the Week view shows no "Submitted".

- [ ] **Step 4: No suggestion on a submitted day.** In `apps/web/src/domain/time/calendar-suggestions.ts`, import `isDateLocked` from `@/domain/time/locked-weeks`, add `"lockedWeeks"` to the `Pick` of `buildCalendarSuggestions`, and in the loop compute the day once and skip it:

```ts
      const localDate = formatLocalDateFromTimestamp(event.startsAt);
      // A submitted week takes no new entry, so it has nothing to suggest.
      if (isDateLocked(state, localDate)) continue;
```

Place it right after `if (rule?.action === "hide") continue;`, and use `localDate` in the pushed suggestion. The function's doc comment gains: "Days of a submitted week get none." This also empties the Days cards, the Day section, the Grid chips and the Calendar panel for that week.

- [ ] **Step 5: The Day list.** In `apps/web/src/features/timer/timer-panel.tsx`:
  - Import `getDateLockReason` from `@/domain/time/locked-weeks` and `DisabledReason` from `@/components/disabled-reason`.
  - After `const currentTimer = ...`: `const lockReason = getDateLockReason(state, date);` with the comment "A submitted day's rows do not drag or reorder, and New entry is disabled."
  - `handleEntryPointerDown`: add `lockReason !== undefined ||` as the first condition of its early return.
  - The row's `onReorder`: `lockReason !== undefined || draggableIndex === -1 ? undefined : (step) => reorderEntry(entry._id, step)`.
  - The empty list's button:

```tsx
                  <EmptyContent>
                    <DisabledReason label="New entry" reason={lockReason}>
                      <Button
                        variant="outline"
                        disabled={lockReason !== undefined}
                        onClick={() => onOpenEntry({})}
                      >
                        <Plus data-icon="inline-start" />
                        New entry
                      </Button>
                    </DisabledReason>
                  </EmptyContent>
```

  - The add row's cell renders, when `lockReason` is set, instead of the `TooltipButton`:

```tsx
                {lockReason ? (
                  <DisabledReason label="New entry" reason={lockReason}>
                    <button type="button" className="time-entries-add" disabled>
                      <Plus />
                      <span>New entry</span>
                    </button>
                  </DisabledReason>
                ) : (
                  <TooltipButton ...the existing New entry button... />
                )}
```

  - The component's doc comment gains: "A day of a submitted week lists its rows read-only."

- [ ] **Step 6: The Week view.** In `apps/web/src/features/time/weekly-time-view.tsx`:
  - Import `getLockedWeek` and `lockedWeekMessage` from `@/domain/time/locked-weeks`, `DisabledReason` and `WeekLockChip`.
  - After `const today = todayIsoDate();`:

```tsx
  // The Week shows one week, so the whole view is locked or open.
  const weekLock = getLockedWeek(state, weekDates[0]!);
  const lockReason = weekLock ? lockedWeekMessage(weekLock.weekOf) : undefined;
```

  - Both `columnPasteActions` use `disabledReason: lockReason ?? pasteDisabledReason`.
  - `handleEntryPointerDown`: add `lockReason !== undefined ||` as the first condition of its early return.
  - `handleColumnDoubleClick`: `if (!lockReason && isColumnEmptySpace(event)) onNewEntry(localDate);`.
  - The running card's `onReorder`: `currentTimer?.entryId && !lockReason ? (step) => reorderEntry(...) : undefined`; the entry cards' `onReorder`: `lockReason ? undefined : (step) => reorderEntry(...)`.
  - The toolbar's right side:

```tsx
        <div className="flex items-center gap-3">
          {weekLock ? <WeekLockChip /> : null}
          <CapacityValue ...the existing props... />
        </div>
```

  - The column's Add button:

```tsx
                  <DisabledReason
                    label="Add"
                    reason={lockReason}
                    className="flex w-full"
                  >
                    <Button
                      variant="ghost"
                      className="weekly-days-column-add"
                      disabled={lockReason !== undefined}
                      onClick={() => onNewEntry(day.localDate)}
                    >
                      <Plus data-icon="inline-start" /> Add
                    </Button>
                  </DisabledReason>
```

  - Pass `lockReason={lockReason}` to `WeekGrid`.
  - The component's doc comment gains: "A submitted week shows its lock in the toolbar and lists its entries read-only."

- [ ] **Step 7: The Week Grid.** In `apps/web/src/features/time/week-grid.tsx`:
  - The props gain:

```tsx
  /**
   * Set when the week is submitted: cells open read-only in the side panel,
   * nothing edits in place, and rows cannot be added or deleted.
   */
  lockReason?: string;
```

  - `getDeleteRowAction(row: WeeklyGridRow, lockReason?: string)` returns `disabledReason: lockReason ?? (row.holdsRunningEntry ? "Stop the running entry first" : undefined)`; both call sites pass `lockReason`. Its doc comment gains: "A submitted week keeps its rows."
  - `describeCell`'s `canEditInPlace` starts with `!lockReason &&`.
  - The "+ Add row" button:

```tsx
                  <DisabledReason label="Add row" reason={lockReason}>
                    <Button
                      variant="ghost"
                      disabled={lockReason !== undefined}
                      onClick={() => setIsAddingRow(true)}
                    >
                      <Plus data-icon="inline-start" /> Add row
                    </Button>
                  </DisabledReason>
```

- [ ] **Step 8: Run the tests**

Run: `just typecheck`, `just test`, then `cd apps/web && npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Submit the week|entry|Week|Day list|clipboard|select"`.
Expected: PASS, the new scenario included.

- [ ] **Step 9: Check it in a browser and measure.** With the dev server from Task 5, Step 7, submit a week, then check the Day list, Week Days and Week Grid: no drag starts, Add and Add row show their tooltip, Cmd+V on a submitted day shows the refusal toast, and the toolbar's chip does not move the week total. Run `just ui-perf` before and after on the large workspace (port 4187 or 4188, ignore the first run): no regression over 10%.

- [ ] **Step 10: Docs.** `agents/ui-registry.md`:
  - The entry editor rule (the "Creating and editing a time entry use one form" bullet) gains: "An entry of a submitted week opens read-only: a disabled `fieldset` holds the fields, `WeekLockChip` replaces Committed, and the lock reason shows under Date. A draft dated on a submitted day shows the same reason and cannot save."
  - The Weekly Time View section gains a paragraph: "A submitted week (`domain/time/locked-weeks.ts`) shows `WeekLockChip` beside the week total. Its cards and Day rows do not drag or reorder, Add, Add row, Delete row, Paste here and in-place Grid edits are disabled with the lock reason through `DisabledReason` or the action's `disabledReason`, the Move to and Duplicate to calendars grey out its days, and it gets no calendar suggestion. Writes without a control of their own, such as Cmd+V, show the refusal as a toast from `features/feedback/locked-week-toast.ts`."

- [ ] **Step 11: Commit**

```sh
git add apps/web/src apps/web/tests agents/ui-registry.md
git commit -m "feat(time): show submitted days read-only in the Day and Week views" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Agent tools `get_week_status` and `submit_week`, and refusals on submitted weeks

Before starting: `git fetch && git rebase origin/main`. If Ajour PR #207 (`fix/commit-change-version`) is merged, `mark_entries_committed` takes `{ changes: { entryId, version }[] }`; Step 7 says what changes then.

**Files:**
- Modify: `packages/shared/agent-tools.ts`, test `packages/shared/tests/agent-tools.test.ts`
- Modify: `apps/web/src/domain/agents/agent-read-model.ts`, test `agent-read-model.test.ts`
- Modify: `apps/web/src/features/agents/agent-tool-runner.ts`, `agent-write-tools.ts`, test `agent-tool-runner.test.ts`
- Modify: `apps/api/src/mcp-server.ts`, test `mcp-server.test.ts` (lines 352-370)
- Modify: `apps/api/src/agent-runner/prompts.ts`, test `prompts.test.ts`
- Docs: `apps/docs/app/agents.md`

**Interfaces:**
- Consumes: `getLockedWeek`, `getDateLockReason`, `LockedWeekError` (Tasks 1-2); `localStore.submitWeek` (Task 3); `computeWeekPace`, `getPaceTolerancePercent` (Task 3); `getWeekDates` (Task 3); `listWeekChanges`, `externalEntryId`, `toAgentChangeValues` (slice 1).
- Produces:
  - `readToolInputSchemas.get_week_status = z.object({ weekOf: isoDateSchema })`
  - `writeToolInputSchemas.submit_week = z.object({ weekOf: isoDateSchema })`
  - `dataToolOutputSchemas.get_week_status`, `dataToolOutputSchemas.submit_week = z.object({ weekOf: z.string(), locked: z.literal(true) })`
  - `getWeekStatusForAgent(state: LocalAppState, input: { weekDates: string[]; today: string; projectPropertyPlugins: ProjectPropertyPlugin[] }): DataToolOutput<"get_week_status">`
  - `"submit_week"` in `ENTRY_WRITE_TOOLS`, activity action "Submitted the week", Undo subject "week"

- [ ] **Step 1: Write the failing contract tests.** In `packages/shared/tests/agent-tools.test.ts`, inside the `describe` that holds "reads only the checked changes unless asked otherwise":

```ts
  it("reads a week's status and submits a week, each by any of its days", () => {
    expect(
      readToolInputSchemas.get_week_status.parse({ weekOf: "2026-10-18" }),
    ).toEqual({ weekOf: "2026-10-18" });
    expect(
      writeToolInputSchemas.submit_week.safeParse({ weekOf: "next week" })
        .success,
    ).toBe(false);
    expect(
      dataToolOutputSchemas.submit_week.parse({
        weekOf: "2026-10-12",
        locked: true,
      }),
    ).toEqual({ weekOf: "2026-10-12", locked: true });
    expect(
      dataToolOutputSchemas.get_week_status.parse({
        weekOf: "2026-10-12",
        locked: false,
        uncommittedChanges: 0,
        committedHoursByDay: [{ date: "2026-10-12", hours: 7.5 }],
        committedEntries: [
          {
            entryId: "e1",
            externalId: "ajour:00000000",
            committed: { date: "2026-10-12", hours: 7.5 },
          },
        ],
        pace: {
          loggedHours: 7.5,
          targetHours: 40,
          expectedHours: 8,
          status: "on-pace",
        },
      }).committedEntries,
    ).toHaveLength(1);
  });
```

- [ ] **Step 2: Write the failing read model test.** In `apps/web/src/domain/agents/agent-read-model.test.ts`, import `getWeekStatusForAgent`, and add inside `describe("agent read model", ...)`:

```ts
  it("reports the week's status: lock, waiting changes, committed hours and entries, and pace", () => {
    const state: LocalAppState = {
      ...createState(),
      timesheetTombstones: [
        {
          entryId: "gone",
          commit: {
            at: 5,
            localDate: "2026-10-15",
            projectId: "project-1",
            taskId: "task-1",
            durationMs: HOUR / 2,
          },
        },
      ],
    };
    const acme = {
      projectName: "Acme",
      projectFullName: "Acme",
      taskName: "Build",
    };
    const input = {
      weekDates: WEEK,
      today: "2026-10-14",
      projectPropertyPlugins: [],
    };

    expect(getWeekStatusForAgent(state, input)).toEqual({
      weekOf: "2026-10-12",
      locked: false,
      // e1 was never committed, and "gone" was deleted since its commit.
      uncommittedChanges: 2,
      committedHoursByDay: [
        { date: "2026-10-12", hours: 0 },
        { date: "2026-10-13", hours: 1 },
        { date: "2026-10-14", hours: 0 },
        { date: "2026-10-15", hours: 0.5 },
        { date: "2026-10-16", hours: 0 },
        { date: "2026-10-17", hours: 0 },
        { date: "2026-10-18", hours: 0 },
      ],
      committedEntries: [
        {
          entryId: "e2",
          externalId: externalEntryId("e2"),
          committed: {
            date: "2026-10-13",
            ...acme,
            hours: 1,
            note: "Afternoon",
          },
        },
        {
          entryId: "gone",
          externalId: externalEntryId("gone"),
          committed: { date: "2026-10-15", ...acme, hours: 0.5 },
        },
      ],
      // Monday to Wednesday expect 24 hours; e1 and e2 log 2.
      pace: {
        loggedHours: 2,
        targetHours: 40,
        expectedHours: 24,
        status: "under",
      },
    });
    expect(
      getWeekStatusForAgent(
        { ...state, lockedWeeks: [{ weekOf: "2026-10-12", lockedAt: 1 }] },
        input,
      ).locked,
    ).toBe(true);
  });
```

- [ ] **Step 3: Write the failing tool tests.** In `apps/web/src/features/agents/agent-tool-runner.test.ts`, add a `describe` after `describe("agent timer and entry tools", ...)`:

```ts
describe("agent tools on submitted weeks", () => {
  // Thursday, October 15, 2026: today is in the week of the 12th.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15, 15));
  });
  afterEach(() => vi.useRealTimers());

  /** One committed 90-minute entry on Tuesday the 13th. */
  async function committedWeek() {
    const context = await setup();
    const created = await context.call("create_entry", {
      date: "2026-10-13",
      projectId: context.project._id,
      taskId: context.task("Build")._id,
      minutes: 90,
      note: "Workshop",
    });
    const entryId = (created as { output: { entryId: string } }).output
      .entryId;
    return { ...context, entryId };
  }

  it("reports the status, and submits the week once every change is committed", async () => {
    const { call, entryId } = await committedWeek();

    expect(await call("get_week_status", { weekOf: "2026-10-18" })).toMatchObject({
      ok: true,
      output: { weekOf: "2026-10-12", locked: false, uncommittedChanges: 1 },
    });
    expect(await call("submit_week", { weekOf: "2026-10-14" })).toMatchObject({
      ok: false,
      error:
        "Commit your changes first. The week of 2026-10-12 has 1 change that is not committed.",
    });

    await call("mark_entries_committed", { entryIds: [entryId] });

    expect(await call("get_week_status", { weekOf: "2026-10-12" })).toMatchObject({
      ok: true,
      output: {
        uncommittedChanges: 0,
        committedHoursByDay: expect.arrayContaining([
          { date: "2026-10-13", hours: 1.5 },
        ]),
        committedEntries: [
          {
            entryId,
            externalId: expect.stringMatching(/^ajour:[0-9a-f]{8}$/),
            committed: { date: "2026-10-13", hours: 1.5, note: "Workshop" },
          },
        ],
        pace: { loggedHours: 1.5, status: "under" },
      },
    });
    // A Sunday locks its Monday's week.
    expect(await call("submit_week", { weekOf: "2026-10-18" })).toMatchObject({
      ok: true,
      output: { weekOf: "2026-10-12", locked: true },
    });
    expect(offerUndo.mock.calls.at(-1)![1].title).toBe(
      "Claude Code: Submitted the week",
    );
    expect(await call("get_week_status", { weekOf: "2026-10-12" })).toMatchObject({
      ok: true,
      output: { locked: true },
    });
  });

  it("refuses every entry write to a submitted week, with the reason", async () => {
    const { call, localStore, project, entryId } = await committedWeek();
    await call("mark_entries_committed", { entryIds: [entryId] });
    await call("submit_week", { weekOf: "2026-10-12" });
    const reason = "The week of 2026-10-12 is submitted. Reopen it to change it.";

    for (const [tool, input] of [
      ["create_entry", { date: "2026-10-16", projectId: project._id, minutes: 30 }],
      ["edit_entry", { entryId, minutes: 30 }],
      ["move_entry", { entryId, date: "2026-10-20" }],
      ["duplicate_entry", { entryId }],
      ["mark_entries_committed", { entryIds: [entryId] }],
      ["start_timer", { projectId: project._id }],
    ] as const) {
      expect(await call(tool, input), tool).toMatchObject({
        ok: false,
        error: reason,
      });
    }
    expect(localStore.snapshot().timers).toEqual([]);
    // A copy to an open week leaves the submitted entry as it is.
    expect(
      await call("duplicate_entry", { entryId, date: "2026-10-20" }),
    ).toMatchObject({ ok: true, output: { date: "2026-10-20" } });
  });
});
```

Add `afterEach` to the `vitest` import.

- [ ] **Step 4: Write the failing API and prompt tests.**
  - `apps/api/src/mcp-server.test.ts`, "lists the read and write tools and forwards a write with its input": `expect(tools).toHaveLength(30);` and add `"get_week_status"` and `"submit_week"` to the `arrayContaining` list.
  - `apps/api/src/agent-runner/prompts.test.ts`:

```ts
  it("tells the agent to submit a week only when the task asks, as its last step", () => {
    const prompt = buildPrompt({
      taskPrompt: "Submit the week.",
      values: { sessionId: "s-1" },
    });

    expect(prompt).toContain(
      "- Call submit_week only when the task asks for it, as its last step. It locks the week in Ajour.",
    );
  });
```

- [ ] **Step 5: Run them**

Run: `cd packages/shared && npx vitest run tests/agent-tools.test.ts`; `cd apps/web && npx vitest run src/domain/agents/agent-read-model.test.ts src/features/agents/agent-tool-runner.test.ts`; `cd apps/api && npx vitest run src/mcp-server.test.ts src/agent-runner/prompts.test.ts`.
Expected: FAIL. The schemas, `getWeekStatusForAgent`, the tools and the rule do not exist.

- [ ] **Step 6: Add the contracts** to `packages/shared/agent-tools.ts`:
  - `readToolInputSchemas`, after `get_week_changes`: `get_week_status: z.object({ weekOf: isoDateSchema }),`
  - `writeToolInputSchemas`, after `mark_entries_committed`: `submit_week: z.object({ weekOf: isoDateSchema }),`
  - Before `dataToolOutputSchemas`:

```ts
/** Ajour's pace check of a week, in decimal hours. */
const weekPaceSchema = z.object({
  loggedHours: z.number(),
  targetHours: z.number(),
  /** The targets of the week's days up to today. */
  expectedHours: z.number(),
  status: z.enum(["on-pace", "under", "over"]),
});
```

  - `dataToolOutputSchemas`, after `get_week_changes`:

```ts
  get_week_status: z.object({
    /** The week's Monday. */
    weekOf: z.string(),
    /** Submitted: its entries are read-only until the user reopens it. */
    locked: z.boolean(),
    /** Changes not committed yet. submit_week refuses until it is 0. */
    uncommittedChanges: z.number(),
    /** What the external timesheet holds each day, Monday first, from the committed copies. */
    committedHoursByDay: z.array(
      z.object({ date: z.string(), hours: z.number() }),
    ),
    /** Each committed entry of the week as the external timesheet holds it, deleted ones included until their deletion is committed. */
    committedEntries: z.array(
      z.object({
        entryId: z.string(),
        externalId: z.string(),
        committed: agentChangeValuesSchema,
      }),
    ),
    /** Ask the user before submitting a week whose status is not "on-pace". */
    pace: weekPaceSchema,
  }),
```

    and after `mark_entries_committed`: `submit_week: z.object({ weekOf: z.string(), locked: z.literal(true) }),`

- [ ] **Step 7: Add the read model and the tools.**
  - `apps/web/src/domain/agents/agent-read-model.ts`: import `getLockedWeek` from `@/domain/time/locked-weeks` and `computeWeekPace`, `getPaceTolerancePercent` from `@/domain/time/week-pace`. Append:

```ts
/**
 * The week's submission status for agents: whether it is submitted, how many
 * changes wait, what the external timesheet holds per day and per entry from
 * the committed copies, and Ajour's pace check, in decimal hours.
 */
export function getWeekStatusForAgent(
  state: LocalAppState,
  {
    weekDates,
    today,
    projectPropertyPlugins,
  }: {
    weekDates: string[];
    today: string;
    /** Active plugins that add project properties. Passed in to keep domain free of `lib/`. */
    projectPropertyPlugins: ProjectPropertyPlugin[];
  },
): DataToolOutput<"get_week_status"> {
  const week = new Set(weekDates);
  // The committed copies of the week: saved entries, then deleted ones.
  const committed = [
    ...state.timesheetEntries.flatMap((entry) =>
      entry.commit ? [{ entryId: entry._id, commit: entry.commit }] : [],
    ),
    ...state.timesheetTombstones,
  ]
    .filter(({ commit }) => week.has(commit.localDate))
    .sort((left, right) =>
      left.commit.localDate.localeCompare(right.commit.localDate),
    );
  const loggedMs = state.timesheetEntries
    .filter((entry) => week.has(entry.localDate))
    .reduce((total, entry) => total + entry.durationMs, 0);

  return {
    weekOf: weekDates[0]!,
    locked: getLockedWeek(state, weekDates[0]!) !== undefined,
    uncommittedChanges: listWeekChanges({
      entries: state.timesheetEntries,
      tombstones: state.timesheetTombstones,
      weekDates,
    }).length,
    committedHoursByDay: weekDates.map((date) => ({
      date,
      hours: toHours(
        committed
          .filter(({ commit }) => commit.localDate === date)
          .reduce((total, { commit }) => total + commit.durationMs, 0),
      ),
    })),
    committedEntries: committed.map(({ entryId, commit }) => ({
      entryId,
      externalId: externalEntryId(entryId),
      committed: toAgentChangeValues(state, commit, projectPropertyPlugins),
    })),
    pace: computeWeekPace({
      weekDates,
      today,
      capacityTargets: state.userPreferences.weeklyCapacityTargets,
      loggedMs,
      tolerancePercent: getPaceTolerancePercent(state.userPreferences),
    }),
  };
}
```

  - `apps/web/src/features/agents/agent-tool-runner.ts`: import `getWeekStatusForAgent`, `LockedWeekError` from `@/domain/time/locked-weeks`, `getWeekDates` from `@/domain/time/local-date`, and `todayIsoDate` with `getIsoWeekDates`. Pull the plugin lookup of `get_week_changes` into a helper and use it in both tools:

```ts
/** Project properties are optional context; without them the tool still answers. */
function loadProjectPropertyPlugins(tool: string) {
  return listProjectPropertyPlugins().catch((error: unknown) => {
    console.warn(`Plugin project properties unavailable for ${tool}.`, error);
    return [];
  });
}
```

    and add the read tool:

```ts
  get_week_status: async (rawInput) => {
    const input = readToolInputSchemas.get_week_status.parse(rawInput);
    return getWeekStatusForAgent(localStore.snapshot(), {
      weekDates: getWeekDates(input.weekOf),
      today: todayIsoDate(),
      projectPropertyPlugins: await loadProjectPropertyPlugins("get_week_status"),
    });
  },
```

    In `runAgentToolCall`'s `catch`, after the `AgentToolRefusal` line: `if (error instanceof LockedWeekError) return refuse(error.message);`. The module comment gains: "A write the local store refuses because it would change a submitted week returns its lock reason the same way."
  - `apps/web/src/features/agents/agent-write-tools.ts`: add `"submit_week"` to `ENTRY_WRITE_TOOLS`, and the case:

```ts
    case "submit_week": {
      const input = writeToolInputSchemas.submit_week.parse(rawInput);
      const { undoToken, result } = localStore.submitWeek(input.weekOf);
      if (!result.ok) throw new AgentToolRefusal(result.message);
      return {
        output: { weekOf: result.weekOf, locked: true },
        undoToken,
        action: "Submitted the week",
        objectId: result.weekOf,
        objectTitle: `Week of ${result.weekOf}`,
        undoSubject: "week",
      };
    }
```

    In `mark_entries_committed`, refuse a submitted week before anything is marked. Build `const tombstones = new Map(state.timesheetTombstones.map((tombstone) => [tombstone.entryId, tombstone]));` and, inside the loop over the IDs, before counting:

```ts
        const day =
          tombstones.get(entryId)?.commit.localDate ??
          state.timesheetEntries.find((candidate) => candidate._id === entryId)
            ?.localDate;
        const lockReason = day ? getDateLockReason(state, day) : undefined;
        if (lockReason) throw new AgentToolRefusal(lockReason);
```

    With PR #207 merged, the loop goes over `input.changes`, each `change.entryId`; put the same lines first in it, so the lock is refused before the version check, and write the test's call as `call("mark_entries_committed", { changes: [{ entryId, version: "v:00000000" }] })`, with the same expected reason. The other entry tools need no code: the store's check throws `LockedWeekError`, and Step 7's catch turns it into the refusal.

- [ ] **Step 8: Describe the tools.** In `apps/api/src/mcp-server.ts`:
  - `AJOUR_INSTRUCTIONS` gains the line: `"A submitted week is read-only: Ajour refuses writes to its entries until the user reopens it.",`
  - `TOOL_DESCRIPTIONS`:

```ts
  get_week_status:
    "The week's submission status: `locked` once it is submitted, the number of changes not committed yet, the hours the external timesheet holds each day and each committed entry with its externalId and committed values, from Ajour's committed copies, and Ajour's pace check. `weekOf` is any date in the week. When `pace.status` is not \"on-pace\", ask the user before submitting.",
  submit_week:
    "Submits the week in Ajour: locks it, so its entries are read-only, for agents too, until the user reopens it. Refuses while a change is not committed or the running entry is in the week, with the reason. Call it last, once the external timesheet holds the week. `weekOf` is any date in the week.",
```

  - Append " Refused on a submitted week." to the descriptions of `create_entry`, `edit_entry`, `move_entry`, `duplicate_entry` and `mark_entries_committed`, and " Refused when today is in a submitted week." to `start_timer`.
  - In `apps/api/src/agent-runner/prompts.ts`, add after the `mark_entries_committed` rule line, leaving that line as it is: `- Call submit_week only when the task asks for it, as its last step. It locks the week in Ajour.`

- [ ] **Step 9: Run the tests**

Run: the Step 5 commands, then `just test` and `just typecheck`.
Expected: PASS.

- [ ] **Step 10: Docs.** `apps/docs/app/agents.md`, "What agents can do": the Read row ends "the week's changes since its last commit, and whether the week is submitted, with its committed hours and pace."; the Time row ends "Mark changes as committed, and submit a week." After "Agents cannot delete anything.", add: "A submitted week is read-only for agents too: Ajour refuses their writes to it with the reason."

- [ ] **Step 11: Commit**

```sh
git add packages/shared apps/api/src apps/web/src apps/docs
git commit -m "feat(mcp): add get_week_status and submit_week, and refuse writes to submitted weeks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The `submit-week` plugin placement

**Files:**
- Modify: `packages/shared/connectors.ts` (`agentTaskSchema`, line 161), `packages/shared/agent-runs.ts` (line 51), test `packages/shared/tests/connectors.test.ts` (lines 240-249)
- Modify: `apps/web/src/features/agents/agent-task-buttons.tsx`
- Modify: `apps/web/src/features/time/commit-page.tsx` (the Commit actions row)
- Modify: `apps/web/tests/acceptance/features/agent-runner.feature`, `apps/web/tests/acceptance/steps/agent-runner.steps.ts`
- Docs: `apps/docs/developers/manifest.md` (lines 86-110), `apps/docs/plugins/workday-agent.md`, `apps/docs/time/commit.md` ("Commit with an agent"), `agents/ui-registry.md` (line 73), `agents/architecture.md` (Agent runner), `agents/progress-tracker.md`

**Interfaces:**
- Consumes: `getSubmitButtonReason`, the Submit week button (Task 5); `DisabledReason` (Task 4); acceptance steps `I open the Commit page for the week of {word}`, `I press {string}`.
- Produces:
  - `agentTaskPlacementSchema = z.enum(["commit-week", "submit-week"])`, `type AgentTaskPlacement`
  - `AgentTaskButtons({ weekOf, placement, disabledReason }: { weekOf: string; placement: AgentTaskPlacement; disabledReason?: string })`
  - `useHasAgentTasks(placement: AgentTaskPlacement): boolean`
  - Acceptance steps `the local API reports a ready {string} submit task`, `the Commit page offers {string} instead of Submit week`, `the {string} run is requested for the week of {word}`

- [ ] **Step 1: Write the failing tests.** In `packages/shared/tests/connectors.test.ts`, replace "refuses the old submit-week placement" with:

```ts
  it("places a task next to Mark as committed or in place of Submit week", () => {
    const parse = (placement: string) =>
      connectorPluginManifestSchema.parse({
        ...agentTaskBase,
        capabilities: { agentTask: { tasks: [{ ...agentTask, placement }] } },
      });

    for (const placement of ["commit-week", "submit-week"]) {
      expect(
        parse(placement).capabilities.agentTask?.tasks[0]?.placement,
      ).toBe(placement);
    }
    expect(() => parse("reset-sync")).toThrow(/placement/);
  });
```

Append to `apps/web/tests/acceptance/features/agent-runner.feature`:

```gherkin
  Scenario: A plugin's submit task replaces Submit week
    Given the local API reports a ready "Check Workday and submit" submit task
    When I open the Commit page for the week of 2026-10-12
    Then the Commit page offers "Check Workday and submit" instead of Submit week
    When I press "Check Workday and submit"
    Then the "submit-week" run is requested for the week of 2026-10-12
```

In `apps/web/tests/acceptance/steps/agent-runner.steps.ts`, after `readyOverview`:

```ts
const submitWeekTask = {
  ...enterWeek,
  taskId: "submit-week",
  label: "Check Workday and submit",
  placement: "submit-week",
};
```

and the steps:

```ts
Given(
  "the local API reports a ready {string} submit task",
  async ({ page }, label: string) => {
    expect(label).toBe(submitWeekTask.label);
    runner = await mockRunner(page, {
      ...readyOverview,
      tasks: [enterWeek, submitWeekTask],
    });
  },
);

Then(
  "the Commit page offers {string} instead of Submit week",
  async ({ page }, label: string) => {
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Submit week", exact: true }),
    ).toHaveCount(0);
  },
);

Then(
  "the {string} run is requested for the week of {word}",
  async ({}, taskId: string, weekOf: string) => {
    await expect
      .poll(() => runner.runRequests)
      .toEqual([{ pluginId: "ajp-workday", taskId, weekOf }]);
  },
);
```

`rg -n "submit task|instead of Submit week|run is requested" apps/web/tests/acceptance/steps` shows these and the existing `the run is requested for the week of {word}`, which cannot match a text that starts with a quoted task ID.

- [ ] **Step 2: Run them**

Run: `cd packages/shared && npx vitest run tests/connectors.test.ts`, then in `apps/web`: `npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Agent tasks from plugins"`.
Expected: FAIL. The manifest refuses `submit-week`, and the runner overview with a `submit-week` task does not parse, so the Commit page shows no task button.

- [ ] **Step 3: Accept the placement.**
  - `packages/shared/connectors.ts`, before `agentTaskSchema`:

```ts
/**
 * Where Ajour shows an agent task's button on the Commit page, for the week on
 * screen: `commit-week` next to Mark as committed, `submit-week` in place of
 * Submit week.
 */
export const agentTaskPlacementSchema = z.enum(["commit-week", "submit-week"]);
export type AgentTaskPlacement = z.infer<typeof agentTaskPlacementSchema>;
```

    and in `agentTaskSchema`: `placement: agentTaskPlacementSchema,` (drop the old comment above it).
  - `packages/shared/agent-runs.ts`: import `agentTaskPlacementSchema` from `./connectors.ts`, and `placement: agentTaskPlacementSchema,` in `agentTaskStatusSchema`.

- [ ] **Step 4: One button set per placement.** In `apps/web/src/features/agents/agent-task-buttons.tsx`, import `type AgentTaskPlacement` from `@ajour/shared`, then:
  - Add:

```tsx
/** True when an active plugin has a task for `placement`, such as one that replaces Submit week. */
export function useHasAgentTasks(placement: AgentTaskPlacement) {
  const state = useAgentRunner();
  return (
    state.kind === "ready" &&
    state.overview.tasks.some((task) => task.placement === placement)
  );
}
```

  - `AgentTaskButtons` takes `{ weekOf, placement, disabledReason }`, with the doc comment "The Commit page's plugin agent tasks for one placement and the week on screen: one button each, disabled with the reason while the task cannot run, a run is going, a start is in flight, or the week is not ready (`disabledReason`, such as "Commit your changes first")." It filters `task.placement === placement`, and the reason becomes `running ? "An agent task is already running." : (task.blockers[0] ?? disabledReason)`.
  - `AgentTaskWeekLinks` lists the links of every task, once per URL:

```tsx
  const seen = new Set<string>();
  const links = state.overview.tasks.flatMap((task) => {
    const url = weekLinkFor(task, weekOf);
    // A plugin's tasks often share one link.
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ key: `${task.pluginId}/${task.taskId}`, url, task }];
  });
```

- [ ] **Step 5: The Commit page uses both.** In `apps/web/src/features/time/commit-page.tsx`, import `useHasAgentTasks`, add `const hasSubmitTasks = useHasAgentTasks("submit-week");`, render `<AgentTaskButtons weekOf={weekOf} placement="commit-week" />`, and replace the `DisabledReason` with Submit week by:

```tsx
            {hasSubmitTasks ? (
              // A plugin's submit task replaces Submit week, with its reasons.
              <AgentTaskButtons
                weekOf={weekOf}
                placement="submit-week"
                disabledReason={submitReason}
              />
            ) : (
              <DisabledReason label="Submit week" reason={submitReason}>
                ...the Submit week button from Task 5...
              </DisabledReason>
            )}
```

- [ ] **Step 6: Run the tests**

Run: `cd packages/shared && npx vitest run tests/connectors.test.ts`, `just test`, `just typecheck`, then in `apps/web`: `npx bddgen && npx playwright test --config playwright.local.config.ts --grep "Agent tasks from plugins|Submit the week"`.
Expected: PASS.

- [ ] **Step 7: Docs.**
  - `apps/docs/developers/manifest.md`: the `placement` row reads "`commit-week`: a button next to **Mark as committed** on the Commit page. `submit-week`: a button in place of **Submit week**, greyed out like it until every change is committed. Both act on the week on screen." After the example, add: "A `submit-week` task looks the same, such as `"id": "submit-week"`, `"label": "Check Workday and submit"`, `"placement": "submit-week"`, `"prompt": "prompts/submit-week.md"`. Its prompt ends with the `submit_week` tool."
  - `apps/docs/plugins/workday-agent.md`:
    - Intro, second sentence onward: "...applies them to your Workday timesheet in a Chrome window. Once the week is committed, **Check Workday and submit** replaces **Submit week**: the agent checks the week in Workday, fixes or asks, then submits it in Ajour."
    - Set it up, step 1: "It needs version 0.4.0 or later, and 0.5.0 for **Check Workday and submit**." Step 3 starts: "Open **Settings › Plugins › Workday (agent)**. Under **Tasks**, fill in, for **Commit to Workday** and **Check Workday and submit**:".
    - After "## Commit a week" and its "### Run it again", add:

```md
## Submit a week

When every change is committed, press **Check Workday and submit** on the Commit page. It replaces **Submit week**, and is greyed out like it while a change is not committed or an entry runs in the week. The agent:

1. Checks the week in Ajour. When the week is behind or over its targets, it asks **Submit anyway** or **Stop**.
2. Opens Workday and compares each day with what Ajour committed.
3. When Workday differs on an entry with one of the week's IDs, it lists the differences and asks: **Update Workday** makes Workday match Ajour, **I'll fix Ajour** stops so you can change and commit in Ajour first, **Leave it** goes on. It never changes an entry without an Ajour ID.
4. Submits the week in Ajour, which locks it. Workday has no Submit step. See [Submit the week](/time/commit#submit-the-week).
```

    - "What it asks you" gains: "- The week is off pace when you submit it: **Submit anyway** or **Stop**." and "- Workday differs from what Ajour committed: **Update Workday**, **I'll fix Ajour** or **Leave it**."
  - `apps/docs/time/commit.md`, "Commit with an agent", after the first paragraph: "A plugin can also replace **Submit week** with its own button, such as **Check Workday and submit**, which checks the week in the timesheet tool before it submits it in Ajour."
  - `agents/ui-registry.md` line 73: "...sits in the Commit page's actions row: one button per `commit-week` task next to Mark as committed, and the `submit-week` tasks in place of Submit week, with its disabled reasons. `AgentTaskWeekLinks` puts each distinct week link in the week summary..."
  - `agents/architecture.md`, Agent runner paragraph: "...and the Commit page's `AgentTaskButtons`, one set per placement (`commit-week`, `submit-week`), both reading `lib/agent-runner.ts`."
  - `agents/progress-tracker.md`, a new section at the end:

```md
## Commit week, slice 2, 2026-10-16

- [x] Submit week on the Commit page, after a pace check that uses the pace tolerance and the under-target warning, locks the week with Undo; Reopen week unlocks it with Undo. One rule, `isDateLocked`, and one check in `writeState` keep a submitted week's entries read-only for every command, Undo and agent tool.
- [x] The Day list, Week Days, Week Grid, entry editor and action menus disable what would change a submitted week, with its reason; other writes show the refusal as a toast. Calendar suggestions skip submitted days.
- [x] Agents get `get_week_status` and `submit_week`, and the plugin placement `submit-week` replaces Submit week.
- [ ] Workday (agent) 0.5.0 with `prompts/submit-week.md` in `les-cabochons/ajp-workday-agent`, then a smoke run by Alex.
```

- [ ] **Step 8: Final check**

Run: `just test`, `just typecheck`, `just format-check` (run `just format` first if it fails, then `git checkout -- docs/superpowers/plans/2026-10-16-commit-week-slice-2.md` if it changed this plan), `just docs-build`, and the whole acceptance suite: `cd apps/web && npx bddgen && npx playwright test --config playwright.local.config.ts`. Then delete `apps/web/playwright.local.config.ts`.
Expected: all pass, no dead link.

- [ ] **Step 9: Commit**

```sh
git add packages/shared apps/web/src apps/web/tests apps/docs agents
git status --short apps/web/playwright.local.config.ts   # must print nothing
git commit -m "feat(plugins): let a submit-week agent task replace Submit week" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Workday (agent) 0.5.0 submit prompt

**Repo:** `/Users/a.trepanier/Repos/Personnal/ajp-workday-agent` (GitHub `les-cabochons/ajp-workday-agent`). `git fetch`, then a new branch `feat/submit-week` from `origin/main`. If PR #4 (`fix/exact-ids`, 0.4.1) is still open, branch from `origin/fix/exact-ids` instead and open the PR against it.

**Files:**
- Create: `prompts/submit-week.md`
- Modify: `plugin.json`, `package.json`, `tests/manifest.test.mjs`, `README.md`

**Interfaces:**
- Consumes: Ajour MCP tools `get_week_status { weekOf }` (`locked`, `uncommittedChanges`, `committedHoursByDay`, `committedEntries` with `entryId`, `externalId`, `committed` values carrying `date`, `projectName`, `projectCode`, `projectFullName`, `projectProperties`, `taskName`, `hours`, `note`, and `pace`) and `submit_week { weekOf }` (Task 8), placement `submit-week` (Task 9), the runner rule on `submit_week` (Task 8).

- [ ] **Step 1: Write the failing manifest tests.** In `tests/manifest.test.mjs`, replace the single-task setup and its tests (keep any other test, such as 0.4.1's regression test) with:

```js
const tasks = manifest.capabilities.agentTask.tasks;

/** Ajour refuses a slot it does not know: weekOf, sessionId and settings.<id>. */
function unknownSlots(text, task) {
  const settingIds = new Set(task.settings.map((setting) => setting.id));
  return [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
    .map(([, slot]) => slot)
    .filter(
      (slot) =>
        slot !== "weekOf" &&
        slot !== "sessionId" &&
        !(slot.startsWith("settings.") && settingIds.has(slot.slice("settings.".length))),
    );
}

test("the manifest is an agent-task plugin with project properties for API 3", () => {
  assert.equal(manifest.apiVersion, 3);
  assert.deepEqual(Object.keys(manifest.capabilities).sort(), ["agentTask", "projectProperties"]);
  assert.equal(manifest.entrypoint, undefined);
  assert.deepEqual(
    tasks.map((task) => [task.id, task.placement]),
    [
      ["commit-week", "commit-week"],
      ["submit-week", "submit-week"],
    ],
  );
});

for (const task of tasks) {
  test(`${task.id}: the prompt is a regular file under 64 KB`, async () => {
    const stat = await lstat(new URL(task.prompt, root));
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.ok(stat.size <= 64 * 1024);
  });

  test(`${task.id}: the prompt and week link use only slots Ajour fills`, async () => {
    const prompt = await readFile(new URL(task.prompt, root), "utf8");
    assert.deepEqual(unknownSlots(prompt, task), []);
    assert.deepEqual(unknownSlots(task.weekLink, task), []);
  });
}

/** The text of `text` from `start` to the end of `end`. */
function block(text, start, end) {
  const from = text.indexOf(start);
  const to = from === -1 ? -1 : text.indexOf(end, from);
  assert.ok(to !== -1, `commit-week.md has no block from "${start}"`);
  return text.slice(from, to + end.length);
}

test("the submit prompt repeats the commit prompt's shared rules word for word", async () => {
  const commit = await readFile(new URL("prompts/commit-week.md", root), "utf8");
  const submit = await readFile(new URL("prompts/submit-week.md", root), "utf8");
  for (const [start, end] of [
    ['1. Send update_session: "Opening Workday."', "say what the page shows."],
    ["Ajour gives hours as decimal numbers with a dot", "when you compare Workday's hours with Ajour's."],
    ["A change may have projectFullName and projectProperties.", "it is a short name only Ajour knows."],
    ["Find a change's time type in Workday.", "Match the task by taskName."],
    ["To add an entry, open the entry dialog from the day itself.", "check the entry shows in the day with the right hours."],
  ]) {
    assert.ok(submit.includes(block(commit, start, end)), `submit-week.md differs from commit-week.md from "${start}"`);
  }
});
```

Run: `corepack pnpm test`
Expected: FAIL. The manifest has one task, and `prompts/submit-week.md` does not exist.

- [ ] **Step 2: Manifest.** In `plugin.json` and `package.json`, set `version` to `0.5.0`. In `plugin.json`, the description becomes "Commits your Ajour week changes to the Workday timesheet, and submits the week, through a coding agent and a Chrome window. Unofficial: it drives Workday's web page and breaks when the page changes. It never signs in for you." Add after the `commit-week` task:

```json
{
  "id": "submit-week",
  "label": "Check Workday and submit",
  "placement": "submit-week",
  "prompt": "prompts/submit-week.md",
  "estimateMinutes": 10,
  "weekLink": "{{settings.timesheetUrl}}",
  "settings": [ <the commit-week task's two settings, copied unchanged> ]
}
```

- [ ] **Step 3: Prompt.** Create `prompts/submit-week.md`. The blocks marked as shared are copied from `prompts/commit-week.md` of the base branch character for character; Step 1's test fails on any difference. On 0.4.0 and 0.4.1 they read as below.

````markdown
# Submit the week of {{weekOf}} in Workday

You check that the user's Workday timesheet holds the week of {{weekOf}} as Ajour committed it, fix what differs or ask, then submit the week in Ajour, which locks it. This Workday has no Submit step: never look for or press a Submit, Review or Soumettre button.

Keep a list of what you checked, fixed and left. The final summary uses it.

## 1. Check the week in Ajour

1. Send update_session: "Checking the week of {{weekOf}} in Ajour."
2. Call get_week_status with weekOf {{weekOf}}.
3. `locked` is true: the week is already submitted in Ajour. End the session as done with "The week is already submitted." and stop.
4. `uncommittedChanges` is not 0: end the session as failed with "Commit your changes first: some changes are not committed in Ajour." and stop. Do not open Workday.
5. `pace.status` is not "on-pace": ask before anything else, with the hours in a decimal comma, for example "The week has 30,5 h logged and 40 h expected by now. Submit it anyway?", with the choices "Submit anyway" and "Stop". "Stop": end the session as cancelled.
6. `committedHoursByDay` is what Workday should hold each day. `committedEntries` lists each committed entry with its externalId and its committed values: the day, project, task, hours and note Workday should have. In the rules below, a committed entry's values read like a change's values.
7. A change may have projectFullName and projectProperties. Use projectProperties["workday-agent"].code and .name for Workday; they already hold the defaults. Never use projectName to find a project: it is a short name only Ajour knows.
8. Ajour gives hours as decimal numbers with a dot, such as 0.75. Workday writes and reads hours with a decimal comma: 45 minutes is 0,75 and 7.5 hours is 7,5. Convert when you type hours in Workday, and when you compare Workday's hours with Ajour's.

## 2. Open the timesheet

1. Send update_session: "Opening Workday."
2. Open {{settings.timesheetUrl}}.
3. A sign-in page: try to get through it without the user first. Send update_session: "Signing in to Workday."
   - Workday's own page offers a single sign-on button, such as "Sign in with SSO" or the company's name: click it.
   - An account picker lists "{{settings.username}}": click that account.
   - A field asks for an email or a username, and "{{settings.username}}" is not empty: type it and press Next or Continue.
   - Wait a few seconds after each step and take a new snapshot. The identity provider often signs in alone when Chrome still has its session.
   - The page asks for a password, a code, a number to match or an approval, or the username is empty and a field needs it: stop there. Never type in that page. Ask the user to sign in in the Chrome window, with the choices "Done" and "Stop". "Done": take a new snapshot and go on. "Stop": end the session as cancelled.
   - Do not try the same step more than twice. A loop back to the same page means you ask the user.
4. Go to the week that holds {{weekOf}}. Use Workday's own week picker or its previous and next week arrows. Check the dates in the page header match the week before you enter anything.
5. The week cannot be found, or the page is not a timesheet: end the session as failed and say what the page shows.

## 3. Compare day by day

Send update_session: "Comparing Workday with Ajour."

Find a change's time type in Workday. Match the project by projectProperties["workday-agent"].code first, then projectProperties["workday-agent"].name, then projectFullName. If a change has neither projectProperties nor projectFullName, match the project by projectCode. Match the task by taskName.

The comment of an entry Ajour committed is the note, then " · ", then the externalId. With no note, the comment is the externalId alone.

For each day, Monday first, compare Workday's total for the day with committedHoursByDay, and each Workday entry whose comment ends with an externalId from committedEntries with that entry's committed values. Note every difference:

- A committed entry with no Workday entry whose comment ends with its externalId.
- A Workday entry with one of these externalIds whose day, time type, hours or comment differs from the committed values.
- A Workday entry on a day of this week whose comment ends with "ajour:" and an ID that is not in committedEntries.
- A day whose total still differs once those are counted. The difference comes from entries without an Ajour ID, the user's own.

No difference: go to step 5.

## 4. Ask about the differences

Ask once, listing each difference with its day, project, task, and hours in Workday and in Ajour. For example: "Workday differs from Ajour on 2 days. Tue, Acme · Build: Workday has 2 h, Ajour committed 1,5 h. Thu: Workday has 1 h more, from an entry without an Ajour ID." Offer the choices "Update Workday", "I'll fix Ajour" and "Leave it".

- "Update Workday": make each Workday entry with one of this week's externalIds match its committed values, add each committed entry Workday lacks, and delete each entry whose Ajour ID is not in committedEntries. Send update_session when you start each day. Then compare again. A difference left from entries without an Ajour ID does not stop the submission: note it for the summary.
- "I'll fix Ajour": end the session as cancelled with "Change the entries in Ajour, commit them, then run Check Workday and submit again." Do not submit.
- "Leave it": go on with the differences as they are, and note them for the summary.

To add an entry, open the entry dialog from the day itself. Workday's page may be in English or French. Click the empty area of that day's column in the week calendar, below any existing entries. Workday shows a blue "Enter Time" or "Entrer des heures" block there; click it if the first click only showed the block. Do not use the "Actions" menu, it is slower. Fill the dialog in this order, because Workday clears the hours when the time type changes:
   1. Pick the time type first. Wait about two seconds with browser_wait_for, then take a snapshot and check the time type shows and the dialog has settled.
   2. Type the hours with a decimal comma such as 0,75 (never type a dot), then the comment.
   3. Take a snapshot and check the hours are still there before you confirm. If they are empty, type them again.
   The same applies when you edit an entry and change its time type: set the time type, wait, then set the hours. Confirm the dialog. Take a snapshot and check the entry shows in the day with the right hours.

Workday shows an error on save: read the message. If it names a field you can fix, fix it once. Otherwise cancel the dialog, note the error, and ask with the choices "Leave it" and "Stop". "Stop" ends the session as failed.

Never delete or change an entry in Workday that has no externalId of yours. Those are the user's own.

## 5. Submit in Ajour

Call submit_week with weekOf {{weekOf}}. Ajour refuses: end the session as failed with Ajour's reason.

## 6. Summary

End the session with what you did, for example: "Workday matched Ajour. Submitted the week in Ajour." or "Updated 2 Workday entries to match Ajour, then submitted the week in Ajour." List each difference you left, with its day, and each day whose total differs because of entries without an Ajour ID.
````

- [ ] **Step 4: README.** Describe both tasks: "Commit to Workday" adds, updates and deletes one Workday entry per Ajour entry, from the Commit page; "Check Workday and submit" replaces Submit week once the week is committed, checks the pace, compares Workday with what Ajour committed day by day, fixes or asks, then submits the week in Ajour. It never presses a Submit button in Workday. State that 0.5.0 needs an Ajour with `get_week_status`, `submit_week` and the `submit-week` placement, and that each task has its own settings.

- [ ] **Step 5: Verify.** `corepack pnpm verify`. Expected: every test passes and `package/workday-agent-0.5.0.ajour-connector` is written. Then check the archive with Ajour's installer from the Ajour worktree, with a throwaway script outside both repos:

```sh
mkdir -p /tmp/ajp-install-check
cat > /tmp/ajp-install-check/check.mts <<'EOF'
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installConnectorPluginArchive } from "/Users/a.trepanier/Repos/Personnal/ajour/.claude/worktrees/submit-week/apps/api/src/plugin-package.ts";

const archive = process.argv[2]!;
const installed = await installConnectorPluginArchive({
  archiveBytes: await readFile(archive),
  archiveFilename: path.basename(archive),
  installRoot: await mkdtemp(path.join(tmpdir(), "ajp-install-")),
});
console.log(
  installed.manifest.version,
  installed.manifest.capabilities.agentTask?.tasks.map(
    (task) => `${task.id}:${task.placement}`,
  ),
);
EOF
cd /Users/a.trepanier/Repos/Personnal/ajour/.claude/worktrees/submit-week/apps/api
node --experimental-strip-types /tmp/ajp-install-check/check.mts /Users/a.trepanier/Repos/Personnal/ajp-workday-agent/package/workday-agent-0.5.0.ajour-connector
```

Expected: `0.5.0 [ 'commit-week:commit-week', 'submit-week:submit-week' ]`. The Ajour worktree must hold Task 9, or the installer refuses `submit-week`. Delete `/tmp/ajp-install-check` afterwards.

- [ ] **Step 6: Commit, push, PR.** `git add plugin.json package.json prompts/submit-week.md tests/manifest.test.mjs README.md`, commit `feat: submit the week in Workday` with the trailer, push `feat/submit-week`, and open a PR titled `feat: submit the week in Workday` against `main` (or `fix/exact-ids`, see Repo), naming the Ajour PR of this plan that it ships with. Copy the archive to `~/Downloads/`.

---

## Self-review

**Spec coverage (slice 2):**

| Requirement | Task |
| ----------- | ---- |
| `LocalAppState.lockedWeeks: { weekOf; lockedAt }[]`, `weekOf` the Monday, default `[]`, normalized on load | 1 |
| One rule `isDateLocked(state, localDate)` in the domain | 1 |
| Every entry transition refuses with "The week of <date> is submitted. Reopen it to change it." | 2 (the check in `writeState`, a table over every transition), 8 (agents) |
| Create, edit, move in and out, duplicate into, delete, import, mark as not committed, selection actions, drag and drop, paste, reorder | 2 (domain table), 6 (action sets, editor), 7 (Day, Week, Grid) |
| Mark as committed on a locked week refused | 8 (agent tool; the page has no change to commit on a locked week) |
| Timer start on a locked today, timer save into a locked day, Switch | 2 (domain and store), 4 (toast) |
| Agent write tools refuse on locked weeks | 8 |
| UI surfacing decided: disabled where a control exists, toast elsewhere | Global Constraints, 4, 6, 7 |
| Locking refuses while a change is not committed or a running entry belongs to the week | 3 |
| Locking drops the week's tombstones | 3 (a week only locks with none; documented in `submitWeek`) |
| Submit week on the Commit page, disabled with "Commit your changes first" | 5 |
| Pace check from `week-pace.ts` with `paceTolerancePercent` and `warnWhenSubmittingUnderCapacity`, under-target confirmation | 3 (`needsPaceConfirmation`), 5 (dialog) |
| Lock with Undo; Reopen week with Undo | 3 (store), 5 (page) |
| Week view and Commit page show a lock; entries read-only there | 5 (Commit page), 6 (editor), 7 (Week view, Day list) |
| `get_week_status { weekOf }` with locked, uncommitted changes, committed hours per day, pace | 8 (plus `committedEntries`, see the decisions) |
| `submit_week { weekOf }` refuses while a change is not committed, with that reason | 3, 8 |
| `agent-tools.ts`, `mcp-server.ts` descriptions, tool runner, write tools, docs | 8 |
| `submit-week` placement in `z.enum` with `commit-week`; its tasks replace Submit week | 9 |
| Runner prompt rule for submitting, commit rule kept | 8 |
| Workday (agent) 0.5.0 `submit-week` task and prompt, shared rules word for word, own branch, PR, install check | 10 |
| Docs: Commit page, agents, Workday (agent), manifest, ui-registry, progress tracker | 5, 7, 8, 9 |
| Testing section: `isDateLocked` and each guarded transition; `get_week_status` output; acceptance: submit, see the lock and a refused edit, reopen | 1, 2, 8, 5, 7 |

Out of scope and not planned: Reset sync, `delete_entry`, `externalId` and `change` in `list_time_entries` (slice 3), commit history, locking without submitting.

**Placeholder scan:** every test step has its code, every logic step has its code. Two steps point at code they keep: Task 7 keeps the existing `TooltipButton` and `CapacityValue` props, and Task 9 Step 5 keeps the Task 5 Submit week button. Task 8 Step 7 names the one change PR #207 brings, and Task 10 Step 3 names the shared blocks the test checks against the base branch.

**Type consistency:** `LocalLockedWeek`, `getWeekOf`, `lockedWeekMessage`, `getLockedWeek`, `isDateLocked`, `getDateLockReason`, `normalizeLockedWeeks` and the exported `recordsEqual` come from Task 1; `LockedWeekError`, `LockCheckState`, `findLockedWeekWrite` and `assertNoLockedWeekWrite` from Task 2; `getWeekDates`, `SubmitWeekRefusal`, `SubmitWeekResult`, `getSubmitWeekRefusal`, `submitWeek`, `reopenWeek`, `WeekPace`, `needsPaceConfirmation`, `localStore.submitWeek` and `localStore.reopenWeek` from Task 3; `installLockedWeekToast` and `DisabledReason` from Task 4; `WeekLockChip` and `getSubmitButtonReason` from Task 5; `lockedReason` and `lockReasonFor` from Task 6; the `WeekGrid` `lockReason` prop from Task 7; `getWeekStatusForAgent` and the tool schemas from Task 8; `agentTaskPlacementSchema`, `AgentTaskPlacement` and `useHasAgentTasks` from Task 9. Each is used only in its own task or a later one. `localStore.submitWeek` returns `{ undoToken, result }` from `updateStateWithUndoResult`, and both the page and the agent tool read it that way. Every `lockedWeeks` read goes through `getLockedWeek`, except the check and `getSubmitWeekRefusal`, which compare Mondays from `getWeekOf`.

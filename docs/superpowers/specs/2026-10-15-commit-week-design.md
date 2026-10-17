# Commit and submit the week

- Status: Design approved by Alex on 2026-10-15
- Date: 2026-10-15
- Builds on: `2026-10-15-ajour-agent-runner-design.md`, `2026-10-15-plugin-project-properties-design.md`
- Later: commit history, issue #170

## Why

The Workday agent can find its own entries by the ID at the end of their comment. So it can update and delete them, not only add them. Today Ajour only knows "submitted" or "not submitted" per entry. It cannot say what changed since the last time the week went to Workday, and it forgets an entry once you delete it.

The week also has no end. Nothing tells Ajour that a week is final, so every week stays editable and keeps its history.

## What the user sees

### The Commit page

- The Submit page becomes the **Commit** page, at the same place. The top bar totals popover opens it with **Commit week**.
- At the top, the **changes** since the last commit, one row per entry:
  - **Added**: an entry never committed.
  - **Updated**: a committed entry whose day, project, task, hours or note changed. The row shows the old and new values, such as `1:00 → 1:30` or `Mon → Tue`.
  - **Deleted**: a committed entry you deleted since.
  - Each kind has its own symbol and color. A week with no changes says "Everything is committed."
- Each change has a checkbox, checked by default. Unchecked changes stay out of the commit and show again next time. This is a **partial commit**.
- Below, the existing lines with **Group by**, for copying into a timesheet by hand. Merging lines only happens in this view. Sync is always one Ajour entry to one external entry.

### Commit

- **Mark as committed**, without an agent: saves the checked changes as committed, after the user copied them by hand. It has the Undo toast.
- **A plugin task**, such as **Commit to Workday**: the agent applies the checked changes in the external tool, adding, updating or deleting one entry per change, and marks each one committed as soon as the tool saved it. No pace check.

### Submit week

- A **Submit week** button on the Commit page. It needs every change committed first; otherwise it is disabled with "Commit your changes first".
- Without an agent: Ajour shows the pace check, then locks the week.
- With a plugin task, such as **Submit in Workday**: the agent checks the pace and asks when it is off, compares Ajour and the external tool day by day, fixes or asks, then calls `submit_week`.
- A locked week:
  - its entries are read-only everywhere, including for agents;
  - nothing can be added to its days, and a running entry cannot start on them;
  - the Week view and the Commit page show a lock;
  - Ajour drops its tombstones, so only the final version stays.
- **Reopen week** unlocks it. Later edits show as changes again.

### Reset sync

- A **Reset sync** plugin task, for when Ajour and the external tool drifted apart.
- The agent reads the week in the external tool and lists the differences with Ajour.
- It asks, with the choices "Make Workday match Ajour", "Make Ajour match Workday" and "Keep both", and the user can type another instruction.
- It makes the changes on the side that needs them, then marks every entry of the week committed and clears the tombstones.

## Data

### Committed copy

`LocalTimesheetEntry` drops `submittedAt`, `submittedFingerprint` and `previousSubmittedAt`, and gets:

```ts
/** The entry as it was last committed. Undefined until its first commit. */
commit?: {
  at: number;
  localDate: string;
  projectId?: string;
  taskId?: string;
  note?: string;
  durationMs: number;
};
```

`committedAt` keeps its meaning: when the entry was saved from a running entry. The names are close, so both get doc comments.

An entry's change:

- `added`: no `commit`.
- `updated`: `commit` differs from the entry on `localDate`, `projectId`, `taskId`, trimmed `note` or `durationMs`.
- none: they are equal.

### Tombstones

`LocalAppState.timesheetTombstones: { entryId: string; commit: <committed copy> }[]`.

- Deleting an entry that has a `commit` adds its tombstone. Deleting an entry with no `commit` leaves none.
- Undo of the delete removes the tombstone with the restored entry.
- Committing a deleted change removes its tombstone.

### Commit IDs

- An entry's external ID is `ajour:` and 8 hex characters of the 32-bit FNV-1a hash of its `_id`. It never changes, whatever the edit.
- `lineId` and `submitLineId` go away with the old line model.

### Locked weeks

`LocalAppState.lockedWeeks: { weekOf: string; lockedAt: number }[]`, where `weekOf` is the week's Monday.

- One rule decides if a date is locked: `isDateLocked(state, localDate)`.
- Every entry transition checks it and refuses with "The week of <date> is submitted. Reopen it to change it.": create, edit, move in and out, duplicate into, delete, import, mark as committed, and starting a running entry today when today is locked.
- Locking refuses while a change is not committed or a running entry belongs to the week.

### Existing data

- An entry with `submittedAt` gets a `commit` equal to its current values. One with `previousSubmittedAt` gets none, so it shows as added. Its Workday entry has an old ID; Reset sync matches it.
- No week starts locked.
- Ajour is not in production: no other compatibility.

## Pace

The pace check moves from `get_submit_lines` to Submit week. Its rules and the `paceTolerancePercent` preference stay.

## Agents

### MCP tools

Removed: `get_submit_lines`, `mark_entries_submitted`, `mark_entries_not_submitted`.

New:

- `get_week_changes { weekOf, onlyChecked = true }`: the changes, each with `change` (`added`, `updated`, `deleted`), `entryId`, `externalId`, `version`, the current values and, for updated and deleted ones, the committed values. Values carry `date`, `projectName`, `projectCode`, `projectFullName`, `projectProperties`, `taskName`, `hours`, `note`.
- `mark_entries_committed { changes: { entryId, version }[] }`: saves the committed copy of each entry, or clears its tombstone. Refuses unknown IDs and locked weeks. It also refuses the whole call when a change's version differs from Ajour now, or the entry has no change any more: "<id> changed since you read it. Call get_week_changes again and apply its current values." The version is `v:` and the FNV-1a hash of `JSON.stringify([change, current, committed])`, where each side is `[localDate, projectId, taskId, trimmed note, durationMs]` or null. Without it, an edit or a delete made after the agent read the week would commit values the external timesheet never received.
- `get_week_status { weekOf }`: `locked`, the number of uncommitted changes, the week's committed hours per day, and `pace`.
- `submit_week { weekOf }`: locks the week. Refuses while a change is not committed, with that reason.
- `delete_entry { entryId }`: deletes a saved entry with the Undo toast. Refuses running entries and locked weeks.

`list_time_entries` adds `externalId` and `change` to each entry, so Reset sync can match external entries.

### Task placements

`placement` becomes `commit-week`, `submit-week` or `reset-sync`.

- `commit-week` tasks show next to **Mark as committed**.
- `submit-week` tasks replace the manual Submit week action when present.
- `reset-sync` tasks show in the Commit page's "…" menu.

The runner prompt drops its rule about `mark_entries_submitted` and says: "After the external tool saved a change, call mark_entries_committed with its entry ID and the version get_week_changes gave you. Never mark a change you did not apply."

### Workday (agent) 0.4.0

Three prompts, `commit-week.md`, `submit-week.md` and `reset-sync.md`, sharing the sign-in and decimal comma rules. The comment is the note, then `·` and the external ID.

## Not included

- Commit history, issue #170.
- Locking a week without submitting it.
- Committing several weeks at once.

## Slices

Each slice is one PR.

1. **Committed copies.** Data model, tombstones, change detection, existing data, the Commit page with changes, partial selection and **Mark as committed**. The agent tools move to `get_week_changes` and `mark_entries_committed`, and the plugin placement `submit-week` becomes `commit-week`, so Workday keeps working with a 0.4.0 commit prompt.
2. **Submit week.** Locked weeks and their guards, pace on submit, `get_week_status`, `submit_week`, the `submit-week` placement and Reopen week. Workday gets its submit prompt.
3. **Reset sync.** `delete_entry`, `externalId` and `change` in `list_time_entries`, the `reset-sync` placement and its prompt.

## Testing

- Domain units: change detection for each field, tombstones on delete and Undo, partial commit, `isDateLocked` and each guarded transition, existing data.
- Read model units: `get_week_changes` and `get_week_status` output.
- Acceptance: edit, add and delete entries after a commit and see the three symbols; uncheck one change, commit, and see only it left; submit, see the lock and a refused edit; reopen.
- Smoke: a Workday run by Alex for each prompt before its plugin release.

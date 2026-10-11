import type { LocalTimesheetEntry } from "@/domain/local-state";
import {
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";

/**
 * What typing hours in a Week Grid cell writes. `create` adds an entry for the
 * row and day, `update` changes the cell's one entry, `delete` removes it, and
 * `invalid` keeps the cell in edit mode with `error` shown.
 */
export type WeekGridCellCommit =
  | { kind: "unchanged" }
  | {
      kind: "create";
      values: {
        localDate: string;
        projectId?: string;
        taskId?: string;
        durationMs: number;
      };
    }
  | {
      kind: "update";
      entryId: string;
      values: {
        projectId?: string;
        taskId?: string;
        note?: string;
        durationMs: number;
      };
    }
  | { kind: "delete"; entryId: string }
  | { kind: "invalid"; error: string };

/** The text a cell shows when it starts editing in place. Empty for an empty cell. */
export function formatWeekGridCellText(entry?: LocalTimesheetEntry) {
  return entry ? formatDurationHoursInput(entry.durationMs) : "";
}

/**
 * Decides what the hours typed in a Grid cell write. Only empty cells and cells
 * with one entry edit in place, so the cell has at most one `entry`.
 *
 * - Empty text, or zero, clears the cell: its entry is deleted. Ajour never saves a 0h entry.
 * - Text equal to what the cell showed writes nothing, so opening and leaving
 *   a cell keeps the entry's exact saved milliseconds.
 * - Otherwise the hours update the entry, or create one with the row's project and task.
 */
export function commitWeekGridCellText({
  text,
  entry,
  row,
  localDate,
}: {
  text: string;
  entry?: LocalTimesheetEntry;
  row: { projectId?: string; taskId?: string };
  localDate: string;
}): WeekGridCellCommit {
  const trimmed = text.trim();
  if (entry && trimmed === formatWeekGridCellText(entry)) {
    return { kind: "unchanged" };
  }

  const durationMs = trimmed ? parseHoursInput(trimmed) : 0;
  if (durationMs === null) {
    return { kind: "invalid", error: "Enter hours, such as 1:30 or 1.5" };
  }

  if (durationMs === 0) {
    return entry
      ? { kind: "delete", entryId: entry._id }
      : { kind: "unchanged" };
  }

  if (!entry) {
    return {
      kind: "create",
      values: {
        localDate,
        projectId: row.projectId,
        taskId: row.taskId,
        durationMs,
      },
    };
  }

  if (durationMs === entry.durationMs) {
    return { kind: "unchanged" };
  }

  return {
    kind: "update",
    entryId: entry._id,
    values: {
      projectId: entry.projectId,
      taskId: entry.taskId,
      note: entry.note,
      durationMs,
    },
  };
}

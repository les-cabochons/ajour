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

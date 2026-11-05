import type { KeyboardEvent } from "react";
import { DateField } from "@/components/ui/date-field";
import type { LocalProject } from "@/domain/local-state";
import { normalizeHoursInput } from "@/domain/time/duration";
import {
  ProjectTaskPicker,
  type ProjectTaskSelection,
} from "@/features/projects/project-task-picker";
import { cn } from "@/lib/utils";

/**
 * The time entry composer, shared by every time entry editor (forms council
 * round 6): the hours large, as the thing written, then a note to write in,
 * then the task and the date as chips. Leave `localDate` out to hide Date,
 * as the running entry does: it is always today.
 */
export function TimeEntryFields({
  className,
  dateError,
  durationError,
  durationHint,
  durationHours,
  idPrefix,
  localDate,
  note,
  onDateChange,
  onDurationChange,
  onDurationKeyDown,
  onNoteChange,
  onNoteKeyDown,
  onProjectTaskChange,
  projectId,
  projects,
  taskId,
}: {
  className?: string;
  dateError?: string | null;
  durationError?: string | null;
  /** Guidance under Hours when there is no error, such as how to start an entry. */
  durationHint?: string | null;
  durationHours: string;
  idPrefix: string;
  localDate?: string;
  note: string;
  onDateChange?: (value: string) => void;
  onDurationChange: (value: string) => void;
  onDurationKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onNoteChange: (value: string) => void;
  onNoteKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onProjectTaskChange: (selection: ProjectTaskSelection) => void;
  projectId: string;
  projects: LocalProject[];
  taskId: string;
}) {
  const noteId = `${idPrefix}-note`;
  const durationId = `${idPrefix}-hours`;
  const durationHintId = `${idPrefix}-hours-hint`;
  const dateId = `${idPrefix}-date`;

  return (
    <div
      className={cn(
        "time-entry-fields composer flex flex-col gap-3",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={durationId} className="sr-only">
          Hours
        </label>
        <input
          id={durationId}
          className="composer-title composer-hours"
          inputMode="numeric"
          autoComplete="off"
          value={durationHours}
          onChange={(event) => onDurationChange(event.target.value)}
          onBlur={(event) =>
            onDurationChange(normalizeHoursInput(event.target.value))
          }
          onKeyDown={onDurationKeyDown}
          placeholder="0:00"
          aria-invalid={Boolean(durationError)}
          aria-describedby={
            !durationError && durationHint ? durationHintId : undefined
          }
        />
        {durationError ? (
          <span className="field-error">{durationError}</span>
        ) : durationHint ? (
          <span id={durationHintId} className="text-xs text-muted-foreground">
            {durationHint}
          </span>
        ) : null}
      </div>
      <label htmlFor={noteId} className="sr-only">
        Note
      </label>
      <textarea
        id={noteId}
        className="composer-body composer-note"
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        onKeyDown={onNoteKeyDown}
        placeholder="Add a note…"
        rows={2}
      />
      <section aria-label="Properties" className="composer-chips">
        <ProjectTaskPicker
          projects={projects}
          projectId={projectId}
          taskId={taskId}
          onChange={onProjectTaskChange}
          placeholder="Project"
          className="time-entry-task-picker composer-task-chip"
        />
        {localDate !== undefined ? (
          <div className="composer-date">
            <label htmlFor={dateId} className="sr-only">
              Date
            </label>
            <DateField
              chip
              id={dateId}
              value={localDate}
              onChange={(value) => onDateChange?.(value)}
              aria-invalid={Boolean(dateError)}
            />
          </div>
        ) : null}
      </section>
      {dateError ? <span className="field-error">{dateError}</span> : null}
    </div>
  );
}

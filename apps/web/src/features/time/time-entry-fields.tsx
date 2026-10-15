import type { KeyboardEvent } from "react";
import { PropertyList, PropertyRow } from "@/components/property-list";
import { SectionHeading } from "@/components/section-heading";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LocalProject } from "@/domain/local-state";
import { normalizeHoursInput } from "@/domain/time/duration";
import {
  ProjectTaskPicker,
  type ProjectTaskSelection,
} from "@/features/projects/project-task-picker";
import { cn } from "@/lib/utils";

/**
 * Project / task, Hours and Date as property rows, then the Note section, shared
 * by every time entry editor. The rows read as values, like the backlog peek's,
 * and show their field on hover and focus. Leave `localDate` out to hide Date,
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
    <div className={cn("time-entry-fields flex flex-col gap-5", className)}>
      <section aria-label="Properties">
        <PropertyList>
          <PropertyRow label="Task">
            <ProjectTaskPicker
              projects={projects}
              projectId={projectId}
              taskId={taskId}
              onChange={onProjectTaskChange}
              placeholder="Select project or task"
              className="time-entry-task-picker"
            />
          </PropertyRow>
          <PropertyRow label={<label htmlFor={durationId}>Hours</label>}>
            <div className="flex w-full min-w-0 flex-col gap-1">
              <Input
                id={durationId}
                className="font-mono"
                value={durationHours}
                onChange={(event) => onDurationChange(event.target.value)}
                onBlur={(event) =>
                  onDurationChange(normalizeHoursInput(event.target.value))
                }
                onKeyDown={onDurationKeyDown}
                placeholder="01:30"
                aria-invalid={Boolean(durationError)}
                aria-describedby={
                  !durationError && durationHint ? durationHintId : undefined
                }
              />
              {durationError ? (
                <span className="field-error">{durationError}</span>
              ) : durationHint ? (
                <span
                  id={durationHintId}
                  className="text-xs text-muted-foreground"
                >
                  {durationHint}
                </span>
              ) : null}
            </div>
          </PropertyRow>
          {localDate !== undefined ? (
            <PropertyRow label={<label htmlFor={dateId}>Date</label>}>
              <div className="flex w-full min-w-0 flex-col gap-1">
                <DateField
                  id={dateId}
                  value={localDate}
                  onChange={(value) => onDateChange?.(value)}
                  aria-invalid={Boolean(dateError)}
                />
                {dateError ? (
                  <span className="field-error">{dateError}</span>
                ) : null}
              </div>
            </PropertyRow>
          ) : null}
        </PropertyList>
      </section>
      <section>
        <SectionHeading>
          <label htmlFor={noteId}>Note</label>
        </SectionHeading>
        <Textarea
          id={noteId}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          onKeyDown={onNoteKeyDown}
          placeholder="Notes (optional)"
          rows={3}
        />
      </section>
    </div>
  );
}

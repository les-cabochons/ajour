import type { KeyboardEvent } from "react";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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
 * Project / task, Note, Hours and Date, shared by every time entry editor. Leave
 * `localDate` out to hide Date, as the running entry does: it is always today.
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
    <FieldGroup className={cn("gap-4", className)}>
      <Field>
        <FieldLabel>Project / task</FieldLabel>
        <ProjectTaskPicker
          projects={projects}
          projectId={projectId}
          taskId={taskId}
          onChange={onProjectTaskChange}
          placeholder="Select project or task"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={noteId}>Note</FieldLabel>
        <Textarea
          id={noteId}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          onKeyDown={onNoteKeyDown}
          placeholder="Notes (optional)"
          rows={3}
        />
      </Field>
      <div className="grid grid-cols-2 items-start gap-4">
        <Field data-invalid={Boolean(durationError)}>
          <FieldLabel htmlFor={durationId}>Hours</FieldLabel>
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
            <FieldDescription id={durationHintId} className="text-xs">
              {durationHint}
            </FieldDescription>
          ) : null}
        </Field>
        {localDate !== undefined ? (
          <Field data-invalid={Boolean(dateError)}>
            <FieldLabel htmlFor={dateId}>Date</FieldLabel>
            <Input
              id={dateId}
              type="date"
              value={localDate}
              onChange={(event) => onDateChange?.(event.target.value)}
              aria-invalid={Boolean(dateError)}
            />
            {dateError ? (
              <span className="field-error">{dateError}</span>
            ) : null}
          </Field>
        ) : null}
      </div>
    </FieldGroup>
  );
}

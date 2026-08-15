import type { KeyboardEvent, FocusEvent } from "react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LocalProject } from "@/domain/local-state";
import { normalizeHoursInput } from "@/domain/time/duration";
import {
  ProjectTaskPicker,
  type ProjectTaskSelection,
} from "@/features/projects/project-task-picker";
import { cn } from "@/lib/utils";

export function TimeEntryFields({
  className,
  durationDisabled = false,
  durationError,
  durationHours,
  idPrefix,
  note,
  onDurationBlur,
  onDurationChange,
  onDurationKeyDown,
  onNoteBlur,
  onNoteChange,
  onProjectTaskChange,
  projectId,
  projects,
  taskId,
}: {
  className?: string;
  durationDisabled?: boolean;
  durationError?: string | null;
  durationHours: string;
  idPrefix: string;
  note: string;
  onDurationBlur?: (value: string, event: FocusEvent<HTMLInputElement>) => void;
  onDurationChange: (value: string) => void;
  onDurationKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onNoteBlur?: (value: string) => void;
  onNoteChange: (value: string) => void;
  onProjectTaskChange: (selection: ProjectTaskSelection) => void;
  projectId: string;
  projects: LocalProject[];
  taskId: string;
}) {
  const noteId = `${idPrefix}-note`;
  const durationId = `${idPrefix}-hours`;

  return (
    <FieldGroup className={cn("gap-4", className)}>
      <Field className="col-span-full">
        <FieldLabel>Project / task</FieldLabel>
        <ProjectTaskPicker
          projects={projects}
          projectId={projectId}
          taskId={taskId}
          onChange={onProjectTaskChange}
          placeholder="Select project or task"
        />
      </Field>
      <Field className="entry-field-note">
        <FieldLabel htmlFor={noteId}>Note</FieldLabel>
        <Textarea
          id={noteId}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          onBlur={(event) => onNoteBlur?.(event.target.value)}
          placeholder="Notes (optional)"
          rows={3}
        />
      </Field>
      <Field className="entry-field-hours" data-invalid={Boolean(durationError)}>
        <FieldLabel htmlFor={durationId}>Hours</FieldLabel>
        <Input
          id={durationId}
          className="font-mono"
          value={durationHours}
          disabled={durationDisabled}
          onChange={(event) => onDurationChange(event.target.value)}
          onBlur={(event) => {
            const normalized = normalizeHoursInput(event.target.value);
            onDurationChange(normalized);
            onDurationBlur?.(normalized, event);
          }}
          onKeyDown={onDurationKeyDown}
          placeholder="01:30"
          aria-invalid={Boolean(durationError)}
        />
        {durationError ? <span className="field-error">{durationError}</span> : null}
      </Field>
    </FieldGroup>
  );
}

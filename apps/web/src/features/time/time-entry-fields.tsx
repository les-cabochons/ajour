import type { KeyboardEvent } from "react";
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

/** Project / task, Note and Hours, shared by every time entry editor. */
export function TimeEntryFields({
  className,
  durationDisabled = false,
  durationError,
  durationHours,
  idPrefix,
  note,
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
  durationDisabled?: boolean;
  durationError?: string | null;
  durationHours: string;
  idPrefix: string;
  note: string;
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
          onKeyDown={onNoteKeyDown}
          placeholder="Notes (optional)"
          rows={3}
        />
      </Field>
      <Field
        className="entry-field-hours"
        data-invalid={Boolean(durationError)}
      >
        <FieldLabel htmlFor={durationId}>Hours</FieldLabel>
        <Input
          id={durationId}
          className="font-mono"
          value={durationHours}
          disabled={durationDisabled}
          onChange={(event) => onDurationChange(event.target.value)}
          onBlur={(event) =>
            onDurationChange(normalizeHoursInput(event.target.value))
          }
          onKeyDown={onDurationKeyDown}
          placeholder="01:30"
          aria-invalid={Boolean(durationError)}
        />
        {durationError ? (
          <span className="field-error">{durationError}</span>
        ) : null}
      </Field>
    </FieldGroup>
  );
}

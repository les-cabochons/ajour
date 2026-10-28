import { useEffect, useRef, type ElementType, type KeyboardEvent } from "react";
import { RiCloseLine as X, RiSaveLine as Save } from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDurationHoursInput } from "@/domain/time/duration";
import type { TaskPropertyPlugin } from "@/domain/projects/plugin-properties";
import { PinnedSlotField } from "@/features/projects/pinned-slot";
import type {
  ProjectTaskEditorFields,
  ProjectTaskEditorState,
} from "@/features/projects/project-task-editor";
import { TaskPropertyFields } from "@/features/projects/task-property-fields";
import { cn } from "@/lib/utils";

/**
 * The form for creating and editing a task: name, billable, budget, adjustment,
 * the pinned slot, and a section per active plugin that adds task properties.
 * It follows the entry editor's rules. Save: the Save button, Enter in a text field,
 * or Cmd/Ctrl+Enter anywhere in the form. Escape, Cancel or × discard the draft.
 *
 * The host owns the draft, so the side panel and the narrow-view dialog can swap
 * mid-edit without losing it.
 */
export function ProjectTaskEditorForm({
  fields,
  editor,
  showNameError,
  projectName,
  taskId,
  trackedMs,
  taskPropertyPlugins = [],
  otherTaskNames = [],
  onFieldsChange,
  onSave,
  onClose,
  titleAs: Title = "h2",
  className,
}: {
  fields: ProjectTaskEditorFields;
  editor: ProjectTaskEditorState;
  /** A new task hides "Enter a task name." until Save or a switch is blocked by it. */
  showNameError: boolean;
  projectName: string;
  /** The saved task. Absent for a new task. */
  taskId?: string;
  /** Time logged on a saved task. Absent for a new task. */
  trackedMs?: number;
  /** Active plugins that add task properties, each shown as a section. */
  taskPropertyPlugins?: TaskPropertyPlugin[];
  /** The names of the project's other active tasks, offered by a property that names a task. */
  otherTaskNames?: string[];
  onFieldsChange: (patch: Partial<ProjectTaskEditorFields>) => void;
  onSave: () => void;
  onClose: () => void;
  /** A dialog host passes its title component so the heading labels the dialog. */
  titleAs?: ElementType;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const nameError = showNameError || !editor.isNew ? editor.nameError : null;

  useEffect(() => {
    rootRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSave();
    }
  }

  function saveOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    onSave();
  }

  return (
    <div
      ref={rootRef}
      className={cn("flex flex-col gap-4", className)}
      onKeyDown={handleKeyDown}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Title className="text-sm font-semibold">
            {editor.isNew ? "New task" : "Edit task"}
          </Title>
          <span className="truncate text-xs text-muted-foreground">
            {projectName}
          </span>
        </div>
        <TooltipButton
          label="Close"
          render={<Button variant="ghost" size="icon" onClick={onClose} />}
        >
          <X />
        </TooltipButton>
      </header>

      <FieldGroup className="gap-4">
        <Field data-invalid={Boolean(nameError)}>
          <FieldLabel htmlFor="project-task-editor-name">Name</FieldLabel>
          <Input
            id="project-task-editor-name"
            value={fields.name}
            placeholder="Task name"
            aria-invalid={Boolean(nameError)}
            onChange={(event) => onFieldsChange({ name: event.target.value })}
            onKeyDown={saveOnEnter}
          />
          {nameError ? <span className="field-error">{nameError}</span> : null}
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id="project-task-editor-billable"
            checked={fields.billable}
            onCheckedChange={(checked) => onFieldsChange({ billable: checked })}
          />
          <FieldLabel htmlFor="project-task-editor-billable">
            Billable
          </FieldLabel>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={Boolean(editor.budgetError)}>
            <FieldLabel htmlFor="project-task-editor-budget">Budget</FieldLabel>
            <Input
              id="project-task-editor-budget"
              className="font-mono"
              value={fields.budget}
              placeholder="Optional"
              aria-invalid={Boolean(editor.budgetError)}
              onChange={(event) =>
                onFieldsChange({ budget: event.target.value })
              }
              onKeyDown={saveOnEnter}
            />
            {editor.budgetError ? (
              <span className="field-error">{editor.budgetError}</span>
            ) : null}
          </Field>
          <Field data-invalid={Boolean(editor.adjustmentError)}>
            <FieldLabel htmlFor="project-task-editor-adjustment">
              Adjustment
            </FieldLabel>
            <Input
              id="project-task-editor-adjustment"
              className="font-mono"
              value={fields.adjustment}
              placeholder="Optional"
              aria-invalid={Boolean(editor.adjustmentError)}
              onChange={(event) =>
                onFieldsChange({ adjustment: event.target.value })
              }
              onKeyDown={saveOnEnter}
            />
            {editor.adjustmentError ? (
              <span className="field-error">{editor.adjustmentError}</span>
            ) : null}
          </Field>
        </div>
        <PinnedSlotField
          taskName={fields.name}
          taskId={taskId}
          slot={fields.pinnedSlot}
          onChange={(pinnedSlot) => onFieldsChange({ pinnedSlot })}
        />
        <TaskPropertyFields
          plugins={taskPropertyPlugins}
          taskName={fields.name}
          otherTaskNames={otherTaskNames}
          pluginProperties={fields.pluginProperties}
          onChange={(pluginProperties) => onFieldsChange({ pluginProperties })}
        />
        {trackedMs !== undefined ? (
          <p className="text-xs text-muted-foreground">
            Tracked{" "}
            <span className="font-mono text-foreground">
              {formatDurationHoursInput(trackedMs)}
            </span>
          </p>
        ) : null}
      </FieldGroup>

      <footer className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"

          disabled={!editor.canSave}
          onClick={onSave}
        >
          <Save data-icon="inline-start" />
          Save
        </Button>
      </footer>
    </div>
  );
}

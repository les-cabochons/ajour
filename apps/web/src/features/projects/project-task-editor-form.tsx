import { useEffect, useRef, type ElementType, type KeyboardEvent } from "react";
import {
  RiCloseLine as X,
  RiMoneyDollarCircleLine as BillableIcon,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { InlineFigure, InlineFigures } from "@/components/ui/inline-figures";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  formatCompactDuration,
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
import type { LocalProject } from "@/domain/local-state";
import type { TaskPropertyPlugin } from "@/domain/projects/plugin-properties";
import { PinnedSlotField } from "@/features/projects/pinned-slot";
import type {
  ProjectTaskEditorFields,
  ProjectTaskEditorState,
} from "@/features/projects/project-task-editor";
import { TaskPropertyFields } from "@/features/projects/task-property-fields";
import { cn } from "@/lib/utils";

/** Typed hours as figures show them ("120h", "-1h30"), or null if they aren't. */
function formatBudgetFigure(value: string) {
  const text = value.trim();
  const negative = text.startsWith("-");
  const ms = parseHoursInput(text.replace(/^[-+]/, ""));
  return ms === null
    ? null
    : `${negative ? "-" : ""}${formatCompactDuration(ms)}`;
}

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
  projectLocalOnly = false,
  project,
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
  /** The project is Local only, so the plugin sections show no Commits as choice. */
  projectLocalOnly?: boolean;
  /** The task's project, where Another task… can create the task it maps to. */
  project?: Pick<LocalProject, "_id" | "tasks" | "team">;
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
      className={cn("composer-root flex flex-col gap-4", className)}
      onKeyDown={handleKeyDown}
    >
      <header className="flex min-w-0 flex-col gap-0.5 pe-20">
        {/* No "New task" line: the project it belongs to opens the
              composer (forms council round 15). */}
        <Title className="sr-only">
          {editor.isNew ? "New task" : "Edit task"}
        </Title>
        <span className="truncate text-xs text-muted-foreground">
          {projectName}
        </span>
      </header>
      <TooltipButton
        label="Close"
        render={
          <Button
            variant="ghost"
            size="icon"
            className="composer-actions"
            onClick={onClose}
          />
        }
      >
        <X />
      </TooltipButton>

      {/* A composer, as the backlog editor's: the name to write in, then
          the task's properties as chips (forms council round 6). */}
      <FieldGroup className="composer gap-3">
        <Field data-invalid={Boolean(nameError)}>
          <FieldLabel htmlFor="project-task-editor-name" className="sr-only">
            Name
          </FieldLabel>
          <input
            id="project-task-editor-name"
            className="composer-title"
            autoComplete="off"
            value={fields.name}
            placeholder="Task name"
            aria-invalid={Boolean(nameError)}
            onChange={(event) => onFieldsChange({ name: event.target.value })}
            onKeyDown={saveOnEnter}
          />
          {nameError ? <span className="field-error">{nameError}</span> : null}
        </Field>
        {/* Budget and adjustment are one sentence under the name, typed in
            place, as a backlog item's estimates (forms council round 13). */}
        <InlineFigures aria-label="Budget">
          <InlineFigure
            id="project-task-editor-budget"
            label="budget"
            value={fields.budget}
            onChange={(budget) => onFieldsChange({ budget })}
            format={formatBudgetFigure}
            invalid={Boolean(editor.budgetError)}
            onKeyDown={saveOnEnter}
          />
          <InlineFigure
            id="project-task-editor-adjustment"
            label="adjustment"
            value={fields.adjustment}
            onChange={(adjustment) => onFieldsChange({ adjustment })}
            format={formatBudgetFigure}
            invalid={Boolean(editor.adjustmentError)}
            onKeyDown={saveOnEnter}
          />
        </InlineFigures>
        <div className="composer-chips" role="group" aria-label="Properties">
          <ToggleChip
            id="project-task-editor-billable"
            checked={fields.billable}
            onCheckedChange={(billable) => onFieldsChange({ billable })}
            icon={<BillableIcon aria-hidden className="size-3.5" />}
          >
            Billable
          </ToggleChip>
          <PinnedSlotField
            taskName={fields.name}
            taskId={taskId}
            slot={fields.pinnedSlot}
            onChange={(pinnedSlot) => onFieldsChange({ pinnedSlot })}
          />
        </div>
        {editor.budgetError ? (
          <span className="field-error">Budget: {editor.budgetError}</span>
        ) : null}
        {editor.adjustmentError ? (
          <span className="field-error">
            Adjustment: {editor.adjustmentError}
          </span>
        ) : null}
        <TaskPropertyFields
          plugins={taskPropertyPlugins}
          taskName={fields.name}
          otherTaskNames={otherTaskNames}
          pluginProperties={fields.pluginProperties}
          commitAs={fields.commitAs}
          choosingAnotherTask={fields.choosingAnotherTask}
          commitsAsError={editor.commitsAsError}
          projectLocalOnly={projectLocalOnly}
          project={project}
          editorSession={taskId ?? "new"}
          onChange={onFieldsChange}
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
        <Button type="button" disabled={!editor.canSave} onClick={onSave}>
          {editor.isNew ? "Create task" : "Save"}
        </Button>
      </footer>
    </div>
  );
}

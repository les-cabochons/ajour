import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
  type Ref,
} from "react";
import {
  RiAlarmWarningLine as AlertTriangle,
  RiCloseLine as X,
  RiRefreshLine as RotateCcw,
  RiSaveLine as Save,
} from "@remixicon/react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isBacklogItemSnoozed } from "@/domain/backlog/backlog-item-lifecycle";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import { getDirectChildWorkItems } from "@/domain/backlog/work-item-hierarchy";
import {
  getLocalProjectDisplayName,
  hasWorkItemEstimateSyncIssue,
  type LocalWorkItem,
} from "@/domain/local-state";
import { settleOpensDialog } from "@/features/backlog/settle-dialog";
import { buildWorkflowStateOptions } from "@/features/backlog/workflow-states";
import { isDoneWorkflowState } from "@/domain/backlog/workflow-states";
import { NO_PRIORITY_NAME, PRIORITY_LEVELS } from "@/domain/backlog/priority";
import { findWorkItemTimer } from "@/domain/time/running-entry";
import { OptionSelect } from "@/components/ui/option-select";
import {
  BACKLOG_ESTIMATE_FIELD_KEYS,
  commitBacklogTaskDraft,
  createBacklogTaskEditorSeed,
  evaluateBacklogTaskEditor,
  sumSubitemEstimates,
  type BacklogEstimateFieldKey,
  type BacklogTaskDraftCommitReason,
  type BacklogTaskEditorFields,
  type BacklogTaskEditorTarget,
} from "@/features/backlog/backlog-task-editor";
import { moveBacklogItemWithUndo } from "@/features/backlog/backlog-item-moves";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";
import { buildProjectTaskOptions } from "@/features/projects/project-task-options";
import {
  useLocalProjects,
  useLocalState,
  useLocalWorkItems,
} from "@/lib/local-hooks";
import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";
import { getOtherSourceStates } from "@/features/backlog/backlog-item-moves";

/** Lets a host save the draft before it loads another item into the same form. */
export interface BacklogItemEditorFormHandle {
  /** Saves a valid draft. Returns false, and shows the error, when the draft blocks the switch. */
  commitBeforeSwitch: () => Promise<boolean>;
}

const ESTIMATE_LABELS: Record<BacklogEstimateFieldKey, string> = {
  originalEstimateHours: "Original",
  remainingEstimateHours: "Remaining",
  completedEstimateHours: "Completed",
};

const ESTIMATE_ERROR_KEYS = {
  originalEstimateHours: "originalEstimateError",
  remainingEstimateHours: "remainingEstimateError",
  completedEstimateHours: "completedEstimateError",
} as const;

function getEditorTitle(target: BacklogTaskEditorTarget, isSubitem: boolean) {
  if (target.kind === "edit") {
    return isSubitem ? "Edit subitem" : "Edit backlog item";
  }

  return isSubitem ? "New subitem" : "New backlog item";
}

/** "#123 · Connection · Project · Type" for synced items, linked to the source when known. */
function getSourceMetaLabel(workItem: LocalWorkItem) {
  if (workItem.source === "manual") {
    return "";
  }

  const reference =
    workItem.source === "azure_devops"
      ? parseWorkItemReference(workItem.sourceId)
      : undefined;
  return [
    reference ? `#${reference}` : undefined,
    workItem.sourceConnectionLabel,
    workItem.sourceProjectName,
    workItem.sourceWorkItemType,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The one form for creating and editing a backlog item. Hosts (the side panel, the
 * narrow dialog) only supply the container, so keys, buttons and save rules stay the
 * same everywhere. Save: the Save button, Enter in the title, or Cmd/Ctrl+Enter.
 * Escape, Cancel or × discard the draft.
 *
 * The draft is seeded once, on mount, so hosts key the form by target. A host that can
 * swap containers mid-edit passes the draft back in through `initialFields`.
 */
export function BacklogItemEditorForm({
  target,
  onClose,
  onAction,
  ref,
  titleAs: Title = "h2",
  className,
  initialFields,
  onFieldsChange,
}: {
  target: BacklogTaskEditorTarget;
  onClose: () => void;
  /**
   * Runs an action from the "…" menu. The form saves a valid draft first and passes
   * the item with the draft applied. An invalid draft blocks the action.
   */
  onAction: (workItem: LocalWorkItem, actionId: BacklogItemActionId) => void;
  ref?: Ref<BacklogItemEditorFormHandle>;
  /** A dialog host passes its title component so the heading labels the dialog. */
  titleAs?: ElementType;
  className?: string;
  /** An unsaved draft to resume instead of the target's seed. */
  initialFields?: BacklogTaskEditorFields;
  /** Reports every draft change, so a host can carry it to another container. */
  onFieldsChange?: (fields: BacklogTaskEditorFields) => void;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const workItems = useLocalWorkItems();
  const workItem = target.kind === "edit" ? target.workItem : undefined;
  const parent = target.kind === "create" ? target.parent : undefined;
  const [fields, setFields] = useState(
    () => initialFields ?? createBacklogTaskEditorSeed(target),
  );
  const onFieldsChangeRef = useRef(onFieldsChange);
  onFieldsChangeRef.current = onFieldsChange;
  useEffect(() => {
    onFieldsChangeRef.current?.(fields);
  }, [fields]);
  // A blocked save or switch reveals the title error even before the title changed.
  const [showErrors, setShowErrors] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const pendingCommitRef = useRef<Promise<boolean> | null>(null);

  const subitems = useMemo(
    () => (workItem ? getDirectChildWorkItems(workItem, workItems) : []),
    [workItem, workItems],
  );
  const editor = evaluateBacklogTaskEditor(fields, target, {
    subitemTotals: subitems.length > 0 ? sumSubitemEstimates(subitems) : null,
  });
  const { validation } = editor;

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project._id,
        label: project.code
          ? `[${project.code}] ${getLocalProjectDisplayName(project)}`
          : getLocalProjectDisplayName(project),
        keywords: [
          project.name,
          getLocalProjectDisplayName(project),
          project.code ?? "",
        ],
      })),
    [projects],
  );
  const availableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === fields.projectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [fields.projectId, projects],
  );
  const taskOptions = useMemo(
    () => buildProjectTaskOptions(availableTasks),
    [availableTasks],
  );
  const statusOptions = useMemo(
    () => buildWorkflowStateOptions(state.workflowStates),
    [state.workflowStates],
  );

  useImperativeHandle(ref, () => ({
    commitBeforeSwitch: () => commit("switch"),
  }));

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  function updateFields(patch: Partial<BacklogTaskEditorFields>) {
    setFields((current) => ({ ...current, ...patch }));
  }

  /** A new project starts on its first active task, or none. */
  function changeProject(projectId: string) {
    const firstTask = projects
      .find((project) => project._id === projectId)
      ?.tasks.find((task) => task.status === "active");
    updateFields({ projectId, taskId: firstTask?._id ?? "" });
  }

  /** Writes the draft when it has something to save. Returns false when it is blocked. */
  function commit(reason: BacklogTaskDraftCommitReason) {
    if (pendingCommitRef.current) return pendingCommitRef.current;
    const pending = commitDraft(reason).finally(() => {
      pendingCommitRef.current = null;
    });
    pendingCommitRef.current = pending;
    return pending;
  }

  async function commitDraft(reason: BacklogTaskDraftCommitReason) {
    const result = commitBacklogTaskDraft(editor, reason);
    switch (result.kind) {
      case "invalid":
        setShowErrors(true);
        return false;
      case "create": {
        // A new item created in a done state closes like a moved one.
        const closes = isDoneWorkflowState(
          localStore.snapshot().workflowStates,
          result.draft.workflowStateId,
        );
        const createdId = localStore.addWorkItem(
          closes
            ? { ...result.draft, workflowStateId: undefined }
            : result.draft,
        );
        const created = localStore
          .snapshot()
          .workItems.find((item) => item._id === createdId);
        if (closes && created && result.draft.workflowStateId) {
          return await moveBacklogItemWithUndo(
            created,
            result.draft.workflowStateId,
          );
        }
        return true;
      }
      case "update":
        if (workItem) {
          // Every state edit uses the move workflow, including source writes.
          const { workflowStateId, ...patch } = result.patch;
          const changesLifecycle =
            "workflowStateId" in result.patch &&
            workflowStateId !== workItem.workflowStateId;
          const saved = localStore
            .snapshot()
            .workItems.find((item) => item._id === workItem._id);
          if (!saved) return false;
          if (changesLifecycle) {
            return await moveBacklogItemWithUndo(saved, workflowStateId, {
              patch,
            });
          }
          // A save has no Undo, unless the description's timelog also set
          // the project or task.
          offerUndo(localStore.saveWorkItemEdits(workItem._id, result.patch), {
            title: "Project and task set from the description",
            subject: "backlog item",
          });
        }
        return true;
      case "unchanged":
        return true;
    }
  }

  async function save() {
    if (await commit("save")) {
      onClose();
    }
  }

  async function handleAction(actionId: BacklogItemActionId) {
    if (!workItem || !(await commit("switch"))) {
      return;
    }

    const saved = localStore
      .snapshot()
      .workItems.find((item) => item._id === workItem._id);
    if (saved) onAction(saved, actionId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Pickers, menus and confirmations render in portals; their keys stay theirs.
    // Fields that already handled the key mark the event as handled.
    if (
      event.defaultPrevented ||
      !(event.target instanceof Node) ||
      !rootRef.current?.contains(event.target)
    ) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  }

  function saveOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    save();
  }

  const idPrefix = `backlog-item-editor-${workItem?._id ?? parent?._id ?? "new"}`;
  const titleError =
    showErrors || editor.hasChanges ? validation.titleError : null;
  const sourceMetaLabel = workItem ? getSourceMetaLabel(workItem) : "";

  return (
    <div
      ref={rootRef}
      className={cn("flex flex-col gap-4", className)}
      onKeyDown={handleKeyDown}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Title className="text-sm font-semibold">
            {getEditorTitle(target, editor.isSubitem)}
          </Title>
          {parent ? (
            <span className="truncate text-xs text-muted-foreground">
              Under {parent.title}
            </span>
          ) : null}
          {sourceMetaLabel ? (
            workItem?.sourceUrl ? (
              <a
                href={workItem.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="backlog-task-meta backlog-task-meta-link truncate"
              >
                {sourceMetaLabel}
              </a>
            ) : (
              <span className="backlog-task-meta truncate">
                {sourceMetaLabel}
              </span>
            )
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {workItem ? (
            <ObjectActionsButton
              actions={getBacklogItemActions(workItem, {
                isRunning: Boolean(
                  findWorkItemTimer(state.timers, workItem._id),
                ),
                isSubitem: editor.isSubitem,
                isSnoozed: isBacklogItemSnoozed(workItem, Date.now()),
                subitemCount: subitems.length,
                isEditing: true,
                settleOpensDialog: settleOpensDialog(workItem),
                otherSourceStateCount: getOtherSourceStates(workItem).length,
              })}
              onAction={handleAction}
              label={`Actions for ${workItem.title}`}
            />
          ) : null}
          <TooltipButton
            label="Close"
            render={<Button variant="ghost" size="icon" onClick={onClose} />}
          >
            <X />
          </TooltipButton>
        </div>
      </header>

      {workItem && hasWorkItemEstimateSyncIssue(workItem) ? (
        <p className="flex items-center gap-2 text-xs text-amber-300">
          <AlertTriangle className="size-3.5 shrink-0" />
          Estimate sync needs review in Sync review.
        </p>
      ) : null}

      <FieldGroup className="gap-4">
        <Field data-invalid={Boolean(titleError)}>
          <FieldLabel htmlFor={`${idPrefix}-title`}>
            {editor.isSubitem ? "Subitem" : "Item"}
          </FieldLabel>
          <Input
            ref={titleInputRef}
            id={`${idPrefix}-title`}
            value={fields.title}
            onChange={(event) => updateFields({ title: event.target.value })}
            onKeyDown={saveOnEnter}
            placeholder={editor.isSubitem ? "Subitem name" : "Item name"}
            aria-invalid={Boolean(titleError)}
          />
          {titleError ? (
            <span className="field-error">{titleError}</span>
          ) : null}
        </Field>

        <div
          className={cn(
            "grid gap-3",
            !editor.isSubitem && "grid-cols-[5rem_minmax(0,1fr)]",
          )}
        >
          {!editor.isSubitem ? (
            <Field data-invalid={Boolean(validation.priorityError)}>
              <FieldLabel htmlFor={`${idPrefix}-priority`}>Priority</FieldLabel>
              <OptionSelect
                id={`${idPrefix}-priority`}
                size="default"
                value={fields.priority}
                onChange={(priority) => updateFields({ priority })}
                invalid={Boolean(validation.priorityError)}
                options={[
                  { value: "", label: NO_PRIORITY_NAME },
                  ...PRIORITY_LEVELS.map(({ level, name }) => ({
                    value: String(level),
                    label: name,
                  })),
                ]}
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel>Workflow state</FieldLabel>
            <SearchableSelect
              value={fields.workflowStateId}
              options={statusOptions}
              onChange={(workflowStateId) => updateFields({ workflowStateId })}
              placeholder="No state"
              clearLabel="No state"
              emptyMessage="No matching workflow states"
              ariaLabel="Workflow state"
            />
          </Field>
        </div>
        {validation.priorityError ? (
          <span className="field-error -mt-2">{validation.priorityError}</span>
        ) : null}
        {editor.priorityReset !== null || editor.statusReset !== null ? (
          <div className="-mt-2 flex flex-wrap gap-2">
            {editor.priorityReset !== null ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateFields({ priority: editor.priorityReset ?? "" })
                }
              >
                Reset priority to synced
              </Button>
            ) : null}
            {editor.statusReset !== null ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateFields({ workflowStateId: editor.statusReset ?? "" })
                }
              >
                Reset state to synced
              </Button>
            ) : null}
          </div>
        ) : null}

        <Field>
          <FieldLabel>Project</FieldLabel>
          <SearchableSelect
            value={fields.projectId}
            options={projectOptions}
            onChange={changeProject}
            placeholder="No project"
            clearLabel="No project"
            emptyMessage="No matching projects"
            ariaLabel="Project"
          />
        </Field>
        <Field>
          <FieldLabel>Task mapping</FieldLabel>
          <SearchableSelect
            value={fields.taskId}
            options={taskOptions}
            onChange={(taskId) => updateFields({ taskId })}
            placeholder={
              fields.projectId ? "Select task" : "Pick a project first"
            }
            clearLabel={fields.projectId ? "No task" : undefined}
            emptyMessage={
              fields.projectId ? "No matching tasks" : "Pick a project first"
            }
            ariaLabel="Task mapping"
            disabled={!fields.projectId || availableTasks.length === 0}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`${idPrefix}-description`}>
            Description
          </FieldLabel>
          <MarkdownEditor
            id={`${idPrefix}-description`}
            aria-label="Description"
            value={fields.description}
            onChange={(description) => updateFields({ description })}
            placeholder="Markdown supported (optional)"
            minLines={4}
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          {BACKLOG_ESTIMATE_FIELD_KEYS.map((key) => {
            const error = validation[ESTIMATE_ERROR_KEYS[key]];
            const resetValue = editor.estimateResets[key];
            const label = ESTIMATE_LABELS[key];
            return (
              <Field key={key} data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={`${idPrefix}-${key}`}>{label}</FieldLabel>
                <div className="relative">
                  <Input
                    id={`${idPrefix}-${key}`}
                    className={cn(
                      "font-mono",
                      resetValue !== undefined && "pr-8",
                    )}
                    inputMode="decimal"
                    value={fields[key]}
                    onChange={(event) =>
                      updateFields({ [key]: event.target.value })
                    }
                    placeholder="0"
                    aria-invalid={Boolean(error)}
                  />
                  {resetValue !== undefined ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="absolute top-1/2 right-1 -translate-y-1/2"
                            aria-label={`Reset ${label.toLowerCase()} estimate to subitem total, ${resetValue}`}
                            onClick={() => updateFields({ [key]: resetValue })}
                          />
                        }
                      >
                        <RotateCcw />
                      </TooltipTrigger>
                      <TooltipContent>
                        Reset to subitem total ({resetValue})
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
                {error ? <span className="field-error">{error}</span> : null}
              </Field>
            );
          })}
        </div>

        {editor.isSynced ? (
          <Field orientation="horizontal">
            <Checkbox
              id={`${idPrefix}-keep`}
              checked={fields.keepWhenMissingFromSync}
              onCheckedChange={(keepWhenMissingFromSync) =>
                updateFields({ keepWhenMissingFromSync })
              }
            />
            <FieldContent>
              <FieldLabel htmlFor={`${idPrefix}-keep`}>
                Keep when missing from sync
              </FieldLabel>
              <FieldDescription className="text-xs">
                Do not archive this item when it disappears from the synced
                source list.
              </FieldDescription>
            </FieldContent>
          </Field>
        ) : null}
      </FieldGroup>

      <footer className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"

          disabled={!validation.canSave}
          onClick={save}
        >
          <Save data-icon="inline-start" />
          Save
        </Button>
      </footer>
    </div>
  );
}

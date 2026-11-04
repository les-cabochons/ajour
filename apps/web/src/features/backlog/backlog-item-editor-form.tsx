import {
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
  type Ref,
  type CSSProperties,
} from "react";
import {
  RiAlarmWarningLine as AlertTriangle,
  RiCloseLine as X,
  RiFolderLine as ProjectChipIcon,
  RiLoader5Line as StateIcon,
  RiRefreshLine as RotateCcw,
} from "@remixicon/react";
import { ProjectIcon } from "@/lib/project-icons";
import { getWorkflowStateFills } from "@/domain/backlog/workflow-state-fill";
import { stateDotStyle } from "@/features/backlog/state-dot";
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
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getPriorityRefusal,
  isBacklogItemSnoozed,
} from "@/domain/backlog/backlog-item-lifecycle";
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
import { PriorityIcon } from "@/features/backlog/priority-icon";
import { findWorkItemTimer } from "@/domain/time/running-entry";
import {
  OptionSelect,
  type SelectOption,
  type SelectOptionGroup,
} from "@/components/ui/option-select";
import {
  BACKLOG_ESTIMATE_FIELD_KEYS,
  commitBacklogTaskDraft,
  createBacklogTaskEditorFields,
  createBacklogTaskEditorSeed,
  evaluateBacklogTaskEditor,
  followChangedItem,
  sumSubitemEstimates,
  type BacklogEstimateFieldKey,
  type BacklogTaskDraftCommitReason,
  type BacklogTaskEditorFields,
  type BacklogTaskEditorTarget,
} from "@/features/backlog/backlog-task-editor";
import { moveBacklogItemWithUndo } from "@/features/backlog/backlog-item-moves";
import {
  canWriteToSource,
  sendPendingSourceWrites,
} from "@/features/backlog/backlog-source-writes";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";
import { buildProjectTaskOptions } from "@/features/projects/project-task-options";
import {
  createTaskFromPicker,
  describeCreateTaskRow,
} from "@/features/projects/task-creation";
import {
  useLocalProjects,
  useLocalState,
  useLocalWorkItems,
} from "@/lib/local-hooks";
import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";
import { DescriptionText } from "@/features/backlog/description-links";
import {
  DescriptionLength,
  DescriptionSaveStatus,
  SourceChangedWarning,
  SyncedDescriptionNote,
  confirmDescriptionLoss,
  useDescriptionAccess,
  useDescriptionLimit,
  followDescriptionDraft,
  useSourceDescriptionCheck,
  writesToSource,
} from "@/features/backlog/synced-description";
import { descriptionLosses } from "@/domain/backlog/description-sync";
import {
  clearDescriptionDraftConflict,
  saveSyncedDescription,
} from "@/lib/description-save";
import { getOtherSourceStates } from "@/features/backlog/backlog-item-moves";
import { withEventAttribution } from "@/lib/wide-events";

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
  surface = "editor",
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
  surface?: "editor" | "dialog";
  /** An unsaved draft to resume instead of the target's seed. */
  initialFields?: BacklogTaskEditorFields;
  /** Reports every draft change, so a host can carry it to another container. */
  onFieldsChange?: (fields: BacklogTaskEditorFields) => void;
}) {
  const editorSurface = surface;
  // Unique per mounted form: the sidebar's New backlog item dialog can open
  // over the Backlog page's own new item form, and their labels must not mix.
  const idPrefix = `backlog-item-editor-${useId()}`;
  const state = useLocalState();
  const projects = useLocalProjects();
  const workItems = useLocalWorkItems();
  const workItem = target.kind === "edit" ? target.workItem : undefined;
  // The item as it is now, which a sync may have changed since the draft began.
  const currentItem =
    (workItem && workItems.find((item) => item._id === workItem._id)) ??
    workItem;
  const currentDescription = currentItem?.description;
  const descriptionAccessState = useDescriptionAccess(currentItem);
  // An archived item's form is read-only elsewhere; its description field stays as it was.
  const descriptionEditable =
    descriptionAccessState.editable ||
    descriptionAccessState.reason === "archived";
  const descriptionWritesToSource = Boolean(
    currentItem && writesToSource(currentItem, descriptionAccessState),
  );
  const descriptionLimit = useDescriptionLimit(
    currentItem,
    descriptionAccessState,
  );
  const latestDescription = useSourceDescriptionCheck(
    currentItem,
    descriptionWritesToSource,
  );
  const parent = target.kind === "create" ? target.parent : undefined;
  const [fields, setFields] = useState(
    () => initialFields ?? createBacklogTaskEditorSeed(target),
  );
  // The item's fields when the draft started. A sync can change the item under
  // an open draft: a field the user has not touched follows it, and only the
  // fields the user changed are saved.
  const [base, setBase] = useState(() => createBacklogTaskEditorSeed(target));
  const currentFields = useMemo(
    () =>
      target.kind === "edit" && currentItem
        ? createBacklogTaskEditorFields(currentItem)
        : undefined,
    [target.kind, currentItem],
  );
  useEffect(() => {
    if (!currentFields) return;
    const keys = Object.keys(
      currentFields,
    ) as (keyof BacklogTaskEditorFields)[];
    if (keys.every((key) => currentFields[key] === base[key])) return;
    // A description written to its source takes the source's change in, so
    // saving it never reverts that change.
    const draftDescription = fields.description;
    const description =
      descriptionWritesToSource &&
      workItem &&
      draftDescription !== base.description &&
      currentFields.description !== base.description
        ? followDescriptionDraft(
            workItem._id,
            base.description,
            draftDescription,
            currentFields.description,
          )
        : undefined;
    setFields((current) => {
      const next = followChangedItem(current, base, currentFields);
      return description !== undefined &&
        current.description === draftDescription
        ? { ...next, description }
        : next;
    });
    setBase(currentFields);
  }, [
    currentFields,
    base,
    fields.description,
    descriptionWritesToSource,
    workItem,
  ]);
  // A new draft starts without a conflict; a draft carried here keeps its own.
  const startedFresh = useRef(!initialFields);
  const openedItemId = useRef(workItem?._id);
  useEffect(() => {
    if (startedFresh.current && openedItemId.current) {
      clearDescriptionDraftConflict(openedItemId.current);
    }
  }, []);
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
    descriptionReadOnly: !descriptionEditable,
    base,
    descriptionLimit,
  });
  const { validation } = editor;
  const noPriorityRefusal = currentItem
    ? getPriorityRefusal(currentItem, undefined)
    : undefined;

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project._id,
        // A chip shows the project's mark and name; its code still finds it.
        label: getLocalProjectDisplayName(project),
        icon: (
          <ProjectIcon
            icon={project.icon}
            color={project.color}
            className="size-3.5 shrink-0"
          />
        ),
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
  const selectedProject = projects.find(
    (project) => project._id === fields.projectId,
  );
  const statusOptions = useMemo(() => {
    const fills = getWorkflowStateFills(state.workflowStates);
    return buildWorkflowStateOptions(state.workflowStates).map((option) => {
      const workflowState = state.workflowStates.find(
        (candidate) => candidate._id === option.value,
      );
      return {
        ...option,
        icon: (
          <span
            className="backlog-state-dot"
            style={stateDotStyle(workflowState?.color, fills.get(option.value))}
          />
        ),
      };
    });
  }, [state.workflowStates]);

  useImperativeHandle(ref, () => ({
    commitBeforeSwitch: () => commit("switch"),
  }));

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  function updateFields(patch: Partial<BacklogTaskEditorFields>) {
    setFields((current) => ({ ...current, ...patch }));
  }

  /**
   * Creates the typed task in the draft's project and picks it. Undo puts the
   * previous task back while the draft still holds the created one.
   */
  function createTask(projectId: string, name: string) {
    const previous = fields.taskId;
    let createdId = "";
    void createTaskFromPicker({
      projectId,
      name,
      onCreated: (taskId) => {
        createdId = taskId;
        updateFields({ taskId });
      },
      onUndone: () =>
        setFields((current) =>
          current.taskId === createdId
            ? { ...current, taskId: previous }
            : current,
        ),
    });
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

  // The commit of the latest render, for a commit that waited on the user.
  const latestCommit = useRef(commitDraft);
  latestCommit.current = commitDraft;

  async function commitDraft(
    reason: BacklogTaskDraftCommitReason,
    /** Losses the user already allowed in a save that asked. */
    allowedBefore: readonly string[] = [],
  ): Promise<boolean> {
    const result = commitBacklogTaskDraft(editor, reason);
    switch (result.kind) {
      case "invalid":
        setShowErrors(true);
        return false;
      case "create": {
        // A new item created in a done state closes like a moved one. A new
        // manual item has no subitems and no source, so nothing needs asking.
        const { workflowStates } = localStore.snapshot();
        const closeIn = isDoneWorkflowState(
          workflowStates,
          result.draft.workflowStateId,
        )
          ? result.draft.workflowStateId
          : undefined;
        const { undoToken } = withEventAttribution(
          { surface: editorSurface },
          () =>
            localStore.saveNewWorkItem(
              closeIn
                ? { ...result.draft, workflowStateId: undefined }
                : result.draft,
              closeIn,
            ),
        );
        const doneName = workflowStates.find(
          (state) => state._id === closeIn,
        )?.name;
        offerUndo(undoToken, {
          title: doneName
            ? `Closed in ${doneName}`
            : "Project and task set from the description",
          subject: "backlog item",
        });
        return true;
      }
      case "update":
        if (workItem) {
          // A description written with losses asks first; Cancel keeps the draft.
          let allowedLoss: readonly string[] = [];
          if (
            "description" in result.patch &&
            descriptionWritesToSource &&
            currentItem
          ) {
            const losses = descriptionLosses(currentItem);
            if (losses.some((loss) => !allowedBefore.includes(loss))) {
              const confirmed = await confirmDescriptionLoss(currentItem);
              if (!confirmed) return false;
              // A sync can change the draft and the item while the dialog
              // is open: commit them as they are now.
              return await latestCommit.current(reason, confirmed);
            }
            allowedLoss = allowedBefore;
          }
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
            const moved = await withEventAttribution(
              { surface: editorSurface },
              () => moveBacklogItemWithUndo(saved, workflowStateId, { patch }),
            );
            if (moved) writeDescription(patch, allowedLoss);
            return moved;
          }
          // A save has no Undo, unless the description's timelog also set
          // the project or task. So a new priority level goes to the source
          // at once.
          const writesPriority =
            "priority" in result.patch && canWriteToSource(saved);
          withEventAttribution({ surface: editorSurface }, () =>
            offerUndo(
              localStore.saveWorkItemEdits(workItem._id, result.patch, {
                writesToSource: writesPriority,
              }),
              {
                title: "Project and task set from the description",
                subject: "backlog item",
              },
            ),
          );
          if (writesPriority) void sendPendingSourceWrites([workItem._id]);
          writeDescription(result.patch, allowedLoss);
        }
        return true;
      case "unchanged":
        return true;
    }
  }

  /** Writes a saved description to its source, in the background. */
  function writeDescription(
    patch: Partial<Pick<LocalWorkItem, "description">>,
    allowedLoss: readonly string[],
  ) {
    if (workItem && "description" in patch && descriptionWritesToSource) {
      void withEventAttribution({ surface: editorSurface }, () =>
        saveSyncedDescription(workItem._id, "save", allowedLoss, false, {
          surface: editorSurface,
        }),
      );
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

  // The title's error waits for the title itself, or a save: a draft that
  // opens with a group's state or project preset is not yet wrong.
  const titleError =
    showErrors || fields.title !== base.title ? validation.titleError : null;
  const sourceMetaLabel = workItem ? getSourceMetaLabel(workItem) : "";

  // Each estimate is a chip with its value typed in place (forms council
  // round 6): "Original 8", "Remaining 5", "Completed 3".
  const estimateChips = BACKLOG_ESTIMATE_FIELD_KEYS.map((key) => {
    const error = validation[ESTIMATE_ERROR_KEYS[key]];
    const resetValue = editor.estimateResets[key];
    const label = ESTIMATE_LABELS[key];
    return (
      <div
        key={key}
        className="composer-chip composer-estimate"
        data-invalid={error ? "true" : undefined}
      >
        <label htmlFor={`${idPrefix}-${key}`}>{label}</label>
        <input
          id={`${idPrefix}-${key}`}
          className="composer-estimate-input"
          inputMode="decimal"
          autoComplete="off"
          value={fields[key]}
          onChange={(event) => updateFields({ [key]: event.target.value })}
          placeholder="–"
          aria-invalid={Boolean(error)}
        />
        {resetValue !== undefined ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
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
    );
  });
  const estimateErrors = BACKLOG_ESTIMATE_FIELD_KEYS.map((key) => {
    const error = validation[ESTIMATE_ERROR_KEYS[key]];
    return error ? (
      <span key={key} className="field-error">
        {ESTIMATE_LABELS[key]}: {error}
      </span>
    ) : null;
  });

  return (
    <div
      ref={rootRef}
      className={cn("flex flex-col gap-4", className)}
      onKeyDown={handleKeyDown}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* In a dialog the title takes the dialog's size, as every dialog's does. */}
          <Title className="composer-kicker">
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
              onAction={(actionId) =>
                withEventAttribution({ surface: editorSurface }, () =>
                  handleAction(actionId),
                )
              }
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

      {/* A composer, as Linear's: the title and description are text to
          write in, not boxes, and the properties are chips that say their
          value (forms council round 6). */}
      <FieldGroup className="composer gap-3">
        <Field data-invalid={Boolean(titleError)}>
          <FieldLabel htmlFor={`${idPrefix}-title`} className="sr-only">
            {editor.isSubitem ? "Subitem" : "Item"}
          </FieldLabel>
          <input
            ref={titleInputRef}
            id={`${idPrefix}-title`}
            className="composer-title"
            value={fields.title}
            onChange={(event) => updateFields({ title: event.target.value })}
            onKeyDown={saveOnEnter}
            placeholder={editor.isSubitem ? "Subitem title" : "Item title"}
            autoComplete="off"
            aria-invalid={Boolean(titleError)}
          />
          {titleError ? (
            <span className="field-error">{titleError}</span>
          ) : null}
        </Field>

        {/* The writing comes first: the name, then its description, then
            the properties (forms council round 3). */}
        {/* A long description scrolls inside its editor, so the properties
            and the buttons stay in reach. */}
        <Field
          style={{ "--markdown-editor-max-height": "14rem" } as CSSProperties}
        >
          <FieldLabel htmlFor={`${idPrefix}-description`} className="sr-only">
            Description
          </FieldLabel>
          {descriptionEditable ? (
            <MarkdownEditor
              id={`${idPrefix}-description`}
              aria-label="Description"
              className="composer-body"
              value={fields.description}
              onChange={(description) => updateFields({ description })}
              placeholder="Add description…"
              minLines={1}
            />
          ) : null}
          {descriptionEditable && currentItem ? (
            <>
              <DescriptionLength
                text={fields.description}
                limit={descriptionLimit}
              />
              <SourceChangedWarning
                item={currentItem}
                latest={latestDescription}
                typed={fields.description !== base.description}
              />
              <DescriptionSaveStatus
                item={currentItem}
                access={descriptionAccessState}
              />
            </>
          ) : null}
          {descriptionEditable ? null : (
            <div id={`${idPrefix}-description`}>
              {currentDescription ? (
                <DescriptionText body={currentDescription} />
              ) : (
                <p className="text-sm text-muted-foreground">No description.</p>
              )}
              {workItem ? (
                <SyncedDescriptionNote
                  item={currentItem ?? workItem}
                  access={descriptionAccessState}
                />
              ) : null}
            </div>
          )}
        </Field>

        <section aria-label="Properties" className="composer-chips">
          {!editor.isSubitem ? (
            <OptionSelect
              id={`${idPrefix}-priority`}
              label="Priority"
              size="sm"
              iconLabel
              className="composer-chip"
              value={fields.priority}
              onChange={(priority) => updateFields({ priority })}
              invalid={Boolean(validation.priorityError)}
              {...withSyncedFirst(
                [
                  {
                    value: "",
                    label: NO_PRIORITY_NAME,
                    disabledReason: noPriorityRefusal,
                    icon: <PriorityIcon priority={undefined} decorative />,
                  },
                  ...PRIORITY_LEVELS.map(({ level, name }) => ({
                    value: String(level),
                    label: name,
                    icon: <PriorityIcon priority={level} decorative />,
                  })),
                ],
                editor.priorityReset,
                "Other levels",
              )}
            />
          ) : null}
          <SearchableSelect
            value={fields.workflowStateId}
            options={syncedStateFirst(statusOptions, editor.statusReset)}
            onChange={(workflowStateId) => updateFields({ workflowStateId })}
            className="composer-chip"
            popoverMinWidth={240}
            placeholderIcon={<StateIcon aria-hidden className="size-3.5" />}
            placeholder="State"
            clearLabel="No state"
            emptyMessage="No matching workflow states"
            ariaLabel="Workflow state"
          />
          <SearchableSelect
            value={fields.projectId}
            options={projectOptions}
            onChange={changeProject}
            className="composer-chip"
            popoverMinWidth={260}
            placeholderIcon={
              <ProjectChipIcon aria-hidden className="size-3.5" />
            }
            placeholder="Project"
            clearLabel="No project"
            emptyMessage="No matching projects"
            ariaLabel="Project"
          />
          {/* The task waits for its project, as Linear hides what can't be
              set yet. */}
          {selectedProject ? (
            <SearchableSelect
              value={fields.taskId}
              options={taskOptions}
              onChange={(taskId) => updateFields({ taskId })}
              className="composer-chip"
              popoverMinWidth={260}
              placeholder="Task"
              clearLabel={fields.projectId ? "No task" : undefined}
              emptyMessage={
                fields.projectId ? "No matching tasks" : "Pick a project first"
              }
              ariaLabel="Task mapping"
              disabled={!selectedProject}
              create={
                selectedProject
                  ? {
                      label: (text) =>
                        describeCreateTaskRow(selectedProject, text),
                      onCreate: (text) => createTask(selectedProject._id, text),
                    }
                  : undefined
              }
            />
          ) : null}
          {estimateChips}
          {editor.isSynced ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <label className="composer-chip composer-estimate composer-toggle" />
                }
              >
                <Checkbox
                  id={`${idPrefix}-keep`}
                  checked={fields.keepWhenMissingFromSync}
                  onCheckedChange={(keepWhenMissingFromSync) =>
                    updateFields({ keepWhenMissingFromSync })
                  }
                />
                <span>Keep when missing</span>
              </TooltipTrigger>
              <TooltipContent>
                Don't archive this item when it disappears from the synced
                source list.
              </TooltipContent>
            </Tooltip>
          ) : null}
        </section>
        {validation.priorityError ? (
          <span className="field-error">{validation.priorityError}</span>
        ) : null}
        {estimateErrors}
      </FieldGroup>

      <footer className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!validation.canSave} onClick={save}>
          {/* A new record's button names what it makes (forms council round 3). */}
          {target.kind === "create"
            ? editor.isSubitem
              ? "Create subitem"
              : "Create item"
            : "Save"}
        </Button>
      </footer>
    </div>
  );
}

/**
 * A synced item's picker lists the source's value first, under "Synced", so
 * going back to it is a pick in the menu, not a button under the field
 * (forms council round 5). Without a synced value, the options stay as they
 * are.
 */
function withSyncedFirst<T extends string>(
  options: SelectOption<T>[],
  synced: string | null,
  otherLabel: string,
): { options?: SelectOption<T>[]; groups?: SelectOptionGroup<T>[] } {
  const match = options.find((option) => option.value === synced);
  if (synced === null || !match) return { options };
  return {
    groups: [
      { label: "Synced", options: [match] },
      {
        label: otherLabel,
        options: options.filter((option) => option !== match),
      },
    ],
  };
}

/** The workflow states with the synced one first, under "Synced". */
function syncedStateFirst(
  options: SearchableSelectOption[],
  synced: string | null,
): SearchableSelectOption[] {
  const match = options.find((option) => option.value === synced);
  if (synced === null || !match) return options;
  return [
    { ...match, group: "Synced" },
    ...options
      .filter((option) => option !== match)
      .map((option) => ({ ...option, group: option.group ?? "Other states" })),
  ];
}

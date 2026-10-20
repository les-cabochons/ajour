import type { LocalWorkItem, LocalWorkItemDraft } from "@/domain/local-state";
import { normalizeDescriptionText } from "@/domain/backlog/description-sync";
import type { WorkItemPatch } from "@/domain/backlog/work-item-transitions";
import { isSubtaskWorkItem } from "@/domain/backlog/work-item-hierarchy";
import { isPriorityLevel, type PriorityLevel } from "@/domain/backlog/priority";

/**
 * The editor model for backlog items. The side panel and the narrow dialog render the
 * same form; this module owns its draft: seeding, parsing, validation, the patch or new
 * item that Save writes, and the reset values the form offers.
 */
export interface BacklogTaskEditorFields {
  title: string;
  description: string;
  priority: string;
  workflowStateId: string;
  parentWorkItemId: string;
  projectId: string;
  taskId: string;
  originalEstimateHours: string;
  remainingEstimateHours: string;
  completedEstimateHours: string;
  keepWhenMissingFromSync: boolean;
}

export interface BacklogTaskEditorValidation {
  titleError: string | null;
  parentError: string | null;
  priorityError: string | null;
  originalEstimateError: string | null;
  remainingEstimateError: string | null;
  completedEstimateError: string | null;
  canSave: boolean;
}

/** What the editor works on: a saved item, or a new item, under `parent` for a subitem. */
export type BacklogTaskEditorTarget =
  | { kind: "edit"; workItem: LocalWorkItem }
  | { kind: "create"; parent?: LocalWorkItem };

export const BACKLOG_ESTIMATE_FIELD_KEYS = [
  "originalEstimateHours",
  "remainingEstimateHours",
  "completedEstimateHours",
] as const;

export type BacklogEstimateFieldKey =
  (typeof BACKLOG_ESTIMATE_FIELD_KEYS)[number];

/** The sum of a parent's subitem estimates. Missing estimates count as 0. */
export type SubitemEstimateTotals = Record<BacklogEstimateFieldKey, number>;

/** What a draft means right now: validation, changes, and the resets the form offers. */
export interface BacklogTaskEditorState {
  isNew: boolean;
  isSubitem: boolean;
  /** The item came from a plugin, so it has synced values to reset to. */
  isSynced: boolean;
  validation: BacklogTaskEditorValidation;
  hasChanges: boolean;
  /**
   * Field values for "Reset to subitem total", keyed by the estimates that differ from
   * the total. Empty for items without subitems.
   */
  estimateResets: Partial<Record<BacklogEstimateFieldKey, string>>;
  /** The synced priority to restore, or `null` when there is nothing to reset. */
  priorityReset: string | null;
  /** The synced status to restore, or `null` when there is nothing to reset. */
  statusReset: string | null;
  /** The new item Save creates, when the target is new and the draft is valid. */
  draft: LocalWorkItemDraft | null;
  /** The changed fields Save writes, when the target is saved and the draft is valid. */
  patch: WorkItemPatch | null;
}

/**
 * What leaving a draft writes. `unchanged` writes nothing, `create` adds `draft`,
 * `update` applies `patch`, and `invalid` keeps the editor open with `error` shown.
 */
export type BacklogTaskDraftCommit =
  | { kind: "unchanged" }
  | { kind: "create"; draft: LocalWorkItemDraft }
  | { kind: "update"; patch: WorkItemPatch }
  | { kind: "invalid"; error: string };

/**
 * Why the draft is being left. `save` is the Save button or its keys. `switch` is the
 * side panel loading another item or running an action, where an untouched new item
 * is simply dropped.
 */
export type BacklogTaskDraftCommitReason = "save" | "switch";

export const EMPTY_BACKLOG_TASK_EDITOR_FIELDS: BacklogTaskEditorFields = {
  title: "",
  description: "",
  priority: "",
  workflowStateId: "",
  parentWorkItemId: "",
  projectId: "",
  taskId: "",
  originalEstimateHours: "",
  remainingEstimateHours: "",
  completedEstimateHours: "",
  keepWhenMissingFromSync: false,
};

export function formatPriorityInput(priority?: PriorityLevel) {
  return priority ? String(priority) : "";
}

/** "" is No priority. Returns null for anything but a level. */
export function parsePriorityInput(value: string) {
  if (value.trim() === "") {
    return undefined;
  }

  const parsedValue = Number(value);
  return isPriorityLevel(parsedValue) ? parsedValue : null;
}

export function formatEstimateInput(value?: number) {
  return typeof value === "number" ? String(value) : "";
}

export function parseEstimateInput(value: string) {
  if (value.trim() === "") {
    return undefined;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  const normalizedValue = Math.round(parsedValue * 10_000) / 10_000;
  return Number.isFinite(normalizedValue) ? normalizedValue : null;
}

export function createBacklogTaskEditorFields(
  workItem?: LocalWorkItem,
  overrides: Partial<BacklogTaskEditorFields> = {},
): BacklogTaskEditorFields {
  const fields = workItem
    ? {
        title: workItem.title,
        description: workItem.description ?? "",
        priority: formatPriorityInput(workItem.priority),
        workflowStateId: workItem.workflowStateId ?? "",
        parentWorkItemId: workItem.parentWorkItemId ?? "",
        projectId: workItem.projectId ?? "",
        taskId: workItem.taskId ?? "",
        originalEstimateHours: formatEstimateInput(
          workItem.originalEstimateHours,
        ),
        remainingEstimateHours: formatEstimateInput(
          workItem.remainingEstimateHours,
        ),
        completedEstimateHours: formatEstimateInput(
          workItem.completedEstimateHours,
        ),
        keepWhenMissingFromSync: workItem.keepWhenMissingFromSync ?? false,
      }
    : EMPTY_BACKLOG_TASK_EDITOR_FIELDS;

  return {
    ...fields,
    ...overrides,
  };
}

/**
 * Seeds the draft for a target. A saved item starts from its own values. A new subitem
 * starts under its parent with the parent's project and task.
 */
export function createBacklogTaskEditorSeed(
  target: BacklogTaskEditorTarget,
): BacklogTaskEditorFields {
  if (target.kind === "edit") {
    return createBacklogTaskEditorFields(target.workItem);
  }

  if (!target.parent) {
    return EMPTY_BACKLOG_TASK_EDITOR_FIELDS;
  }

  return createBacklogTaskEditorFields(undefined, {
    parentWorkItemId: target.parent._id,
    projectId: target.parent.projectId ?? "",
    taskId: target.parent.taskId ?? "",
  });
}

export function sumSubitemEstimates(
  subitems: LocalWorkItem[],
): SubitemEstimateTotals {
  return subitems.reduce(
    (totals, subitem) => ({
      originalEstimateHours:
        totals.originalEstimateHours + (subitem.originalEstimateHours ?? 0),
      remainingEstimateHours:
        totals.remainingEstimateHours + (subitem.remainingEstimateHours ?? 0),
      completedEstimateHours:
        totals.completedEstimateHours + (subitem.completedEstimateHours ?? 0),
    }),
    {
      originalEstimateHours: 0,
      remainingEstimateHours: 0,
      completedEstimateHours: 0,
    },
  );
}

export function validateBacklogTaskEditor(
  fields: BacklogTaskEditorFields,
  options: {
    isSubtask: boolean;
    requireParent?: boolean;
  },
): BacklogTaskEditorValidation {
  const titleError = fields.title.trim() ? null : "Enter an item name";
  const parentError =
    options.requireParent && !fields.parentWorkItemId
      ? "Select a parent item"
      : null;
  const priorityError =
    !options.isSubtask && parsePriorityInput(fields.priority) === null
      ? "Choose a priority"
      : null;
  const originalEstimateError =
    parseEstimateInput(fields.originalEstimateHours) === null
      ? "Enter a non-negative number"
      : null;
  const remainingEstimateError =
    parseEstimateInput(fields.remainingEstimateHours) === null
      ? "Enter a non-negative number"
      : null;
  const completedEstimateError =
    parseEstimateInput(fields.completedEstimateHours) === null
      ? "Enter a non-negative number"
      : null;
  const canSave = ![
    titleError,
    parentError,
    priorityError,
    originalEstimateError,
    remainingEstimateError,
    completedEstimateError,
  ].some(Boolean);

  return {
    titleError,
    parentError,
    priorityError,
    originalEstimateError,
    remainingEstimateError,
    completedEstimateError,
    canSave,
  };
}

function parseEditorEstimates(fields: BacklogTaskEditorFields) {
  const originalEstimateHours = parseEstimateInput(
    fields.originalEstimateHours,
  );
  const remainingEstimateHours = parseEstimateInput(
    fields.remainingEstimateHours,
  );
  const completedEstimateHours = parseEstimateInput(
    fields.completedEstimateHours,
  );

  if (
    originalEstimateHours === null ||
    remainingEstimateHours === null ||
    completedEstimateHours === null
  ) {
    return null;
  }

  return {
    originalEstimateHours,
    remainingEstimateHours,
    completedEstimateHours,
  };
}

/**
 * Builds the patch for a saved item from the fields the user changed. Unchanged fields
 * stay out of the patch, so saving never rewrites a description, title or precise estimate the
 * user did not touch. Returns `null` when a changed field does not parse.
 */
export function buildBacklogTaskPatch(
  workItem: LocalWorkItem,
  fields: BacklogTaskEditorFields,
  options: {
    isSubtask: boolean;
    descriptionReadOnly?: boolean;
    /**
     * The item's fields when the draft started. A sync can change the item
     * under an open draft; only a field the user changed is written, never
     * an old value a sync replaced.
     */
    base?: BacklogTaskEditorFields;
  },
): WorkItemPatch | null {
  const saved = createBacklogTaskEditorFields(workItem);
  const patch: WorkItemPatch = {};
  const changed = (key: keyof BacklogTaskEditorFields) =>
    fields[key] !== saved[key] &&
    (!options.base || fields[key] !== options.base[key]);

  if (changed("title")) {
    const title = fields.title.trim();
    if (!title) {
      return null;
    }
    patch.title = title;
  }

  // A read-only description follows its source, so a draft never writes it.
  if (!options.descriptionReadOnly && changed("description")) {
    patch.description =
      normalizeDescriptionText(fields.description) || undefined;
  }

  if (!options.isSubtask && changed("priority")) {
    const priority = parsePriorityInput(fields.priority);
    if (priority === null) {
      return null;
    }
    patch.priority = priority;
  }

  if (changed("workflowStateId")) {
    patch.workflowStateId = fields.workflowStateId || undefined;
  }

  // Project and task change together so the parent mapping is inferred from both.
  if (changed("projectId") || changed("taskId")) {
    patch.projectId = fields.projectId || undefined;
    patch.taskId = fields.taskId || undefined;
  }

  for (const key of BACKLOG_ESTIMATE_FIELD_KEYS) {
    if (!changed(key)) {
      continue;
    }

    const value = parseEstimateInput(fields[key]);
    if (value === null) {
      return null;
    }
    patch[key] = value;
  }

  if (changed("keepWhenMissingFromSync")) {
    patch.keepWhenMissingFromSync = fields.keepWhenMissingFromSync;
  }

  return patch;
}

export function buildBacklogTaskDraft(
  fields: BacklogTaskEditorFields,
  options: {
    isSubtask: boolean;
    requireParent?: boolean;
  },
): LocalWorkItemDraft | null {
  const validation = validateBacklogTaskEditor(fields, options);
  if (!validation.canSave) {
    return null;
  }

  const estimates = parseEditorEstimates(fields);
  if (!estimates) {
    return null;
  }

  return {
    title: fields.title.trim(),
    description: normalizeDescriptionText(fields.description) || undefined,
    parentWorkItemId: fields.parentWorkItemId || undefined,
    priority: options.isSubtask
      ? undefined
      : (parsePriorityInput(fields.priority) ?? undefined),
    workflowStateId: fields.workflowStateId || undefined,
    projectId: fields.projectId || undefined,
    taskId: fields.taskId || undefined,
    ...estimates,
  };
}

function hasSameFields(
  left: BacklogTaskEditorFields,
  right: BacklogTaskEditorFields,
) {
  return (Object.keys(left) as (keyof BacklogTaskEditorFields)[]).every(
    (key) => left[key] === right[key],
  );
}

/**
 * Evaluates a draft against its target. `subitemTotals` is the sum of the item's
 * subitem estimates, or `null` when it has no subitems.
 */
export function evaluateBacklogTaskEditor(
  fields: BacklogTaskEditorFields,
  target: BacklogTaskEditorTarget,
  options: {
    subitemTotals?: SubitemEstimateTotals | null;
    /** The description follows its source; the draft's copy is ignored. */
    descriptionReadOnly?: boolean;
    /** The item's fields when the draft started. */
    base?: BacklogTaskEditorFields;
  } = {},
): BacklogTaskEditorState {
  const original = target.kind === "edit" ? target.workItem : undefined;
  const isSubitem = original
    ? isSubtaskWorkItem(original)
    : Boolean(target.kind === "create" && target.parent);
  const isSynced = Boolean(original && original.source !== "manual");
  const validation = validateBacklogTaskEditor(fields, {
    isSubtask: isSubitem,
    requireParent: !original && isSubitem,
  });

  const estimateResets: Partial<Record<BacklogEstimateFieldKey, string>> = {};
  const subitemTotals = isSubitem ? null : options.subitemTotals;
  if (subitemTotals) {
    for (const key of BACKLOG_ESTIMATE_FIELD_KEYS) {
      // An unparsable value differs from the total too, so the reset can fix it.
      if ((parseEstimateInput(fields[key]) ?? 0) !== subitemTotals[key]) {
        estimateResets[key] = formatEstimateInput(subitemTotals[key]);
      }
    }
  }

  const syncedPriority = formatPriorityInput(original?.importedPriority);
  const syncedStatus = original?.importedWorkflowStateId ?? "";

  return {
    isNew: !original,
    isSubitem,
    isSynced,
    validation,
    hasChanges: !hasSameFields(
      options.descriptionReadOnly ? { ...fields, description: "" } : fields,
      options.descriptionReadOnly
        ? { ...createBacklogTaskEditorSeed(target), description: "" }
        : createBacklogTaskEditorSeed(target),
    ),
    estimateResets,
    priorityReset:
      isSynced && !isSubitem && fields.priority.trim() !== syncedPriority
        ? syncedPriority
        : null,
    statusReset:
      isSynced && fields.workflowStateId !== syncedStatus ? syncedStatus : null,
    draft:
      !original && validation.canSave
        ? buildBacklogTaskDraft(fields, {
            isSubtask: isSubitem,
            requireParent: isSubitem,
          })
        : null,
    patch:
      original && validation.canSave
        ? buildBacklogTaskPatch(original, fields, {
            isSubtask: isSubitem,
            descriptionReadOnly: options.descriptionReadOnly,
            base: options.base,
          })
        : null,
  };
}

function getFirstValidationError(validation: BacklogTaskEditorValidation) {
  return (
    validation.titleError ??
    validation.parentError ??
    validation.priorityError ??
    validation.originalEstimateError ??
    validation.remainingEstimateError ??
    validation.completedEstimateError ??
    "Check the highlighted fields"
  );
}

/**
 * Decides what Save, or leaving the draft for another item or an action, writes. An
 * unchanged saved item writes nothing, and a switch drops an untouched new item. A valid
 * draft is written. Anything else blocks with the first field error.
 */
export function commitBacklogTaskDraft(
  editor: BacklogTaskEditorState,
  reason: BacklogTaskDraftCommitReason,
): BacklogTaskDraftCommit {
  if (!editor.hasChanges && (!editor.isNew || reason === "switch")) {
    return { kind: "unchanged" };
  }

  if (editor.draft) {
    return { kind: "create", draft: editor.draft };
  }

  if (editor.patch) {
    return { kind: "update", patch: editor.patch };
  }

  return { kind: "invalid", error: getFirstValidationError(editor.validation) };
}

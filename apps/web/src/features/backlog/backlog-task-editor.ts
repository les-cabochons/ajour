import type { LocalWorkItem, LocalWorkItemDraft } from "@/domain/local-state";
import type { WorkItemPatch } from "@/domain/backlog/work-item-transitions";
import { getDirectChildWorkItems } from "@/domain/backlog/work-item-hierarchy";

export interface BacklogTaskEditorFields {
  title: string;
  note: string;
  priority: string;
  backlogStatusId: string;
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

export const EMPTY_BACKLOG_TASK_EDITOR_FIELDS: BacklogTaskEditorFields = {
  title: "",
  note: "",
  priority: "",
  backlogStatusId: "",
  parentWorkItemId: "",
  projectId: "",
  taskId: "",
  originalEstimateHours: "",
  remainingEstimateHours: "",
  completedEstimateHours: "",
  keepWhenMissingFromSync: false,
};

export function formatPriorityInput(priority?: number) {
  return typeof priority === "number" ? String(priority) : "";
}

export function parsePriorityInput(value: string) {
  if (value.trim() === "") {
    return undefined;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    return null;
  }

  return parsedValue;
}

export function isSamePriorityValue(
  left: number | undefined | null,
  right: number | undefined,
) {
  return left === right;
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
        note: workItem.note ?? "",
        priority: formatPriorityInput(workItem.priority),
        backlogStatusId: workItem.backlogStatusId ?? "",
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
      ? "Enter a whole number"
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

export function buildBacklogTaskPatch(
  workItem: LocalWorkItem,
  fields: BacklogTaskEditorFields,
  options: {
    isSubtask: boolean;
    preserveTitle?: boolean;
    includeHierarchy?: boolean;
    includeRetention?: boolean;
  },
): WorkItemPatch | null {
  const title = fields.title.trim();
  if (!title && !options.preserveTitle) {
    return null;
  }

  const priority = parsePriorityInput(fields.priority);
  if (!options.isSubtask && priority === null) {
    return null;
  }

  const estimates = parseEditorEstimates(fields);
  if (!estimates) {
    return null;
  }

  const patch: WorkItemPatch = {
    title: title || workItem.title,
    note: fields.note.trim() || undefined,
    priority: options.isSubtask ? undefined : (priority ?? undefined),
    backlogStatusId: fields.backlogStatusId || undefined,
    projectId: fields.projectId || undefined,
    taskId: fields.taskId || undefined,
    ...estimates,
  };

  if (options.includeHierarchy) {
    patch.parentWorkItemId = fields.parentWorkItemId || undefined;
    patch.parentSourceId = undefined;
  }

  if (options.includeRetention) {
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
    note: fields.note.trim() || undefined,
    parentWorkItemId: fields.parentWorkItemId || undefined,
    priority: options.isSubtask
      ? undefined
      : (parsePriorityInput(fields.priority) ?? undefined),
    backlogStatusId: fields.backlogStatusId || undefined,
    projectId: fields.projectId || undefined,
    taskId: fields.taskId || undefined,
    ...estimates,
  };
}

export function collectBlockedParentIds(
  workItem: LocalWorkItem,
  workItems: LocalWorkItem[],
) {
  const blockedParentIds = new Set<string>([workItem._id]);
  const queue = [workItem];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const childItem of getDirectChildWorkItems(current, workItems)) {
      if (blockedParentIds.has(childItem._id)) {
        continue;
      }

      blockedParentIds.add(childItem._id);
      queue.push(childItem);
    }
  }

  return blockedParentIds;
}

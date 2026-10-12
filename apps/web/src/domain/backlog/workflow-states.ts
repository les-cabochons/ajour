import {
  normalizeConnectorStatusKey,
  type ConnectorBacklogSource,
} from "@ajour/shared";
import type {
  LocalAppState,
  LocalWorkflowState,
  LocalWorkflowStateMapping,
  LocalWorkItem,
} from "@/domain/local-state";

const DEFAULT_BACKLOG_STATUS_COLORS = [
  "#64748b",
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
];

interface WorkflowStateFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export interface WorkflowStateMappingInput {
  source: ConnectorBacklogSource;
  connectionId: string;
  sourceStatusKey: string;
  workflowStateId?: string;
}

export function normalizeWorkflowStateName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function getDefaultWorkflowStateColor(index: number) {
  return DEFAULT_BACKLOG_STATUS_COLORS[
    index % DEFAULT_BACKLOG_STATUS_COLORS.length
  ]!;
}

export function normalizeWorkflowStateColor(
  value: string | undefined,
  fallbackColor: string,
) {
  const trimmedValue = value?.trim();
  if (trimmedValue && /^#[0-9a-f]{6}$/iu.test(trimmedValue)) {
    return trimmedValue.toLowerCase();
  }

  return fallbackColor;
}

/** The workflow a new workspace starts with. */
const DEFAULT_WORKFLOW_STATES = [
  { _id: "workflow_state_todo", name: "To do", color: "#64748b" },
  { _id: "workflow_state_in_progress", name: "In progress", color: "#d97706" },
  { _id: "workflow_state_in_review", name: "In review", color: "#7c3aed" },
  { _id: "workflow_state_done", name: "Done", color: "#059669", done: true },
] as const;

const FALLBACK_DONE_STATE = DEFAULT_WORKFLOW_STATES[3];

/**
 * Normalizes persisted workflow states. An empty workflow gets the default
 * states, and a workflow without a done state gets a Done state at the end,
 * because the workflow always keeps one.
 */
export function normalizeWorkflowStates(
  statuses: Array<Partial<LocalWorkflowState>>,
  now: () => number,
): LocalWorkflowState[] {
  const states: LocalWorkflowState[] = statuses
    .filter(
      (
        status,
      ): status is Partial<LocalWorkflowState> &
        Pick<LocalWorkflowState, "_id" | "name"> =>
        Boolean(status?._id && status.name),
    )
    .map((status, index) => ({
      _id: status._id,
      name: normalizeWorkflowStateName(status.name),
      color: normalizeWorkflowStateColor(
        status.color,
        getDefaultWorkflowStateColor(index),
      ),
      ...(status.done === true ? { done: true } : {}),
      createdAt: status.createdAt ?? now(),
    }));

  if (states.length === 0) {
    const createdAt = now();
    return DEFAULT_WORKFLOW_STATES.map((state) => ({ ...state, createdAt }));
  }

  if (!states.some((state) => state.done)) {
    const taken = new Set(
      states.map((state) =>
        normalizeWorkflowStateName(state.name).toLowerCase(),
      ),
    );
    states.push({
      ...FALLBACK_DONE_STATE,
      name: taken.has("done") ? "Closed" : FALLBACK_DONE_STATE.name,
      createdAt: now(),
    });
  }

  return states;
}

export function isDoneWorkflowState(
  states: LocalWorkflowState[],
  workflowStateId: string | undefined,
) {
  return Boolean(
    workflowStateId &&
    states.some((state) => state._id === workflowStateId && state.done),
  );
}

/** The done state that closing an item without a chosen state moves it to. */
export function getFirstDoneWorkflowState(states: LocalWorkflowState[]) {
  return states.find((state) => state.done);
}

/** Moves a workflow state one place up or down in the workflow. */
export function moveWorkflowState(
  state: LocalAppState,
  workflowStateId: string,
  step: -1 | 1,
): LocalAppState {
  const index = state.workflowStates.findIndex(
    (candidate) => candidate._id === workflowStateId,
  );
  const target = index + step;
  if (index === -1 || target < 0 || target >= state.workflowStates.length) {
    return state;
  }

  const workflowStates = [...state.workflowStates];
  const [moved] = workflowStates.splice(index, 1);
  workflowStates.splice(target, 0, moved!);
  return { ...state, workflowStates };
}

export function findMappedWorkflowStateId(
  mappings: LocalWorkflowStateMapping[],
  source: LocalWorkItem["source"],
  connectionId: string | undefined,
  sourceStatusKey: string | undefined,
) {
  if (!connectionId || !sourceStatusKey || source === "manual") {
    return undefined;
  }

  return mappings.find(
    (mapping) =>
      mapping.source === source &&
      mapping.connectionId === connectionId &&
      mapping.sourceStatusKey === sourceStatusKey,
  )?.workflowStateId;
}

export function syncImportedWorkflowState(
  workItem: LocalWorkItem,
  mappings: LocalWorkflowStateMapping[],
): LocalWorkItem {
  const importedWorkflowStateId = findMappedWorkflowStateId(
    mappings,
    workItem.source,
    workItem.sourceConnectionId,
    workItem.sourceStatusKey,
  );
  // An archived item stays in its done state when a mapping changes.
  const followsImportedWorkflowState =
    workItem.status !== "archived" &&
    workItem.workflowStateId === workItem.importedWorkflowStateId;

  return {
    ...workItem,
    workflowStateId: followsImportedWorkflowState
      ? importedWorkflowStateId
      : workItem.workflowStateId,
    importedWorkflowStateId,
  };
}

export function reconcileImportedWorkflowStates(
  state: LocalAppState,
): LocalAppState {
  const validWorkflowStateIds = new Set(
    state.workflowStates.map((status) => status._id),
  );
  const workflowStateMappings = state.workflowStateMappings.filter((mapping) =>
    validWorkflowStateIds.has(mapping.workflowStateId),
  );

  return {
    ...state,
    workflowStateMappings,
    workItems: state.workItems.map((workItem) =>
      syncImportedWorkflowState(
        {
          ...workItem,
          workflowStateId: validWorkflowStateIds.has(
            workItem.workflowStateId ?? "",
          )
            ? workItem.workflowStateId
            : undefined,
          importedWorkflowStateId: validWorkflowStateIds.has(
            workItem.importedWorkflowStateId ?? "",
          )
            ? workItem.importedWorkflowStateId
            : undefined,
        },
        workflowStateMappings,
      ),
    ),
  };
}

export function addWorkflowState(
  state: LocalAppState,
  name: string,
  color: string | undefined,
  factories: WorkflowStateFactories,
) {
  const normalizedName = normalizeWorkflowStateName(name);
  if (!normalizedName) {
    throw new Error("Workflow state name is required.");
  }

  if (
    state.workflowStates.some(
      (status) =>
        normalizeWorkflowStateName(status.name).toLocaleLowerCase() ===
        normalizedName.toLocaleLowerCase(),
    )
  ) {
    throw new Error("Workflow state already exists.");
  }

  const status = {
    _id: factories.createId("workflow_state"),
    name: normalizedName,
    color: normalizeWorkflowStateColor(
      color,
      getDefaultWorkflowStateColor(state.workflowStates.length),
    ),
    createdAt: factories.now(),
  } satisfies LocalWorkflowState;

  return {
    state: {
      ...state,
      workflowStates: [...state.workflowStates, status],
    },
    result: status._id,
  };
}

export function updateWorkflowState(
  state: LocalAppState,
  statusId: string,
  updates: string | { name: string; color?: string; done?: boolean },
): LocalAppState {
  const nextName = typeof updates === "string" ? updates : updates.name;
  const nextColor = typeof updates === "string" ? undefined : updates.color;
  const nextDone = typeof updates === "string" ? undefined : updates.done;
  const normalizedName = normalizeWorkflowStateName(nextName);
  if (!normalizedName) {
    throw new Error("Workflow state name is required.");
  }

  const targetIndex = state.workflowStates.findIndex(
    (status) => status._id === statusId,
  );
  const target = state.workflowStates[targetIndex];
  if (!target) {
    throw new Error("Workflow state not found.");
  }

  if (
    state.workflowStates.some(
      (status) =>
        status._id !== statusId &&
        normalizeWorkflowStateName(status.name).toLocaleLowerCase() ===
          normalizedName.toLocaleLowerCase(),
    )
  ) {
    throw new Error("Workflow state already exists.");
  }

  const color = normalizeWorkflowStateColor(
    nextColor,
    target.color || getDefaultWorkflowStateColor(targetIndex),
  );
  const done = nextDone ?? target.done === true;
  if (!done && isLastDoneState(state, statusId)) {
    throw new Error(LAST_DONE_STATE_MESSAGE);
  }
  const replacementDoneId = getFirstDoneWorkflowState(
    state.workflowStates.filter((status) => status._id !== statusId),
  )?._id;

  return {
    ...state,
    workItems:
      target.done && !done
        ? state.workItems.map((workItem) =>
            workItem.status === "archived" &&
            workItem.workflowStateId === statusId
              ? { ...workItem, workflowStateId: replacementDoneId }
              : workItem,
          )
        : state.workItems,
    workflowStates: state.workflowStates.map((status) => {
      if (status._id !== statusId) return status;
      const { done: _done, ...rest } = status;
      return {
        ...rest,
        name: normalizedName,
        color,
        ...(done ? { done } : {}),
      };
    }),
  };
}

const LAST_DONE_STATE_MESSAGE = "The workflow needs at least one done state.";

function isLastDoneState(state: LocalAppState, statusId: string) {
  const doneStates = state.workflowStates.filter((status) => status.done);
  return doneStates.length === 1 && doneStates[0]!._id === statusId;
}

/** Deletes a workflow state. The last done state can't be deleted. */
export function deleteWorkflowState(
  state: LocalAppState,
  statusId: string,
): LocalAppState {
  if (isLastDoneState(state, statusId)) {
    throw new Error(LAST_DONE_STATE_MESSAGE);
  }
  const replacementDoneId = getFirstDoneWorkflowState(
    state.workflowStates.filter(
      (workflowState) => workflowState._id !== statusId,
    ),
  )?._id;

  return reconcileImportedWorkflowStates({
    ...state,
    workflowStates: state.workflowStates.filter(
      (status) => status._id !== statusId,
    ),
    workflowStateMappings: state.workflowStateMappings.filter(
      (mapping) => mapping.workflowStateId !== statusId,
    ),
    workItems: state.workItems.map((workItem) => ({
      ...workItem,
      workflowStateId:
        workItem.workflowStateId === statusId
          ? workItem.status === "archived" &&
            isDoneWorkflowState(state.workflowStates, statusId)
            ? replacementDoneId
            : undefined
          : workItem.workflowStateId,
      workflowStateIdBeforeClose:
        workItem.workflowStateIdBeforeClose === statusId
          ? undefined
          : workItem.workflowStateIdBeforeClose,
      importedWorkflowStateId:
        workItem.importedWorkflowStateId === statusId
          ? undefined
          : workItem.importedWorkflowStateId,
      pendingSourceWrite: workItem.pendingSourceWrite
        ? {
            ...workItem.pendingSourceWrite,
            previous: {
              ...workItem.pendingSourceWrite.previous,
              ...(workItem.pendingSourceWrite.previous.workflowStateId ===
              statusId
                ? { workflowStateId: undefined }
                : {}),
              ...(workItem.pendingSourceWrite.previous
                .importedWorkflowStateId === statusId
                ? { importedWorkflowStateId: undefined }
                : {}),
            },
          }
        : undefined,
    })),
  });
}

export function setWorkflowStateMapping(
  state: LocalAppState,
  mapping: WorkflowStateMappingInput,
): LocalAppState {
  const sourceStatusKey = normalizeConnectorStatusKey(mapping.sourceStatusKey);
  if (!mapping.connectionId || !sourceStatusKey) {
    throw new Error("Source status mapping is incomplete.");
  }

  const workflowStateMappings = state.workflowStateMappings.filter(
    (candidate) =>
      !(
        candidate.source === mapping.source &&
        candidate.connectionId === mapping.connectionId &&
        candidate.sourceStatusKey === sourceStatusKey
      ),
  );

  if (mapping.workflowStateId) {
    workflowStateMappings.push({
      source: mapping.source,
      connectionId: mapping.connectionId,
      sourceStatusKey,
      workflowStateId: mapping.workflowStateId,
    });
  }

  return reconcileImportedWorkflowStates({
    ...state,
    workflowStateMappings,
  });
}

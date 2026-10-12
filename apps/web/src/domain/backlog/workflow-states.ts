import {
  normalizeConnectorStatusKey,
  type ConnectorBacklogSource,
} from "@ajour/shared";
import type {
  LocalAppState,
  LocalWorkflowState,
  LocalWorkflowStateMapping,
  LocalWorkflowStateWriteRule,
  LocalWorkItem,
} from "@/domain/local-state";
import { getPendingSourceWriteItemIds } from "@/domain/local-state";

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
  /** Missing for a mapping that applies to the whole connection. */
  sourceProjectName?: string;
  sourceStatusKey: string;
  sourceStatusLabel?: string;
  workflowStateId?: string | null;
}

/** A source project's place in the mappings. */
export interface SourceProjectRef {
  source: LocalWorkItem["source"];
  connectionId: string | undefined;
  sourceProjectName?: string;
}

function sameProject(
  mapping: { sourceProjectName?: string },
  sourceProjectName: string | undefined,
) {
  return (mapping.sourceProjectName ?? "") === (sourceProjectName ?? "");
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

/**
 * The mapping a source state of a source project uses: its project's own, or
 * else the connection's.
 */
export function findWorkflowStateMapping(
  mappings: LocalWorkflowStateMapping[],
  source: LocalWorkItem["source"],
  connectionId: string | undefined,
  sourceStatusKey: string | undefined,
  sourceProjectName?: string,
) {
  if (!connectionId || !sourceStatusKey || source === "manual") {
    return undefined;
  }

  const candidates = mappings.filter(
    (mapping) =>
      mapping.source === source &&
      mapping.connectionId === connectionId &&
      mapping.sourceStatusKey === sourceStatusKey,
  );
  return (
    (sourceProjectName
      ? candidates.find(
          (mapping) => mapping.sourceProjectName === sourceProjectName,
        )
      : undefined) ??
    candidates.find((mapping) => mapping.sourceProjectName === undefined)
  );
}

export function findMappedWorkflowStateId(
  mappings: LocalWorkflowStateMapping[],
  source: LocalWorkItem["source"],
  connectionId: string | undefined,
  sourceStatusKey: string | undefined,
  sourceProjectName?: string,
) {
  return (
    findWorkflowStateMapping(
      mappings,
      source,
      connectionId,
      sourceStatusKey,
      sourceProjectName,
    )?.workflowStateId ?? undefined
  );
}

/**
 * The source states of a source project that map to a workflow state, in
 * mapping order. A connection-wide mapping counts unless the project maps
 * that source state elsewhere.
 */
export function getSourceStatesMappedTo(
  mappings: LocalWorkflowStateMapping[],
  project: SourceProjectRef,
  workflowStateId: string,
  availableSourceStates?: readonly string[],
): { key: string; label: string }[] {
  const available = availableSourceStates
    ? new Set(availableSourceStates.map(normalizeConnectorStatusKey))
    : undefined;
  const seen = new Set<string>();
  const states: { key: string; label: string }[] = [];
  for (const mapping of mappings) {
    if (
      mapping.source !== project.source ||
      mapping.connectionId !== project.connectionId ||
      (available && !available.has(mapping.sourceStatusKey)) ||
      seen.has(mapping.sourceStatusKey)
    ) {
      continue;
    }
    const effective = findWorkflowStateMapping(
      mappings,
      project.source,
      project.connectionId,
      mapping.sourceStatusKey,
      project.sourceProjectName,
    );
    if (effective?.workflowStateId === workflowStateId) {
      seen.add(mapping.sourceStatusKey);
      states.push({
        key: mapping.sourceStatusKey,
        label: effective.sourceStatusLabel ?? mapping.sourceStatusKey,
      });
    }
  }
  return states;
}

/** The write rule set for a workflow state of a source project, if any. */
export function findWorkflowStateWriteRule(
  rules: LocalWorkflowStateWriteRule[],
  project: SourceProjectRef,
  workflowStateId: string,
) {
  const candidates = rules.filter(
    (rule) =>
      rule.source === project.source &&
      rule.connectionId === project.connectionId &&
      rule.workflowStateId === workflowStateId,
  );
  return (
    (project.sourceProjectName
      ? candidates.find((rule) => sameProject(rule, project.sourceProjectName))
      : undefined) ??
    candidates.find((rule) => rule.sourceProjectName === undefined)
  );
}

/** What moving a synced item into a workflow state should write. */
export type WorkflowStateWritePlan =
  | { kind: "write"; sourceStatusLabel: string }
  | { kind: "ask"; sourceStatusLabels: string[] }
  | { kind: "none" };

/**
 * Plans the source write for moving an item into a workflow state: the rule's
 * source state, the source states to choose from for Ask, or nothing. Without
 * a rule it writes the first source state mapped to the workflow state. Ask
 * with fewer than two source states writes the only one.
 */
export function planWorkflowStateWrite(
  state: Pick<
    LocalAppState,
    "workflowStateMappings" | "workflowStateWriteRules"
  >,
  workItem: Pick<
    LocalWorkItem,
    "source" | "sourceConnectionId" | "sourceProjectName" | "sourceId"
  >,
  workflowStateId: string,
  availableSourceStates: readonly string[],
): WorkflowStateWritePlan {
  if (workItem.source === "manual" || !workItem.sourceId) {
    return { kind: "none" };
  }
  const project: SourceProjectRef = {
    source: workItem.source,
    connectionId: workItem.sourceConnectionId,
    sourceProjectName: workItem.sourceProjectName,
  };
  const mapped = getSourceStatesMappedTo(
    state.workflowStateMappings,
    project,
    workflowStateId,
    availableSourceStates,
  ).map((sourceState) => sourceState.label);
  const rule = findWorkflowStateWriteRule(
    state.workflowStateWriteRules,
    project,
    workflowStateId,
  )?.write;

  if (rule?.kind === "none") return { kind: "none" };
  if (rule?.kind === "state") {
    if (
      !mapped.some(
        (label) =>
          normalizeConnectorStatusKey(label) ===
          normalizeConnectorStatusKey(rule.sourceStatusLabel),
      )
    )
      return { kind: "none" };
    return { kind: "write", sourceStatusLabel: rule.sourceStatusLabel };
  }
  if (rule?.kind === "ask" && mapped.length > 1) {
    return { kind: "ask", sourceStatusLabels: mapped };
  }
  return mapped[0]
    ? { kind: "write", sourceStatusLabel: mapped[0] }
    : { kind: "none" };
}

/** A source state a sync or a connector reported, with its done category. */
export interface ReportedSourceState {
  source: LocalWorkItem["source"];
  connectionId: string;
  sourceProjectName?: string;
  label: string;
  done?: boolean;
}

/**
 * Maps new source states the user hasn't mapped yet, for the whole
 * connection: one whose name matches a workflow state, ignoring case, maps to
 * it, and one in the tool's done category maps to the first done state.
 * Anything else stays unmapped.
 */
export function autoMapSourceStates(
  state: LocalAppState,
  reported: readonly ReportedSourceState[],
): LocalAppState {
  const added: LocalWorkflowStateMapping[] = [];
  const firstDone = getFirstDoneWorkflowState(state.workflowStates);
  for (const entry of reported) {
    if (entry.source === "manual") continue;
    const label = entry.label.trim();
    const sourceStatusKey = normalizeConnectorStatusKey(label);
    if (!label || !sourceStatusKey) continue;
    const mappings = [...state.workflowStateMappings, ...added];
    if (
      findWorkflowStateMapping(
        mappings,
        entry.source,
        entry.connectionId,
        sourceStatusKey,
        entry.sourceProjectName,
      )
    ) {
      continue;
    }
    const sameName = state.workflowStates.find(
      (workflowState) =>
        normalizeWorkflowStateName(workflowState.name).toLowerCase() ===
        normalizeWorkflowStateName(label).toLowerCase(),
    );
    const workflowStateId =
      sameName?._id ?? (entry.done ? firstDone?._id : undefined);
    if (workflowStateId) {
      added.push({
        source: entry.source,
        connectionId: entry.connectionId,
        sourceStatusKey,
        sourceStatusLabel: label,
        workflowStateId,
      });
    }
  }
  return added.length > 0
    ? reconcileImportedWorkflowStates({
        ...state,
        workflowStateMappings: [...state.workflowStateMappings, ...added],
      })
    : state;
}

/** Sets or clears the write rule of a workflow state for a source project. */
export function setWorkflowStateWriteRule(
  state: LocalAppState,
  rule: Omit<LocalWorkflowStateWriteRule, "write"> & {
    write?: LocalWorkflowStateWriteRule["write"];
  },
): LocalAppState {
  const rest = state.workflowStateWriteRules.filter(
    (candidate) =>
      !(
        candidate.source === rule.source &&
        candidate.connectionId === rule.connectionId &&
        candidate.workflowStateId === rule.workflowStateId &&
        sameProject(candidate, rule.sourceProjectName)
      ),
  );
  return {
    ...state,
    workflowStateWriteRules: rule.write
      ? [...rest, { ...rule, write: rule.write }]
      : rest,
  };
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
    workItem.sourceProjectName,
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
  const workflowStateMappings = state.workflowStateMappings.filter(
    (mapping) =>
      mapping.workflowStateId === null ||
      validWorkflowStateIds.has(mapping.workflowStateId),
  );
  const pendingMoveItemIds = getPendingSourceWriteItemIds(state);

  return {
    ...state,
    workflowStateMappings,
    workflowStateWriteRules: state.workflowStateWriteRules.filter(
      (rule) =>
        rule.write.kind !== "state" ||
        getSourceStatesMappedTo(
          workflowStateMappings,
          rule,
          rule.workflowStateId,
        ).some(
          (source) =>
            normalizeConnectorStatusKey(source.label) ===
            normalizeConnectorStatusKey(
              rule.write.kind === "state" ? rule.write.sourceStatusLabel : "",
            ),
        ),
    ),
    workItems: state.workItems.map((workItem) => {
      const normalized = {
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
      };
      return pendingMoveItemIds.has(workItem._id)
        ? normalized
        : syncImportedWorkflowState(normalized, workflowStateMappings);
    }),
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
            !workItem.archivedByMissingSync &&
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

function clearDeletedWorkflowReferences<
  T extends Pick<
    LocalWorkItem,
    "workflowStateId" | "importedWorkflowStateId" | "workflowStateIdBeforeClose"
  > & { status?: LocalWorkItem["status"] },
>(snapshot: T, statusId: string, replacementDoneId?: string): T {
  return {
    ...snapshot,
    ...(snapshot.workflowStateId === statusId
      ? {
          workflowStateId:
            snapshot.status === "archived" ? replacementDoneId : undefined,
        }
      : {}),
    ...(snapshot.importedWorkflowStateId === statusId
      ? { importedWorkflowStateId: undefined }
      : {}),
    ...(snapshot.workflowStateIdBeforeClose === statusId
      ? { workflowStateIdBeforeClose: undefined }
      : {}),
  };
}

/** Deletes a workflow state. The last done state can't be deleted. */
export function deleteWorkflowState(
  state: LocalAppState,
  statusId: string,
): LocalAppState {
  if (isLastDoneState(state, statusId)) {
    throw new Error(LAST_DONE_STATE_MESSAGE);
  }
  const replacementDoneId = isDoneWorkflowState(state.workflowStates, statusId)
    ? getFirstDoneWorkflowState(
        state.workflowStates.filter(
          (workflowState) => workflowState._id !== statusId,
        ),
      )?._id
    : undefined;

  return reconcileImportedWorkflowStates({
    ...state,
    workflowStates: state.workflowStates.filter(
      (status) => status._id !== statusId,
    ),
    workflowStateMappings: state.workflowStateMappings.filter(
      (mapping) => mapping.workflowStateId !== statusId,
    ),
    workflowStateWriteRules: state.workflowStateWriteRules.filter(
      (rule) => rule.workflowStateId !== statusId,
    ),
    workItems: state.workItems.map((workItem) => ({
      ...workItem,
      workflowStateId:
        workItem.workflowStateId === statusId
          ? workItem.status === "archived" &&
            !workItem.archivedByMissingSync &&
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
              ...clearDeletedWorkflowReferences(
                workItem.pendingSourceWrite.previous,
                statusId,
                replacementDoneId,
              ),
              ...(workItem.pendingSourceWrite.previous.lifecycle
                ? {
                    lifecycle: clearDeletedWorkflowReferences(
                      workItem.pendingSourceWrite.previous.lifecycle,
                      statusId,
                      replacementDoneId,
                    ),
                  }
                : {}),
              ...(workItem.pendingSourceWrite.previous.carriedChildren
                ? {
                    carriedChildren:
                      workItem.pendingSourceWrite.previous.carriedChildren.map(
                        (child) => ({
                          ...child,
                          before: clearDeletedWorkflowReferences(
                            child.before,
                            statusId,
                            replacementDoneId,
                          ),
                          after: clearDeletedWorkflowReferences(
                            child.after,
                            statusId,
                            replacementDoneId,
                          ),
                        }),
                      ),
                  }
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
        candidate.sourceStatusKey === sourceStatusKey &&
        sameProject(candidate, mapping.sourceProjectName)
      ),
  );

  if (mapping.workflowStateId !== undefined) {
    workflowStateMappings.push({
      source: mapping.source,
      connectionId: mapping.connectionId,
      ...(mapping.sourceProjectName
        ? { sourceProjectName: mapping.sourceProjectName }
        : {}),
      sourceStatusKey,
      ...(mapping.sourceStatusLabel?.trim()
        ? { sourceStatusLabel: mapping.sourceStatusLabel.trim() }
        : {}),
      workflowStateId: mapping.workflowStateId,
    });
  }

  return reconcileImportedWorkflowStates({
    ...state,
    workflowStateMappings,
  });
}

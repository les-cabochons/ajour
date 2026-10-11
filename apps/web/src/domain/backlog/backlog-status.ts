import {
  normalizeConnectorStatusKey,
  type ConnectorBacklogSource,
} from "@ajour/shared";
import type {
  LocalAppState,
  LocalBacklogStatus,
  LocalBacklogStatusMapping,
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

interface BacklogStatusFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export interface BacklogStatusMappingInput {
  source: ConnectorBacklogSource;
  connectionId: string;
  sourceStatusKey: string;
  backlogStatusId?: string;
}

export function normalizeBacklogStatusName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function getDefaultBacklogStatusColor(index: number) {
  return DEFAULT_BACKLOG_STATUS_COLORS[
    index % DEFAULT_BACKLOG_STATUS_COLORS.length
  ]!;
}

export function normalizeBacklogStatusColor(
  value: string | undefined,
  fallbackColor: string,
) {
  const trimmedValue = value?.trim();
  if (trimmedValue && /^#[0-9a-f]{6}$/iu.test(trimmedValue)) {
    return trimmedValue.toLowerCase();
  }

  return fallbackColor;
}

export function normalizeBacklogStatuses(
  statuses: Array<Partial<LocalBacklogStatus>>,
  now: () => number,
): LocalBacklogStatus[] {
  return statuses
    .filter(
      (
        status,
      ): status is Partial<LocalBacklogStatus> &
        Pick<LocalBacklogStatus, "_id" | "name"> =>
        Boolean(status?._id && status.name),
    )
    .map((status, index) => ({
      _id: status._id,
      name: normalizeBacklogStatusName(status.name),
      color: normalizeBacklogStatusColor(
        status.color,
        getDefaultBacklogStatusColor(index),
      ),
      createdAt: status.createdAt ?? now(),
    }));
}

export function findMappedBacklogStatusId(
  mappings: LocalBacklogStatusMapping[],
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
  )?.backlogStatusId;
}

export function syncImportedBacklogStatus(
  workItem: LocalWorkItem,
  mappings: LocalBacklogStatusMapping[],
): LocalWorkItem {
  const importedBacklogStatusId = findMappedBacklogStatusId(
    mappings,
    workItem.source,
    workItem.sourceConnectionId,
    workItem.sourceStatusKey,
  );
  const followsImportedBacklogStatus =
    workItem.backlogStatusId === workItem.importedBacklogStatusId;

  return {
    ...workItem,
    backlogStatusId: followsImportedBacklogStatus
      ? importedBacklogStatusId
      : workItem.backlogStatusId,
    importedBacklogStatusId,
  };
}

export function reconcileImportedBacklogStatuses(
  state: LocalAppState,
): LocalAppState {
  const validBacklogStatusIds = new Set(
    state.backlogStatuses.map((status) => status._id),
  );
  const backlogStatusMappings = state.backlogStatusMappings.filter((mapping) =>
    validBacklogStatusIds.has(mapping.backlogStatusId),
  );

  return {
    ...state,
    backlogStatusMappings,
    workItems: state.workItems.map((workItem) =>
      syncImportedBacklogStatus(
        {
          ...workItem,
          backlogStatusId: validBacklogStatusIds.has(
            workItem.backlogStatusId ?? "",
          )
            ? workItem.backlogStatusId
            : undefined,
          importedBacklogStatusId: validBacklogStatusIds.has(
            workItem.importedBacklogStatusId ?? "",
          )
            ? workItem.importedBacklogStatusId
            : undefined,
        },
        backlogStatusMappings,
      ),
    ),
  };
}

export function addBacklogStatus(
  state: LocalAppState,
  name: string,
  color: string | undefined,
  factories: BacklogStatusFactories,
) {
  const normalizedName = normalizeBacklogStatusName(name);
  if (!normalizedName) {
    throw new Error("Status name is required.");
  }

  if (
    state.backlogStatuses.some(
      (status) =>
        normalizeBacklogStatusName(status.name).toLocaleLowerCase() ===
        normalizedName.toLocaleLowerCase(),
    )
  ) {
    throw new Error("Status already exists.");
  }

  const status = {
    _id: factories.createId("backlog_status"),
    name: normalizedName,
    color: normalizeBacklogStatusColor(
      color,
      getDefaultBacklogStatusColor(state.backlogStatuses.length),
    ),
    createdAt: factories.now(),
  } satisfies LocalBacklogStatus;

  return {
    state: {
      ...state,
      backlogStatuses: [...state.backlogStatuses, status],
    },
    result: status._id,
  };
}

export function updateBacklogStatus(
  state: LocalAppState,
  statusId: string,
  updates: string | { name: string; color?: string },
): LocalAppState {
  const nextName = typeof updates === "string" ? updates : updates.name;
  const nextColor = typeof updates === "string" ? undefined : updates.color;
  const normalizedName = normalizeBacklogStatusName(nextName);
  if (!normalizedName) {
    throw new Error("Status name is required.");
  }

  const targetIndex = state.backlogStatuses.findIndex(
    (status) => status._id === statusId,
  );
  const target = state.backlogStatuses[targetIndex];
  if (!target) {
    throw new Error("Status not found.");
  }

  if (
    state.backlogStatuses.some(
      (status) =>
        status._id !== statusId &&
        normalizeBacklogStatusName(status.name).toLocaleLowerCase() ===
          normalizedName.toLocaleLowerCase(),
    )
  ) {
    throw new Error("Status already exists.");
  }

  const color = normalizeBacklogStatusColor(
    nextColor,
    target.color || getDefaultBacklogStatusColor(targetIndex),
  );

  return {
    ...state,
    backlogStatuses: state.backlogStatuses.map((status) =>
      status._id === statusId
        ? { ...status, name: normalizedName, color }
        : status,
    ),
  };
}

export function deleteBacklogStatus(
  state: LocalAppState,
  statusId: string,
): LocalAppState {
  return reconcileImportedBacklogStatuses({
    ...state,
    backlogStatuses: state.backlogStatuses.filter(
      (status) => status._id !== statusId,
    ),
    backlogStatusMappings: state.backlogStatusMappings.filter(
      (mapping) => mapping.backlogStatusId !== statusId,
    ),
    workItems: state.workItems.map((workItem) => ({
      ...workItem,
      backlogStatusId:
        workItem.backlogStatusId === statusId
          ? undefined
          : workItem.backlogStatusId,
      importedBacklogStatusId:
        workItem.importedBacklogStatusId === statusId
          ? undefined
          : workItem.importedBacklogStatusId,
    })),
  });
}

export function setBacklogStatusMapping(
  state: LocalAppState,
  mapping: BacklogStatusMappingInput,
): LocalAppState {
  const sourceStatusKey = normalizeConnectorStatusKey(mapping.sourceStatusKey);
  if (!mapping.connectionId || !sourceStatusKey) {
    throw new Error("Source status mapping is incomplete.");
  }

  const backlogStatusMappings = state.backlogStatusMappings.filter(
    (candidate) =>
      !(
        candidate.source === mapping.source &&
        candidate.connectionId === mapping.connectionId &&
        candidate.sourceStatusKey === sourceStatusKey
      ),
  );

  if (mapping.backlogStatusId) {
    backlogStatusMappings.push({
      source: mapping.source,
      connectionId: mapping.connectionId,
      sourceStatusKey,
      backlogStatusId: mapping.backlogStatusId,
    });
  }

  return reconcileImportedBacklogStatuses({
    ...state,
    backlogStatusMappings,
  });
}

import {
  normalizeConnectorStatusKey,
  type ConnectorBacklogSource,
  type ConnectorBacklogStatus,
} from "@ajour/shared";
import { findWorkflowStateMapping } from "@/domain/backlog/workflow-states";
import type {
  LocalWorkflowStateMapping,
  LocalWorkItem,
} from "@/domain/local-state";

export interface SourceStateRow {
  key: string;
  label: string;
}

/**
 * One source project of a connection in Settings > Workflow. The group without
 * a source project holds the connection's own mappings, which every source
 * project uses for the source states it doesn't map itself.
 */
export interface SourceProjectGroup {
  key: string;
  source: ConnectorBacklogSource;
  connectionId: string;
  sourceProjectName?: string;
  states: SourceStateRow[];
  /** A synced item of each work item type, to load the project's states. */
  sampleSourceIds: string[];
}

export interface SourceConnectionGroup {
  key: string;
  source: ConnectorBacklogSource;
  connectionId: string;
  connectionLabel: string;
  tenantLabel?: string;
  projects: SourceProjectGroup[];
}

export function getSourceProjectKey(
  source: string,
  connectionId: string,
  sourceProjectName?: string,
) {
  return `${source}:${connectionId}:${sourceProjectName ?? ""}`;
}

function addState(states: SourceStateRow[], label: string | undefined) {
  const trimmed = label?.trim();
  if (!trimmed) return;
  const key = normalizeConnectorStatusKey(trimmed);
  if (!states.some((state) => state.key === key)) {
    states.push({ key, label: trimmed });
  }
}

/**
 * Groups source states by connection and source project, from the states
 * syncs registered, the states of synced items, and the states loaded from
 * connectors. Registered states have no source project, so they go in the
 * connection's own group.
 */
export function buildSourceConnectionGroups(
  registered: readonly ConnectorBacklogStatus[],
  workItems: readonly LocalWorkItem[],
  loaded: Readonly<Record<string, readonly string[]>>,
): SourceConnectionGroup[] {
  const connections = new Map<string, SourceConnectionGroup>();
  const projects = new Map<string, SourceProjectGroup>();
  const sampleTypes = new Map<string, Set<string>>();

  const connectionFor = (
    source: ConnectorBacklogSource,
    connectionId: string,
    connectionLabel: string,
    tenantLabel?: string,
  ) => {
    const key = `${source}:${connectionId}`;
    let connection = connections.get(key);
    if (!connection) {
      connection = {
        key,
        source,
        connectionId,
        connectionLabel,
        tenantLabel,
        projects: [],
      };
      connections.set(key, connection);
    }
    connection.tenantLabel ??= tenantLabel;
    return connection;
  };
  const projectFor = (
    connection: SourceConnectionGroup,
    sourceProjectName?: string,
  ) => {
    const key = getSourceProjectKey(
      connection.source,
      connection.connectionId,
      sourceProjectName,
    );
    let project = projects.get(key);
    if (!project) {
      project = {
        key,
        source: connection.source,
        connectionId: connection.connectionId,
        sourceProjectName,
        states: [],
        sampleSourceIds: [],
      };
      projects.set(key, project);
      connection.projects.push(project);
    }
    return project;
  };

  for (const status of registered) {
    const connection = connectionFor(
      status.source,
      status.connectionId,
      status.connectionLabel,
      status.tenantLabel,
    );
    addState(projectFor(connection).states, status.label);
  }

  for (const workItem of workItems) {
    if (workItem.source === "manual" || !workItem.sourceConnectionId) continue;
    const connection = connectionFor(
      workItem.source,
      workItem.sourceConnectionId,
      workItem.sourceConnectionLabel ?? workItem.sourceConnectionId,
    );
    projectFor(connection);
    const project = projectFor(
      connection,
      workItem.sourceProjectName?.trim() || undefined,
    );
    addState(project.states, workItem.sourceStatusLabel);
    const types = sampleTypes.get(project.key) ?? new Set<string>();
    const type = workItem.sourceWorkItemType ?? "";
    if (workItem.sourceId && !types.has(type)) {
      types.add(type);
      project.sampleSourceIds.push(workItem.sourceId);
    }
    sampleTypes.set(project.key, types);
  }

  for (const project of projects.values()) {
    for (const label of loaded[project.key] ?? []) {
      addState(project.states, label);
    }
    project.states.sort((left, right) => left.label.localeCompare(right.label));
  }

  return Array.from(connections.values())
    .map((connection) => ({
      ...connection,
      // The connection's own group first, then source projects by name.
      projects: [...connection.projects].sort((left, right) =>
        left.sourceProjectName === undefined
          ? -1
          : right.sourceProjectName === undefined
            ? 1
            : left.sourceProjectName.localeCompare(right.sourceProjectName),
      ),
    }))
    .sort(
      (left, right) =>
        (left.tenantLabel ?? "").localeCompare(right.tenantLabel ?? "") ||
        left.connectionLabel.localeCompare(right.connectionLabel),
    );
}

/** How a source state of a project is mapped, and whether it inherits it. */
export function getEffectiveMapping(
  mappings: LocalWorkflowStateMapping[],
  project: SourceProjectGroup,
  sourceStatusKey: string,
) {
  const mapping = findWorkflowStateMapping(
    mappings,
    project.source,
    project.connectionId,
    sourceStatusKey,
    project.sourceProjectName,
  );
  return {
    workflowStateId: mapping?.workflowStateId,
    inherited:
      mapping !== undefined &&
      project.sourceProjectName !== undefined &&
      mapping.sourceProjectName === undefined,
  };
}

export function countUnmappedStates(
  mappings: LocalWorkflowStateMapping[],
  project: SourceProjectGroup,
) {
  return project.states.filter(
    (state) =>
      !getEffectiveMapping(mappings, project, state.key).workflowStateId,
  ).length;
}

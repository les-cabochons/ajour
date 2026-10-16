import {
  TEAM_SYNC_MAX_PROJECTS,
  TEAM_SYNC_MAX_TASKS,
  teamProjectChangeSchema,
  teamProjectIconSchema,
  teamTaskChangeSchema,
  type TeamProject,
  type TeamProjectChange,
  type TeamProjectFields,
  type TeamSyncRequest,
  type TeamSyncResult,
  type TeamTask,
  type TeamTaskChange,
  type TeamTaskFields,
} from "@ajour/shared";
import type {
  LocalProject,
  LocalProjectTask,
  LocalTeamConnection,
} from "@/domain/local-state";
import {
  DEFAULT_PROJECT_ICON,
  normalizeProjectIcon,
} from "@/domain/projects/project-icon";
import {
  createProject,
  createProjectTask,
  DEFAULT_PROJECT_COLOR,
  type ProjectFactories,
} from "@/domain/projects/project-transitions";
import { normalizeTaskImportName } from "@/domain/projects/task-import";

/*
 * The sync rules for shared projects. See ADR 0005 and
 * docs/superpowers/specs/2026-10-16-team-project-sync-design.md.
 *
 * A shared project's `team.synced` holds its team-owned fields as last synced.
 * A field that differs from it is a local change: a push sends it, and a pull
 * leaves it in place. Every other field takes the team's value. Local IDs never
 * change, so time entries keep their references.
 */

export interface TeamSyncState {
  projects: LocalProject[];
  teamConnections: Record<string, LocalTeamConnection>;
}

const PROJECT_FIELDS = [
  "name",
  "displayName",
  "code",
  "color",
  "icon",
  "status",
] as const satisfies readonly (keyof TeamProjectFields)[];

const TASK_FIELDS = [
  "name",
  "status",
  "billable",
  "budgetMs",
] as const satisfies readonly (keyof TeamTaskFields)[];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Field values are primitives or a flat icon object in schema key order. */
function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameName(left: string, right: string) {
  return normalizeTaskImportName(left) === normalizeTaskImportName(right);
}

/**
 * A project's team-owned fields as the team sees them. A color or an icon the
 * contract does not accept, such as an older color format, goes as Ajour's
 * default.
 */
export function toTeamProjectFields(project: LocalProject): TeamProjectFields {
  const icon = teamProjectIconSchema.safeParse(
    normalizeProjectIcon(project.icon),
  );
  const name = project.name.trim();
  return {
    name,
    displayName: project.displayName?.trim() || name,
    code: project.code?.trim() || null,
    color: HEX_COLOR.test(project.color)
      ? project.color
      : DEFAULT_PROJECT_COLOR,
    icon: icon.success ? icon.data : DEFAULT_PROJECT_ICON,
    status: project.status,
  };
}

export function toTeamTaskFields(task: LocalProjectTask): TeamTaskFields {
  return {
    name: task.name.trim(),
    status: task.status,
    billable: task.billable ?? true,
    budgetMs: task.budgetMs ?? null,
  };
}

function pickFields<T extends object, K extends keyof T>(
  source: Partial<T>,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

function withTeamProjectFields(
  project: LocalProject,
  fields: Partial<TeamProjectFields>,
): LocalProject {
  const next = { ...project };
  if (fields.name !== undefined) next.name = fields.name;
  if (fields.displayName !== undefined) next.displayName = fields.displayName;
  if (fields.code !== undefined) next.code = fields.code ?? undefined;
  if (fields.color !== undefined) next.color = fields.color;
  if (fields.icon !== undefined) next.icon = normalizeProjectIcon(fields.icon);
  if (fields.status !== undefined) next.status = fields.status;
  return next;
}

function withTeamTaskFields(
  task: LocalProjectTask,
  fields: Partial<TeamTaskFields>,
  now: () => number,
): LocalProjectTask {
  const next = { ...task };
  if (fields.name !== undefined) next.name = fields.name;
  if (fields.billable !== undefined) next.billable = fields.billable;
  if (fields.budgetMs !== undefined) {
    next.budgetMs = fields.budgetMs ?? undefined;
  }
  if (fields.status !== undefined && fields.status !== task.status) {
    next.status = fields.status;
    next.archivedAt =
      fields.status === "archived" ? (task.archivedAt ?? now()) : undefined;
  }
  return next;
}

/**
 * Takes the team's value for every field without a local change, and moves
 * the last-synced copy to the team's value for all of them. A field with a
 * local change keeps its value, so the next push sends it as the later write.
 */
function mergeFields<T extends object, K extends keyof T>(
  current: T,
  synced: T,
  incoming: T,
  keys: readonly K[],
): { take: Partial<T>; synced: T } {
  const take: Partial<T> = {};
  const nextSynced = { ...synced };
  for (const key of keys) {
    if (
      sameValue(current[key], synced[key]) &&
      !sameValue(current[key], incoming[key])
    ) {
      take[key] = incoming[key];
    }
    nextSynced[key] = incoming[key];
  }
  return { take, synced: nextSynced };
}

function changedFields<T extends object, K extends keyof T>(
  current: T,
  synced: T | undefined,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const changed: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (!synced || !sameValue(current[key], synced[key])) {
      changed[key] = current[key];
    }
  }
  return changed;
}

function teamFieldsOf(project: TeamProject): TeamProjectFields {
  return pickFields<TeamProjectFields, (typeof PROJECT_FIELDS)[number]>(
    project,
    PROJECT_FIELDS,
  ) as TeamProjectFields;
}

function taskFieldsOf(task: TeamTask): TeamTaskFields {
  return pickFields<TeamTaskFields, (typeof TASK_FIELDS)[number]>(
    task,
    TASK_FIELDS,
  ) as TeamTaskFields;
}

function linkedTask(
  task: TeamTask,
  factories: ProjectFactories,
): LocalProjectTask {
  const fields = taskFieldsOf(task);
  return {
    ...createProjectTask(
      {
        name: fields.name,
        status: fields.status,
        billable: fields.billable,
        budgetMs: fields.budgetMs ?? undefined,
      },
      factories,
    ),
    team: { remoteId: task.remoteId, synced: fields },
  };
}

/** A local project for a team project the workspace does not have yet. */
function projectFromTeam(
  teamProject: TeamProject,
  connectionId: string,
  factories: ProjectFactories,
): LocalProject {
  const fields = teamFieldsOf(teamProject);
  return {
    ...createProject(
      {
        name: fields.name,
        displayName: fields.displayName,
        code: fields.code ?? undefined,
        color: fields.color,
        icon: normalizeProjectIcon(fields.icon),
        status: fields.status,
      },
      factories,
    ),
    tasks: teamProject.tasks.map((task) => linkedTask(task, factories)),
    team: { connectionId, remoteId: teamProject.remoteId, synced: fields },
  };
}

function connectionOf(
  state: TeamSyncState,
  connectionId: string,
): LocalTeamConnection {
  return (
    state.teamConnections[connectionId] ?? {
      unsharedRemoteIds: [],
      unsharedLocalIds: [],
      heldArrivals: [],
    }
  );
}

// ---------------------------------------------------------------------------
// Plan

export interface UnsendableRecord {
  projectId: string;
  /** Absent when the project's own fields cannot be sent. */
  taskId?: string;
}

export interface TeamSyncPlan {
  request: TeamSyncRequest;
  /** Changes the page bounds left for the next round. */
  hasMoreChanges: boolean;
  /** Records the contract refuses as they are, such as a 300 character name. */
  unsendable: UnsendableRecord[];
}

function taskChange(task: LocalProjectTask): TeamTaskChange | null {
  const fields = toTeamTaskFields(task);
  if (!task.team) {
    return { localId: task._id, ...fields };
  }
  const changed = changedFields(fields, task.team.synced, TASK_FIELDS);
  if (Object.keys(changed).length === 0) return null;
  return { localId: task._id, remoteId: task.team.remoteId, ...changed };
}

/**
 * One round of local changes for a team connection, within the page bounds.
 * Projects in `skipProjectIds`, those the pending Undo touches, wait for a
 * later round. Run it again after applying the result while `hasMoreChanges`.
 */
export function planTeamSync(
  state: TeamSyncState,
  connectionId: string,
  skipProjectIds: ReadonlySet<string>,
): TeamSyncPlan {
  const changes: TeamProjectChange[] = [];
  const unsendable: UnsendableRecord[] = [];
  let taskRoom = TEAM_SYNC_MAX_TASKS;
  let hasMoreChanges = false;

  for (const project of state.projects) {
    const link = project.team;
    if (link?.connectionId !== connectionId || skipProjectIds.has(project._id))
      continue;

    const own = changedFields(
      toTeamProjectFields(project),
      link.synced,
      PROJECT_FIELDS,
    );
    const tasks: TeamTaskChange[] = [];
    for (const task of project.tasks) {
      const change = taskChange(task);
      if (!change) continue;
      if (teamTaskChangeSchema.safeParse(change).success) {
        tasks.push(change);
      } else {
        unsendable.push({ projectId: project._id, taskId: task._id });
      }
    }

    const change: TeamProjectChange = {
      localId: project._id,
      ...(link.remoteId ? { remoteId: link.remoteId } : {}),
      ...own,
      tasks: [],
    };
    if (!teamProjectChangeSchema.safeParse(change).success) {
      unsendable.push({ projectId: project._id });
      continue;
    }
    const hasOwnChange = !link.remoteId || Object.keys(own).length > 0;
    if (!hasOwnChange && tasks.length === 0) continue;

    if (
      changes.length === TEAM_SYNC_MAX_PROJECTS ||
      (taskRoom === 0 && !hasOwnChange)
    ) {
      hasMoreChanges = true;
      break;
    }
    change.tasks = tasks.slice(0, taskRoom);
    taskRoom -= change.tasks.length;
    changes.push(change);
    if (change.tasks.length < tasks.length) {
      hasMoreChanges = true;
      break;
    }
  }

  const cursor = state.teamConnections[connectionId]?.cursor;
  return {
    request: { ...(cursor ? { cursor } : {}), changes },
    hasMoreChanges,
    unsendable,
  };
}

// ---------------------------------------------------------------------------
// Apply

export type TeamSyncApplyResult =
  | {
      kind: "applied";
      /** Team projects the workspace did not have, now local shared projects. */
      createdProjectIds: string[];
      /** Shared projects whose fields or tasks the team changed. */
      updatedProjectIds: string[];
      /**
       * New team projects held because a local project already has their name.
       * Each waits for `resolveHeldArrival`: the local project is never shared
       * without the user asking.
       */
      heldArrivals: { remoteId: string; localProjectId: string }[];
    }
  /**
   * The result contradicts what Ajour sent or knows, so none of it applies
   * and the cursor stays. New records keep their local IDs, so the next round
   * can send them again safely.
   */
  | { kind: "rejected"; reason: string };

/**
 * Why a round's result cannot apply, or undefined when it can. Every new
 * record sent must get an ID, and only those; an ID names one project or one
 * task, of one project, here or held; and a task stays in its project.
 */
function findResultProblem(
  projects: readonly LocalProject[],
  connection: LocalTeamConnection,
  connectionId: string,
  pushed: readonly TeamProjectChange[],
  result: TeamSyncResult,
): string | undefined {
  const assigned = new Map(
    result.assigned.map((entry) => [entry.localId, entry.remoteId]),
  );
  // Remote ID to the local record that holds it, and a task's project.
  const projectOwners = new Map<string, string>();
  const taskOwners = new Map<string, { taskId: string; projectId: string }>();
  for (const project of projects) {
    const link = project.team;
    if (link?.connectionId !== connectionId || !link.remoteId) continue;
    projectOwners.set(link.remoteId, project._id);
    for (const task of project.tasks) {
      if (task.team) {
        taskOwners.set(task.team.remoteId, {
          taskId: task._id,
          projectId: link.remoteId,
        });
      }
    }
  }
  for (const held of connection.heldArrivals) {
    projectOwners.set(held.remoteId, `held:${held.remoteId}`);
    for (const task of held.tasks) {
      taskOwners.set(task.remoteId, {
        taskId: `held:${task.remoteId}`,
        projectId: held.remoteId,
      });
    }
  }

  const sentNew = new Set<string>();
  for (const change of pushed) {
    let projectRemoteId = change.remoteId;
    if (!change.remoteId) {
      sentNew.add(change.localId);
      projectRemoteId = assigned.get(change.localId);
      if (!projectRemoteId) {
        return "The team's answer left out the ID of a new project.";
      }
      const owner = projectOwners.get(projectRemoteId);
      if (owner !== undefined && owner !== change.localId) {
        return "The team's answer gave one ID to two projects.";
      }
      projectOwners.set(projectRemoteId, change.localId);
    }
    for (const task of change.tasks) {
      if (task.remoteId) continue;
      sentNew.add(task.localId);
      const taskRemoteId = assigned.get(task.localId);
      if (!taskRemoteId) {
        return "The team's answer left out the ID of a new task.";
      }
      const owner = taskOwners.get(taskRemoteId);
      if (owner !== undefined && owner.taskId !== task.localId) {
        return "The team's answer gave one ID to two tasks.";
      }
      taskOwners.set(taskRemoteId, {
        taskId: task.localId,
        projectId: projectRemoteId!,
      });
    }
  }
  for (const localId of assigned.keys()) {
    if (!sentNew.has(localId)) {
      return "The team's answer gave an ID to a record Ajour did not send.";
    }
  }

  for (const teamProject of result.projects) {
    for (const task of teamProject.tasks) {
      const owner = taskOwners.get(task.remoteId);
      if (owner !== undefined && owner.projectId !== teamProject.remoteId) {
        return "The team's answer moved a task to another project.";
      }
    }
  }
  return undefined;
}

/** A held arrival with a later version of it: newer fields, tasks merged. */
function updateHeldArrival(
  held: TeamProject,
  incoming: TeamProject,
): TeamProject {
  const tasks = [...held.tasks];
  for (const task of incoming.tasks) {
    const index = tasks.findIndex((entry) => entry.remoteId === task.remoteId);
    if (index === -1) tasks.push(task);
    else tasks[index] = task;
  }
  return { ...incoming, tasks };
}

/** Gives the records pushed in this round their remote IDs and synced copies. */
function recordPushed(
  projects: LocalProject[],
  connectionId: string,
  pushed: readonly TeamProjectChange[],
  assigned: ReadonlyMap<string, string>,
) {
  const changesByProject = new Map(
    pushed.map((change) => [change.localId, change]),
  );
  return projects.map((project) => {
    const change = changesByProject.get(project._id);
    const link = project.team;
    // An answer only reaches the link it was sent for. A project unshared, or
    // linked to another team project, while the round was on its way keeps
    // its new link.
    if (
      !change ||
      link?.connectionId !== connectionId ||
      link.remoteId !== change.remoteId
    ) {
      return project;
    }

    const remoteId = change.remoteId ?? assigned.get(change.localId);
    if (!remoteId) return project;
    const synced = {
      ...link.synced,
      ...pickFields<TeamProjectFields, (typeof PROJECT_FIELDS)[number]>(
        change,
        PROJECT_FIELDS,
      ),
    } as TeamProjectFields;

    const taskChanges = new Map(
      change.tasks.map((taskChange) => [taskChange.localId, taskChange]),
    );
    const tasks = project.tasks.map((task) => {
      const taskChange = taskChanges.get(task._id);
      if (!taskChange || task.team?.remoteId !== taskChange.remoteId) {
        return task;
      }
      const taskRemoteId =
        taskChange.remoteId ?? assigned.get(taskChange.localId);
      if (!taskRemoteId) return task;
      const taskSynced = {
        ...task.team?.synced,
        ...pickFields<TeamTaskFields, (typeof TASK_FIELDS)[number]>(
          taskChange,
          TASK_FIELDS,
        ),
      } as TeamTaskFields;
      return { ...task, team: { remoteId: taskRemoteId, synced: taskSynced } };
    });

    return { ...project, tasks, team: { connectionId, remoteId, synced } };
  });
}

/** Merges one team project into the shared project linked to it. */
function mergeTeamProject(
  project: LocalProject & {
    team: { connectionId: string; remoteId: string; synced: TeamProjectFields };
  },
  teamProject: TeamProject,
  factories: ProjectFactories,
): LocalProject {
  const merged = mergeFields(
    toTeamProjectFields(project),
    project.team.synced,
    teamFieldsOf(teamProject),
    PROJECT_FIELDS,
  );
  const tasks = [...project.tasks];
  for (const teamTask of teamProject.tasks) {
    const incoming = taskFieldsOf(teamTask);
    let index = tasks.findIndex(
      (task) => task.team?.remoteId === teamTask.remoteId,
    );
    // A task added here and on the team at once, before either synced.
    if (index === -1) {
      index = tasks.findIndex(
        (task) => !task.team && sameName(task.name, incoming.name),
      );
    }
    if (index === -1) {
      tasks.push(linkedTask(teamTask, factories));
      continue;
    }

    const task = tasks[index]!;
    const current = toTeamTaskFields(task);
    const taskMerge = mergeFields(
      current,
      task.team?.synced ?? incoming,
      incoming,
      TASK_FIELDS,
    );
    tasks[index] = {
      ...withTeamTaskFields(task, taskMerge.take, factories.now),
      team: { remoteId: teamTask.remoteId, synced: taskMerge.synced },
    };
  }

  return {
    ...withTeamProjectFields(project, merged.take),
    tasks,
    team: {
      connectionId: project.team.connectionId,
      remoteId: project.team.remoteId,
      synced: merged.synced,
    },
  };
}

/**
 * Applies one round's result: assigns remote IDs to what this round pushed,
 * merges the team's projects into the shared projects linked to them, adds the
 * team projects the workspace does not have, and stores the cursor. A team
 * project the user unshared here is ignored. A new team project whose name a
 * local project has is held instead of added, and later rounds keep it current.
 * A result that contradicts what Ajour sent or knows changes nothing.
 */
export function applyTeamSync(
  state: TeamSyncState,
  connectionId: string,
  pushed: readonly TeamProjectChange[],
  result: TeamSyncResult,
  factories: ProjectFactories,
): TeamSyncState & { result: TeamSyncApplyResult } {
  const connection = connectionOf(state, connectionId);
  const problem = findResultProblem(
    state.projects,
    connection,
    connectionId,
    pushed,
    result,
  );
  if (problem)
    return { ...state, result: { kind: "rejected", reason: problem } };

  const assigned = new Map(
    result.assigned.map((entry) => [entry.localId, entry.remoteId]),
  );
  // A project unshared before its ID came: the team's project stays ignored.
  const unsharedLocalIds = new Set(connection.unsharedLocalIds);
  const unshared = new Set(connection.unsharedRemoteIds);
  for (const entry of result.assigned) {
    if (unsharedLocalIds.delete(entry.localId)) unshared.add(entry.remoteId);
  }
  const projects = recordPushed(state.projects, connectionId, pushed, assigned);
  const heldArrivals = [...connection.heldArrivals];
  const outcome = {
    kind: "applied" as const,
    createdProjectIds: [] as string[],
    updatedProjectIds: [] as string[],
    heldArrivals: [] as { remoteId: string; localProjectId: string }[],
  };

  for (const teamProject of result.projects) {
    const index = projects.findIndex(
      (project) =>
        project.team?.connectionId === connectionId &&
        project.team.remoteId === teamProject.remoteId,
    );
    if (index !== -1) {
      const project = projects[index]!;
      if (!project.team?.remoteId) continue;
      const merged = mergeTeamProject(
        { ...project, team: project.team },
        teamProject,
        factories,
      );
      if (!sameValue(merged, project)) {
        projects[index] = merged;
        outcome.updatedProjectIds.push(project._id);
      }
      continue;
    }
    if (unshared.has(teamProject.remoteId)) continue;

    const heldIndex = heldArrivals.findIndex(
      (held) => held.remoteId === teamProject.remoteId,
    );
    if (heldIndex !== -1) {
      heldArrivals[heldIndex] = updateHeldArrival(
        heldArrivals[heldIndex]!,
        teamProject,
      );
      continue;
    }
    const sameNameLocal = projects.find(
      (project) => !project.team && sameName(project.name, teamProject.name),
    );
    if (sameNameLocal) {
      heldArrivals.push(teamProject);
      outcome.heldArrivals.push({
        remoteId: teamProject.remoteId,
        localProjectId: sameNameLocal._id,
      });
      continue;
    }

    const created = projectFromTeam(teamProject, connectionId, factories);
    projects.push(created);
    outcome.createdProjectIds.push(created._id);
  }

  return {
    projects,
    teamConnections: {
      ...state.teamConnections,
      [connectionId]: {
        ...connection,
        cursor: result.cursor,
        heldArrivals,
        unsharedRemoteIds: [...unshared],
        unsharedLocalIds: [...unsharedLocalIds],
      },
    },
    result: outcome,
  };
}

// ---------------------------------------------------------------------------
// Share, link, unshare and disconnect

export type TeamShareResult =
  | { kind: "shared" }
  | { kind: "missing" }
  | { kind: "alreadyShared" }
  /** The team already has a shared project of that name here. */
  | { kind: "sameNameShared"; sharedProjectId: string }
  /** A held arrival has that name: link to it with `resolveHeldArrival`. */
  | { kind: "sameNameHeld"; remoteId: string };

/**
 * Gives a local project to a team. It goes to the team with the next sync,
 * with all its tasks. A team project of the same name, shared here or held,
 * stops it, so the team does not get two.
 */
export function shareProject(
  state: TeamSyncState,
  connectionId: string,
  projectId: string,
): TeamSyncState & { result: TeamShareResult } {
  const project = state.projects.find((entry) => entry._id === projectId);
  if (!project) return { ...state, result: { kind: "missing" } };
  if (project.team) return { ...state, result: { kind: "alreadyShared" } };
  const sameNameShared = state.projects.find(
    (entry) =>
      entry.team?.connectionId === connectionId &&
      sameName(entry.name, project.name),
  );
  if (sameNameShared) {
    return {
      ...state,
      result: { kind: "sameNameShared", sharedProjectId: sameNameShared._id },
    };
  }
  const sameNameHeld = connectionOf(state, connectionId).heldArrivals.find(
    (held) => sameName(held.name, project.name),
  );
  if (sameNameHeld) {
    return {
      ...state,
      result: { kind: "sameNameHeld", remoteId: sameNameHeld.remoteId },
    };
  }

  const connection = connectionOf(state, connectionId);
  return {
    projects: state.projects.map((entry) =>
      entry._id === projectId
        ? {
            ...entry,
            tasks: entry.tasks.map((task) => ({ ...task, team: undefined })),
            team: { connectionId },
          }
        : entry,
    ),
    // Sharing again sends the same local ID, so the team answers with the
    // project an earlier share made, and it links instead of being ignored.
    teamConnections: {
      ...state.teamConnections,
      [connectionId]: {
        ...connection,
        unsharedLocalIds: connection.unsharedLocalIds.filter(
          (localId) => localId !== projectId,
        ),
      },
    },
    result: { kind: "shared" },
  };
}

export type TeamLinkResult =
  | { kind: "linked" }
  | { kind: "missing" }
  | { kind: "alreadyShared" }
  | { kind: "alreadyLinked"; projectId: string };

/**
 * Makes a local project the team's project of the same work, as the picker
 * does when joining a team. The project takes the team's values. Tasks match
 * by name; a team task without a match is added, and a local task without one
 * goes to the team with the next sync.
 */
export function linkProject(
  state: TeamSyncState,
  connectionId: string,
  projectId: string,
  teamProject: TeamProject,
  factories: ProjectFactories,
): TeamSyncState & { result: TeamLinkResult } {
  const project = state.projects.find((entry) => entry._id === projectId);
  if (!project) return { ...state, result: { kind: "missing" } };
  if (project.team) return { ...state, result: { kind: "alreadyShared" } };
  const linked = state.projects.find(
    (entry) =>
      entry.team?.connectionId === connectionId &&
      entry.team.remoteId === teamProject.remoteId,
  );
  if (linked) {
    return {
      ...state,
      result: { kind: "alreadyLinked", projectId: linked._id },
    };
  }

  const fields = teamFieldsOf(teamProject);
  const tasks: LocalProjectTask[] = project.tasks.map((task) => ({
    ...task,
    team: undefined,
  }));
  for (const teamTask of teamProject.tasks) {
    const incoming = taskFieldsOf(teamTask);
    const index = tasks.findIndex(
      (task) => !task.team && sameName(task.name, incoming.name),
    );
    if (index === -1) {
      tasks.push(linkedTask(teamTask, factories));
      continue;
    }
    tasks[index] = {
      ...withTeamTaskFields(tasks[index]!, incoming, factories.now),
      team: { remoteId: teamTask.remoteId, synced: incoming },
    };
  }

  const connection = connectionOf(state, connectionId);
  return {
    projects: state.projects.map((entry) =>
      entry._id === projectId
        ? {
            ...withTeamProjectFields(entry, fields),
            tasks,
            team: {
              connectionId,
              remoteId: teamProject.remoteId,
              synced: fields,
            },
          }
        : entry,
    ),
    teamConnections: {
      ...state.teamConnections,
      [connectionId]: {
        ...connection,
        unsharedRemoteIds: connection.unsharedRemoteIds.filter(
          (remoteId) => remoteId !== teamProject.remoteId,
        ),
        heldArrivals: connection.heldArrivals.filter(
          (held) => held.remoteId !== teamProject.remoteId,
        ),
        unsharedLocalIds: connection.unsharedLocalIds.filter(
          (localId) => localId !== projectId,
        ),
      },
    },
    result: { kind: "linked" },
  };
}

export type HeldArrivalChoice =
  { kind: "link"; projectId: string } | { kind: "addSeparately" };

export type TeamResolveResult =
  TeamLinkResult | { kind: "added"; projectId: string } | { kind: "notHeld" };

/**
 * The user's answer for a held arrival: link it to a local project, usually
 * the one with its name, or add it as a project of its own.
 */
export function resolveHeldArrival(
  state: TeamSyncState,
  connectionId: string,
  remoteId: string,
  choice: HeldArrivalChoice,
  factories: ProjectFactories,
): TeamSyncState & { result: TeamResolveResult } {
  const connection = connectionOf(state, connectionId);
  const held = connection.heldArrivals.find(
    (arrival) => arrival.remoteId === remoteId,
  );
  if (!held) return { ...state, result: { kind: "notHeld" } };

  if (choice.kind === "link") {
    return linkProject(state, connectionId, choice.projectId, held, factories);
  }

  const created = projectFromTeam(held, connectionId, factories);
  return {
    projects: [...state.projects, created],
    teamConnections: {
      ...state.teamConnections,
      [connectionId]: {
        ...connection,
        heldArrivals: connection.heldArrivals.filter(
          (arrival) => arrival.remoteId !== remoteId,
        ),
      },
    },
    result: { kind: "added", projectId: created._id },
  };
}

function withoutTeam(project: LocalProject): LocalProject {
  return {
    ...project,
    tasks: project.tasks.map((task) => ({ ...task, team: undefined })),
    team: undefined,
  };
}

/**
 * Makes a shared project local on this machine only. The team keeps it, and
 * its later changes are ignored here.
 */
export function unshareProject(
  state: TeamSyncState,
  projectId: string,
): TeamSyncState {
  const project = state.projects.find((entry) => entry._id === projectId);
  const link = project?.team;
  if (!link) return state;

  const connection = connectionOf(state, link.connectionId);
  return {
    projects: state.projects.map((entry) =>
      entry._id === projectId ? withoutTeam(entry) : entry,
    ),
    teamConnections: {
      ...state.teamConnections,
      [link.connectionId]: link.remoteId
        ? {
            ...connection,
            unsharedRemoteIds: [
              ...connection.unsharedRemoteIds.filter(
                (remoteId) => remoteId !== link.remoteId,
              ),
              link.remoteId,
            ],
          }
        : {
            // A round may already have sent it: its ID is ignored on arrival.
            ...connection,
            unsharedLocalIds: [
              ...connection.unsharedLocalIds.filter(
                (localId) => localId !== projectId,
              ),
              projectId,
            ],
          },
    },
  };
}

/** Makes every project of the connection local, and forgets its sync state. */
export function disconnectTeam(
  state: TeamSyncState,
  connectionId: string,
): TeamSyncState {
  const { [connectionId]: _removed, ...teamConnections } =
    state.teamConnections;
  return {
    projects: state.projects.map((project) =>
      project.team?.connectionId === connectionId
        ? withoutTeam(project)
        : project,
    ),
    teamConnections,
  };
}

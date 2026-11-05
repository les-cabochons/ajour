import type {
  ProjectSourceProject,
  ProjectSourceSnapshot,
  ProjectSourceTask,
} from "@ajour/shared";
import type {
  LocalProject,
  LocalProjectSource,
  LocalProjectTask,
} from "@/domain/local-state";
import {
  createProject,
  createProjectTask,
  DEFAULT_PROJECT_COLOR,
  type ProjectFactories,
} from "@/domain/projects/project-transitions";
import {
  findWaitingTaskChoices,
  type WaitingTaskAnswer,
  type WaitingTaskChoice,
} from "@/domain/projects/project-import";
import {
  formatTaskImportName,
  normalizeTaskImportName,
} from "@/domain/projects/task-import";

/*
 * The project source sync rules (#505). See ADR 0016.
 *
 * A project source hands Ajour a read-only snapshot. The projects it brings
 * become managed projects: their source-owned fields (full name, code,
 * client, dates, budget, and the tasks' names, billable and budget) take the
 * snapshot's values on every sync, and the personal ones (display name,
 * color, icon, favorites, pins, plugin properties, Commits as) stay. Local
 * IDs never change, and no time entry is touched.
 */

export interface ProjectSourceSyncState {
  projects: LocalProject[];
  projectSources: Record<string, LocalProjectSource>;
}

/** The connection a snapshot came from. */
export interface ProjectSourceConnectionRef {
  pluginId: string;
  connectionId: string;
}

/** What one sync did, in counts: the sync's event carries them. */
export interface ProjectSourceSyncCounts {
  /** Local projects that became managed. */
  linked: number;
  created: number;
  /** Managed projects whose fields or tasks changed. */
  updated: number;
  /** Managed projects the sync archived: complete, or missing. */
  archived: number;
  restored: number;
  /** Source projects waiting in Sync review. */
  held: number;
  /** Managed projects the sync left as they were. */
  unchanged: number;
}

/**
 * A project the sync added source tasks to while it has Not known yet tasks:
 * the user picks which new task each one waited for (#481).
 */
export interface SourceWaitingQuestion {
  projectId: string;
  choices: WaitingTaskChoice[];
}

export type ProjectSourceSyncResult = ProjectSourceSyncCounts & {
  waitingQuestions: SourceWaitingQuestion[];
};

const HOUR_MS = 3_600_000;

function normalizeCode(code: string | undefined) {
  return code?.trim().toLowerCase() ?? "";
}

function sameName(left: string, right: string) {
  return normalizeTaskImportName(left) === normalizeTaskImportName(right);
}

/** A project neither managed nor shared: the only kind a source may link. */
function isLinkable(project: LocalProject) {
  return !project.source && !project.team;
}

/** `value` with its object keys sorted and its undefined fields dropped. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, field]) => [key, canonical(field)]),
  );
}

/**
 * Whether two records hold the same values, the time of the sync aside,
 * whatever order their fields were written in.
 */
function sameExceptSyncTime(left: LocalProject, right: LocalProject) {
  const strip = (project: LocalProject) =>
    JSON.stringify(
      canonical({
        ...project,
        source: project.source ? { ...project.source, syncedAt: 0 } : undefined,
      }),
    );
  return strip(left) === strip(right);
}

function budgetMsOf(task: ProjectSourceTask) {
  return task.estimateHours === undefined
    ? undefined
    : Math.round(task.estimateHours * HOUR_MS);
}

function taskSourceOf(task: ProjectSourceTask) {
  return {
    remoteId: task.remoteId,
    ...(task.group !== undefined ? { group: task.group } : {}),
    assigned: task.assigned,
    ...(task.myHours !== undefined ? { myHours: task.myHours } : {}),
  };
}

/** The fields a sync's archive reads and writes, on a project or a task. */
type SourceArchived = Pick<
  LocalProject,
  "status" | "archivedBySource" | "archivedByMissingSync"
>;

/**
 * Archives what the source says is done, and restores what only the source
 * archived. A record the user archived by hand stays archived.
 */
function withSourceStatus<T extends SourceArchived>(
  record: T,
  done: boolean,
): T {
  if (done) {
    if (record.status === "archived") {
      // Gone and back, but done: still the source's archive.
      return record.archivedByMissingSync
        ? {
            ...record,
            archivedByMissingSync: undefined,
            archivedBySource: true,
          }
        : record;
    }
    return { ...record, status: "archived", archivedBySource: true };
  }
  if (
    record.status === "archived" &&
    (record.archivedBySource || record.archivedByMissingSync)
  ) {
    return {
      ...record,
      status: "active",
      archivedBySource: undefined,
      archivedByMissingSync: undefined,
    };
  }
  return record;
}

/** Archives a record the snapshot lacks, unless it is archived already. */
function withMissingArchive<T extends SourceArchived>(record: T): T {
  if (record.status === "archived") return record;
  return { ...record, status: "archived", archivedByMissingSync: true };
}

/** A task's archive time, for the status the sync gave it. */
function withTaskArchivedAt(
  before: LocalProjectTask,
  after: LocalProjectTask,
  now: number,
): LocalProjectTask {
  if (before.status === after.status) return after;
  return {
    ...after,
    archivedAt: after.status === "archived" ? now : undefined,
  };
}

function withTaskSourceStatus(
  task: LocalProjectTask,
  closed: boolean,
  now: number,
) {
  return withTaskArchivedAt(task, withSourceStatus(task, closed), now);
}

function withTaskMissingArchive(task: LocalProjectTask, now: number) {
  return withTaskArchivedAt(task, withMissingArchive(task), now);
}

/** A task's source-owned fields, as the snapshot has them. */
function withTaskSourceFields(
  task: LocalProjectTask,
  sourceTask: ProjectSourceTask,
  now: number,
): LocalProjectTask {
  return withTaskSourceStatus(
    {
      ...task,
      name: sourceTask.name,
      billable: sourceTask.billable ?? true,
      budgetMs: budgetMsOf(sourceTask),
      source: taskSourceOf(sourceTask),
      // The source knows the task: its time commits as its name.
      commitAs: task.commitAs === "waiting" ? undefined : task.commitAs,
    },
    sourceTask.closed,
    now,
  );
}

/**
 * The project's tasks after the snapshot's: linked, updated or added, with
 * the IDs of the ones added.
 */
function mergeTasks(
  tasks: readonly LocalProjectTask[],
  sourceTasks: readonly ProjectSourceTask[],
  factories: ProjectFactories,
  now: number,
): { tasks: LocalProjectTask[]; createdIds: Set<string> } {
  const next = [...tasks];
  const createdIds = new Set<string>();
  const seen = new Set<string>();
  for (const sourceTask of sourceTasks) {
    seen.add(sourceTask.remoteId);
    let index = next.findIndex(
      (task) => task.source?.remoteId === sourceTask.remoteId,
    );
    // A local task of the name becomes the source's, and keeps its time.
    if (index === -1) {
      index = next.findIndex(
        (task) => !task.source && sameName(task.name, sourceTask.name),
      );
    }
    if (index !== -1) {
      next[index] = withTaskSourceFields(next[index]!, sourceTask, now);
      continue;
    }
    const created = withTaskSourceFields(
      createProjectTask({ name: sourceTask.name }, factories),
      sourceTask,
      now,
    );
    createdIds.add(created._id);
    next.push(created);
  }
  // A task that left the source is archived, never deleted.
  return {
    tasks: next.map((task) =>
      task.source && !seen.has(task.source.remoteId)
        ? withTaskMissingArchive(task, now)
        : task,
    ),
    createdIds,
  };
}

/**
 * The #481 question for a project the sync added tasks to: its Not known
 * yet tasks the source doesn't know, and the added tasks still open.
 */
function waitingQuestionOf(
  project: LocalProject,
  createdIds: ReadonlySet<string>,
): SourceWaitingQuestion | undefined {
  const added = project.tasks.filter(
    (task) => createdIds.has(task._id) && task.status === "active",
  );
  if (added.length === 0) return undefined;
  const choices = findWaitingTaskChoices(
    {
      tasks: project.tasks.filter(
        (task) => !createdIds.has(task._id) && !task.source,
      ),
    },
    added.map((task) => task.name),
  );
  return choices.length > 0 ? { projectId: project._id, choices } : undefined;
}

/**
 * The display name after the source's: a project being linked keeps the one
 * it shows, its full name included. Once managed, a display name that was
 * the full name follows it, and one the user chose stays.
 */
function displayNameAfter(
  project: LocalProject,
  sourceName: string,
  linking: boolean,
) {
  const shown = project.displayName?.trim()
    ? project.displayName
    : project.name;
  if (linking) return shown;
  return shown.trim() === project.name.trim() ? sourceName : shown;
}

/**
 * The project's source-owned fields and tasks, as the snapshot has them.
 * `linking` is set when a local project becomes managed.
 */
function withSourceFields(
  project: LocalProject,
  sourceProject: ProjectSourceProject,
  asOf: string,
  connection: ProjectSourceConnectionRef,
  factories: ProjectFactories,
  now: number,
  linking: boolean,
): { project: LocalProject; createdTaskIds: Set<string> } {
  const merged = mergeTasks(project.tasks, sourceProject.tasks, factories, now);
  const next: LocalProject = {
    ...project,
    name: sourceProject.name,
    displayName: displayNameAfter(project, sourceProject.name, linking),
    code: sourceProject.code,
    client: sourceProject.client,
    startsOn: sourceProject.startsOn,
    endsOn: sourceProject.endsOn,
    budget: sourceProject.budget
      ? { ...sourceProject.budget, asOf }
      : undefined,
    tasks: merged.tasks,
    source: {
      pluginId: connection.pluginId,
      connectionId: connection.connectionId,
      remoteId: sourceProject.remoteId,
      ...(sourceProject.url ? { url: sourceProject.url } : {}),
      syncedAt: now,
    },
  };
  return {
    project: withSourceStatus(next, sourceProject.complete),
    createdTaskIds: merged.createdIds,
  };
}

function connectionRecord(
  snapshot: ProjectSourceSnapshot,
  connection: ProjectSourceConnectionRef,
  held: ProjectSourceProject[],
  syncedAt: number,
): LocalProjectSource {
  return {
    pluginId: connection.pluginId,
    label: snapshot.source.label,
    ...(snapshot.source.url ? { url: snapshot.source.url } : {}),
    asOf: snapshot.asOf,
    ...(snapshot.me ? { me: snapshot.me } : {}),
    syncedAt,
    held,
  };
}

function createManagedProject(
  sourceProject: ProjectSourceProject,
  asOf: string,
  connection: ProjectSourceConnectionRef,
  factories: ProjectFactories,
  now: number,
) {
  return withSourceFields(
    createProject(
      { name: sourceProject.name, color: DEFAULT_PROJECT_COLOR },
      factories,
    ),
    sourceProject,
    asOf,
    connection,
    factories,
    now,
    false,
  ).project;
}

/**
 * Syncs one snapshot into the workspace's projects, and keeps what the
 * connection needs between syncs. `syncedAt` is the connection's last sync
 * time as the local API answered it, so a later sync can tell whether it
 * missed an answer; it defaults to now.
 */
export function syncProjectSource(
  state: ProjectSourceSyncState,
  connection: ProjectSourceConnectionRef,
  snapshot: ProjectSourceSnapshot,
  factories: ProjectFactories,
  options: { syncedAt?: number } = {},
): ProjectSourceSyncState & { result: ProjectSourceSyncResult } {
  const now = factories.now();
  const projects = [...state.projects];
  const held: ProjectSourceProject[] = [];
  const result: ProjectSourceSyncResult = {
    linked: 0,
    created: 0,
    updated: 0,
    archived: 0,
    restored: 0,
    held: 0,
    unchanged: 0,
    waitingQuestions: [],
  };

  const countStatus = (before: LocalProject, after: LocalProject) => {
    if (before.status === after.status) return;
    if (after.status === "archived") result.archived += 1;
    else result.restored += 1;
  };
  const update = (
    index: number,
    sourceProject: ProjectSourceProject,
    linking: boolean,
  ) => {
    const before = projects[index]!;
    const { project: after, createdTaskIds } = withSourceFields(
      before,
      sourceProject,
      snapshot.asOf,
      connection,
      factories,
      now,
      linking,
    );
    projects[index] = after;
    countStatus(before, after);
    const question = waitingQuestionOf(after, createdTaskIds);
    if (question) result.waitingQuestions.push(question);
    return { before, after };
  };
  const inSnapshot = new Set(
    snapshot.projects.map((sourceProject) => sourceProject.remoteId),
  );

  for (const sourceProject of snapshot.projects) {
    const linkedIndex = projects.findIndex(
      (project) =>
        project.source?.connectionId === connection.connectionId &&
        project.source.remoteId === sourceProject.remoteId,
    );
    if (linkedIndex !== -1) {
      const { before, after } = update(linkedIndex, sourceProject, false);
      if (sameExceptSyncTime(before, after)) result.unchanged += 1;
      else result.updated += 1;
      continue;
    }

    const code = normalizeCode(sourceProject.code);
    const index = projects.findIndex(
      (project) => isLinkable(project) && normalizeCode(project.code) === code,
    );
    if (index !== -1) {
      update(index, sourceProject, true);
      result.linked += 1;
      continue;
    }

    // A shared project follows its team: a source never takes it over, so
    // the source project is added beside it, not held.
    const matchesShared = projects.some(
      (project) =>
        project.team &&
        (normalizeCode(project.code) === code ||
          sameName(project.name, sourceProject.name)),
    );
    if (
      !matchesShared &&
      projects.some(
        (project) =>
          isLinkable(project) && sameName(project.name, sourceProject.name),
      )
    ) {
      held.push(sourceProject);
      result.held += 1;
      continue;
    }

    const created = createManagedProject(
      sourceProject,
      snapshot.asOf,
      connection,
      factories,
      now,
    );
    projects.push(created);
    result.created += 1;
    if (created.status === "archived") result.archived += 1;
  }

  // A managed project that left the source is archived, never deleted.
  projects.forEach((project, index) => {
    if (
      project.source?.connectionId !== connection.connectionId ||
      inSnapshot.has(project.source.remoteId)
    ) {
      return;
    }
    const archived = withMissingArchive(project);
    if (archived !== project) {
      projects[index] = archived;
      result.archived += 1;
    }
  });

  return {
    projects,
    projectSources: {
      ...state.projectSources,
      [connection.connectionId]: connectionRecord(
        snapshot,
        connection,
        held,
        options.syncedAt ?? now,
      ),
    },
    result,
  };
}

/**
 * The source had nothing new: the projects stay, and the connection keeps
 * the local API's new sync time, so the next sync trusts its cursor.
 */
export function confirmProjectSourceUnchanged(
  state: ProjectSourceSyncState,
  connectionId: string,
  syncedAt: number,
): ProjectSourceSyncState {
  const record = state.projectSources[connectionId];
  if (!record || record.syncedAt === syncedAt) return state;
  return {
    ...state,
    projectSources: {
      ...state.projectSources,
      [connectionId]: { ...record, syncedAt },
    },
  };
}

// ---------------------------------------------------------------------------
// Held projects, Not known yet tasks, and a removed connection

/**
 * The local project a held source project would link to: one neither
 * managed nor shared with its name. Undefined when none has it any more.
 */
export function findHeldSourceMatch(
  projects: readonly LocalProject[],
  held: Pick<ProjectSourceProject, "name">,
): LocalProject | undefined {
  return projects.find(
    (project) => isLinkable(project) && sameName(project.name, held.name),
  );
}

export type HeldSourceProjectChoice =
  { kind: "link"; projectId: string } | { kind: "addAsNew" };

export type HeldSourceProjectResult =
  | {
      kind: "linked";
      projectId: string;
      /** The #481 question, when the link added tasks beside waiting ones. */
      waitingQuestion?: SourceWaitingQuestion;
    }
  | { kind: "added"; projectId: string }
  /** The source project waits no more: a sync or another window took it. */
  | { kind: "notHeld" }
  /** The picked project is gone, shared or managed already. */
  | { kind: "notLinkable" };

/**
 * The user's answer for a held source project: link it to a local project,
 * usually the one with its name, or add it as a project of its own. Either
 * way the next sync follows it by its remote ID.
 */
export function resolveHeldSourceProject(
  state: ProjectSourceSyncState,
  connection: ProjectSourceConnectionRef,
  remoteId: string,
  choice: HeldSourceProjectChoice,
  factories: ProjectFactories,
): ProjectSourceSyncState & { result: HeldSourceProjectResult } {
  const record = state.projectSources[connection.connectionId];
  const held = record?.held.find((project) => project.remoteId === remoteId);
  if (!record || !held) return { ...state, result: { kind: "notHeld" } };
  const now = factories.now();
  const projectSources = {
    ...state.projectSources,
    [connection.connectionId]: {
      ...record,
      held: record.held.filter((project) => project.remoteId !== remoteId),
    },
  };

  if (choice.kind === "addAsNew") {
    const created = createManagedProject(
      held,
      record.asOf,
      connection,
      factories,
      now,
    );
    return {
      projects: [...state.projects, created],
      projectSources,
      result: { kind: "added", projectId: created._id },
    };
  }

  const index = state.projects.findIndex(
    (project) => project._id === choice.projectId,
  );
  const project = state.projects[index];
  if (!project || !isLinkable(project)) {
    return { ...state, result: { kind: "notLinkable" } };
  }
  const projects = [...state.projects];
  const linked = withSourceFields(
    project,
    held,
    record.asOf,
    connection,
    factories,
    now,
    true,
  );
  projects[index] = linked.project;
  const waitingQuestion = waitingQuestionOf(
    linked.project,
    linked.createdTaskIds,
  );
  return {
    projects,
    projectSources,
    result: {
      kind: "linked",
      projectId: project._id,
      ...(waitingQuestion ? { waitingQuestion } : {}),
    },
  };
}

/**
 * Applies the answers to a sync's Not known yet question. A picked source
 * task becomes the waiting task: the waiting task takes its name and its
 * source link and commits as that name, and the task the sync added goes,
 * so the waiting task's time, pins and favorite stay where they are. An
 * answer about a task that changed since the question does nothing, and so
 * does one whose source task is in use, pinned or starred. Local only and
 * Still waiting apply as Import tasks… applies them.
 */
export function answerSourceWaitingTasks(
  projects: LocalProject[],
  projectId: string,
  answers: Readonly<Record<string, WaitingTaskAnswer>>,
  isTaskInUse: (taskId: string) => boolean,
): { projects: LocalProject[]; matchedCount: number } {
  const project = projects.find((entry) => entry._id === projectId);
  if (!project) return { projects, matchedCount: 0 };
  let tasks = [...project.tasks];
  let matchedCount = 0;
  let changed = false;

  for (const [taskId, answer] of Object.entries(answers)) {
    const index = tasks.findIndex((task) => task._id === taskId);
    const task = tasks[index];
    if (
      !task ||
      task.commitAs !== "waiting" ||
      task.status !== "active" ||
      task.source ||
      task.name !== answer.expectedName ||
      answer.kind === "wait"
    ) {
      continue;
    }
    if (answer.kind === "local") {
      tasks[index] = { ...task, commitAs: "local" };
      changed = true;
      continue;
    }
    const key = normalizeTaskImportName(formatTaskImportName(answer.name));
    const picked = tasks.find(
      (candidate) =>
        candidate.source &&
        candidate.status === "active" &&
        normalizeTaskImportName(candidate.name) === key,
    );
    if (
      !picked ||
      isTaskInUse(picked._id) ||
      picked.pinnedSlot ||
      picked.favoritedAt !== undefined
    ) {
      continue;
    }
    tasks[index] = {
      ...task,
      name: picked.name,
      billable: picked.billable,
      budgetMs: picked.budgetMs,
      source: picked.source,
      commitAs: undefined,
    };
    tasks = tasks.filter((candidate) => candidate._id !== picked._id);
    matchedCount += 1;
    changed = true;
  }

  if (!changed) return { projects, matchedCount: 0 };
  return {
    projects: projects.map((entry) =>
      entry._id === projectId ? { ...entry, tasks } : entry,
    ),
    matchedCount,
  };
}

function withoutSource<T extends LocalProject | LocalProjectTask>(
  record: T,
): T {
  const {
    source: _source,
    archivedByMissingSync: _missing,
    archivedBySource: _bySource,
    ...rest
  } = record;
  return rest as T;
}

/**
 * A removed project source connection: its managed projects become local
 * ones, with their entries, names, figures and status, and the connection's
 * record goes.
 */
export function disconnectProjectSource(
  state: ProjectSourceSyncState,
  connectionId: string,
): ProjectSourceSyncState {
  const { [connectionId]: _removed, ...projectSources } = state.projectSources;
  return {
    projects: state.projects.map((project) =>
      project.source?.connectionId === connectionId
        ? { ...withoutSource(project), tasks: project.tasks.map(withoutSource) }
        : project,
    ),
    projectSources,
  };
}

import type { LocalProject, LocalProjectTask } from "@/domain/local-state";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import { getProjectTaskBillableValueLabel } from "@/features/projects/project-task-options";

export const PROJECT_TASK_SEARCH_RESULT_LIMIT = 50;

export interface ProjectTaskSearchMatch {
  project: LocalProject;
  task: LocalProjectTask;
}

export interface ProjectTaskSearchResults {
  matches: ProjectTaskSearchMatch[];
  total: number;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getSearchTerms(query: string) {
  const normalizedQuery = normalizeSearchText(query);
  return normalizedQuery ? normalizedQuery.split(/\s+/u) : [];
}

function getProjectSearchText(project: LocalProject) {
  return normalizeSearchText(
    [project.name, getLocalProjectDisplayName(project), project.code ?? ""].join(
      " ",
    ),
  );
}

function getTaskSearchText(task: LocalProjectTask) {
  return normalizeSearchText(
    [task.name, getProjectTaskBillableValueLabel(task)].join(" "),
  );
}

function matchesAllTerms(searchText: string, terms: string[]) {
  return terms.every((term) => searchText.includes(term));
}

export function findMatchingProjects(
  projects: LocalProject[],
  query: string,
) {
  const terms = getSearchTerms(query);
  const activeProjects = projects.filter(
    (project) => project.status === "active",
  );

  if (terms.length === 0) {
    return activeProjects;
  }

  return activeProjects.filter((project) =>
    matchesAllTerms(getProjectSearchText(project), terms),
  );
}

function getTaskMatchRank(
  project: LocalProject,
  task: LocalProjectTask,
  query: string,
) {
  const normalizedQuery = normalizeSearchText(query);
  const taskName = normalizeSearchText(task.name);
  const projectTaskText = `${getProjectSearchText(project)} ${getTaskSearchText(task)}`;

  if (taskName === normalizedQuery) {
    return 0;
  }

  if (taskName.startsWith(normalizedQuery)) {
    return 1;
  }

  if (taskName.includes(normalizedQuery)) {
    return 2;
  }

  if (projectTaskText.includes(normalizedQuery)) {
    return 3;
  }

  return 4;
}

export function findMatchingProjectTasks(
  projects: LocalProject[],
  query: string,
  limit = PROJECT_TASK_SEARCH_RESULT_LIMIT,
): ProjectTaskSearchResults {
  const terms = getSearchTerms(query);
  if (terms.length === 0) {
    return { matches: [], total: 0 };
  }

  const rankedMatches = projects
    .filter((project) => project.status === "active")
    .flatMap((project, projectIndex) => {
      const projectSearchText = getProjectSearchText(project);

      return project.tasks
        .filter((task) => task.status === "active")
        .flatMap((task, taskIndex) => {
          const taskSearchText = getTaskSearchText(task);
          const combinedSearchText = `${projectSearchText} ${taskSearchText}`;
          const hasTaskTerm = terms.some((term) =>
            taskSearchText.includes(term),
          );

          if (
            !hasTaskTerm ||
            !matchesAllTerms(combinedSearchText, terms)
          ) {
            return [];
          }

          return [
            {
              match: { project, task },
              projectIndex,
              taskIndex,
              rank: getTaskMatchRank(project, task, query),
            },
          ];
        });
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.projectIndex - right.projectIndex ||
        left.taskIndex - right.taskIndex,
    );

  return {
    matches: rankedMatches.slice(0, Math.max(0, limit)).map(({ match }) => match),
    total: rankedMatches.length,
  };
}

export function findMatchingTasksInProject(
  project: LocalProject,
  query: string,
) {
  const terms = getSearchTerms(query);

  return project.tasks.filter(
    (task) =>
      task.status === "active" &&
      (terms.length === 0 ||
        matchesAllTerms(getTaskSearchText(task), terms)),
  );
}

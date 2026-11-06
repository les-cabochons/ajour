import { normalizeTaskName } from "@ajour/shared/task-names";
import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalProjectTask,
} from "@/domain/local-state";

/** The longest code the user can give a project. */
export const PROJECT_CODE_MAX_LENGTH = 10;

const PROJECT_CODE_PATTERN = new RegExp(
  `^[A-Z0-9_-]{1,${PROJECT_CODE_MAX_LENGTH}}$`,
);

export const PROJECT_CODE_ERROR = `A code has up to ${PROJECT_CODE_MAX_LENGTH} letters, digits, - or _.`;

export const PROJECT_NAME_ERROR = "Enter a full name.";

/**
 * A code as the user typed it, made a project code: trimmed and uppercase.
 * Empty means no code. Spaces, other signs or more than ten characters are
 * refused with `PROJECT_CODE_ERROR`, never cut short, since the code stands
 * for the project in tight places such as the timer card.
 */
export function normalizeProjectCode(
  text: string,
): { ok: true; code: string | undefined } | { ok: false; error: string } {
  const code = text.trim().toUpperCase();
  if (!code) return { ok: true, code: undefined };
  return PROJECT_CODE_PATTERN.test(code)
    ? { ok: true, code }
    : { ok: false, error: PROJECT_CODE_ERROR };
}

/**
 * Another project with this name, full or display, compared as task names
 * are: trimmed, spaces collapsed, case and accents ignored.
 */
export function findProjectNamed(
  projects: readonly Pick<LocalProject, "_id" | "name" | "displayName">[],
  name: string,
  exceptProjectId?: string,
) {
  const key = normalizeTaskName(name);
  if (!key) return undefined;
  return projects.find(
    (project) =>
      project._id !== exceptProjectId &&
      (normalizeTaskName(project.name) === key ||
        normalizeTaskName(getLocalProjectDisplayName(project)) === key),
  );
}

/** Says that another project has the name, or null. */
export function getDuplicateProjectNameWarning(
  projects: readonly Pick<LocalProject, "_id" | "name" | "displayName">[],
  name: string,
  exceptProjectId?: string,
) {
  const other = findProjectNamed(projects, name, exceptProjectId);
  return other
    ? `Another project is named ${getLocalProjectDisplayName(other)}.`
    : null;
}

/**
 * Says that another task of the project has the name, compared as task
 * names are, or null. An archived one is named as such.
 */
export function getDuplicateTaskNameWarning(
  projectName: string,
  tasks: readonly Pick<LocalProjectTask, "_id" | "name" | "status">[],
  name: string,
  exceptTaskId?: string,
) {
  const key = normalizeTaskName(name);
  if (!key) return null;
  const matches = tasks.filter(
    (task) => task._id !== exceptTaskId && normalizeTaskName(task.name) === key,
  );
  const other = matches.find((task) => task.status === "active") ?? matches[0];
  if (!other) return null;
  return other.status === "active"
    ? `${projectName} already has a task named ${other.name}.`
    : `${projectName} already has an archived task named ${other.name}.`;
}

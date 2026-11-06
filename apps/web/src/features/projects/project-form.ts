import {
  getLocalProjectDisplayName,
  type LocalProject,
} from "@/domain/local-state";
import {
  DEFAULT_PROJECT_ICON,
  type LocalProjectIcon,
} from "@/domain/projects/project-icon";
import { DEFAULT_PROJECT_COLOR } from "@/domain/projects/project-transitions";
import {
  normalizeProjectCode,
  PROJECT_NAME_ERROR,
} from "@/domain/projects/project-names";

/** The project form's draft: what the user typed, before trimming. */
export interface ProjectFormFields {
  name: string;
  displayName: string;
  code: string;
  color: string;
  icon: LocalProjectIcon;
  /**
   * The saved project's code, as it is. An import or a project source may
   * bring a code the form would refuse; left as it is, it is kept, and only a
   * changed code is checked (Sol's review of #649).
   */
  savedCode?: string;
}

/** What Save writes for a project, for both create and edit. */
export interface ProjectFormValues {
  name: string;
  displayName: string;
  code: string | undefined;
  color: string;
  icon: LocalProjectIcon;
}

/** Seeds the form from a saved project, or with defaults for a new one. */
export function createProjectFormFields(
  project?: LocalProject,
): ProjectFormFields {
  if (!project) {
    return {
      name: "",
      displayName: "",
      code: "",
      color: DEFAULT_PROJECT_COLOR,
      icon: DEFAULT_PROJECT_ICON,
    };
  }

  return {
    name: project.name,
    displayName: getLocalProjectDisplayName(project),
    code: project.code ?? "",
    savedCode: project.code ?? "",
    color: project.color,
    icon: project.icon,
  };
}

/**
 * Changes the full name. The display name follows it while the user has not given
 * the display name a value of its own (empty, or still equal to the full name).
 */
export function setProjectFormName(
  fields: ProjectFormFields,
  name: string,
): ProjectFormFields {
  const displayNameFollowsName =
    fields.displayName.trim() === "" ||
    fields.displayName.trim() === fields.name.trim();

  return {
    ...fields,
    name,
    displayName: displayNameFollowsName ? name : fields.displayName,
  };
}

/** The code to save: the saved one left as it is, or a typed one checked. */
function readProjectFormCode(fields: ProjectFormFields) {
  if (fields.savedCode !== undefined && fields.code === fields.savedCode) {
    return { ok: true as const, code: fields.savedCode || undefined };
  }
  return normalizeProjectCode(fields.code);
}

/** Why the form can't save: an empty full name or a code Ajour refuses. */
export interface ProjectFormErrors {
  name?: string;
  code?: string;
}

/** The form's mistakes, each said next to its field. Empty when it can save. */
export function getProjectFormErrors(
  fields: ProjectFormFields,
): ProjectFormErrors {
  const code = readProjectFormCode(fields);
  return {
    ...(fields.name.trim() ? {} : { name: PROJECT_NAME_ERROR }),
    ...(code.ok ? {} : { code: code.error }),
  };
}

/**
 * Returns the values to save, or `null` while the full name is empty or the
 * code is refused. Names are trimmed and the code uppercase. An empty display
 * name falls back to the full name; an empty code is cleared.
 */
export function getProjectFormValues(
  fields: ProjectFormFields,
): ProjectFormValues | null {
  const name = fields.name.trim();
  const code = readProjectFormCode(fields);
  if (!name || !code.ok) {
    return null;
  }

  return {
    name,
    displayName: fields.displayName.trim() || name,
    code: code.code,
    color: fields.color,
    icon: fields.icon,
  };
}

/**
 * The project page's in-place edits: applies `change` to the saved project's
 * fields and returns the values to save, or `null` when the result is invalid
 * (an empty full name keeps the saved one) or changes nothing.
 */
export function getProjectPatch(
  project: LocalProject,
  change: (fields: ProjectFormFields) => ProjectFormFields,
): ProjectFormValues | null {
  const values = getProjectFormValues(change(createProjectFormFields(project)));
  if (!values) {
    return null;
  }

  const unchanged =
    values.name === project.name &&
    values.displayName === getLocalProjectDisplayName(project) &&
    values.code === (project.code || undefined) &&
    values.color === project.color &&
    JSON.stringify(values.icon) === JSON.stringify(project.icon);
  return unchanged ? null : values;
}

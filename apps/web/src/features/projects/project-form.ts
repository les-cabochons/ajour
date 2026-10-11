import {
  getLocalProjectDisplayName,
  type LocalProject,
} from "@/domain/local-state";
import {
  DEFAULT_PROJECT_ICON,
  type LocalProjectIcon,
} from "@/domain/projects/project-icon";

/** The project form's draft: what the user typed, before trimming. */
export interface ProjectFormFields {
  name: string;
  displayName: string;
  code: string;
  color: string;
  icon: LocalProjectIcon;
}

/** What Save writes for a project, for both create and edit. */
export interface ProjectFormValues {
  name: string;
  displayName: string;
  code: string | undefined;
  color: string;
  icon: LocalProjectIcon;
}

const DEFAULT_PROJECT_COLOR = "#1f7667";

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

/**
 * Returns the trimmed values to save, or `null` while the full name is empty.
 * An empty display name falls back to the full name; an empty code is cleared.
 */
export function getProjectFormValues(
  fields: ProjectFormFields,
): ProjectFormValues | null {
  const name = fields.name.trim();
  if (!name) {
    return null;
  }

  return {
    name,
    displayName: fields.displayName.trim() || name,
    code: fields.code.trim() || undefined,
    color: fields.color,
    icon: fields.icon,
  };
}

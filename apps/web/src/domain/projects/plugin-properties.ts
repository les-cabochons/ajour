import type {
  ProjectPropertiesCapability,
  ProjectPropertyField,
  TaskPropertiesCapability,
  TaskPropertyField,
} from "@ajour/shared";
import type { LocalProject, LocalProjectTask } from "@/domain/local-state";

/*
 * Properties that plugins add to projects and tasks, such as the Workday
 * name of a project or the Workday task a task commits as. Only overrides
 * are stored; an empty value means the field's default, read live from the
 * project or task so a rename in Ajour follows. Values of plugins that are
 * not installed are kept untouched.
 */

export const PLUGIN_PROPERTY_MAX_LENGTH = 240;

export type PluginProperties = Record<string, Record<string, string>>;

/** An active plugin that adds project properties. */
export interface ProjectPropertyPlugin {
  pluginId: string;
  capability: ProjectPropertiesCapability;
}

/** An active plugin that adds task properties. */
export interface TaskPropertyPlugin {
  pluginId: string;
  capability: TaskPropertiesCapability;
}

/** The active plugins that add properties, to projects and to tasks. */
export interface PropertyPlugins {
  projects: ProjectPropertyPlugin[];
  tasks: TaskPropertyPlugin[];
}

export const NO_PROPERTY_PLUGINS: PropertyPlugins = { projects: [], tasks: [] };

export interface ResolvedPluginProperty<
  Field extends { id: string } = ProjectPropertyField,
> {
  field: Field;
  /** The override, or the default when there is none. */
  value: string;
  defaultValue: string;
  isDefault: boolean;
}

/** What holds plugin property overrides: a project or a task. */
interface PluginPropertyOwner {
  pluginProperties?: PluginProperties;
}

function resolveFields<Field extends { id: string }>(
  owner: PluginPropertyOwner,
  pluginId: string,
  fields: readonly Field[],
  defaultValue: (field: Field) => string,
): ResolvedPluginProperty<Field>[] {
  const plugins = owner.pluginProperties;
  // Own keys only, so an id such as "constructor" never reads Object.prototype.
  const stored =
    plugins && Object.hasOwn(plugins, pluginId)
      ? (plugins[pluginId] ?? {})
      : {};
  return fields.map((field) => {
    const fallback = defaultValue(field);
    const override = Object.hasOwn(stored, field.id)
      ? stored[field.id]
      : undefined;
    return override
      ? { field, value: override, defaultValue: fallback, isDefault: false }
      : { field, value: fallback, defaultValue: fallback, isDefault: true };
  });
}

/** Each field of the plugin with its value for this project, in manifest order. */
export function resolvePluginProperties(
  project: LocalProject,
  plugin: ProjectPropertyPlugin,
): ResolvedPluginProperty[] {
  return resolveFields(
    project,
    plugin.pluginId,
    plugin.capability.fields,
    (field) => {
      if (field.defaultFrom === "fullName") return project.name;
      if (field.defaultFrom === "code") return project.code ?? "";
      return "";
    },
  );
}

/** Each field of the plugin with its value for this task, in manifest order. */
export function resolveTaskPluginProperties(
  task: Pick<LocalProjectTask, "name" | "pluginProperties">,
  plugin: TaskPropertyPlugin,
): ResolvedPluginProperty<TaskPropertyField>[] {
  return resolveFields(
    task,
    plugin.pluginId,
    plugin.capability.fields,
    (field) => (field.defaultFrom === "name" ? task.name : ""),
  );
}

/**
 * The name the plugin's tool knows the task by: the value of the plugin's
 * first field that defaults to the task's name. Undefined when the plugin
 * has no such field or the user picked no other name, so the task keeps its
 * own name there.
 */
export function getMappedTaskName(
  task: Pick<LocalProjectTask, "name" | "pluginProperties">,
  plugin: TaskPropertyPlugin,
): string | undefined {
  const property = resolveTaskPluginProperties(task, plugin).find(
    (item) => item.field.defaultFrom === "name",
  );
  return property && !property.isDefault && property.value !== task.name
    ? property.value
    : undefined;
}

/**
 * The next overrides of a project or task after setting one field. A blank
 * value removes the override; an empty plugin record is dropped. Returns
 * undefined when no override is left.
 */
export function setPluginProperty(
  owner: PluginPropertyOwner,
  pluginId: string,
  fieldId: string,
  value: string,
): PluginProperties | undefined {
  const text = value.trim().slice(0, PLUGIN_PROPERTY_MAX_LENGTH);
  const { [fieldId]: _previous, ...otherFields } =
    owner.pluginProperties?.[pluginId] ?? {};
  const fields = text ? { ...otherFields, [fieldId]: text } : otherFields;
  const { [pluginId]: _plugin, ...otherPlugins } =
    owner.pluginProperties ?? {};
  const next =
    Object.keys(fields).length > 0
      ? { ...otherPlugins, [pluginId]: fields }
      : otherPlugins;
  return Object.keys(next).length > 0 ? next : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Keeps the non-empty text values of stored overrides, and drops the rest. */
export function normalizePluginProperties(
  value: unknown,
): PluginProperties | undefined {
  if (!isRecord(value)) return undefined;
  const plugins: PluginProperties = {};
  for (const [pluginId, fields] of Object.entries(value)) {
    if (!isRecord(fields)) continue;
    const kept = Object.fromEntries(
      Object.entries(fields).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim() !== "",
      ),
    );
    if (Object.keys(kept).length > 0) plugins[pluginId] = kept;
  }
  return Object.keys(plugins).length > 0 ? plugins : undefined;
}

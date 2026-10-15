import type {
  ProjectPropertiesCapability,
  ProjectPropertyField,
} from "@ajour/shared";
import type { LocalProject } from "@/domain/local-state";

/*
 * Properties that plugins add to projects, such as the Workday name. Only
 * overrides are stored; an empty value means the field's default, read live
 * from the project so a rename in Ajour follows. Values of plugins that are
 * not installed are kept untouched.
 */

export const PLUGIN_PROPERTY_MAX_LENGTH = 240;

export type PluginProperties = Record<string, Record<string, string>>;

/** An active plugin that adds project properties. */
export interface ProjectPropertyPlugin {
  pluginId: string;
  capability: ProjectPropertiesCapability;
}

export interface ResolvedPluginProperty {
  field: ProjectPropertyField;
  /** The override, or the default when there is none. */
  value: string;
  defaultValue: string;
  isDefault: boolean;
}

function defaultValue(project: LocalProject, field: ProjectPropertyField) {
  if (field.defaultFrom === "fullName") return project.name;
  if (field.defaultFrom === "code") return project.code ?? "";
  return "";
}

/** Each field of the plugin with its value for this project, in manifest order. */
export function resolvePluginProperties(
  project: LocalProject,
  plugin: ProjectPropertyPlugin,
): ResolvedPluginProperty[] {
  const stored = project.pluginProperties?.[plugin.pluginId] ?? {};
  return plugin.capability.fields.map((field) => {
    const fallback = defaultValue(project, field);
    const override = stored[field.id];
    return override
      ? { field, value: override, defaultValue: fallback, isDefault: false }
      : { field, value: fallback, defaultValue: fallback, isDefault: true };
  });
}

/**
 * The project's next overrides after setting one field. A blank value
 * removes the override; an empty plugin record is dropped. Returns
 * undefined when no override is left.
 */
export function setPluginProperty(
  project: LocalProject,
  pluginId: string,
  fieldId: string,
  value: string,
): PluginProperties | undefined {
  const text = value.trim().slice(0, PLUGIN_PROPERTY_MAX_LENGTH);
  const { [fieldId]: _previous, ...otherFields } =
    project.pluginProperties?.[pluginId] ?? {};
  const fields = text ? { ...otherFields, [fieldId]: text } : otherFields;
  const { [pluginId]: _plugin, ...otherPlugins } =
    project.pluginProperties ?? {};
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

import {
  pluginHasProjectProperties,
  pluginHasTaskProperties,
} from "@ajour/shared";
import {
  NO_PROPERTY_PLUGINS,
  type ProjectPropertyPlugin,
  type PropertyPlugins,
  type TaskPropertyPlugin,
} from "@/domain/projects/plugin-properties";
import { getPluginsOverview, isPluginApiMissing } from "@/lib/app-api";

/**
 * The active plugins that add project or task properties, from one plugins
 * overview. Empty without the local API, as in the web build.
 */
export async function listPropertyPlugins(): Promise<PropertyPlugins> {
  try {
    const overview = await getPluginsOverview();
    if (overview.pluginsEnabled === false) return NO_PROPERTY_PLUGINS;
    const active = overview.connectionGroups
      .filter((group) => group.enabled && !group.plugin.unavailableReason)
      .map((group) => group.plugin);
    return {
      projects: active.flatMap((plugin): ProjectPropertyPlugin[] =>
        pluginHasProjectProperties(plugin)
          ? [
              {
                pluginId: plugin.id,
                capability: plugin.capabilities.projectProperties!,
              },
            ]
          : [],
      ),
      tasks: active.flatMap((plugin): TaskPropertyPlugin[] =>
        pluginHasTaskProperties(plugin)
          ? [
              {
                pluginId: plugin.id,
                capability: plugin.capabilities.taskProperties!,
              },
            ]
          : [],
      ),
    };
  } catch (error) {
    if (isPluginApiMissing(error)) return NO_PROPERTY_PLUGINS;
    throw error;
  }
}

/** The active plugins that add project properties. See listPropertyPlugins. */
export async function listProjectPropertyPlugins(): Promise<
  ProjectPropertyPlugin[]
> {
  return (await listPropertyPlugins()).projects;
}

/** The active plugins that add task properties. See listPropertyPlugins. */
export async function listTaskPropertyPlugins(): Promise<TaskPropertyPlugin[]> {
  return (await listPropertyPlugins()).tasks;
}

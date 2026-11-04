import {
  pluginHasProjectProperties,
  pluginHasTaskProperties,
  type PluginsOverview,
} from "@ajour/shared";
import {
  NO_PROPERTY_PLUGINS,
  type ProjectPropertyPlugin,
  type PropertyPlugins,
  type TaskPropertyPlugin,
} from "@/domain/projects/plugin-properties";
import {
  getCachedPluginsOverview,
  getPluginsOverview,
  isPluginApiMissing,
} from "@/lib/app-api";

/** The active plugins of one overview that add project or task properties. */
function toPropertyPlugins(overview: PluginsOverview): PropertyPlugins {
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
}

/**
 * The active plugins that add project or task properties, from one plugins
 * overview. Empty without the local API, as in the web build.
 */
export async function listPropertyPlugins(): Promise<PropertyPlugins> {
  try {
    return toPropertyPlugins(await getPluginsOverview());
  } catch (error) {
    if (isPluginApiMissing(error)) return NO_PROPERTY_PLUGINS;
    throw error;
  }
}

/**
 * The property plugins of the last overview this window holds, kept current
 * as its plugin changes answer with a new one. Undefined before the first.
 */
export function getCachedPropertyPlugins(): PropertyPlugins | undefined {
  const overview = getCachedPluginsOverview();
  return overview ? toPropertyPlugins(overview) : undefined;
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

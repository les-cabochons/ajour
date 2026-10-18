import { pluginHasProjectProperties } from "@ajour/shared";
import type { ProjectPropertyPlugin } from "@/domain/projects/plugin-properties";
import { getPluginsOverview, isPluginApiMissing } from "@/lib/app-api";

/**
 * The active plugins that add project properties, from the plugins
 * overview. Empty without the local API, as in the web build.
 */
export async function listProjectPropertyPlugins(): Promise<
  ProjectPropertyPlugin[]
> {
  try {
    const overview = await getPluginsOverview();
    if (overview.pluginsEnabled === false) return [];
    return overview.connectionGroups.flatMap((group) =>
      group.enabled &&
      !group.plugin.unavailableReason &&
      pluginHasProjectProperties(group.plugin)
        ? [
            {
              pluginId: group.plugin.id,
              capability: group.plugin.capabilities.projectProperties!,
            },
          ]
        : [],
    );
  } catch (error) {
    if (isPluginApiMissing(error)) return [];
    throw error;
  }
}

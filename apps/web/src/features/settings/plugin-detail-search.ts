/**
 * The secret the Vault sends the user to replace: a connection's field, or,
 * with no connection, a setting of the plugin's agent tasks.
 */
export type PluginReplaceTarget = { connectionId?: string; fieldId: string };

/** The search of a plugin's page: the secret to replace, if the Vault sent one. */
export interface PluginDetailSearch {
  connection?: string;
  field?: string;
}

export function parsePluginDetailSearch(
  search: Record<string, unknown>,
): PluginDetailSearch {
  return {
    ...(typeof search.connection === "string" && search.connection
      ? { connection: search.connection }
      : {}),
    ...(typeof search.field === "string" && search.field
      ? { field: search.field }
      : {}),
  };
}

/** The secret a plugin page's search names, if it names one. */
export function replaceTargetOf(
  search: PluginDetailSearch,
): PluginReplaceTarget | undefined {
  return search.field
    ? {
        ...(search.connection ? { connectionId: search.connection } : {}),
        fieldId: search.field,
      }
    : undefined;
}

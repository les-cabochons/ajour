import { AJOUR_CONNECTION_FIELD_IDS } from "../../../packages/shared/plugins.ts";

/**
 * The connection fields Ajour owns. Ajour keeps them out of the config it
 * stores for the plugin, and passes label, tenantLabel and the auto sync
 * settings beside that config on each operation. None of them is secret;
 * `connection-credentials.ts` owns the ones that are.
 */
export const RESERVED_CONNECTION_FIELD_IDS: ReadonlySet<string> = new Set([
  "label",
  "tenantLabel",
  "autoSync",
  "autoSyncIntervalMinutes",
  "pullRequestAutoSync",
  ...AJOUR_CONNECTION_FIELD_IDS,
]);

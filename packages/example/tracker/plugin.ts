// The example tracker: a plugin API 4 backlog plugin that describes its item
// types from memory, without touching the network, so Ajour's tests have a
// plugin that answers `describeItemTypes`. It syncs no items: the tests put
// the synced items in Ajour's local state themselves. Erasable TypeScript
// only, with explicit .ts imports: Ajour strips the types as it loads the
// file.
import type {} from "../../plugin-sdk/globals.ts";
import type {
  PluginConnection,
  ValidationResult,
} from "../../plugin-sdk/index.ts";

export { describeItemTypes } from "./item-types.ts";

export async function validateConnection(
  connection: PluginConnection,
): Promise<ValidationResult> {
  return { normalizedConfig: connection.config, connectionSummary: {} };
}

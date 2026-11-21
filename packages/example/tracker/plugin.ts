// The example tracker: a plugin API 4 backlog plugin that describes its item
// types from memory, without touching the network, so Ajour's tests have a
// plugin that answers `describeItemTypes`. It syncs no items: the tests put
// the synced items in Ajour's local state themselves. Erasable TypeScript
// only, with explicit .ts imports: Ajour strips the types as it loads the
// file.
import type {} from "../../plugin-sdk/globals.ts";
import type {
  DescribeItemTypesRequest,
  DescribeItemTypesResult,
  PluginConnection,
  ValidationResult,
} from "../../plugin-sdk/index.ts";

/** A 16px square icon in one color, as a tracker draws its types. */
function icon(color: string, shape: string) {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='${color}' d='${shape}'/></svg>`;
}

const SQUARE = "M2 2h12v12H2z";
const DIAMOND = "M8 1l7 7-7 7-7-7z";
const TRIANGLE = "M8 2l7 12H1z";

const effort = { name: "Effort", id: "Scheduling.Effort" };
const originalEstimate = {
  name: "Original Estimate",
  id: "Scheduling.OriginalEstimate",
};
const remainingWork = {
  name: "Remaining Work",
  id: "Scheduling.RemainingWork",
};
const completedWork = {
  name: "Completed Work",
  id: "Scheduling.CompletedWork",
};

/**
 * The tracker's types. A Task keeps its size in Original Estimate and
 * proposes it; a Spike has no estimate field and proposes none; a Bug has
 * no icon; an Epic is a type no synced item has, for Add a type.
 */
const ITEM_TYPES: DescribeItemTypesResult["types"] = [
  {
    name: "Story",
    iconSvg: icon("#2f74c0", SQUARE),
    fields: [effort, remainingWork],
  },
  {
    name: "Task",
    iconSvg: icon("#d4a82b", SQUARE),
    fields: [originalEstimate, remainingWork, completedWork],
    suggestions: { originalEstimateFieldName: ["Original Estimate"] },
  },
  { name: "Bug", fields: [effort, remainingWork] },
  {
    name: "Spike",
    iconSvg: icon("#8a5cc7", TRIANGLE),
    fields: [remainingWork],
  },
  { name: "Epic", iconSvg: icon("#e0702b", DIAMOND), fields: [effort] },
];

export async function validateConnection(
  connection: PluginConnection,
): Promise<ValidationResult> {
  return { normalizedConfig: connection.config, connectionSummary: {} };
}

/** Every type the tracker knows, whichever the request names. */
export async function describeItemTypes(
  _connection: PluginConnection,
  _request: DescribeItemTypesRequest,
): Promise<DescribeItemTypesResult> {
  return { types: ITEM_TYPES };
}

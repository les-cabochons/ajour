import { codeHostOperations } from "./code-host.ts";
import type { PluginConnectionAccessChoice } from "./plugin-api-4.ts";
import { connectionAccessOn } from "./plugin-request-rules.ts";
import type {
  BacklogEstimateFieldKey,
  BacklogSyncRequestWorkItem,
  BacklogSyncWorkItem,
  BacklogSyncWorkItemUpdate,
} from "./plugins.ts";

/*
 * Connection access (#395, spec #381): what each connection of a plugin may
 * do, chosen by the user. Reading the backlog is always on; editing work
 * items, pull requests and organisation-wide people search are separate
 * choices that start off. The API refuses an operation whose choice is off
 * before the plugin runs, the broker refuses an API 4 plugin's requests to
 * an endpoint whose choice is off, and the web holds the edits a refusal
 * stops.
 */

export { connectionAccessOn };

/**
 * The plugin operation that stands for uploading estimates. Estimates go
 * with a sync, not through an operation of their own, so a choice lists
 * this name to gate them.
 */
export const ESTIMATE_PUSH_OPERATION = "pushEstimates";

export type ConnectionAccessChoice = Pick<
  PluginConnectionAccessChoice,
  "id" | "label" | "description" | "tokenScope" | "always" | "operations"
>;

/** The choice that lets a connection change work items in its source. */
export const EDIT_WORK_ITEMS_ACCESS = "editWorkItems";

/**
 * The choices of the Azure DevOps plugin while it runs on plugin API 3,
 * whose manifest can't declare them. Its API 4 manifest declares the same.
 */
const AZURE_DEVOPS_API_3_ACCESS: readonly ConnectionAccessChoice[] = [
  {
    id: "readBacklog",
    label: "Read the backlog",
    description: "Work items, queries, comments and descriptions.",
    tokenScope: "Work Items (Read)",
    always: true,
    operations: [],
  },
  {
    id: EDIT_WORK_ITEMS_ACCESS,
    label: "Edit work items",
    description:
      "Send estimates, settled and moved work, descriptions and comments.",
    tokenScope: "Work Items (Read & write)",
    always: false,
    operations: [
      "writeSettle",
      "writeDescription",
      "postItemComment",
      "editItemComment",
      "deleteItemComment",
      "setItemCommentReaction",
      ESTIMATE_PUSH_OPERATION,
    ],
  },
  {
    id: "pullRequests",
    label: "Pull requests",
    description:
      "Read the pull requests you're involved in, and your teams' review requests.",
    tokenScope: "Code (Read), and Project and Team (Read) for teams",
    always: false,
    operations: Object.keys(codeHostOperations),
  },
  {
    id: "peopleSearch",
    label: "Search people across the organisation",
    description:
      "Suggest anyone in the organisation for @mentions, not only the people on your items.",
    tokenScope: "Identity (Read)",
    always: false,
    operations: ["searchItemPeople"],
  },
];

/**
 * The access choices of plugin API 3 plugins, by plugin id. Only Azure
 * DevOps has them: Jira and GitHub keep running as they do until their
 * API 4 manifests declare choices.
 */
const API_3_CONNECTION_ACCESS: Readonly<
  Record<string, readonly ConnectionAccessChoice[]>
> = { azure_devops: AZURE_DEVOPS_API_3_ACCESS };

/**
 * The access choices each connection of the plugin makes: those its API 4
 * manifest declares, or Ajour's own for an API 3 plugin that has them. A
 * plugin without choices does what its capabilities allow.
 */
export function connectionAccessChoicesOf(manifest: {
  id: string;
  apiVersion: number;
  connectionAccess?: readonly ConnectionAccessChoice[];
}): readonly ConnectionAccessChoice[] {
  if (manifest.apiVersion >= 4) return manifest.connectionAccess ?? [];
  return API_3_CONNECTION_ACCESS[manifest.id] ?? [];
}

/** The choice that unlocks the operation, or undefined when none gates it. */
export function accessChoiceOfOperation(
  choices: readonly ConnectionAccessChoice[],
  operation: string,
) {
  return choices.find((choice) => choice.operations.includes(operation));
}

/**
 * The choice the operation needs and the connection has off, or undefined
 * when the operation may run. `turnedOn` is what the connection saved.
 */
export function accessRefusalOf(
  choices: readonly ConnectionAccessChoice[],
  turnedOn: readonly string[] | undefined,
  operation: string,
): ConnectionAccessChoice | undefined {
  const choice = accessChoiceOfOperation(choices, operation);
  if (!choice) return undefined;
  return connectionAccessOn(choices, turnedOn).includes(choice.id)
    ? undefined
    : choice;
}

/** Whether the connection's access lets the operation run. */
export function connectionAllowsOperation(
  choices: readonly ConnectionAccessChoice[],
  turnedOn: readonly string[] | undefined,
  operation: string,
) {
  return accessRefusalOf(choices, turnedOn, operation) === undefined;
}

/**
 * Whether a connection as the overview lists it may run the operation: its
 * plugin's choices, from the overview group, against the connection's.
 */
export function connectionAccessAllows(
  group: { connectionAccess?: readonly ConnectionAccessChoice[] },
  connection: { access?: readonly string[] },
  operation: string,
) {
  return connectionAllowsOperation(
    group.connectionAccess ?? [],
    connection.access,
    operation,
  );
}

/**
 * What a save stores of the choices a user turned on: only those the plugin
 * declares and can turn off, once each, in the plugin's order.
 */
export function accessToStore(
  choices: readonly ConnectionAccessChoice[],
  requested: readonly string[],
): string[] {
  const wanted = new Set(requested);
  return choices
    .filter((choice) => !choice.always && wanted.has(choice.id))
    .map((choice) => choice.id);
}

/**
 * The choices a connection lost: on before, off now. Their operations
 * still running are cancelled.
 */
export function accessTurnedOff(
  choices: readonly ConnectionAccessChoice[],
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
): ConnectionAccessChoice[] {
  const was = new Set(connectionAccessOn(choices, before));
  const now = new Set(connectionAccessOn(choices, after));
  return choices.filter((choice) => was.has(choice.id) && !now.has(choice.id));
}

const ESTIMATE_FIELDS: readonly BacklogEstimateFieldKey[] = [
  "originalEstimateHours",
  "remainingEstimateHours",
  "completedEstimateHours",
];

/**
 * The estimate fields a sync would upload: the local value moved away from
 * the value both sides last agreed on, or the user chose to keep theirs in
 * a conflict.
 */
export function estimateFieldsToPush(
  workItem: Partial<Record<BacklogEstimateFieldKey, number>> & {
    estimateSync?: Partial<
      Record<
        BacklogEstimateFieldKey,
        { baselineValue?: number; resolution?: "keep_local" } | undefined
      >
    >;
  },
): BacklogEstimateFieldKey[] {
  return ESTIMATE_FIELDS.filter((field) => {
    const state = workItem.estimateSync?.[field];
    return (
      state?.resolution === "keep_local" ||
      workItem[field] !== state?.baselineValue
    );
  });
}

/** Estimate fields a sync kept from uploading, by work item. */
export interface HeldEstimates {
  localWorkItemId: string;
  fields: BacklogEstimateFieldKey[];
}

/**
 * The work items as a plugin may see them in a sync that must not upload
 * estimates: each field that would upload shows the value both sides agreed
 * on, without Keep mine, so the plugin has nothing to send. All of them when
 * `holdAll`, as on a connection that can't edit work items; otherwise only
 * those the user hasn't approved yet (`held`). The fields it held come back
 * too, so their answers can be dropped: the local value stays as it is, for
 * the user to review.
 */
export function holdEstimatePushes(
  workItems: readonly BacklogSyncRequestWorkItem[],
  holdAll: boolean,
): { workItems: BacklogSyncWorkItem[]; held: HeldEstimates[] } {
  const held: HeldEstimates[] = [];
  const masked = workItems.map((workItem) => {
    const fields = estimateFieldsToPush(workItem).filter(
      (field) => holdAll || workItem.estimateSync?.[field]?.held === true,
    );
    const withoutFlags = stripHeldFlags(workItem);
    if (fields.length === 0) return withoutFlags;
    held.push({ localWorkItemId: workItem.localWorkItemId, fields });
    const next: BacklogSyncWorkItem = {
      ...withoutFlags,
      estimateSync: { ...withoutFlags.estimateSync },
    };
    for (const field of fields) {
      const state = next.estimateSync?.[field];
      next[field] = state?.baselineValue;
      if (state) {
        const { resolution: _resolution, ...rest } = state;
        next.estimateSync![field] = rest;
      }
    }
    return next;
  });
  return { workItems: masked, held };
}

/** The work item without Ajour's `held` marks, which plugins never see. */
function stripHeldFlags(
  workItem: BacklogSyncRequestWorkItem,
): BacklogSyncWorkItem {
  if (!workItem.estimateSync) return workItem as BacklogSyncWorkItem;
  const estimateSync: BacklogSyncWorkItem["estimateSync"] = {};
  for (const field of ESTIMATE_FIELDS) {
    const state = workItem.estimateSync[field];
    if (!state) continue;
    const { held: _held, ...rest } = state;
    estimateSync[field] = rest;
  }
  return { ...workItem, estimateSync };
}

/** A sync's estimate answers without those of the fields it held. */
export function withoutHeldEstimateUpdates(
  updates: readonly BacklogSyncWorkItemUpdate[],
  held: readonly HeldEstimates[],
): BacklogSyncWorkItemUpdate[] {
  if (held.length === 0) return [...updates];
  const heldFields = new Map(
    held.map((entry) => [entry.localWorkItemId, new Set(entry.fields)]),
  );
  return updates.flatMap((update) => {
    const fields = heldFields.get(update.localWorkItemId);
    if (!fields) return [update];
    const kept = Object.fromEntries(
      Object.entries(update.fields).filter(
        ([field]) => !fields.has(field as BacklogEstimateFieldKey),
      ),
    ) as BacklogSyncWorkItemUpdate["fields"];
    return Object.keys(kept).length > 0 ? [{ ...update, fields: kept }] : [];
  });
}

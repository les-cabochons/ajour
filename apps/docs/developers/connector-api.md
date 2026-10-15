# Connector API

A connector syncs backlog items and their estimates between a tool and Ajour. It can also write a new state and priority back when the user settles or moves an item. This page is the reference for plugin API version 3.

## Functions

Export these as named functions from your entry point. Each can be `async`.

| Function             | Needed when                     | Called when                                                                                                                            |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `validateConnection` | Always                          | The user saves a connection.                                                                                                           |
| `syncConnection`     | `capabilities.connector`        | The user presses **Sync**, the connection's timer fires, or the user saves time on one of your items, so estimate changes get written. |
| `listSettleStates`   | `capabilities.connector.settle` | The settle dialog opens for one of your items.                                                                                         |
| `writeSettle`        | `capabilities.connector.settle` | A settle or move is due, after the Undo toast closes.                                                                                  |

```ts
export async function validateConnection(
  config: ConnectorFieldValues,
): Promise<ConnectorPluginValidationResult>;

export async function syncConnection(
  connection: ConnectorPluginConnection,
  workItems: ConnectorSyncWorkItem[],
): Promise<ConnectorPluginSyncResult>;

export async function listSettleStates(
  connection: ConnectorPluginConnection,
  request: ConnectorSettleStatesRequest,
): Promise<ConnectorSettleStatesResult>;

export async function writeSettle(
  connection: ConnectorPluginConnection,
  request: ConnectorSettleWriteRequest,
): Promise<ConnectorSettleWriteResult>;
```

To fail, throw an `Error`. Its message reaches the user as it is. See [Errors](#errors).

## validateConnection

Ajour calls it with the form's values, without the [reserved fields](/developers/manifest#reserved-fields). Saved secrets the user did not retype are filled in. Check the credentials against the tool, then return:

- `normalizedConfig`: the values to store. Ajour stores exactly this, so a field you leave out is lost. Trim strings and fix URLs here.
- `connectionSummary`: optional facts shown on the connection's row, such as the account name. Never secrets.

## syncConnection

Ajour calls it with the [connection](#connection) and every item it tracks for that connection, at most 1,000. Return the items to show, and the result of any estimate writes.

### What Ajour does with the items

- **Items with `stateDone: true`** are archived in Ajour if it tracks them. They never go to review.
- **Other items**, on a manual sync, wait in [Sync review](/plugins/sync-review) until the user imports them. On an automatic sync, new items go straight to the backlog. An item the user dismissed in review stays dismissed.
- **Tracked items missing from the result** of an automatic sync are archived, unless the user turned on **Keep when missing from sync**.
- **After a time entry save**, Ajour keeps only your estimate results. It imports and stages nothing.
- **Every `state`** you report is added to the source states the user maps in **Settings › Workflow**.

So:

- Return every open item in your query, every time. Ajour does the diffing.
- Report tracked items that reached a done state with `stateDone: true`, even if your query no longer returns them. `workItems` tells you which items Ajour tracks.
- Keep `sourceId` stable. Ajour keys the item on `source`, the connection and `sourceId`, and sends `sourceId` back on every later call. The official plugins use the item's URL.
- Set `source` to your plugin `id`.

### Subitems

Ajour supports one level of hierarchy. Return a child with `depth: 1`, `parentSourceId` and `parentTitle`, and its parent with `depth: 0` and `childCount`. A parent the user cannot import, there only for context, has `selectable: false`.

### Estimates

Ajour tracks three estimates, in hours: `originalEstimateHours`, `remainingEstimateHours` and `completedEstimateHours`. Sync goes both ways, field by field. For each tracked item, `workItems` has Ajour's values, and in `estimateSync` the value at the last sync, `baselineValue`.

For each field, compare Ajour's value, the tool's value and the baseline:

| Ajour changed | Tool changed | Do                                           | Return `status` |
| ------------- | ------------ | -------------------------------------------- | --------------- |
| No            | No           | Nothing.                                     | `noop`          |
| Yes           | No           | Write Ajour's value to the tool.             | `pushed`        |
| No            | Yes          | Nothing. Ajour takes the tool's value.       | `pulled`        |
| Yes           | Yes          | Nothing. Ajour asks the user in Sync review. | `conflict`      |

When the user picks **Keep local** in Sync review, the field comes with `resolution: "keep_local"`. Write Ajour's value and return `pushed`.

Return each field's result in `workItemUpdates`, with `nextBaselineValue` set to the value both sides now agree on. If a write fails, return `status: "error"` and a `message`, and leave out `nextBaselineValue`. Do not throw: the other fields and items still sync.

Skip fields the user did not map. The official plugins ship this logic in `src/estimate-sync.ts`. Copy it from [ajc-jira](https://github.com/les-cabochons/ajc-jira/blob/main/src/estimate-sync.ts).

### Priorities

Ajour has four priority levels: `urgent`, `high`, `medium` and `low`. Map your tool's priorities to these levels on sync, and back to a value of your tool on write. Leave `priority` out for an item with no priority, or a priority that maps to no level. Ajour never sees your tool's priority values.

## listSettleStates

Return the states an item can move to, for the settle dialog. Ajour passes the item's `sourceId`, so you can return only the states its workflow allows. The dialog groups states by `category`, in the order you return them. Mark done states with `done: true`. Picking one archives the item. Return at most 200 states.

## writeSettle

Ajour sends only what changed: `state`, `priority`, or both. Write them, then return the item's values in the tool after the write. Ajour stores them as the item's source values.

Ajour sends the write once the Undo toast closes, about 8 seconds after the user acts, or at the next launch if Ajour quit first. If you throw, Ajour restores the item's previous values and shows your message until the user dismisses it.

::: tip Check the target
`sourceId` comes from your own sync, but treat it as input. Before you send a credential to a URL built from it, check that it points at the connection's site. The Azure DevOps plugin refuses work item URLs outside the configured organization.
:::

## Errors

- Throw an `Error` whose message tells the user what to do, such as `Set a priority field on the Azure DevOps connection to write priority.`
- Prefix HTTP failures with the tool's name and status, such as `Jira request failed (401): …`.
- Ajour shows the message on the connection's row, in a toast, or in the settle error. It cuts messages at 4,096 characters.
- A result that does not match the types below fails the whole call with a validation message. Test your results against the limits.

## Types

Copy this block into your plugin, for example as `src/contract.ts`. It matches plugin API 3.

```ts
export type ConnectorPriorityLevel = "urgent" | "high" | "medium" | "low";
export type ConnectorFieldValue = string | number | boolean;
export type ConnectorFieldValues = Record<string, ConnectorFieldValue>;
export type ConnectorSummaryValues = Record<string, string | number | boolean>;

export interface ConnectorPluginValidationResult {
  /** Stored as the connection's config, as is. */
  normalizedConfig: ConnectorFieldValues;
  /** Shown on the connection's row. Never secret. */
  connectionSummary?: ConnectorSummaryValues;
}

export interface ConnectorPluginConnection {
  id: string;
  pluginId: string;
  label: string;
  tenantLabel: string;
  autoSync: boolean;
  autoSyncIntervalMinutes: number;
  /** Unix milliseconds. */
  connectedAt: number;
  lastSyncAt?: number;
  lastError?: string;
  /** The normalizedConfig from validateConnection. */
  config: ConnectorFieldValues;
}

export interface ConnectorImportCandidateInput {
  /** Your plugin id. */
  source: string;
  connectionId: string;
  connectionLabel: string;
  tenantLabel: string;
  /** Stable and unique within the connection. Up to 400 characters. */
  sourceId: string;
  /** The ID people see, such as "42" or "ENG-1". Up to 120 characters. */
  externalId: string;
  sourceUrl?: string;
  /** 1 to 240 characters. */
  title: string;
  /** Markdown. Up to 4,000 characters. */
  note?: string;
  projectName?: string;
  /** Such as "Bug" or "User Story". */
  workItemType: string;
  state?: string;
  /** The state's category, such as "In Progress". */
  stateCategory?: string;
  /** True in a done category. Ajour archives done items. */
  stateDone?: boolean;
  assignedTo?: string;
  priority?: ConnectorPriorityLevel;
  originalEstimateHours?: number;
  remainingEstimateHours?: number;
  completedEstimateHours?: number;
  parentSourceId?: string;
  parentTitle?: string;
  depth: 0 | 1;
  /** False for a parent included only as context. Defaults to true. */
  selectable: boolean;
  selected?: boolean;
  childCount: number;
  pushedAt?: number;
}

export interface ConnectorSyncEstimateFieldState {
  baselineValue?: number;
  remoteValue?: number;
  resolution?: "keep_local";
}

/** An item Ajour tracks for this connection, with Ajour's estimates. */
export interface ConnectorSyncWorkItem {
  localWorkItemId: string;
  sourceId: string;
  originalEstimateHours?: number;
  remainingEstimateHours?: number;
  completedEstimateHours?: number;
  estimateSync?: {
    originalEstimateHours?: ConnectorSyncEstimateFieldState;
    remainingEstimateHours?: ConnectorSyncEstimateFieldState;
    completedEstimateHours?: ConnectorSyncEstimateFieldState;
  };
}

export interface ConnectorSyncFieldUpdate {
  status: "noop" | "pushed" | "pulled" | "conflict" | "error";
  localValue?: number;
  remoteValue?: number;
  baselineValue?: number;
  nextBaselineValue?: number;
  message?: string;
}

export interface ConnectorSyncWorkItemUpdate {
  localWorkItemId: string;
  sourceId: string;
  fields: {
    originalEstimateHours?: ConnectorSyncFieldUpdate;
    remainingEstimateHours?: ConnectorSyncFieldUpdate;
    completedEstimateHours?: ConnectorSyncFieldUpdate;
  };
}

export interface ConnectorPluginSyncResult {
  items: ConnectorImportCandidateInput[];
  workItemUpdates?: ConnectorSyncWorkItemUpdate[];
}

/** A state an item can move to when it is settled. */
export interface ConnectorSettleState {
  name: string;
  category: string;
  done: boolean;
}

export interface ConnectorSettleStatesRequest {
  sourceId: string;
}

export interface ConnectorSettleStatesResult {
  states: ConnectorSettleState[];
}

/** Only the fields the settle changed. At least one is set. */
export interface ConnectorSettleWriteRequest {
  sourceId: string;
  state?: string;
  priority?: ConnectorPriorityLevel;
}

/** The item's values in the tool after the write. */
export interface ConnectorSettleWriteResult {
  state?: string;
  stateCategory?: string;
  stateDone?: boolean;
  priority?: ConnectorPriorityLevel;
}
```

Ajour's own schemas for these types are in [`packages/shared/connectors.ts`](https://github.com/les-cabochons/ajour/blob/main/packages/shared/connectors.ts). They are the source of truth.

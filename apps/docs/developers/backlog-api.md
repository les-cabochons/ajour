# Backlog API

A backlog plugin syncs backlog items and their estimates between a tool and Ajour. It can also write a new state and priority back when the user settles or moves an item, and show an item's comments. This page is the reference for plugin API version 3. The backlog capability is declared under the `connector` key until plugin API 4.

## Functions

Export these as named functions from your entry point. Each can be `async`.

| Function                 | Needed when                                 | Called when                                                                                                                            |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `validateConnection`     | Always                                      | The user saves a connection.                                                                                                           |
| `syncConnection`         | `capabilities.connector`                    | The user presses **Sync**, the connection's timer fires, or the user saves time on one of your items, so estimate changes get written. |
| `listSettleStates`       | `capabilities.connector.settle`             | The settle dialog opens for one of your items.                                                                                         |
| `writeSettle`            | `capabilities.connector.settle`             | A settle or move is due, after the Undo toast closes.                                                                                  |
| `listItemComments`       | `capabilities.connector.comments`           | The user opens one of your items, and again for each "Show earlier comments".                                                          |
| `postItemComment`        | `capabilities.connector.comments`           | The user sends a comment on one of your items, or settles one with a comment, after the settle's write.                                |
| `editItemComment`        | `capabilities.connector.comments.edit`      | The user edits one of their own comments.                                                                                              |
| `deleteItemComment`      | `capabilities.connector.comments.delete`    | The Undo toast of a deleted comment closes, or Ajour starts again after quitting during it.                                            |
| `setItemCommentReaction` | `capabilities.connector.comments.reactions` | The user adds or removes their reaction.                                                                                               |
| `searchItemPeople`       | `capabilities.connector.comments.mentions`  | The user types `@` and a few letters in a comment.                                                                                     |

```ts
export async function validateConnection(
  config: PluginFieldValues,
): Promise<PluginValidationResult>;

export async function syncConnection(
  connection: PluginConnection,
  workItems: BacklogSyncWorkItem[],
): Promise<BacklogPluginSyncResult>;

export async function listSettleStates(
  connection: PluginConnection,
  request: BacklogSettleStatesRequest,
): Promise<BacklogSettleStatesResult>;

export async function writeSettle(
  connection: PluginConnection,
  request: BacklogSettleWriteRequest,
): Promise<BacklogSettleWriteResult>;

export async function listItemComments(
  connection: PluginConnection,
  request: BacklogListItemCommentsRequest,
): Promise<BacklogListItemCommentsResult>;

export async function postItemComment(
  connection: PluginConnection,
  request: BacklogPostItemCommentRequest,
): Promise<BacklogPostItemCommentResult>;

export async function editItemComment(
  connection: PluginConnection,
  request: BacklogEditItemCommentRequest,
): Promise<BacklogPostItemCommentResult>;

export async function deleteItemComment(
  connection: PluginConnection,
  request: BacklogDeleteItemCommentRequest,
): Promise<Record<string, never>>;

export async function setItemCommentReaction(
  connection: PluginConnection,
  request: BacklogSetItemCommentReactionRequest,
): Promise<BacklogSetItemCommentReactionResult>;

export async function searchItemPeople(
  connection: PluginConnection,
  request: BacklogSearchItemPeopleRequest,
): Promise<BacklogSearchItemPeopleResult>;
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
- **Tracked items missing from the result** of an automatic sync are archived, unless the user set the item's **When missing** to **Keep**.
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

### Comments on settled items

If you provide comments, Ajour brings a settled item back when someone else comments on it. For each settled item, `workItems` has `commentsSince`, the time it was settled. Return the comments posted after it in `commentFacts`, without their text: id, author and time, at most 50 per item, and `mentionsViewer` when one mentions the user. Return the user as `viewer`, in the same id space as comment authors, as in `listItemComments`.

Ajour ignores comments by the `viewer` and those before `commentsSince`. Fetch only the newest comments of each settled item, and skip an item whose comments fail rather than fail the sync. Leave both fields out if you don't provide comments.

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

## listItemComments

Return a page of an item's comments when the user opens it. Ajour asks for the newest 5, then 20 more each time the user presses **Show earlier comments**, passing the `earlierCursor` you returned. Return the page oldest first, and set `earlierCursor` while earlier comments remain. Return `total` when your tool says how many comments the item has.

Declare the features your tool supports under `capabilities.connector.comments`:

```json
"connector": {
  "comments": {
    "reactions": ["like", "heart"],
    "mentions": true,
    "maxLength": 32767
  }
}
```

- `reactions` lists the reactions your tool supports, in Ajour's names: `like`, `dislike`, `heart`, `hooray`, `laugh`, `confused`, `rocket` and `eyes`. Return each comment's counts and whether the user reacted.
- Convert each comment to Markdown. Write a mention as `[@Display Name](mention:<id>)`, where the id is yours and stays opaque to Ajour. Ajour shows it as a chip and never follows it.
- Return the user as `viewer`, in the same id space as comment authors, so Ajour can tell which comments are theirs.
- Set `restrictedTo` to the group or role that may read a restricted comment, such as a Jira role.
- Ajour never stores comment text. It holds the newest page in memory for a few minutes, so throw rather than return a partial page. See [ADR 0008](https://github.com/les-cabochons/ajour/blob/main/docs/adr/0008-backlog-comments-are-fetched-and-written-at-once.md).

## postItemComment

Post the comment at once and return it as your tool stored it. A comment typed in the settle dialog comes after `writeSettle`, once the Undo toast closes. Ajour sends Markdown, with mentions as `[@Name](mention:<id>)`, and shows your returned comment at the end of the thread. If you throw, Ajour keeps the text in the editor and shows your message, so the user can send it again. Ajour doesn't queue comments for later (ADR 0008). Declare `maxLength` when your tool limits comment length, measured as your tool measures it, and check the converted size before you send.

## Editing, deleting and reacting

Declare `edit`, `delete` and `reactions` under `capabilities.connector.comments` for what your tool allows. Ajour offers edit and delete only on the user's own comments, those whose author is your `viewer`.

- `editItemComment` saves at once and returns the comment as your tool stored it. If you throw, the editor keeps the text and shows your message.
- `deleteItemComment` comes once the Undo toast closes, about 8 seconds after the user deletes, or at the next launch if Ajour quit first. Return `{}`. If you throw, the comment comes back and Ajour shows your message.
- `setItemCommentReaction` adds the user's reaction when `reacted` is true and removes it otherwise. Return the comment's reactions after the change. Ajour shows the change before you answer and puts it back if you throw.

## Mentions

With `mentions: true`, Ajour suggests people when the user types `@` in a comment and calls `searchItemPeople` with what they typed. Return at most `limit` people who can be mentioned on the item, with the ids your mentions use. Ajour inserts `[@Display Name](mention:<id>)` and shows it as a chip; your `postItemComment` and `editItemComment` turn it into your tool's mention, so the person is notified.

## Errors

- Throw an `Error` whose message tells the user what to do, such as `Set a priority field on the Azure DevOps connection to write priority.`
- Prefix HTTP failures with the tool's name and status, such as `Jira request failed (401): …`.
- Ajour shows the message on the connection's row, in a toast, or in the settle error. It cuts messages at 4,096 characters.
- A result that does not match the types below fails the whole call with a validation message. Test your results against the limits.

## Types

Copy this block into your plugin, for example as `src/contract.ts`. It matches plugin API 3.

```ts
export type BacklogPriorityLevel = "urgent" | "high" | "medium" | "low";
export type PluginFieldValue = string | number | boolean;
export type PluginFieldValues = Record<string, PluginFieldValue>;
export type PluginSummaryValues = Record<string, string | number | boolean>;

export interface PluginValidationResult {
  /** Stored as the connection's config, as is. */
  normalizedConfig: PluginFieldValues;
  /** Shown on the connection's row. Never secret. */
  connectionSummary?: PluginSummaryValues;
}

export interface PluginConnection {
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
  config: PluginFieldValues;
}

export interface BacklogImportCandidateInput {
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
  /** The item's description, in Markdown. Up to 4,000 characters. */
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
  priority?: BacklogPriorityLevel;
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

export interface BacklogSyncEstimateFieldState {
  baselineValue?: number;
  remoteValue?: number;
  resolution?: "keep_local";
}

/** An item Ajour tracks for this connection, with Ajour's estimates. */
export interface BacklogSyncWorkItem {
  localWorkItemId: string;
  sourceId: string;
  originalEstimateHours?: number;
  remainingEstimateHours?: number;
  completedEstimateHours?: number;
  estimateSync?: {
    originalEstimateHours?: BacklogSyncEstimateFieldState;
    remainingEstimateHours?: BacklogSyncEstimateFieldState;
    completedEstimateHours?: BacklogSyncEstimateFieldState;
  };
  /** Set on settled items: report the comments posted after it (ISO 8601). */
  commentsSince?: string;
}

export interface BacklogSyncFieldUpdate {
  status: "noop" | "pushed" | "pulled" | "conflict" | "error";
  localValue?: number;
  remoteValue?: number;
  baselineValue?: number;
  nextBaselineValue?: number;
  message?: string;
}

export interface BacklogSyncWorkItemUpdate {
  localWorkItemId: string;
  sourceId: string;
  fields: {
    originalEstimateHours?: BacklogSyncFieldUpdate;
    remainingEstimateHours?: BacklogSyncFieldUpdate;
    completedEstimateHours?: BacklogSyncFieldUpdate;
  };
}

export interface BacklogPluginSyncResult {
  items: BacklogImportCandidateInput[];
  workItemUpdates?: BacklogSyncWorkItemUpdate[];
  /** The user, in the id space of comment authors. Needed with `commentFacts`. */
  viewer?: BacklogPerson;
  /** At most 1,000 items. */
  commentFacts?: BacklogItemCommentFacts[];
}

/** A comment without its text. */
export interface BacklogCommentFact {
  id: string;
  author: BacklogPerson;
  /** ISO 8601. */
  createdAt: string;
  mentionsViewer?: boolean;
}

export interface BacklogItemCommentFacts {
  localWorkItemId: string;
  /** At most 50. */
  comments: BacklogCommentFact[];
}

/** A state an item can move to when it is settled. */
export interface BacklogSettleState {
  name: string;
  category: string;
  done: boolean;
}

export interface BacklogSettleStatesRequest {
  sourceId: string;
}

export interface BacklogSettleStatesResult {
  states: BacklogSettleState[];
}

/** Only the fields the settle changed. At least one is set. */
export interface BacklogSettleWriteRequest {
  sourceId: string;
  state?: string;
  priority?: BacklogPriorityLevel;
}

/** The item's values in the tool after the write. */
export interface BacklogSettleWriteResult {
  state?: string;
  stateCategory?: string;
  stateDone?: boolean;
  priority?: BacklogPriorityLevel;
}

export type BacklogReaction =
  | "like"
  | "dislike"
  | "heart"
  | "hooray"
  | "laugh"
  | "confused"
  | "rocket"
  | "eyes";

/** A person in the tool, in the same id space as comment authors. */
export interface BacklogPerson {
  id: string;
  displayName: string;
}

export interface BacklogListItemCommentsRequest {
  sourceId: string;
  /** 1 to 50. */
  limit: number;
  /** An `earlierCursor` you returned before. */
  cursor?: string;
}

export interface BacklogComment {
  id: string;
  author: BacklogPerson;
  /** Markdown. Mentions are `[@Name](mention:<id>)`. */
  body: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, when the comment changed after it was posted. */
  updatedAt?: string;
  reactions?: {
    reaction: BacklogReaction;
    count: number;
    viewerReacted: boolean;
  }[];
  /** The group or role that may read it, when restricted. */
  restrictedTo?: string;
}

export interface BacklogPostItemCommentRequest {
  sourceId: string;
  /** Markdown. Mentions are `[@Name](mention:<id>)`. */
  body: string;
}

export interface BacklogPostItemCommentResult {
  /** The comment as your tool stored it. */
  comment: BacklogComment;
}

export interface BacklogEditItemCommentRequest {
  sourceId: string;
  commentId: string;
  /** Markdown. Mentions are `[@Name](mention:<id>)`. */
  body: string;
}

export interface BacklogDeleteItemCommentRequest {
  sourceId: string;
  commentId: string;
}

export interface BacklogSetItemCommentReactionRequest {
  sourceId: string;
  commentId: string;
  reaction: BacklogReaction;
  /** True to add the user's reaction, false to remove it. */
  reacted: boolean;
}

export interface BacklogSetItemCommentReactionResult {
  reactions: NonNullable<BacklogComment["reactions"]>;
}

export interface BacklogSearchItemPeopleRequest {
  sourceId: string;
  /** What the user typed after `@`. */
  query: string;
  /** 1 to 20. */
  limit: number;
}

export interface BacklogSearchItemPeopleResult {
  /** In the id space of `mention:<id>`. */
  people: BacklogPerson[];
}

export interface BacklogListItemCommentsResult {
  viewer: BacklogPerson;
  /** Oldest first, at most 50. */
  comments: BacklogComment[];
  total?: number;
  /** Set while earlier comments remain. */
  earlierCursor?: string;
}
```

Ajour's own schemas for these types are in [`packages/shared/plugins.ts`](https://github.com/les-cabochons/ajour/blob/main/packages/shared/plugins.ts) and, for comments, [`packages/shared/backlog-comments.ts`](https://github.com/les-cabochons/ajour/blob/main/packages/shared/backlog-comments.ts). They are the source of truth.

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
| `readDescription`        | `capabilities.connector.description`        | The user opens the description editor, and before each save of the description.                                                        |
| `writeDescription`       | `capabilities.connector.description.write`  | The user saves an edited description, or picks Keep mine in Sync review.                                                               |
| `listItemComments`       | `capabilities.connector.comments`           | The user opens one of your items, and again for each "Show earlier comments".                                                          |
| `postItemComment`        | `capabilities.connector.comments`           | The user sends a comment on one of your items. A settle's or an agent's comment comes once its Undo toast closes.                      |
| `editItemComment`        | `capabilities.connector.comments.edit`      | The user edits one of their own comments.                                                                                              |
| `deleteItemComment`      | `capabilities.connector.comments.delete`    | The Undo toast of a deleted comment closes, or Ajour starts again after quitting during it.                                            |
| `setItemCommentReaction` | `capabilities.connector.comments.reactions` | The user adds or removes their reaction.                                                                                               |
| `searchItemPeople`       | `capabilities.connector.comments.mentions`  | The user types `@` in a comment, and each name after it.                                                                               |

```ts
export async function validateConnection(
  config: PluginFieldValues,
  context: PluginValidationContext,
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

export async function readDescription(
  connection: PluginConnection,
  request: BacklogReadDescriptionRequest,
): Promise<BacklogReadDescriptionResult>;

export async function writeDescription(
  connection: PluginConnection,
  request: BacklogWriteDescriptionRequest,
): Promise<BacklogWriteDescriptionResult>;

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

Ajour calls it with the form's values, without the [reserved fields](/developers/manifest#reserved-fields). Saved secrets the user did not retype are filled in. The second argument, `context`, lists in `capabilities` the capabilities the user has on, such as `["connector"]`, so you check only the access they need. Check the credentials against the tool, then return:

- `normalizedConfig`: the values to store. Ajour stores exactly this, so a field you leave out is lost. Trim strings and fix URLs here.
- `connectionSummary`: optional facts shown on the connection's row, such as the account name. Never secrets.

## syncConnection

Ajour calls it with the [connection](#types) and every item it tracks for that connection, at most 1,000. Return the items to show, and the result of any estimate writes.

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

### Descriptions

Declare `connector.description` and return the item's full description in `description` on every sync:

- `text`: the description converted to Markdown, up to 64,000 characters. Write a mention as `[@Display Name](mention:<id>)`, as in comments. Keep each image as a Markdown image whose address holds everything you need to restore it.
- `lost`: short names of what the conversion dropped, such as `"text colour"` or `"underline"`. Leave it out when nothing was lost. Images never count as lost.
- `cut`: `true` when the source's text was longer and you cut it to 64,000 characters.

Ajour keeps the text both sides last agreed on. On each sync, a description only the source changed follows the source, one only the user changed keeps the user's edit, and one changed on both sides becomes a conflict for the user to resolve. A newly imported item takes your text. Without `connector.description.write`, the description is read-only in Ajour, with a link to edit it in your tool. A `cut` description is always read-only, so a shortened copy is never written back, and so is one with `lost`, so an edit in Ajour never erases formatting your tool keeps.

With `connector.description.write`, the user edits the description in Ajour, and Ajour writes it back through [writeDescription](#writedescription). Set `maxLength` to your tool's limit, measured as your tool measures it; the editor then stops at the smaller of it and 64,000 characters.

A plugin that returns only `note`, up to 4,000 characters, keeps the older behaviour: Ajour takes it when the item first arrives, later syncs leave the description in Ajour as it is, and Ajour never writes it back. When `description` is present, `note` is ignored.

A description can start with a [frontmatter](/backlog/items#frontmatter) block, YAML between two `---` lines, whose `timelog` sets the item's project and task in Ajour. When you convert your tool's text, keep such a block at the very start, as written.

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

## readDescription

Return the item's description as your tool holds it now, converted as in a sync: `text`, `lost` and `cut`. Ajour calls it in the background when the user starts editing, to warn when the description changed since the last sync, and before every save, to merge with what changed.

## writeDescription

Ajour sends the Markdown to write in `text`, and in `expected` the `text` your `readDescription` returned just before. Convert the item's current description as you do in `readDescription`:

- If it is still `expected`, write `text`, converted to your tool's format, and return `outcome: "written"` with the description as your tool now holds it, converted back.
- If it is not, someone changed it in between. Write nothing, and return `outcome: "conflict"` with the description as it is. Ajour records a conflict for the user to resolve.
- If it is, but its conversion now has `lost` entries, write only when each of them is in the request's `allowedLoss`. Ajour sends the names the user saw, on a connection with **Allow lossy conversion** on, before choosing **Save anyway**. Otherwise throw a message naming the loss. A `cut` description is never written.

Ajour has already merged the user's edit with what changed in your tool, line by line, so write `text` as it is. Keep images and mentions as the sync sent them. If the converted text is too long for your tool, or the write fails, throw: Ajour keeps the user's text and shows your message with Retry.

Ajour writes at once, with no Undo toast, and one write at a time per item.

## listItemComments

Return a page of an item's comments when the user opens it. Ajour asks for the newest 5, then 20 more each time the user presses **Show earlier comments**, passing the `earlierCursor` you returned. An agent the user allowed to read comments asks for up to 50 at a time. Return the page oldest first, and set `earlierCursor` while earlier comments remain. Return `total` when your tool says how many comments the item has.

Declare the features your tool supports under `capabilities.connector.comments`. The key alone means you list and post comments:

```json
"connector": {
  "comments": {
    "edit": true,
    "delete": true,
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
- Ajour never stores the comment text it fetches. It holds the newest page in memory for five minutes, so throw rather than return a partial page. See [ADR 0008](https://github.com/les-cabochons/ajour/blob/main/docs/adr/0008-backlog-comments-are-fetched-and-written-at-once.md).
- Ajour adds its own **Agent access** field to your connection form: None, the default, Read, or Read and write. It covers comments, and descriptions when you declare `description.write`. The value never reaches your plugin. Calls for an agent arrive like the user's.

## postItemComment

Post the comment at once and return it as your tool stored it. A comment typed in the settle dialog, or posted by an agent, comes once its Undo toast closes, and after `writeSettle` when the settle writes. Ajour sends Markdown, with mentions as `[@Name](mention:<id>)`, and shows your returned comment at the end of the thread. If you throw, Ajour keeps the text as a draft and shows your message, so the user can send it again. Ajour doesn't retry a failed post. A settle or agent comment waits on the device for its Undo window, so after a quit it can reach you at the next launch. Declare `maxLength`, 1 to 10,000,000, when your tool limits comment length, measured as your tool measures it, and check the converted size before you send.

## Editing, deleting and reacting

Declare `edit`, `delete` and `reactions` under `capabilities.connector.comments` for what your tool allows. Ajour offers edit and delete only on the user's own comments, those whose author is your `viewer`.

- `editItemComment` saves at once and returns the comment as your tool stored it. If you throw, the editor keeps the text and shows your message.
- `deleteItemComment` comes once the Undo toast closes, about 8 seconds after the user deletes, or at the next launch if Ajour quit first. Return `{}`. If you throw, the comment comes back and Ajour shows your message.
- `setItemCommentReaction` adds the user's reaction when `reacted` is true and removes it otherwise. Return the comment's reactions after the change. Ajour shows the change before you answer and puts it back if you throw.

## Mentions

With `mentions: true`, Ajour suggests people when the user types `@` in a comment and calls `searchItemPeople` with what they typed. A bare `@` calls it with an empty `query`: return the people most likely to be mentioned, such as the item's assignee and commenters, or none. A `query` can hold up to three words, such as `Ana Silva`, so match it against whole names. Return at most `limit` people who can be mentioned on the item, with the ids your mentions use, and each one's `email` when you know it, which Ajour shows under the name. Ajour inserts `[@Display Name](mention:<id>)` and shows it as a chip; your `postItemComment` and `editItemComment` turn it into your tool's mention, so the person is notified.

## Errors

- Throw an `Error` whose message tells the user what to do, such as `Set a priority field on the Azure DevOps connection to write priority.`
- Prefix HTTP failures with the tool's name and status, such as `Jira request failed (401): …`.
- Ajour shows the message on the connection's row, in a toast, or in the settle error. It cuts messages at 4,096 characters, and at 1,000 on the connection's row, so put the useful part first.
- A result that does not match the types below fails the whole call with a validation message. Test your results against the limits.

## Types

Copy this block into your plugin, for example as `src/contract.ts`. It matches plugin API 3.

```ts
export type BacklogPriorityLevel = "urgent" | "high" | "medium" | "low";
export type PluginFieldValue = string | number | boolean;
export type PluginFieldValues = Record<string, PluginFieldValue>;
export type PluginSummaryValues = Record<string, string | number | boolean>;

/** The capabilities a user can turn on and off. "connector" is the backlog. */
export type SwitchableCapability =
  "connector" | "codeHost" | "calendar" | "team";

export interface PluginValidationContext {
  /** The capabilities the user has on. */
  capabilities: SwitchableCapability[];
}

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
  /** An absolute URL. */
  sourceUrl?: string;
  /** 1 to 240 characters. */
  title: string;
  /** The item's description, in Markdown. Up to 4,000 characters. Ignored with `description`. */
  note?: string;
  /** The full description, synced both ways. See Descriptions. */
  description?: {
    /** Markdown. Up to 64,000 characters. */
    text: string;
    /** What the conversion to Markdown dropped. Up to 20 names. */
    lost?: string[];
    /** The source's text was longer, and you cut it. */
    cut?: boolean;
  };
  /** Up to 120 characters. */
  projectName?: string;
  /** Such as "Bug" or "User Story". Up to 120 characters. */
  workItemType: string;
  /** Up to 120 characters. */
  state?: string;
  /** The state's category, such as "In Progress". */
  stateCategory?: string;
  /** True in a done category. Ajour archives done items. */
  stateDone?: boolean;
  /** Up to 240 characters. */
  assignedTo?: string;
  priority?: BacklogPriorityLevel;
  /** Hours, 0 or more. */
  originalEstimateHours?: number;
  remainingEstimateHours?: number;
  completedEstimateHours?: number;
  parentSourceId?: string;
  parentTitle?: string;
  depth: 0 | 1;
  /** False for a parent included only as context. Defaults to true. */
  selectable?: boolean;
  /** Selected for import in Sync review. Defaults to true. */
  selected?: boolean;
  /** Defaults to 0. */
  childCount?: number;
  /** When the item reached Ajour, in Unix milliseconds. Defaults to now. */
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

export interface BacklogReadDescriptionRequest {
  sourceId: string;
}

export interface BacklogReadDescriptionResult {
  /** As in a sync's `description`. */
  description: { text: string; lost?: string[]; cut?: boolean };
}

export interface BacklogWriteDescriptionRequest {
  sourceId: string;
  /** The Markdown to write. Up to 64,000 characters. */
  text: string;
  /** The text `readDescription` returned before the write. */
  expected: string;
  /** The `lost` names the user saw and saved anyway. */
  allowedLoss?: string[];
}

export interface BacklogWriteDescriptionResult {
  /** `conflict` when the tool no longer held `expected`, and nothing was written. */
  outcome: "written" | "conflict";
  /** The description as the tool holds it after the write, or as it is. */
  description: { text: string; lost?: string[]; cut?: boolean };
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
  /** Shown under the name in the @ suggestions. */
  email?: string;
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
  /** What the user typed after `@`; empty after a bare `@`. */
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

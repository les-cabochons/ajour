# Connector Estimate Sync Design

- Date: 2026-04-21
- Status: Draft for review
- Scope: Backlog estimate fields, connector field mapping, bidirectional sync, conflict review

## Summary

Add three editable estimate fields to backlog tasks:

- `originalEstimateHours`
- `remainingEstimateHours`
- `completedEstimateHours`

These fields are editable for all tasks, including imported tasks. Each connector connection can map these fields to source-system fields the same way priority is mapped today. Sync becomes bidirectional for mapped fields: local changes can be pushed back to the origin, remote changes can be imported into the local task, and conflicts are tracked per field.

Conflicts do not block the full task or full sync run. Non-conflicting fields on the same task still sync. Conflicts are surfaced as warnings on the task and resolved in a renamed `Sync Review` area in connector settings.

This behavior applies to both Azure DevOps and Jira. The sync policy is shared; only connector-specific field discovery and read/write mechanics differ.

## Goals

- Let users edit `original`, `remaining`, and `completed` directly on backlog tasks.
- Let connectors map those fields per connection.
- Push local estimate changes back to Azure DevOps and Jira during sync.
- Import remote estimate changes into local tasks during sync.
- Detect conflicts when both local and remote changed from the last synced baseline.
- Let non-conflicting fields continue syncing even when another field on the same task is conflicted.
- Move conflict resolution into connector review and rename that area from `Import Review` to `Sync Review`.

## Non-Goals

- Auto-deriving `original` from `remaining + completed`.
- Making estimate behavior connector-specific at the policy level.
- Blocking all sync when a single field conflicts.
- Adding background conflict notifications outside the existing backlog and settings surfaces.

## Product Decisions

### Estimate field behavior

Each backlog task stores `original`, `remaining`, and `completed` as independent values.

Manual edits:

- `original` stays independent
- `remaining` stays independent
- `completed` stays independent

Only time logging mutates estimate fields automatically:

- adding time through the timer increments `completed`
- adding time through the backlog `Hours` field increments `completed`
- both flows decrement `remaining`
- `remaining` is clamped to `0`
- `original` is never auto-adjusted

### Conflict policy

Conflicts are detected per field, not per task. If both local and remote values changed relative to the last synced baseline:

- keep local and remote values unchanged
- mark that field as conflicted
- surface a warning on the task
- surface the resolution controls in `Sync Review`

Other non-conflicting mapped fields on the same task continue syncing normally.

### Review workflow

The current import review surface is renamed to `Sync Review`.

`Sync Review` becomes the home for:

- unresolved field conflicts
- connector field mapping errors
- connector write errors that require user action
- any remaining staged sync decisions

Task warnings remain lightweight. Resolution happens in `Sync Review`, not inline in the backlog editor.

## Data Model

### Local work item fields

Extend `LocalWorkItem` with:

- `originalEstimateHours?: number`
- `remainingEstimateHours?: number`
- `completedEstimateHours?: number`

These values are stored for both manual and imported tasks.

### Sync baseline and conflict state

Each mapped field needs field-level sync metadata. The simplest shape is a per-field record stored on the work item, for example:

- current local value
- last imported remote value
- last successfully synced baseline
- conflict state
- last sync error state

Conceptually this can be modeled as:

```ts
type SyncFieldKey =
  | "priority"
  | "originalEstimateHours"
  | "remainingEstimateHours"
  | "completedEstimateHours";

type WorkItemSyncFieldState = {
  baselineValue?: number | string;
  remoteValue?: number | string;
  conflict?: {
    detectedAt: number;
    localValue?: number | string;
    remoteValue?: number | string;
    baselineValue?: number | string;
  };
  error?: {
    detectedAt: number;
    message: string;
  };
};
```

The exact persisted shape can be optimized for the current store, but the required behavior is:

- compare local and remote against a baseline
- track conflicts per field
- track write or mapping errors per field
- clear state per field when that field is resolved

### Connector connection mapping

Each connector connection gets optional mappings for:

- priority
- original
- remaining
- completed

For Azure DevOps and Jira, the mapping is configured per connection, not globally per plugin.

If a field is unmapped:

- it is not read from the connector for sync comparison
- it is not written back through the connector
- it is ignored during sync
- it is not treated as an error

Connections do not need to map all estimate fields. Partial mapping is valid. Sync only evaluates the subset of fields that are explicitly mapped for that connection.

## Sync Algorithm

### Shared policy

For each mapped field on each synced task:

1. Read the remote field value from the connector result.
2. Load the local value from the work item.
3. Load the last synced baseline for that field.
4. Compute:
   - `localChanged = localValue != baselineValue`
   - `remoteChanged = remoteValue != baselineValue`
5. Apply the field decision:
   - local changed only: push local to remote
   - remote changed only: import remote into local
   - neither changed: no-op
   - both changed: create conflict
6. Persist a new baseline only if that field synced cleanly.

Only mapped fields participate in this algorithm. Unmapped fields are skipped entirely.

This algorithm is shared by Azure DevOps and Jira.

### Partial sync behavior

Sync is partial by design:

- one conflicted field does not block other fields on the same task
- one failed task update does not block the full connection sync unless the connector itself is unavailable
- one invalid mapping does not prevent other valid mappings from syncing

The sync result should report:

- tasks updated locally
- fields pushed remotely
- conflicts created
- field-level errors

### Connector-specific behavior

### Azure DevOps

Azure DevOps connection settings gain field mappings for `original`, `remaining`, and `completed` alongside `priority`.

The connector must:

- validate configured field names
- resolve them to actual Azure field reference names
- read them during import
- patch them during outbound sync for non-conflicting fields only

### Jira

Jira connection settings gain the same field mappings.

The connector must:

- validate configured field names
- resolve them to Jira field identifiers
- read them during import
- update them during outbound sync for non-conflicting fields only

The sync policy must stay identical between connectors.

## UI Changes

### Backlog editor

Add three editable fields to the backlog task editor:

- `Original`
- `Remaining`
- `Completed`

These fields should be visible and editable for imported tasks and manual tasks.

The existing `Hours` input remains the quick logging surface:

- when hours are submitted, create or update the time entry as today
- increment `completedEstimateHours`
- decrement `remainingEstimateHours`
- clamp `remainingEstimateHours` to `0`

### Task warning state

If any mapped field is conflicted or has a sync error that needs review:

- show a warning badge or icon on the task row
- show the same warning in the task modal

This warning is informational. Users can still edit the task and sync can still process other clean fields.

### Settings review surface

Rename `Import Review` to `Sync Review`.

`Sync Review` should show only items requiring attention, including:

- field conflicts
- invalid mappings
- remote write errors

For each conflicted field, show:

- task reference
- connector and connection
- field name
- local value
- remote value
- baseline value

Resolution actions:

- keep local and push on next sync
- accept remote into local
- dismiss if the user reconciled manually

Resolution is field-level, not task-level.
`keep local` updates the baseline after the next successful remote write for that field.
`accept remote` updates the local field immediately and resets the baseline to that imported remote value.

## Error Handling

- Missing mappings are `not configured`, not errors.
- Unmapped fields are skipped completely and produce no sync work.
- Invalid mapped field names or unsupported remote field types create review items and connection status messages.
- Connector unavailability fails the sync run.
- Field-level remote write failures create review items but do not abort unrelated field updates.
- Baselines are updated only for fields that completed a clean import or push.

## Migration

- Existing local work items receive empty estimate values.
- Existing local work items receive no conflict state by default.
- Existing connector connections continue to work without estimate push until mappings are configured.
- Existing imported priority and status behavior remains unchanged.

## Testing

### Shared sync policy tests

- local-only field change pushes to remote
- remote-only field change imports to local
- local and remote change together creates a conflict
- a conflicted field does not prevent another clean field on the same task from syncing
- baseline updates only for cleanly synced fields

### Estimate behavior tests

- manual edit of `original` does not auto-adjust `remaining`
- manual edit of `remaining` does not auto-adjust `completed`
- timer logging increments `completed` and decrements `remaining`
- backlog `Hours` logging increments `completed` and decrements `remaining`
- `remaining` clamps at `0`

### Connector tests

Azure DevOps:

- validates configured mappings
- reads mapped estimate values
- writes only mapped non-conflicting fields
- reports partial failures

Jira:

- validates configured mappings
- reads mapped estimate values
- writes only mapped non-conflicting fields
- reports partial failures

### UI tests

- backlog task editor renders `Original`, `Remaining`, and `Completed`
- task warning appears when a conflict exists
- `Import Review` label becomes `Sync Review`
- conflict actions resolve correctly

## Implementation Notes

Recommended implementation order:

1. Extend shared connector schemas and local work item model for estimate fields and sync metadata.
2. Add estimate field editors and timer/hour mutation logic in the backlog UI and local store.
3. Add connector connection mappings for Azure DevOps and Jira.
4. Introduce shared per-field sync comparison and result reporting.
5. Extend Azure DevOps and Jira connectors to read and write mapped estimate fields.
6. Rename `Import Review` to `Sync Review` and add conflict resolution UI.
7. Add migration coverage and automated tests.

## Open Risks

- Jira custom field shapes may differ across tenants and require normalization rules.
- Existing sync APIs may need broader result payloads to represent partial success and field-level review items cleanly.
- If conflict metadata is stored directly on work items, the local store migration must remain backward-compatible and lightweight.

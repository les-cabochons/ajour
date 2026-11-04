# Settle writes an assignee in the plugin's own id space

Settling an item often hands it to someone else: QA, a reviewer, a teammate. The settle dialog now offers an Assignee field next to the state and priority, and the settle write carries the new assignee to the source tool after the Undo toast closes, as it does for the state and priority ([ADR 0001](0001-connector-writes-after-undo-window.md)). A backlog plugin opts in with a new optional `connector.assign` capability. With it, the plugin sends each synced item's assignee as a person, answers `searchAssignees` with the people the item can be assigned to, and takes one of their ids, or `null` to unassign, as the settle write's `assignee`.

The person's id belongs to the plugin, and it is the id the plugin's write takes. Ajour stores it and hands it back, and never reads it. This id space is separate from the one used for mentions, because the source tools disagree: an Azure DevOps mention names the identity id, while its assigned-to field takes the unique name. A Jira assignee is an account id, and a GitHub assignee is a login.

## Considered options

- **Reuse `searchItemPeople`, the comment editor's @ search.** Rejected. It returns mention ids, which the Azure DevOps write can't take, and it belongs to the comments capability, which Jira and GitHub don't declare. A plugin that can assign but has no comments would have had to declare comments to offer an assignee.
- **Send the assignee's display name and let the plugin look it up.** Rejected. Names aren't unique, and a lookup at write time could pick the wrong person after the Undo toast closed, with no one watching.
- **A separate assign operation, outside settle.** Not now. The user reassigns while handing the item off, which is a settle. A reassign elsewhere, such as on the item page, can reuse the same capability and search later.

## Consequences

- A synced item keeps its assignee, as a person with the plugin's id, from each sync of a plugin with `connector.assign`. An item from another plugin has none, and the dialog doesn't show the field.
- An empty `searchAssignees` query is part of reading the backlog, like a bare @. A typed one may search the organisation and needs the connection's people search choice, which lists both searches.
- One write carries a waiting state, priority and assignee. A failed write puts the previous assignee back with the rest.
- A settled item returns when a sync shows another assignee, as it does for a state or priority change.
- Wide events record whether an assignee was changed or sent, never who ([ADR 0011](0011-wide-events-hold-no-content.md)).

# Only done states change the lifecycle, and moving a card writes the source state through a per-source-project mapping

The Backlog page gets a list and a board grouped by the user's workflow states. A workflow state carries one flag, Done. Moving a backlog item into a done state archives it, and moving it out of one makes it active again. No other workflow state changes whether an item is active, settled or archived; settling stays an explicit action. For synced items, each source project maps every source state to a workflow state on the way in, and gives every workflow state a default source state, Ask, or Don't write on the way out. Moving a card writes that source state after the Undo window, as [ADR 0001](0001-connector-writes-after-undo-window.md) already requires for settle. Moves use the out mapping in Settings > Workflow. The explicit Settle rules introduced on main in #95 stay in Settings > Backlog and control Settle independently.

## Considered options

- **State categories with a Settled column (Not started, Started, Settled, Done).** Dropping into a Settled column would have settled the item. This was rejected because it ties waiting on someone to a column, would have to let manual items settle, and makes an ordinary drag change the lifecycle.
- **Local-only workflow states, no write back.** This was rejected because several source states can map to one workflow state, and a board that never reaches the source tool leaves the two out of step after every move.
- **Write back the first mapped source state only.** This was rejected because a column such as In review can stand for several source states; Ask and "Change source state" let the user pick when it matters.

## Consequences

- Every card move on a synced item can produce a delayed connector write, not only Settle.
- Write planning filters mapped states against the connector's available states for the actual item. A failed state lookup cancels the move; Don't write rules and unmapped destinations still move locally without a lookup.
- Connectors need a capability that lists all source states of a source project, so states can be mapped before any item reaches them. Plugins without it fall back to the states seen in syncs.
- Priority becomes five levels (Urgent, High, Medium, Low, No priority). Each connection maps source priority values to levels with ranges, and Settle or Done write back the lowest value of the level's range.

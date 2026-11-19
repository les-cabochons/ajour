# Time sync checks send a cursor that stays in the window's memory

Amends [ADR 0018](0018-time-entries-sync-both-ways-through-a-time-sync-plugin.md): a time sync round can be a check that lists nothing (spec #842, #843).

A time sync took changes made in the other system only with its 60-second round, so a timer stopped there kept counting in Ajour for up to a minute. Each round lists the user's window there, through the other system's API. For ChronOps, that API sits behind a service that scales to zero after 5 minutes without calls, and a round every minute kept it awake while Ajour was open.

**The contract.** `syncTimeEntries` takes an optional, opaque `cursor`, and its full answer may carry the next one. A plugin whose other system keeps a change marker, a version that moves on every time entry write there, puts in the cursor whatever lets it tell that the marker moved. To a request with a cursor and no changes, it may answer `{ unchanged: true, cursor }` without listing. Ajour refuses that answer to any other request, so an Ajour that never sends a cursor never gets it. Nothing in the manifest, the catalog or the plugin API version changes: a plugin without a marker answers as before.

**The runner.** Ajour asks every 5 seconds while its window shows, every 60 seconds while it is hidden, and once when it shows again. A round is a check, the cursor and no changes, only while the inputs the rules read (projects, timers, entries, locked weeks and the connection's time sync record) are the objects the last full answer left, the plan has nothing to send, and the connection wasn't saved again since. A check reads the cached plugins overview, and an unchanged answer only moves the cursor: no lock, no store write, and no connection summary from the local API. Any other round is full and sends no cursor. A connection whose last answer gave no cursor has nothing to check against, so its checks list at most once a minute, as the 60-second poll did.

**The cursor stays in memory.** Ajour keeps it per connection in the window that ran the round, never in the state file or an event, because it may hold a read link to the marker. A reload, a failed round or a saved connection drops it, and the next round is full.

## Considered options

- **Keep the cursor in the API or the state file, as a project source's.** Rejected. A cursor that holds a read link would sit on disk, and a lost cursor costs only one full round.
- **Check only while the plan is empty.** Rejected. A reopened week or a project source sync changes what the listing does without leaving anything to send, so the round after it must list.
- **Push changes over an open connection.** Out of scope: it needs a service that holds the connection, and the marker covers the delay.

## Consequences

- A plugin with a marker answers most rounds without calling its system's API, so that API can scale to zero while nothing changes.
- A plugin without a marker lists once a minute, as before. Only a plugin with a marker gets the 5-second checks.
- A check plans the round each time, about a millisecond for 1,800 entries, so a rule that changes with time alone, such as a new day, still makes the round full.

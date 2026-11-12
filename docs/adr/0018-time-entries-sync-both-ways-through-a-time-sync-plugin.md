# Time entries sync both ways through a time sync plugin

A user's time stays on one machine until they commit the week, so their team sees it days late, and time they log in other tools, such as a timer on a work item, never reaches Ajour. A plugin with the time sync capability keeps a live copy of the user's time entries in another system, both ways, on the projects its project source manages. This amends [ADR 0016](0016-managed-projects-follow-their-source-and-each-budget-number-has-one-writer.md)'s "Ajour never writes to a project source" for time entries only: Ajour writes the user's own time entries there, and nothing else. Budgets keep one writer each: the other system's budgets count the timesheet tool's report only, and Ajour's Not counted yet line is unchanged.

A time sync is not a commit. The timesheet tool still gets a week only through Commit and Submit week, a round never marks an entry committed, and a synced copy is not the committed copy. Because the user's time leaves Ajour, the capability's switch, Time entries, is the one switch that starts off, and turning it on lets the plugin refuse each connection first, such as one whose token can only read. Ajour names the other system only by its plugin. Notes never leave Ajour.

## Considered options

- **Send time one way, from Ajour.** Rejected. Time logged in other tools would still miss the week the user commits from Ajour, or be typed twice.
- **Commit through the other system.** Rejected. The timesheet tool stays the one place Ajour commits to, and the other system's budgets would count the same minutes twice against Not counted yet.
- **A capability of its own, without a project source.** Rejected. An entry takes part only on a project the same connection manages, so the manifest refuses `timeSync` without `projectSource`.
- **Start the switch on, as the others do.** Rejected. It sends time the user never chose to share.

## Consequences

- One plugin operation, `syncTimeEntries`, runs a round: the changes in order, at most 20, then the remote entries of a window. Each change carries a sync key the plugin sends as its client reference, so a retry never duplicates.
- The state file keeps, per plugin, the switches that start off and that the user turned on, apart from those that start on and that the user turned off, so a file saved before keeps every other switch.
- The window keeps each round's status. The local API keeps none, so a round never hides the project source's last error on the connection.

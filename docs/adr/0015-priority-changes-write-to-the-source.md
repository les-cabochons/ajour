# Priority changes on synced items write to the source

Until now, only Settle wrote a priority to Azure DevOps or Jira. A priority picked anywhere else stayed in Ajour, so the source tool kept showing the team a priority the user no longer followed, and the two drifted apart until the next settle. Now every change of a synced item's priority level writes the new level to its source, from every surface: the pickers, the peek, the item page, the editor, a drop in a priority group and the agent edit tool. All of them go through one priority transition in the backlog lifecycle module.

The write uses the queue Settle and moves already use ([ADR 0001](0001-connector-writes-after-undo-window.md)): it is sent when the Undo toast closes, held for Sync review when editing is off on the connection, and put back with an error toast when it fails. The editor's Save has no Undo, so its write goes at once. A level equal to the source's writes nothing, so the source keeps its exact number. The plugin contract does not change: the settle write already takes a priority without a state. Azure DevOps writes the lowest value of the level's range, and Jira maps the level to its priority.

## Considered options

- **Keep priority local, and write it only on Settle.** Rejected. It is the drift this decision removes.
- **Write at once, with a confirmation dialog.** Rejected. A priority is changed often, from pickers and drags, and the UI rules prefer Undo to a dialog. A move writes the same way.
- **Send a priority change with the next sync, as estimates do.** Rejected. A sync can be far off, and the queue already handles Undo, held writes and failures for one item.

## Consequences

- Plugin levels have no "none". For a synced item whose source has a priority, No priority is disabled in the pickers and the editor, with the reason, and the agent tool refuses it. Manual items keep No priority.
- A priority write keeps a pending state write, and a later move or settle keeps a pending priority, so one write carries both.
- A failed priority write puts back only the priority. The item stays settled, snoozed or archived as it was, unless a later settle joined the write.
- A request already sent may still land. The write records the level on its way, kept across a restart, so a level back at the source's is then written after it instead of dropped.
- A held priority stays held when a move or settle joins it. Turning editing on is not approval, so both wait for Send in Sync review.
- Priorities changed in Ajour before this decision are not sent. They go at the item's next level change.

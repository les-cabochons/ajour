# Shared projects sync with last writer wins and archive without review

A team plugin keeps projects and tasks in step between the members of a team. Unlike backlog imports, which stage items for review, and unlike settle writes, which wait for the Undo window and restore the source on failure ([ADR 0001](0001-connector-writes-after-undo-window.md)), a shared project's team-owned fields follow the most recent write: each sync pushes the local changes made since the last sync, then pulls the team's changes, and the later write to a field wins. Archiving a shared project or task on any machine archives it for the whole team, and restoring it restores it everywhere, with no review step. A local change is pushed only once its Undo window has closed; a sync that runs during the window skips it and the next one carries it.

## Considered options

- **Review before accepting, like backlog import.** This was rejected because the team is trusted by construction (the user connected to it on purpose), the data is project names, codes and budgets, and a review queue for renames would be busywork that people would click through.
- **Conflict dialog when both sides changed a field.** This was rejected because a lost edit is a rename or a budget figure, which is cheaper to redo than to adjudicate, and a dialog would be the only one of its kind in Ajour.
- **Team-wide delete.** This was rejected because it would be the first destructive sync action in Ajour. Only archive exists, and it is reversible. Unsharing a project makes it local on one machine and leaves the team project for everyone else.

## Consequences

- Shared projects and tasks need a remote identity and a last-synced copy of their team-owned fields, and each connection needs a sync cursor. A field that differs from its copy is a local change, so a push sends only changed fields and survives a restart.
- Local projects never leave the machine. Time entries, tracked totals, notes and budget consumption never sync; only the budget figure itself does.
- The rule is per field, so a rename on one machine and a budget change on another both survive one round.

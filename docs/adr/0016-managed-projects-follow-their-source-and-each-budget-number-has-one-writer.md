# Managed projects follow their source, and each budget number has one writer

Some systems hold the truth about a user's projects: the official name and code, the client, the planned tasks, who is assigned to each, and the budget with what it has consumed. A plugin with the project source capability hands Ajour a read-only snapshot of that truth, and the projects it brings become managed projects. Their source-owned fields (full name, code, client, dates, tasks and budget) are locked in Ajour and follow the source on every sync. The user keeps the personal fields: display name, color, icon, favorites, pins and plugin properties. Ajour never writes to a project source. Time keeps going to the timesheet tool as it does today.

The source's hours come from a report that lags the user's own entries, so a budget shown straight from the snapshot is a few hours behind, and a naive comparison reports conflicts that are only lag. Each budget number therefore has one writer. The source writes the budget and the consumed hours as of a time it gives (`asOf`). Ajour adds one computed line, Not counted yet: the user's entries on the project that are not committed or were committed after that time. A stale entry counts only its difference from the committed copy the source already has: an entry reported at 8 hours and edited to 9 adds 1 hour, and an entry moved to another task of the same project adds nothing. An entry moved off the project subtracts its committed hours there. Remaining is an estimate and says so. Nothing computed is stored. When the snapshot carries the source's hours for the user, Ajour also says whether what the user committed before `asOf` matches them, and lists the entries when it does not, so a commit that never reached the timesheet tool shows within a sync instead of weeks later.

Ajour names the source only by the label the plugin gives, never by a product name. A project or task that leaves the source is archived, never deleted, and comes back when it reappears. A project the source marks complete becomes archived.

## Considered options

- **Extend the team capability ([ADR 0006](0006-shared-projects-last-writer-wins.md)).** Rejected. A team syncs both ways with last writer wins; a project source is one-way and its fields are locked. A project is managed or shared, never both, and the two rules would fight inside one module.
- **Store the computed budget lines, or let Ajour write consumed hours.** Rejected. Two writers to one number is where the false conflicts come from. Ajour computes its lines from `commit.at` and `asOf` each time the card renders, so a later snapshot cannot disagree with a stored figure.
- **Let Ajour write time back to the source.** Rejected for now, and maybe forever. The timesheet tool is the only place Ajour commits time to, and the source learns it from there.
- **Name the product in Ajour.** Rejected. The first source is one product, but the capability is generic, and the plugin owns the label, the URLs and the sentence that explains why the user's hours are unavailable.

## Consequences

- A project gets a source link (plugin, connection, remote id, URL, time of last sync) and a task gets a remote id and group. A managed project is one with a source link.
- The first sync links an existing local project by code without asking. A project that only matches by name waits in a one-time review, so Ajour never locks the wrong project. Tasks link by exact name.
- Any task of a managed project offers Merge into…, which moves its entries to another task, marks their committed copies stale so the next commit moves them in the timesheet tool, and archives the empty task.
- The sync module lives next to `team-sync.ts`, not inside it. Linking, archiving on disappearance and restoring on return reuse the mechanisms the backlog sync already has.
- The budget card shows three things from two writers: the source's figures with their time, Ajour's Not counted yet line, and the reconciliation line when the source can give the user's hours. When it cannot, the card shows the plugin's note on why.

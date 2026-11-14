# Time sync

A plugin with **Time entries** keeps a live copy of your time entries in another system, such as the planning tool that manages your projects, both ways. Your team sees your hours there within seconds, days before you commit the week, and time you log there in another tool shows in Ajour within a minute.

A time sync is not a commit. Your timesheet tool still gets the week only when you [commit it](/time/commit), and a time sync never marks an entry committed.

## Turn it on

1. Connect the plugin in **Settings › Plugins**. Its **Managed projects** bring your projects, as described in [Managed projects](/projects/#managed-projects).
2. Turn on **Time entries** under **Capabilities** on the plugin's page. It is off until you turn it on.

Ajour first checks each of the plugin's connections. If the plugin refuses one, such as a token that can only read, the switch stays off and the page says why.

From then on, Ajour sends your entries from the week you turned it on. Older weeks stay where they are.

## What Ajour sends

Ajour sends a saved or running entry when all of these hold:

- Its project is managed by the same connection.
- It has a task, and neither the task nor the project is **Local only**.
- Its day is in the week you turned **Time entries** on or later, and not after today. An entry for tomorrow waits for its day.
- It lasts at least 30 seconds, so a mis-click stays in Ajour.

For each entry, the other system gets its day, its time rounded to the nearest minute, its project and its task under the name your [commit](/time/commit) would use. A **Not known yet** task goes under its own name. Your notes never leave Ajour.

| Sent                                       | Stays in Ajour                        |
| ------------------------------------------ | ------------------------------------- |
| Day                                        | Notes                                 |
| Time, in whole minutes                     | Entries under 30 seconds              |
| Project                                    | Entries on Local only tasks           |
| Task, under the name your commit would use | Entries on projects it doesn't manage |

## Your running entry

Your running entry shows in the other system as running, with the same elapsed time as in Ajour. It goes there once it has run 30 seconds, within a minute after that, so a Start you discard right away stays in Ajour.

- **Stop** stops that same entry there, with its time in whole minutes.
- **Start** on another task while an entry runs stops the first entry and starts the second there, in one go, at the same instant.
- **Continue** on today's entry makes it run again there, with its saved time.
- **Discard** deletes the running entry there. On a continued entry, it puts back the saved time, stopped.

Ajour sends the running entry again only when its count changes by a minute or more, such as when you correct its time, or when you change its task. The minutes it counts as time passes never send a change.

## When it sends

Ajour sends a change about 2 seconds after you add, edit, move or delete an entry, and checks again every minute while the plugin is on. An entry you move to a **Local only** task, to a project the connection doesn't manage, or to a later day is deleted there. **Merge into** and **Undo** are sent like any other change.

Ajour compares whole minutes, so a few seconds more never send a change.

## What Ajour takes

Every minute, Ajour reads your entries in the other system for this week and the 4 before it, never before the week you turned **Time entries** on, and takes what changed there:

- An entry logged in another tool, such as a timer on a work item, appears on its project and task.
- An edit there changes the entry in Ajour.
- A delete there deletes the entry in Ajour. If you committed it, the next [commit](/time/commit) removes it from your timesheet tool.

Ajour finds the task by the name your commit would use, then by the task's own name, ignoring case, accents and extra spaces. When no task matches, Ajour adds one of that name, marked **Not known yet**, so its time waits on the Commit page until you pick what it commits as.

If an entry changed on both sides before Ajour checked, the later change wins, and a delete wins over an edit. When you turn **Time entries** on, Ajour's values win for the entries it already has.

A running entry started in another tool, and a week you submitted, stay as they are for now.

### Held entries

Ajour doesn't take an entry logged there on a project the connection doesn't manage, or on a **Local only** project or task. It holds it instead, and **Settings › Sync review** lists it with its day, the project's code, its task, its duration and why. Nothing there changes it: the list follows the other system, so an entry leaves it once Ajour can take it.

## On the connection

The connection's row in **Settings › Plugins** says what the last round did:

- **Time entries · 2 sent**: the other system took two changes.
- **Time entries · 1 received**: Ajour took one entry added, edited or deleted there.
- **Time entries · 1 held**: one entry waits in Sync review.
- **Time entries · up to date**: nothing was waiting.
- **Time entries · 1 refused**, with the plugin's reason, such as an entry over 24 hours. Ajour sends that entry again only once you change it.
- **Time entries · Last sync failed**, with the reason. Nothing changed, and your changes wait. Ajour shows the connection's error toast and tries again by itself, after a few seconds and then less often.

## Turn it off

Turn off **Time entries**, or remove the connection, and Ajour stops sending and taking, and forgets the held entries. The other system keeps the entries it has. Turn it on again and Ajour sends your entries from that week on; the plugin finds the ones it already has, so none arrive twice.

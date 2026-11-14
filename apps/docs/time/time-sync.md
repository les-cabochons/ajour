# Time sync

A plugin with **Time entries** keeps a live copy of your time entries in another system, such as the planning tool that manages your projects. Your team sees your hours there within seconds, days before you commit the week.

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

## On the connection

The connection's row in **Settings › Plugins** says what the last round did:

- **Time entries · 2 sent**: the other system took two changes.
- **Time entries · up to date**: nothing was waiting.
- **Time entries · 1 refused**, with the plugin's reason, such as an entry over 24 hours. Ajour sends that entry again only once you change it.
- **Time entries · Last sync failed**, with the reason. Nothing changed, and your changes wait. Ajour shows the connection's error toast and tries again by itself, after a few seconds and then less often.

## Turn it off

Turn off **Time entries**, or remove the connection, and Ajour stops sending. The other system keeps the entries it has. Turn it on again and Ajour sends your entries from that week on; the plugin finds the ones it already has, so none arrive twice.

# Shared projects

A team plugin keeps a team's projects and tasks in step between its members' Ajour workspaces. Rename a shared project or change a task's budget, and your teammates see it at their next sync. Your time stays yours: time entries, notes and tracked time never leave your device.

You need a team plugin and a connection to a team. Both are set up in **Settings › Plugins**.

## What the team shares

| Follows the team                                   | Stays on your device                |
| -------------------------------------------------- | ----------------------------------- |
| Full name, display name, code, color, icon, status | Your time entries and their notes   |
| Tasks: name, status, billable, budget              | Tracked time and budget used        |
|                                                    | Pinned tasks and the order of lists |
|                                                    | Budget adjustments                  |
|                                                    | Plugin properties, such as Workday  |

When two people change the same field, the change that reaches the team last wins. Changes to different fields both stand. Archiving a shared project or task archives it for the whole team. Nothing is ever deleted from a team.

## Join a team

1. Open the team plugin in **Settings › Plugins** and press **Add a connection**.
2. Enter the deployment URL you were given.
3. To start a team, enter its name and press **Create a team**. Ajour fills in the team ID and secret. To join one instead, paste the team ID and secret a teammate gave you.
4. Press **Add connection**.

Ajour syncs right away, then asks what to do with your projects:

- **The team already has these** lists the team's projects that share a name with one of yours. **Link to your project** makes yours the shared one, so its time entries stay where they are. **Add as its own project** keeps both.
- **Share your projects** lists your other projects. Check the ones the team should have.

Press **Apply**. Projects you don't share stay local. You can share them later.

Pass the team secret privately. Anyone with the team ID and secret sees the team's shared projects.

## Share a project

On the project's page, press **Share with team** in the properties card. The project goes to the team when the Undo toast closes. If you have several teams, pick one.

A shared project shows a team mark in the Projects list, and a **Team** row in its properties card.

## When a teammate shares a project

It appears in your Projects list at the next sync, with its tasks.

One case waits for you: a project with the same name as one of yours. The plugin's connection then shows that a team project waits, and **Choose projects** offers to link it to yours or add it separately. Sharing your project of that name links it too.

## Stop sharing

Press **Stop sharing** on the project's page. The project becomes local on your device, with its tasks and time entries. The team keeps it, and your teammates keep working with it. Its later changes no longer reach you.

Stop sharing asks first and has no Undo.

Removing the team's connection in **Settings › Plugins** stops sharing every project of that team the same way.

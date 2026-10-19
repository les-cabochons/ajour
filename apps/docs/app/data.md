# Your data

Ajour keeps your work on your machine. It has no account, no server and no telemetry. This page lists what Ajour stores, where, and when it uses the network.

## Where Ajour stores data

The desktop app keeps everything in one folder:

| Platform | Folder                                |
| -------- | ------------------------------------- |
| macOS    | `~/Library/Application Support/Ajour` |
| Windows  | `%APPDATA%\Ajour`                     |

The folder holds:

- **Your workspace**: projects, tasks, entries, backlog items, workflow and preferences, in the app's local storage.
- **`app-api-state.json`**: plugin connections, items waiting in Sync review, MCP clients and agent task settings.
- **`plugins/`**: installed plugins.
- **`plugin-catalog/`**: a cache of the plugin catalog.

To back up Ajour, quit it and copy this folder.

::: warning Plugin credentials
Connection tokens, such as an Azure DevOps personal access token, are stored in `app-api-state.json`. Only your user account can read the file, but the tokens in it are not encrypted. Give each token only the permissions its plugin needs, and an expiry date.
:::

## When Ajour uses the network

Ajour never sends your time entries anywhere. It connects to the network for these, some of them on a timer:

- **GitHub releases**, to check for updates on startup, every 4 hours and when you ask, in the desktop app. Updates download only when you choose to update.
- **The plugin catalog** on GitHub, at launch and every 15 minutes, and GitHub releases when you download a plugin.
- **The tools you connect**, such as Azure DevOps, Jira, GitHub or your calendar, when you press **Sync**, on the connection's timer, and when you open a week or an item's comments.

Your time entries stay on your machine, unless you export them or let an agent read them, through [MCP](/app/agents) or an [agent task](/app/agents#agent-tasks).

## What plugins can see

A plugin sees the connection settings you give it, and the data of its own connections, such as their backlog items. A team plugin also gets the projects and tasks you share with the team. No plugin sees your time entries or other plugins' data. Plugins do run with your user's permissions, like any app you install, so install plugins you trust. See [Plugins](/plugins/#trust).

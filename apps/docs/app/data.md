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
- **`app-api-state.json`**: plugin connections, items waiting in Sync review, and MCP clients.
- **`plugins/`**: installed plugins.
- **`plugin-catalog/`**: a cache of the plugin catalog.

To back up Ajour, quit it and copy this folder.

::: warning Plugin credentials
Connection tokens, such as an Azure DevOps personal access token, are stored in `app-api-state.json`. Only your user account can read the file, but the tokens in it are not encrypted. Give each token only the permissions its plugin needs, and an expiry date.
:::

## When Ajour uses the network

Ajour sends nothing on its own. It connects to:

- **GitHub releases**, to check for updates.
- **The plugin catalog** on GitHub, to list plugins, and GitHub releases to download them.
- **The tools you connect**, such as Azure DevOps, Jira or GitHub, when a plugin syncs.

Your time entries never leave your machine, unless you export them or [turn on MCP](/app/agents) for an agent.

## What plugins can see

A plugin sees the connection settings you give it, and the backlog items of its own connections. It does not see your time entries, your projects or other plugins' data. Plugins do run with your user's permissions, like any app you install, so install plugins you trust. See [Plugins](/plugins/#trust).

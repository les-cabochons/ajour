# Plugins

Plugins connect Ajour to the tools where your work lives. They run on your machine, in the desktop app, and talk to those tools directly. No Ajour server sits in between.

<Shot name="settings-plugins" alt="Settings › Plugins with Azure DevOps, GitHub and Jira installed" />

## Official plugins

| Plugin                                    | Capability | What it does                                                                            |
| ----------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| [Azure DevOps](/plugins/azure-devops)     | Connector  | Syncs work items into your backlog. Writes estimates, states and priorities back.       |
| [Jira](/plugins/jira)                     | Connector  | Syncs Jira issues into your backlog. Writes estimates, statuses and priorities back.    |
| [GitHub](/plugins/github)                 | Code host  | Lists the pull requests you wrote or were asked to review.                              |
| [Workday](/plugins/workday)               | Schema     | Maps projects and tasks to a Workday file layout. Coming soon.                          |
| [Workday (agent)](/plugins/workday-agent) | Agent task | Has an agent enter your week in the Workday timesheet. Unofficial, install from a file. |

Want to connect another tool? See [Build a plugin](/developers/).

## Install a plugin

1. Open **Settings › Plugins**.
2. Find the plugin. The tabs filter by capability: **Connectors**, **Code hosts** and **Schemas**.
3. Press **Download**. Ajour downloads the latest release from the plugin's GitHub repository and installs it turned off.
4. Turn on the plugin's switch to activate it.

To install a plugin from a file, press **Install from file** and choose its `.ajour-connector` file. Use this for plugins that are not in the catalog.

::: info
Plugins need the desktop app. The web version cannot show the catalog, install plugins or run them.
:::

## Add a connection

A connection is one account or site the plugin talks to, with its own credentials. You can add several, for example one per client.

1. Click the plugin in the catalog to open its page.
2. Under **Configuration**, press **Add a connection**.
3. Fill in the fields. Each plugin page lists them: [Azure DevOps](/plugins/azure-devops#connection-fields), [Jira](/plugins/jira#connection-fields), [GitHub](/plugins/github#connection-fields).
4. Press **Add connection**. The plugin checks the credentials before Ajour saves them.

<Shot name="settings-plugin-connections" alt="The Configuration section of a plugin, with one connection" />

Each connection shows its status, **Connected** or **Error** with the last error message, and how it syncs:

- **Stage for review**: press **Sync** to fetch items. They wait in [Sync review](/plugins/sync-review) until you pick the ones you want.
- **Auto every N min**: Ajour syncs on its own while it is open, and adds new items straight to your backlog.

Press **Edit** to change a connection. Secret fields, such as tokens, show as dots. Leave them as they are to keep the saved value.

## Update a plugin

When Ajour changes its plugin API, a plugin built for the old API shows as **Unavailable**, with the reason. Press **Update** to download the version for the new API from the catalog. Your connections, imported items and activation stay.

::: info Newer versions of a working plugin
The catalog does not offer newer versions of a plugin that works. To update it, download the new `.ajour-connector` file from the plugin's GitHub releases and press **Install from file**. Ajour replaces the plugin and keeps its connections.
:::

## Turn plugins off

- **The plugin's switch** pauses one plugin. It stops syncing, but keeps its connections, staged items and imported backlog items.
- **Plugin system**, at the top of the page, pauses every plugin at once.

## Uninstall a plugin

Open the plugin's page and press **Uninstall** at the bottom. Ajour deletes the plugin, its connections and their credentials. Backlog items it already imported stay in your backlog as they are.

## Trust {#trust}

A plugin runs with your user's permissions, like any app you install. It can reach the network and your files. Ajour does not sandbox it. Install plugins from people you trust, and give each token only the permissions its plugin needs.

The catalog refreshes at launch and every 15 minutes. Change this under **Refresh catalog**.

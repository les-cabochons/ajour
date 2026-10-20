# Plugins

Plugins connect Ajour to the tools where your work lives. They run on your machine, in the desktop app, and talk to those tools directly. No Ajour server sits in between.

<Shot name="settings-plugins" alt="Settings › Plugins with Azure DevOps, GitHub and Jira installed" />

## Official plugins

| Plugin                                    | Capability         | What it does                                                                                                                     |
| ----------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [Azure DevOps](/plugins/azure-devops)     | Backlog, code host | Syncs work items into your backlog, with their comments. Writes estimates, states and priorities back. Lists your pull requests. |
| [Jira](/plugins/jira)                     | Backlog            | Syncs Jira issues into your backlog. Writes estimates, statuses and priorities back.                                             |
| [GitHub](/plugins/github)                 | Backlog, code host | Syncs issues assigned to you into your backlog. Lists the pull requests you wrote or were asked to review.                       |
| [Workday](/plugins/workday)               | Schema             | Maps projects and tasks to a Workday file layout. Coming soon.                                                                   |
| [Workday (agent)](/plugins/workday-agent) | Agent tasks        | Has an agent commit your week to the Workday timesheet, and check it before you submit the week. Unofficial.                     |
| [Calendar address (ICS)](/plugins/ics)    | Calendar           | Suggests your Google Calendar, Outlook or Exchange meetings as time entries. Not in the catalog yet: install it from a file.     |

Want to connect another tool? See [Build a plugin](/developers/).

## What a plugin can add

| Capability  | What it adds                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Backlog     | Syncs items into your [backlog](/backlog/) and writes settles back.                                         |
| Code host   | Lists your [pull requests](/pull-requests/).                                                                |
| Calendar    | Suggests your calendar's meetings as time entries. See [Calendar suggestions](/time/calendar-suggestions).  |
| Agent tasks | Has a coding agent run a task, such as committing your week. See [Agents and MCP](/app/agents#agent-tasks). |
| Schema      | Maps projects and tasks to another tool's file layout. See [Import and export](/projects/import-export).    |
| Team        | Keeps shared projects and tasks in step with your team. See [Shared projects](/projects/shared-projects).   |

The catalog has no calendar plugin yet. Install [Calendar address (ICS)](/plugins/ics) from a file, and it shows under **Calendars**.

## Install a plugin

1. Open **Settings › Plugins**.
2. Find the plugin. The tabs filter by capability: **Backlog**, **Code hosts**, **Calendars**, **Agent tasks** and **Schemas**.
3. Press **Download**. Ajour downloads the latest release from the plugin's GitHub repository and installs it turned off.
4. Turn on the plugin's switch to activate it.

To install a plugin from a file, press **Install from file** and choose its `.ajour-connector` file. Use this for plugins that are not in the catalog. A plugin installed from a file starts turned on.

When the catalog lists a plugin this version of Ajour can't read, the page names it and asks you to update Ajour.

::: info
Plugins need the desktop app. The web version cannot show the catalog, install plugins or run them.
:::

## Add a connection

A connection is one account or site the plugin talks to, with its own credentials. You can add several, for example one per client.

1. Click the plugin in the catalog to open its page.
2. Under **Configuration**, press **Add a connection**.
3. Fill in the fields. Each plugin page lists them: [Azure DevOps](/plugins/azure-devops#connection-fields), [Jira](/plugins/jira#connection-fields), [GitHub](/plugins/github#connection-fields), [Calendar address (ICS)](/plugins/ics#connection-fields).
4. Press **Add connection**. The plugin checks the credentials before Ajour saves them.

<Shot name="settings-plugin-connections" alt="The Configuration section of a plugin, with one connection" />

Each connection shows its status, **Connected** or **Error** with the last error message, or **Paused** while the plugin is off. It also shows how it syncs:

- **Stage for review**: press **Sync** to fetch backlog items. They wait in [Sync review](/plugins/sync-review) until you pick the ones you want.
- **Auto every N min**: Ajour syncs on its own while it is open, and adds new backlog items straight to your backlog.
- **Manual sync**: pull requests sync only when you press **Sync** on the [Pull requests](/pull-requests/) page.

A plugin with backlog items and pull requests that sync differently shows both, such as **Backlog items: Stage for review · Pull requests: Auto every 5 min**.

Press **Edit** to change a connection, then **Update connection**. Secret fields, such as tokens, show as dots. Leave them as they are to keep the saved value.

Press **Remove** to delete a connection and its credentials. For a plugin with pull requests, a calendar or a team, Ajour asks first and says what goes with it, such as the connection's saved pull requests.

When the plugin provides comments, the form ends with Ajour's own **Agent access to comments**: **None**, the default, **Read** or **Read and post**. See [Agents and MCP](/app/agents#comments).

When the plugin writes descriptions back, the form also has Ajour's own **Allow lossy conversion**, off by default. A description whose formatting has no Markdown form, such as text colour, is read-only until you turn it on. Then every save of such a description names what will be lost and asks first. See [Backlog items](/backlog/items#description).

## Update a plugin

When Ajour changes its plugin API, a plugin built for the old API shows as **Unavailable**, with the reason. Press **Update** to download the version for the new API from the catalog. Your connections, imported items and activation stay.

::: info Newer versions of a working plugin
The catalog does not offer newer versions of a plugin that works. To update it, download the new `.ajour-connector` file from the plugin's GitHub releases and press **Install from file**. Ajour replaces the plugin and keeps its connections.
:::

## Turn plugins off

- **The plugin's switch** pauses one plugin. It stops syncing, but keeps its connections, staged items and imported backlog items.
- **Capabilities**, on the page of a plugin with more than one part, has a switch for each part, such as **Backlog items** and **Pull requests**. Turning one off pauses it. Its connection fields hide, and its data stays. When an update adds a part to a plugin you have, the new part starts off.
- **Plugin system**, at the top of the page, pauses every plugin at once.

## Uninstall a plugin

Open the plugin's page and press **Uninstall** at the bottom, then **Uninstall plugin**. Ajour deletes the plugin, its connections and their credentials. Backlog items it already imported stay in your backlog as they are.

## Trust {#trust}

A plugin runs with your user's permissions, like any app you install. It can reach the network and your files. Ajour does not sandbox it. Install plugins from people you trust, and give each token only the permissions its plugin needs.

The catalog refreshes at launch and every 15 minutes. Change this under **Refresh catalog**.

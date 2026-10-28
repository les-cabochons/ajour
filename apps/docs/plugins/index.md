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
| [Calendar address (ICS)](/plugins/ics)    | Calendar           | Suggests your Google Calendar, Outlook or Exchange meetings as time entries.                                                     |

The official plugins come from [les-cabochons/ajour-plugins](https://github.com/les-cabochons/ajour-plugins), the plugin source Ajour lists by default. Want to connect another tool? See [Build a plugin](/developers/).

## What a plugin can add

| Capability  | What it adds                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Backlog     | Syncs items into your [backlog](/backlog/) and writes settles back.                                         |
| Code host   | Lists your [pull requests](/pull-requests/).                                                                |
| Calendar    | Suggests your calendar's meetings as time entries. See [Calendar suggestions](/time/calendar-suggestions).  |
| Agent tasks | Has a coding agent run a task, such as committing your week. See [Agents and MCP](/app/agents#agent-tasks). |
| Schema      | Maps projects and tasks to another tool's file layout. See [Import and export](/projects/import-export).    |
| Team        | Keeps shared projects and tasks in step with your team. See [Shared projects](/projects/shared-projects).   |

## Install a plugin

1. Open **Settings › Plugins**.
2. Find the plugin. The tabs filter by capability: **Backlog**, **Code hosts**, **Calendars**, **Agent tasks** and **Schemas**.
3. Press **Download**. Ajour downloads the plugin's files from its source, checks each one, and installs it turned off.
4. Turn on the plugin's switch to activate it.

To install a plugin from a file, turn on **Allow installing unsigned plugins**, press **Install from file** and choose its `.ajour-connector` file. A plugin installed from a file starts turned off too, so turn on its switch before you add a connection.

When a source lists a plugin this version of Ajour can't read, or one another source already lists, the page names it.

::: info
Plugins need the desktop app. The web version cannot list plugins, install them or run them.
:::

## Plugin sources {#sources}

A plugin source is a git repository with an `ajour.json` file that lists plugins. **Plugin sources**, at the bottom of **Settings › Plugins**, shows the ones Ajour reads, and each one's state: **Signed**, **Unsigned**, or a problem such as **Key changed**.

To add one, paste its address under **Add a source**, such as `https://codeberg.org/alice/plugins`, and press **Add source**. Ajour reads it and shows its plugins and how it is signed before anything is added. It reads repositories on GitHub, GitLab, Codeberg and other Gitea or Forgejo hosts.

- **Signed** sources show their key's fingerprint, such as `3f2a 9c1d 77e0 b4a2`. Compare it with the one the publisher gives. Once you add the source, Ajour trusts it only with that key.
- If a source is later signed with another key, or loses its signature, Ajour hides its plugins and shows **Review**. Approve the new key only if the publisher told you about it.
- **Remove** stops listing the source's plugins. Plugins you installed from it stay installed, without updates.

The official source is there by default. If you remove it, **Add the official source** brings it back. Ajour checks it against keys built into the app, so it never asks you to approve its key. If it is ever signed with another key, Ajour blocks it, and only an Ajour update can bring the new key.

## Add a connection

A connection is one account or site the plugin talks to, with its own credentials. You can add several, for example one per client.

1. Click the plugin in the catalog to open its page.
2. Turn on the plugin's switch if it is off. **Add a connection** stays disabled, and a form can't save, until the plugin is on. If an update reaches more than you allowed, press **Allow and activate** instead.
3. Under **Configuration**, press **Add a connection**.
4. Fill in the fields. Each plugin page lists them: [Azure DevOps](/plugins/azure-devops#connection-fields), [Jira](/plugins/jira#connection-fields), [GitHub](/plugins/github#connection-fields), [Calendar address (ICS)](/plugins/ics#connection-fields).
5. Press **Add connection**. The plugin checks the credentials before Ajour saves them.

<Shot name="settings-plugin-connections" alt="The Configuration section of a plugin, with one connection" />

Each connection shows its status, **Connected** or **Error** with the last error message, or **Paused** while the plugin is off. It also shows how it syncs:

- **Stage for review**: press **Sync** to fetch backlog items. They wait in [Sync review](/plugins/sync-review) until you pick the ones you want.
- **Auto every N min**: Ajour syncs on its own while it is open, and adds new backlog items straight to your backlog.
- **Manual sync**: pull requests sync only when you press **Sync** on the [Pull requests](/pull-requests/) page.

A plugin with backlog items and pull requests that sync differently shows both, such as **Backlog items: Stage for review · Pull requests: Auto every 5 min**.

Press **Edit** to change a connection, then **Update connection**. Secret fields, such as tokens, show as dots. Leave them as they are to keep the saved value.

Press **Remove** to delete a connection and its credentials. For a plugin with pull requests, a calendar or a team, Ajour asks first and says what goes with it, such as the connection's saved pull requests.

When the plugin provides comments or writes descriptions back, the form ends with Ajour's own **Agent access**: **None**, the default, **Read** or **Read and write**. See [Agents and MCP](/app/agents#comments).

When the plugin writes descriptions back, the form also has Ajour's own **Allow lossy conversion**, off by default. A description whose formatting has no Markdown form, such as text colour, is read-only until you turn it on. Then every save of such a description names what will be lost and asks first. See [Backlog items](/backlog/items#description).

## Update a plugin

When the plugin's source lists a newer version, the plugin shows **Update**, and its row says which version is available. Press it to install that version. Your connections, imported items and activation stay. Ajour never updates a plugin on its own, and only the source a plugin came from updates it.

When Ajour changes its plugin API, a plugin built for the old API shows as **Unavailable**, with the reason, and **Update** installs the version for the new API.

## Turn plugins off

- **The plugin's switch** pauses one plugin. It stops syncing, but keeps its connections, staged items and imported backlog items.
- **Capabilities**, on the page of a plugin with more than one part, has a switch for each part, such as **Backlog items** and **Pull requests**. Turning one off pauses it. Its connection fields hide, and its data stays. When an update adds a part to a plugin you have, the new part starts off.
- **Deactivate unsigned plugins**, at the top of the page, pauses every unsigned plugin at once. Signed plugins keep running. Turn it off again and each one goes back to its own switch.
- **Plugin system**, at the top of the page, pauses every plugin at once.

## Uninstall a plugin

Open the plugin's page and press **Uninstall** at the bottom, then **Uninstall plugin**. Ajour deletes the plugin, its connections and their credentials. Backlog items it already imported stay in your backlog as they are.

## Trust {#trust}

A plugin runs with your user's permissions, like any app you install. It can reach the network and your files. Ajour does not sandbox it. Install plugins from people you trust, and give each token only the permissions its plugin needs.

A plugin is **signed** when it comes from a source signed with a key you approved, or with one of Ajour's official keys. Ajour then installs exactly the files the publisher signed. Any other plugin is **Unsigned**, and says so: one from an unsigned source, one whose source key you haven't approved, one installed from a file, and any plugin installed before Ajour kept track of where plugins come from. Ajour can't tell who made an unsigned plugin or that nobody changed it.

- **Allow installing unsigned plugins** is off at first. While it is off, Ajour installs only signed plugins. When it is on, Ajour warns you before every unsigned install or update.
- **Deactivate unsigned plugins** pauses every unsigned plugin you already have.

Ajour reads your plugin sources at launch and every 15 minutes. Change this under **Refresh catalog**.

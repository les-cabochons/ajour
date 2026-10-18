# Plugin API

A plugin connects Ajour to another tool. The official plugins for Azure DevOps, Jira and GitHub use the same API that this section documents, so anything they do, your plugin can do too.

## What a plugin is

A plugin is a folder with a `plugin.json` manifest and compiled JavaScript. Ajour loads the JavaScript and calls functions it exports, such as `validateConnection` or `syncConnection`. Each function gets plain data in and returns plain data out. Ajour does the rest: the settings form, storage, scheduling, the review screen and the backlog.

```text
my-plugin/
  plugin.json      the manifest
  dist/plugin.js   the entry point, with named function exports
```

A plugin has one or more capabilities:

| Capability    | What it does                                                                     | Example                                                      | API version |
| ------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------- |
| **Backlog**   | Syncs backlog items and estimates. Optionally writes states and priorities back. | [Azure DevOps](/plugins/azure-devops), [Jira](/plugins/jira) | 3           |
| **Code host** | Provides the user's pull requests as facts. Ajour decides which need the user.   | [GitHub](/plugins/github)                                    | 3           |
| **Schema**    | Maps projects and tasks to and from a file layout.                               | [Workday](/plugins/workday)                                  | 1           |

One package can be a backlog plugin and a code host at once. A schema is a separate kind of package.

## How it runs

```text
Ajour window            your data, the UI
   │  HTTP on 127.0.0.1
Ajour's local API       connections, staging, scheduling
   │  a new worker thread per call
your plugin             stateless
   │  fetch
your tool's API
```

- Your plugin runs in the desktop app, on the user's machine. There is no Ajour server.
- Every call runs in a new Node worker thread, which ends when the call returns. Nothing survives between calls.
- Ajour validates every result against its schema. A result that does not match fails the whole call.

## What a plugin can do

- Call any HTTP API with `fetch`.
- Ask the user for settings and secrets, through connection fields that Ajour renders as a form.
- Bring backlog items into Ajour, with their state, priority, estimates, description and one level of subitems.
- Sync estimates both ways, with Ajour handling conflicts.
- Write a new state and priority to the source when the user settles or moves an item.
- Report pull requests and their reviews, comments and checks.
- Map projects and tasks to the columns of a file.

## What a plugin cannot do

- **Read Ajour's data.** A plugin sees its connection's settings and the items it synced, nothing else. It never sees time entries, projects or other plugins.
- **Keep state between calls.** Each call starts fresh. Cache within a call only.
- **Show UI.** Ajour draws every screen. A plugin describes fields and returns data.
- **Run in the background.** Ajour decides when to call a plugin: when the user presses Sync, on the connection's timer, or when a write is due.
- **Log.** Console output is discarded. Report problems by throwing an error with a message for the user.
- **Read environment variables.** `process.env` is empty.
- **Run longer than 30 seconds** per call, or return more than 8 MiB.

Plugins are not sandboxed. A plugin can reach the user's files and network like any program. Users install plugins they trust, and a plugin should only talk to the tool it is for. See [Runtime and limits](/developers/runtime).

## API versions

Ajour checks a plugin's `apiVersion` exactly. A backlog plugin or code host for API `3` works with Ajour versions that use API `3`, and with no other. When Ajour changes the API, it shows older plugins as unavailable until they are updated, and keeps their connections and data. Plan to release a new version of your plugin when the API version changes.

## Start here

<DocLinks :items="[
  { icon: 'terminal', title: 'Build a backlog plugin', text: 'Write a GitHub Issues backlog plugin, run it in Ajour, and package it.', link: '/developers/build-a-backlog-plugin' },
  { icon: 'list', title: 'Manifest', text: 'Every field of plugin.json.', link: '/developers/manifest' },
  { icon: 'code', title: 'Backlog API', text: 'Functions, types and sync rules for backlog plugins.', link: '/developers/backlog-api' },
  { icon: 'pullRequest', title: 'Code host API', text: 'Pull request facts for code hosts.', link: '/developers/code-host-api' },
  { icon: 'calendar', title: 'Calendar API', text: 'Calendar events for time suggestions.', link: '/developers/calendar-api' },
  { icon: 'excel', title: 'Schema API', text: 'Map projects and tasks to a file layout.', link: '/developers/schema-api' },
  { icon: 'shield', title: 'Runtime and limits', text: 'Where plugins run and what they may use.', link: '/developers/runtime' },
  { icon: 'test', title: 'Test and debug', text: 'Unit tests, development builds and error messages.', link: '/developers/testing' },
  { icon: 'upload', title: 'Publish a plugin', text: 'Package, release and list your plugin in the catalog.', link: '/developers/publish' },
]" />

The best examples are the official plugins. [ajc-jira](https://github.com/les-cabochons/ajc-jira) is the smallest backlog plugin, [ajc-azure-devops](https://github.com/les-cabochons/ajc-azure-devops) shows configurable priorities, and [ajc-github](https://github.com/les-cabochons/ajc-github) is a code host.

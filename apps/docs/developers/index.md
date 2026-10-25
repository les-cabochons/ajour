# Plugin API

A plugin connects Ajour to another tool. The official plugins, such as Azure DevOps, Jira and GitHub, use the same API that this section documents, so anything they do, your plugin can do too.

## What a plugin is

A plugin is a folder with a `plugin.json` manifest and compiled JavaScript. Ajour loads the JavaScript and calls functions it exports, such as `validateConnection` or `syncConnection`. Each function gets plain data in and returns plain data out. Ajour does the rest: the settings form, storage, scheduling, the review screen and the backlog. A plugin with only agent tasks or project properties has no JavaScript: its manifest and prompt files are the whole plugin.

```text
my-plugin/
  plugin.json      the manifest
  dist/plugin.js   the entry point, with named function exports
```

A plugin has one or more capabilities:

| Capability             | What it does                                                                                           | Example                                                                                 | API version |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------- |
| **Backlog**            | Syncs backlog items and estimates. Optionally writes states and priorities back, and handles comments. | [Azure DevOps](/plugins/azure-devops), [Jira](/plugins/jira), [GitHub](/plugins/github) | 3           |
| **Code host**          | Provides the user's pull requests as facts. Ajour decides which need the user.                         | [GitHub](/plugins/github), [Azure DevOps](/plugins/azure-devops)                        | 3           |
| **Calendar**           | Provides the user's calendar events as facts, for time suggestions. Read-only.                         | [Calendar address (ICS)](/plugins/ics)                                                  | 3           |
| **Team**               | Keeps a team's shared projects in step through a backend.                                              |                                                                                         | 3, team 1   |
| **Agent tasks**        | Prompts a coding agent runs from the Commit page. No plugin code runs.                                 | [Workday (agent)](/plugins/workday-agent)                                               | 3           |
| **Project properties** | Text fields the plugin adds to every project. No plugin code runs.                                     | [Workday (agent)](/plugins/workday-agent)                                               | 3           |
| **Schema**             | Maps projects and tasks to and from a file layout.                                                     | [Workday](/plugins/workday)                                                             | 1           |

One package can combine capabilities, such as GitHub's backlog and code host, or Workday's agent tasks and project properties. A schema is a separate kind of package.

## How it runs

```text
Ajour window            your data, the UI
   │  HTTP on 127.0.0.1
Ajour's local API       connections, staging, validation
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
- Show, post, edit and delete comments on synced items, with reactions and mentions.
- Report pull requests and their reviews, comments and checks.
- Report calendar events for a range of days.
- Keep a team's shared projects and tasks in step.
- Give a coding agent a task, such as entering the week in a timesheet, and add text fields to projects.
- Map projects and tasks to the columns of a file.

## What a plugin cannot do

- **Read Ajour's data.** A plugin sees its connection's settings and what each call passes, such as the items it synced, nothing else. A team plugin sees the projects the user shares, and a schema the projects the user exports. No plugin code sees time entries or other plugins. The agent of an agent task reads the week through Ajour's MCP tools.
- **Keep state between calls.** Each call starts fresh. Cache within a call only.
- **Show UI.** Ajour draws every screen. A plugin describes fields and returns data.
- **Run in the background.** Ajour decides when to call a plugin: when the user acts, on the connection's timer, or when a write is due.
- **Log.** Console output is discarded. Report problems by throwing an error with a message for the user.
- **Read environment variables.** `process.env` is empty.
- **Run longer than 30 seconds** per call, or return more than 8 MiB.

Plugins are not sandboxed. A plugin can reach the user's files and network like any program. Users install plugins they trust, and a plugin should only talk to the tool it is for. See [Runtime and limits](/developers/runtime).

## API versions

Ajour checks a plugin's `apiVersion` exactly. A plugin for API `3` works with Ajour versions that use API `3`, and with no other. Schema plugins have their own API version, `1`. When Ajour changes the API, it shows older plugins as unavailable until they are updated, and keeps their connections and data. Plan to release a new version of your plugin when the API version changes.

## Start here

<DocLinks :items="[
  { icon: 'terminal', title: 'Build a backlog plugin', text: 'Write a GitHub Issues backlog plugin, run it in Ajour, and package it.', link: '/developers/build-a-backlog-plugin' },
  { icon: 'list', title: 'Manifest', text: 'Every field of plugin.json.', link: '/developers/manifest' },
  { icon: 'code', title: 'Backlog API', text: 'Functions, types and sync rules for backlog plugins.', link: '/developers/backlog-api' },
  { icon: 'pullRequest', title: 'Code host API', text: 'Pull request facts for code hosts.', link: '/developers/code-host-api' },
  { icon: 'calendar', title: 'Calendar API', text: 'Calendar events for time suggestions.', link: '/developers/calendar-api' },
  { icon: 'projects', title: 'Team API', text: 'Keep the shared projects of a team in step.', link: '/developers/team-api' },
  { icon: 'robot', title: 'Agent tasks', text: 'Prompts a coding agent runs from the Commit page.', link: '/developers/manifest#agent-tasks' },
  { icon: 'excel', title: 'Schema API', text: 'Map projects and tasks to a file layout.', link: '/developers/schema-api' },
  { icon: 'shield', title: 'Runtime and limits', text: 'Where plugins run and what they may use.', link: '/developers/runtime' },
  { icon: 'test', title: 'Test and debug', text: 'Unit tests, development builds and error messages.', link: '/developers/testing' },
  { icon: 'upload', title: 'Publish a plugin', text: 'List your plugins in a repository with a signed ajour.json.', link: '/developers/publish' },
]" />

The best examples are the official plugins, in [les-cabochons/ajour-plugins](https://github.com/les-cabochons/ajour-plugins). [Jira](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/jira) is the smallest backlog plugin, [Azure DevOps](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/azure-devops) shows configurable priorities and comments, [GitHub](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/github) is a backlog plugin and a code host, [ICS](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/ics) is a calendar, and [Workday (agent)](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/workday-agent) declares agent tasks and project properties.

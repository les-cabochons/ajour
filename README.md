# <img src="./assets/ajour-logo-mark.png" alt="" width="48" height="48" /> Ajour

Local-first time tracking for your workday.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Ajour is a time tracker for people who fill in a timesheet every week. Keep your
time entries, projects, and backlog together, then review what to enter in your
timesheet tool.

- Start a timer or log time by hand, with notes and a project and task.
- Review and edit your day or week. Copy entries and drag them between days.
- Organize projects and tasks, set budgets, and manage your backlog as a list or board.
- Bring in work items and pull requests from Azure DevOps, Jira, and GitHub through optional plugins.
- Turn calendar events into time entries after reviewing the suggestions.
- Review the week's changes on the Commit page before copying them into your timesheet.

Your workspace stays on your machine. Ajour needs no account and does not collect
activity in the background. Optional plugins and agents connect to the services
you choose. Read [how Ajour stores and uses your data](https://docs.ajour.day/app/data).

![Ajour's Day view with a running timer, time entries, and backlog](./apps/docs/public/shots/time-day-light.webp#gh-light-mode-only)
![Ajour's Day view with a running timer, time entries, and backlog](./apps/docs/public/shots/time-day-dark.webp#gh-dark-mode-only)

## Get started

- [Download Ajour for macOS or Windows](https://github.com/les-cabochons/ajour/releases).
- Follow the [start guide](https://docs.ajour.day/start/) to track your first day.
- To run from source, follow [Run locally](#run-locally) below.

## Documentation

The user guide and plugin developer reference are at [docs.ajour.day](https://docs.ajour.day/).

- [Time tracking and weekly review](https://docs.ajour.day/time/day-view)
- [Projects, tasks, and budgets](https://docs.ajour.day/projects/)
- [Plugins and connections](https://docs.ajour.day/plugins/)
- [Build a plugin](https://docs.ajour.day/developers/)
- [Keyboard shortcuts](https://docs.ajour.day/start/shortcuts)

## Run locally

### Requirements

- Node.js 22 or later
- Corepack
- `just`
- A POSIX shell. On Windows, make Git Bash's `sh` available on your `PATH`.

Use the root [justfile](./justfile) for development commands. Corepack uses the
pnpm version pinned in `package.json`.

### Web app

Clone the repository, install dependencies, and start the app:

```sh
git clone https://github.com/les-cabochons/ajour.git
cd ajour
just install
just start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The local time-tracking
workflow needs no account or plugin credentials.

To use another port:

```sh
just start --port 4173
```

### Desktop app

After installing dependencies, start the Electron app in development mode:

```sh
just desktop-start
```

The desktop renderer also uses port `5173`, so stop a running `just start` first.

### Local API

The optional local API handles plugin configuration, sync, and import review.
To run it on its own:

```sh
just api-start
```

It listens at `http://127.0.0.1:8787` by default.

### Development commands

Run `just` to list all available recipes.

| Command                | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `just test`            | Run workspace unit tests.                                |
| `just typecheck`       | Check TypeScript and package import boundaries.          |
| `just format`          | Format the workspace with Prettier.                      |
| `just format-check`    | Check formatting without changing files.                 |
| `just build`           | Build all workspace packages.                            |
| `just desktop-build`   | Build the desktop renderer.                              |
| `just desktop-package` | Package the desktop app for the current host.            |
| `just desktop-make`    | Create a desktop distributable for the current host.     |
| `just docs-start`      | Start the documentation site at `http://127.0.0.1:5174`. |

Create desktop distributables for specific platforms with:

```sh
just make --mac
just make --windows
just make
```

With no flags, `just make` requests both platforms.
See the [release process](./docs/release-process.md) for packaging details.

To remove build output, run `just clean --force`. To also remove dependencies,
run `just clean-all --force`. Without `--force`, both commands show a dry run.

### Tests and verification

Run the main verification checks with:

```sh
just test
just typecheck
just build
just format-check
```

`just test` runs Vitest in workspace packages that expose a test script.
For browser acceptance tests, install Chromium once, then generate and run the
Gherkin scenarios:

```sh
just acceptance-install
just acceptance-test
```

Acceptance tests use Playwright-BDD and Chromium against an isolated Vite server
in test mode at `http://127.0.0.1:4173`. Local fixtures keep them independent of
live services and credentials. Set `AJOUR_ACCEPTANCE_PORT` to use another port.
Manual QA procedures live in [qa/routines](./qa/routines/).

### Plugin development

Plugins live outside this repository and compile to self-contained JavaScript.
They do not import Ajour application source at runtime. The official plugins
live together in [les-cabochons/ajour-plugins](https://github.com/les-cabochons/ajour-plugins):

- [Azure DevOps](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/azure-devops)
- [Jira](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/jira)
- [GitHub](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/github)
- [ICS calendars](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/ics)

In the plugin repository, run `just install`, then keep `just dev` running.
In the Ajour repository, point the development app at the compiled plugin:

```sh
AJOUR_DEV_PLUGIN_DIRS=/absolute/path/to/plugin just desktop-start
```

For multiple directories, separate paths with `:` on macOS or Linux, or `;` on
Windows. Each directory must contain `plugin.json` and its compiled manifest
entrypoint. Ajour loads that output but does not compile or watch the plugin.

You can also choose a directory under Settings > Debug in the development
desktop app. That setting persists across development launches.
`AJOUR_DEV_PLUGIN_DIRS` overrides it for the current launch. Production builds
ignore development directories.

Production installs use `.ajour-connector` archives containing `plugin.json` and
the compiled `dist/` tree. The manifest declares the version, host API version,
entrypoint, icon, and connection fields. No plugin archives come preinstalled.
Install one archive at a time through Settings > Plugins. File installation uses
the desktop bridge and native file chooser, and is unavailable through the
loopback HTTP API. Uninstalling removes the plugin and its configuration while
keeping previously imported backlog items.

See the [plugin developer guide](https://docs.ajour.day/developers/) for the API,
testing, and packaging instructions.

## Contributing

[Report a bug or propose a change](https://github.com/les-cabochons/ajour/issues).
Before contributing, read [AGENTS.md](./AGENTS.md) and the
[project overview](./docs/agents/project-overview.md). Project context and coding
conventions live in [docs/agents](./docs/agents/).

### Repository layout

```text
apps/web/         React + Vite time-tracking UI
apps/desktop/     Electron runtime and desktop packaging
apps/api/         Optional local API and plugin host
apps/docs/        User guide and plugin developer documentation
packages/shared/  Cross-runtime types, validation, and domain logic
packages/example/ Template for a new deep-module package
docs/             Agent context, ADRs, frozen specs, and architecture notes
qa/               Acceptance support, UI checks, and manual QA routines
```

Read the [local-first architecture](./docs/local-first-architecture.md) before
changing sync or activity capture behavior. The
[logging strategy](./docs/logging-strategy.md) describes logging and privacy rules.

## License

Ajour is available under the [MIT license](./LICENSE).

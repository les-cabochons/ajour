# Ajour - Ajour

Ajour is a local-first time-tracking workspace with a web app, an Electron desktop shell, shared domain logic, and an optional local API for plugin-driven imports.

## What Exists Today

- local workspace onboarding
- projects and tasks
- start/stop timer flow
- manual time entries and notes
- backlog management
- desktop packaging for local use

## Privacy Boundary

The default product direction is local-first:

- timers, time entries, backlog items, and workspace metadata stay local
- there is no automatic activity capture in the supported workflow
- tracking data should not be uploaded without explicit user intent

Read [docs/local-first-architecture.md](./docs/local-first-architecture.md) before changing sync or capture behavior.

## Requirements

- Node.js 22+
- Corepack
- `just`

This repo is meant to be driven through the root `Justfile`.

## Quick Start

Install dependencies:

```sh
just install
```

Start the web app:

```sh
just start
```

Open:

```text
http://127.0.0.1:5173
```

To use a different port:

```sh
just start --port 4173
```

## Common Commands

List available commands:

```sh
just
```

Start the web app:

```sh
just start
```

Start the desktop app in development:

```sh
just desktop-start
```

Start the local API server:

```sh
just api-start
```

Run tests:

```sh
just test
```

Run type checks:

```sh
just typecheck
```

Format the workspace with Prettier, or check formatting without writing:

```sh
just format
just format-check
```

Build all workspace packages:

```sh
just build
```

Create desktop distributables:

```sh
just make --mac
just make --windows
just make
```

Clean local build output:

```sh
just clean --force
```

Remove dependencies and build output:

```sh
just clean-all --force
```

## Runtime Surfaces

### Web app

The main local-first UI lives in `apps/web`.

### Desktop app

The Electron shell lives in `apps/desktop` and wraps the web renderer for desktop timer workflows.

Useful commands:

```sh
just desktop-start
just desktop-build
just desktop-package
just desktop-make
```

### Local API

The optional local API lives in `apps/api` and defaults to `127.0.0.1:8787`. It supports plugin configuration, sync, and local import review flows.

### Plugins

Plugin implementations live in standalone repositories. They compile to
self-contained JavaScript and do not import API, desktop, web, or shared
application source at runtime.

Each standalone plugin repository owns its compilation and watch process.
Run `just install` there, then keep `just dev` running while developing the
plugin. In Ajour, set `AJOUR_DEV_PLUGIN_DIRS` to a platform-delimited
list of development plugin directories, or choose a directory from Settings →
Debug in the development desktop app. A selected directory must contain
`plugin.json` and its compiled manifest entrypoint. Ajour loads that output but
does not compile or watch the external plugin. The Debug setting is persisted
for future development launches and is ignored by production builds. An explicit
`AJOUR_DEV_PLUGIN_DIRS` value overrides the saved Debug setting for that
launch.

```sh
AJOUR_DEV_PLUGIN_DIRS=/absolute/path/to/plugin just desktop-start
```

Production desktop installs use one local `.ajour-connector` archive at a time
through Settings → Plugins. Archive installation is available only through the
desktop bridge and its native file chooser, not the loopback HTTP API. Official
plugin implementations and their versioned builds are maintained in:

- [`les-cabochons/ajc-azure-devops`](https://github.com/les-cabochons/ajc-azure-devops)
- [`les-cabochons/ajc-jira`](https://github.com/les-cabochons/ajc-jira)

Each archive contains `plugin.json` and the compiled `dist/` tree. The manifest
declares the plugin version, host API version, entrypoint, icon, and
connection fields. Production builds do not preinstall plugin archives.
Uninstalling removes the managed archive contents and plugin configuration
while retaining backlog items that were already imported.

## Verification

The main verification path is:

```sh
just test
just typecheck
just build
```

## Repo Map

```text
apps/web/        React + Vite app for the main time-tracking UI
apps/desktop/    Electron shell and packaging scripts
apps/api/        local API for plugins and import flows
packages/shared/ shared schemas, rules, and domain logic
packages/example/ copy-me template for a new deep-module package
docs/            project context (docs/agents), ADRs, frozen specs, architecture and logging notes
```

## Related Docs

- [docs/local-first-architecture.md](./docs/local-first-architecture.md)
- [docs/logging-strategy.md](./docs/logging-strategy.md)
- [AGENTS.md](./AGENTS.md) and [docs/agents/](./docs/agents/) for project context, conventions and the planning workflow

<!-- testing-shell:start -->

## Testing Shell

The repository keeps its existing Vitest unit tests and adds executable, web-first Gherkin acceptance coverage plus manual QA routines. The acceptance path runs the documented behavior through Playwright-BDD and Playwright's Chromium project against an isolated Vite test server.

### Commands

Install project dependencies and Playwright's managed Chromium build:

```sh
just install
just acceptance-install
```

Run the existing unit shell:

```sh
just test
```

`just test` runs Vitest in workspace packages that expose a test script. No duplicate unit smoke test was added because the established web and shared suites already prove deterministic test discovery.

Generate and run the Gherkin acceptance shell:

```sh
just acceptance-test
```

This command runs `bddgen` and then Playwright in Chromium. The Vite server uses `127.0.0.1:4173` in test mode, and the step binding supplies an empty local plugin fixture so acceptance does not depend on live services or credentials.

QA routines are manual Markdown procedures under `qa/routines/`; testers follow them directly rather than invoking a QA command.

`@playwright/test` owns browser lifecycle, assertions, isolation, screenshots, and traces. `playwright-bdd` compiles `.feature` files into Playwright tests and binds their steps through `createBdd`. Both are development-only dependencies of `apps/web`.

<!-- testing-shell:end -->

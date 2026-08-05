# TimeTracker

TimeTracker is a local-first time-tracking workspace with a web app, an Electron desktop shell, shared domain logic, and an optional local API for connector-driven imports.

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

The optional local API lives in `apps/api` and defaults to `127.0.0.1:8787`. It supports connector configuration, sync, and local import review flows.

### Connector plugins

Connector implementations live in standalone repositories. They compile to
self-contained JavaScript and do not import API, desktop, web, or shared
application source at runtime.

Development desktop builds compile and watch these plugin directories. Set
`TIMETRACKER_DEV_PLUGIN_DIRS` to a platform-delimited list of other development
plugin directories when needed, or choose a directory from Settings → Debug in
the development desktop app. A selected directory must contain `plugin.json`
and its compiled manifest entrypoint. The Debug setting is persisted for future
development launches and is ignored by production builds. An explicit
`TIMETRACKER_DEV_PLUGIN_DIRS` value overrides the saved Debug setting for that
launch.

```sh
TIMETRACKER_DEV_PLUGIN_DIRS=/absolute/path/to/plugin just desktop-start
```

Production desktop installs use one local `.harday-connector` archive at a time
through Settings → Plugins. Archive installation is available only through the
desktop bridge and its native file chooser, not the loopback HTTP API. Official
connector implementations and their versioned builds are maintained in:

- [`les-cabochons/ajc-azure-devops`](https://github.com/les-cabochons/ajc-azure-devops)
- [`les-cabochons/ajc-jira`](https://github.com/les-cabochons/ajc-jira)

Each archive contains `plugin.json` and the compiled `dist/` tree. The manifest
declares the connector version, host API version, entrypoint, icon, and
connection fields. Production builds do not preinstall connector archives.
Uninstalling removes the managed archive contents and connector configuration
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
apps/api/        local API for connectors and import flows
connectors/      isolated connector plugin packages
packages/shared/ shared schemas, rules, and domain logic
docs/            architecture and logging notes
```

## Related Docs

- [docs/local-first-architecture.md](./docs/local-first-architecture.md)
- [docs/logging-strategy.md](./docs/logging-strategy.md)

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

This command runs `bddgen` and then Playwright in Chromium. The Vite server uses `127.0.0.1:4173` in test mode, and the step binding supplies an empty local connector fixture so acceptance does not depend on live services or credentials.

QA routines are manual Markdown procedures under `qa/routines/`; testers follow them directly rather than invoking a QA command.

### Added and modified paths

| Path | Change and ownership |
| --- | --- |
| `.gitignore` | Ignores Playwright-BDD's generated `.features-gen` specifications while keeping authored features and steps tracked. |
| `Justfile` | Adds `acceptance-install` for the managed Chromium prerequisite, `acceptance-test` as the public Gherkin command, and a private isolated Vite server recipe. |
| `apps/web/package.json` | Adds the `acceptance-test` script and the web-owned testing dependencies `@playwright/test` and `playwright-bdd`. |
| `pnpm-lock.yaml` | Locks `@playwright/test` 1.62.0, `playwright-bdd` 9.2.0, and their transitive testing dependencies. |
| `apps/web/vite.config.ts` | Extends Vitest's default exclusions with `.features-gen/` so generated Playwright specifications cannot enter the unit suite. |
| `apps/web/playwright.config.ts` | Configures feature/step discovery, generated tests, Chromium, diagnostics, retries, and the isolated web server. |
| `apps/web/tests/acceptance/features/local-workspace.feature` | Describes the user-visible local daily-workspace smoke behavior in Gherkin. |
| `apps/web/tests/acceptance/steps/local-workspace.steps.ts` | Binds the scenario to Playwright using accessible UI roles, clean browser state, and a controlled connector fixture. |
| `qa/routines/local-workspace-smoke.md` | Gives a human tester prerequisites, data, observable actions and results, cleanup, evidence, and pass/fail fields. |
| `docs/testing-shell-plan.md` | Records the non-overlapping layout, runner choices, commands, and verification plan. |
| `agents.md` | Preserves the repository's operational agent instructions and explains every context file under `agents/`. |
| `agents/architecture.md` | Records developer-maintained runtime, persistence, dependency, and privacy boundaries. |
| `agents/project-overview.md` | Records developer-maintained product scope, users, workflows, and local-first intent. |
| `agents/code-standards.md` | Records developer-maintained implementation and testing conventions. |
| `agents/library-docs.md` | Indexes canonical libraries and local module ownership. |
| `agents/writing-plan.md` | Provides the planning checklist and default verification path. |
| `agents/progress-tracker.md` | Records the implemented shell and actual verification results. |
| `agents/ui-tokens.md` | Documents semantic design tokens for this UI project. |
| `agents/ui-rules.md` | Defines the UI project's interaction, accessibility, layout, and visual rules. |
| `agents/ui-registry.md` | Catalogs reusable UI patterns and component ownership. |
| `README.md` | Provides this bounded, rerunnable testing-shell inventory and usage guide. |

`@playwright/test` owns browser lifecycle, assertions, isolation, screenshots, and traces. `playwright-bdd` compiles `.feature` files into Playwright tests and binds their steps through `createBdd`. Both are development-only dependencies of `apps/web`.

### Context files

All project context now lives under `agents/`, with `agents.md` at the repository root as its index. The files were moved without replacing their existing content:

- developers maintain `agents/architecture.md`, `agents/project-overview.md`, `agents/code-standards.md`, and `agents/library-docs.md`
- developers and coding agents maintain the active guidance in `agents/writing-plan.md` and status in `agents/progress-tracker.md`
- developers maintain `agents/ui-tokens.md` and `agents/ui-rules.md`; UI workflows maintain `agents/ui-registry.md`

No context file intentionally starts empty in this repository because all required files already existed with project-authored content. UI context files are included because TimeTracker ships React web and Electron interfaces.

### Verification status

- `just test`: passed, 29 files and 198 tests
- `just acceptance-test`: passed, 1 Chromium scenario
- `just typecheck`: passed across the workspace
- `just build`: passed across the workspace

The only remaining `TBD` is the owner field in `qa/routines/local-workspace-smoke.md`. The manual routine remains `Not run` until a tester records evidence and a result.
<!-- testing-shell:end -->

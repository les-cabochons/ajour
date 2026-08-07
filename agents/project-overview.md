# Project Overview

TimeTracker is a work-focused, local-first time tracker for daily timesheets, project/task tracking, backlog management, and connector-assisted imports.

## What Exists

- local workspace onboarding
- project and task management
- active timer start, stop, update, and save flows
- manual time entry creation and editing
- daily time page
- backlog management
- optional Azure DevOps and Jira connector support through local API/plugin surfaces
- optional provider-specific project import/export shapes, beginning with Workday-compatible records
- Electron desktop shell and packaging

## Primary Users

The product is aimed at people who need accurate workday time records without turning their machine activity into remote telemetry. The UI should optimize repeated daily use: fast entry, clear review, predictable editing, and low-friction correction.

## Core Principles

- Local-first is the default, not an implementation detail.
- User-confirmed time entries are more important than passive activity capture.
- Connector data is assistive. It should not silently overwrite local decisions.
- Settings and import review flows must make side effects explicit.
- The interface should be quiet, dense, and operational rather than promotional.

## Important Workflows

- Start a timer for a project/task, update it during the day, and save it.
- Add or edit a manual time entry with duration, project/task, and note.
- Review imported meeting or connector data before accepting it.
- Manage backlog items and project task estimates.
- Configure optional connectors without requiring them for the local workflow.

## Non-Goals

- Automatic upload of time-tracking data.
- Background activity surveillance.
- SaaS-first account or team synchronization as the baseline behavior.
- Marketing-style landing pages inside the application.

## Repo Map

```text
apps/web/        React + Vite product UI
apps/desktop/    Electron runtime and packaging
apps/api/        optional local API and connector plugin host
packages/shared/ shared domain logic and types
docs/            architecture and strategy docs
```

Installable connector implementations are maintained in standalone
repositories, including `les-cabochons/ajc-azure-devops` and
`les-cabochons/ajc-jira`.

Provider-specific project data shapes are also standalone. The Workday shape is
maintained in `les-cabochons/ajp-workday`; Ajour contains only the generic
shape contract, host, file adapters, and always-available default behavior.

## Command Surface

Use `just`:

```sh
just
just install
just start
just test
just typecheck
just build
```

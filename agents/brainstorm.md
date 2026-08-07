# Workday Plugin Brainstorm

Status: Implemented. The Workday implementation is standalone.

## Intent

Plan TimeTracker's first plugin that is not a connector: the Workday plugin.

The Workday plugin does not authenticate with, connect to, read from, or write to
Workday. It determines Workday-specific data shapes and transformations. The
initial implementation covers:

- project import
- project export

Timesheet submission remains future work.

The implementation is maintained in `les-cabochons/ajp-workday`; Ajour owns
only the generic contract and runtime surface.

## Existing Context

- TimeTracker is local-first. Canonical projects, tasks, timesheet entries, and
  submission state remain owned by the application.
- Project import/export uses an Ajour-owned Excel adapter around a format-neutral
  dataset contract. The built-in default shape always remains available. Shape
  plugins map canonical projects to and from those datasets, while deterministic
  web-domain transitions continue to own project and task merging.
- Timesheet import/export has a separate generic Excel workbook shape and a
  staged local review workflow.
- Timesheet submission currently performs no external operation. It marks
  selected local entries as submitted and clears that state if the submitted
  data later changes.
- The Plugins UI is generically named, but the only installable plugin contract
  is connector-specific: `.harday-connector` packaging, connection fields,
  configuration validation, synchronization operations, API-side storage, and
  worker execution.
- The Workday data-shaping plugin is not part of the connector contract. It is
  discovered and executed by a dedicated worker host through the versioned
  `projectDataShape` capability.

## Confirmed Language

- **Plugin:** An installable, activatable capability package that extends
  defined application workflows. A plugin does not inherently connect to an
  external system.
- **Connector:** One plugin category that owns authentication, transport, remote
  reads and writes, connections, and synchronization. Workday is not in this
  category.
- **Data shape:** The Workday-specific schema, validation, mapping, grouping,
  and formatting applied at a workflow boundary without owning TimeTracker's
  canonical local records.
- **Project import/export:** A selected data shape maps records entering or
  leaving the canonical project/task model. Ajour owns Excel and future CSV or
  JSON serialization, merge rules, and local persistence.
- **Timesheet submission:** Currently a local submission-state transition. The
  initial understanding is that the Workday plugin will shape selected entries
  into a Workday-compatible representation without authenticating or
  transmitting data to Workday.

## Current Boundary

1. Ajour canonical data → selected data shape → selected file format.
2. With no plugins, the Ajour default shape continues to import and export.
3. Plugins own format-neutral dataset definitions, mapping, validation, and
   normalization. They never receive or mutate the local store.
4. Ajour owns workbook parsing/writing, file interaction, plugin result
   validation, deterministic merging, and persistence.
5. Excel is the first file format. CSV and JSON can reuse the same dataset
   contract later without changing shape plugins.

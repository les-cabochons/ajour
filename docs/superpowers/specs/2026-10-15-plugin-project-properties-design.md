# Plugin project properties

- Status: Approved design, spec waiting for review
- Date: 2026-10-15
- Builds on: `2026-10-15-ajour-agent-runner-design.md` (PR #163)

## Why

The Workday agent matched projects by their Ajour display name, a short name such as "Internal", where Workday knows the project as "CA004 Tech & Design". The names and codes in an external tool do not always match Ajour's. A plugin needs a place to keep, per project, the name and code its tool uses, and the agent needs to read them.

## What the user sees

- A plugin can add properties to projects. Workday (agent) adds **Workday name** and **Workday code**.
- On a project's page, the properties card shows one section per plugin that adds properties, below Ajour's own rows. The plugin names the section, such as "Workday".
- A section starts collapsed. A click on its title opens it. Ajour does not remember it open: it is collapsed again on the next visit.
- Each row edits in place, like **Full name** and **Code**. An empty row shows its default in grey: Workday name defaults to the project's full name, Workday code to the project's code. Typing a value overrides the default. Clearing it brings the default back.
- The default is read live. Renaming the project in Ajour changes the Workday name too, until the user types one.
- Only active plugins show a section. Deactivating or uninstalling a plugin hides its section but keeps the values, so reinstalling brings them back.
- An archived project shows the sections read-only, like its other rows.

## Manifest

A new capability, `projectProperties`. It counts as a capability on its own, and a plugin may combine it with any other.

```json
"capabilities": {
  "projectProperties": {
    "section": "Workday",
    "fields": [
      { "id": "name", "label": "Workday name", "defaultFrom": "fullName" },
      { "id": "code", "label": "Workday code", "defaultFrom": "code" }
    ]
  }
}
```

| Key                    | Rules                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `section`              | The section title. 1 to 60 characters.                                |
| `fields`               | 1 to 10 fields.                                                       |
| `fields[].id`          | Lowercase letters, digits and `-`, up to 63 characters. Unique.       |
| `fields[].label`       | The row label. 1 to 60 characters.                                    |
| `fields[].defaultFrom` | Optional. `fullName` or `code`: the Ajour project value used as default. |

Fields are plain text, at most 240 characters. No other types until a plugin needs one.

## Storage

- `LocalProject` gets `pluginProperties?: Record<pluginId, Record<fieldId, string>>`.
- Only overrides are stored. Values are trimmed, and an empty value is removed, so "no value" always means "use the default".
- Values of plugins that are not installed stay as they are.
- They live in the local workspace with the rest of the project, so they go wherever the workspace goes, such as a workspace backup. The project Excel import and export ignore them.
- `normalizeProject` drops entries that are not strings and keeps the rest.

## Code

- `packages/shared/connectors.ts`: `projectPropertiesSchema` in the capabilities, `pluginHasProjectProperties`, and the refine message lists the new capability.
- `apps/web/src/domain/projects/plugin-properties.ts`, pure:
  - `resolvePluginProperties(project, capability)`: for each field, its stored value or its default, and whether it is the default.
  - `setPluginProperty(project, pluginId, fieldId, value)`: the next `pluginProperties`, with an empty value removed and an empty plugin record dropped.
- `project-transitions.ts`: the project patch accepts `pluginProperties`, so `updateProjectWithUndo` saves it with the same Undo toast, such as "Workday name changed".
- `features/projects/project-properties.tsx`: a `PluginPropertySection` for each active plugin with `projectProperties`, read from `getConnectorsOverview()`, with a disclosure button (`aria-expanded`) and the existing `InlineText` rows. The placeholder is the default, or "None" when the default is empty.
- `features/agents/agent-tool-runner.ts` and `domain/agents/agent-read-model.ts`: `get_submit_lines` gets the active plugins from `getConnectorsOverview()` and adds to each line with a project:
  - `projectFullName`, the project's full name;
  - `projectProperties`, keyed by plugin ID then field ID, with defaults resolved, for active plugins only. A field whose value and default are both empty is left out.
- `packages/shared/agent-tools.ts`: the output schema gets both keys.

Without the local API, as in the web build, the overview is unavailable: the card shows no plugin sections, and `get_submit_lines` sends `projectFullName` with no `projectProperties`.

## Workday (agent) plugin

- `plugin.json` declares the section above. Version 0.3.0. It needs an Ajour with this change. Older Ajour builds refuse the unknown capability at install, with the existing error.
- The prompt matches the Workday project by `projectProperties["workday-agent"].code`, then `.name`, then `projectFullName`. It never uses `projectName`, the display name.

## Docs

- Developers › Manifest: the `projectProperties` capability.
- Projects: the plugin sections in the properties card.
- Plugins › Workday (agent): set the Workday name and code when they differ from Ajour's.

## Testing

- Unit, `plugin-properties.test.ts`: the default comes from the full name or the code, an override wins, clearing an override brings the default back, and a value of another plugin is kept.
- Unit, shared schema: a manifest with only `projectProperties` is valid; a duplicate field ID and an unknown `defaultFrom` are refused.
- Unit, read model: `get_submit_lines` gives `projectFullName`, and resolved `projectProperties` only for the plugins passed in.
- Acceptance, `plugin-project-properties.feature`: with Workday (agent) installed, the project page shows a collapsed "Workday" section; opening it shows the full name and code as defaults; typing a Workday name saves it and Undo restores the default.

## Out of scope

- Properties on tasks. Workday task names already match Ajour's; add them when one does not.
- Field types other than text.
- Remembering which sections are open.
- Showing the properties in the projects list or the sidebar.

# Manifest

Every connector and code host plugin has a `plugin.json` file at its root. Ajour reads it when it installs or loads the plugin, and refuses the plugin if it does not match the schema below. Unknown keys are ignored.

For schema plugins, see [Schema API](/developers/schema-api#manifest).

## Example

```json
{
  "id": "jira",
  "version": "1.0.0",
  "apiVersion": 3,
  "displayName": "Jira",
  "description": "Sync Jira issues into backlog.",
  "iconSvg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\">…</svg>",
  "entrypoint": "dist/plugin.js",
  "capabilities": { "connector": { "settle": true } },
  "connectionFields": [
    {
      "id": "label",
      "label": "Connection label",
      "type": "text",
      "required": true
    },
    {
      "id": "tenantLabel",
      "label": "Workspace",
      "type": "text",
      "required": true
    },
    { "id": "baseUrl", "label": "Site URL", "type": "url", "required": true },
    {
      "id": "apiToken",
      "label": "API token",
      "type": "password",
      "required": true,
      "secret": true
    }
  ]
}
```

## Fields

| Field              | Type   | Rules                                                                                                                                                                              |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | string | Lowercase letters and digits, separated by single `.`, `_` or `-`. Up to 120 characters. Use the same ID as your [catalog entry](/developers/catalog-entry), which allows no dots. |
| `version`          | string | Semver: `1.2.3` or `1.2.3-beta.1`.                                                                                                                                                 |
| `apiVersion`       | number | Must be `3`, the current plugin API.                                                                                                                                               |
| `displayName`      | string | 1 to 120 characters.                                                                                                                                                               |
| `description`      | string | Optional. Up to 500 characters.                                                                                                                                                    |
| `iconSvg`          | string | Inline SVG markup, up to 20,000 characters.                                                                                                                                        |
| `entrypoint`       | string | Relative path to a `.js`, `.mjs` or `.cjs` file inside the package. No symlinks. Leave it out for a plugin with only `agentTask`.                                                  |
| `capabilities`     | object | At least one of `connector`, `codeHost`, `agentTask` and `projectProperties`. See below.                                                                                           |
| `connectionFields` | array  | 1 to 50 [connection fields](#connection-fields). Optional, and empty by default, for a plugin with only `agentTask`.                                                               |

The `id` is permanent. It names the install folder, and it is the `source` of every item your connector syncs. Changing it orphans the user's connections and items.

## Capabilities

```json
"capabilities": {
  "connector": { "settle": true },
  "codeHost": {}
}
```

| Capability          | Means                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connector`         | The plugin exports `syncConnection`. See [Connector API](/developers/connector-api).                                                                                        |
| `connector.settle`  | Optional. `true` if the plugin exports `listSettleStates` and `writeSettle`, and can write states and priorities. Without it, Ajour settles items locally and never writes. |
| `codeHost`          | The plugin exports `syncPullRequests`. See [Code host API](/developers/code-host-api).                                                                                      |
| `agentTask`         | The plugin declares tasks that a coding agent runs from a prompt. No plugin code runs. See [Agent tasks](#agent-tasks).                                                     |
| `projectProperties` | Text properties the plugin adds to every project. No plugin code runs. See [Project properties](#project-properties).                                                       |

Ajour only calls the functions your capabilities declare.

## Agent tasks

An agent task is a Markdown prompt that Ajour gives to the user's coding agent, Claude Code, Codex or OpenCode, with the Ajour MCP tools and a Chrome window. Ajour only reads the prompt file. A plugin that declares only `agentTask` runs no code and needs no `entrypoint`.

```json
"capabilities": {
  "agentTask": {
    "tasks": [
      {
        "id": "enter-week",
        "label": "Enter in Workday",
        "placement": "submit-week",
        "prompt": "prompts/enter-week.md",
        "estimateMinutes": 10,
        "weekLink": "{{settings.timesheetUrl}}",
        "settings": [
          { "id": "timesheetUrl", "label": "Workday timesheet URL", "type": "url", "required": true }
        ]
      }
    ]
  }
}
```

| Key               | Type   | Rules                                                                                                                         |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`              | string | Unique in the plugin.                                                                                                         |
| `label`           | string | The button label on the Submit page.                                                                                          |
| `placement`       | string | `submit-week`, the only value: a button on the Submit page for the week on screen.                                            |
| `prompt`          | string | Relative path to a Markdown file in the package. A regular file, no symlinks, at most 64 KB.                                  |
| `estimateMinutes` | number | How long a run usually takes. The agent panel uses it to tell a slow run from a stuck one.                                    |
| `weekLink`        | string | Optional. A URL template for **Open the week in…**. Shown only when it fills to an `https:` URL.                              |
| `settings`        | array  | Optional. Fields with the [connection field](#connection-fields) keys. The user fills them on the plugin's page, under Tasks. |

A plugin can declare up to 10 tasks.

### Slots

The prompt and `weekLink` can use these slots. A slot Ajour does not know fails the install.

::: v-pre

| Slot                | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| `{{weekOf}}`        | The ISO date of the week's Monday, such as `2026-10-12`.   |
| `{{sessionId}}`     | The agent session Ajour opened for the run.                |
| `{{settings.<id>}}` | The value of the task setting `<id>`, or empty when unset. |

:::

### What the agent gets

Ajour puts its own rules before your prompt. The agent must report in its session, ask the user only when it cannot go on, mark each change as committed once the external tool saved it, and never type a password or a code. Your prompt describes the steps in the external tool. The agent can use the [MCP tools](/app/agents#what-agents-can-do), including `get_week_changes`, which lists the week's added, updated and deleted entries, each with a stable `externalId`, and `mark_entries_committed`.

## Project properties

A plugin can add text fields to every project. A plugin that declares only `projectProperties` runs no code and needs no `entrypoint`.

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

| Key                    | Rules                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| `section`              | The section title. 1 to 60 characters.                                   |
| `fields`               | 1 to 10 fields.                                                          |
| `fields[].id`          | Lowercase letters, digits and `-`, up to 63 characters. Unique.          |
| `fields[].label`       | The row label. 1 to 60 characters.                                       |
| `fields[].defaultFrom` | Optional. `fullName` or `code`: the Ajour project value used as default. |

Fields are plain text, up to 240 characters.

Ajour shows the fields in a section of the project's properties card, titled `section`, collapsed until the user opens it. An empty value shows the default in grey: the project's full name for `fullName`, its code for `code`. Agents read the values in `get_week_changes`, under `projectProperties.<plugin id>.<field id>`, with defaults filled in.

## Connection fields

Ajour draws the connection form from `connectionFields`, in order. The values reach your plugin as `config`, keyed by `id`.

| Key                  | Type                        | Rules                                                        |
| -------------------- | --------------------------- | ------------------------------------------------------------ |
| `id`                 | string                      | 1 to 120 characters. Keep it unique: values are keyed by it. |
| `label`              | string                      | The form label. 1 to 120 characters.                         |
| `type`               | string                      | `text`, `password`, `url`, `select`, `number` or `checkbox`. |
| `placeholder`        | string                      | Optional. Up to 240 characters.                              |
| `helpText`           | string                      | Optional. Shown under the field. Up to 500 characters.       |
| `required`           | boolean                     | Defaults to `false`.                                         |
| `secret`             | boolean                     | Defaults to `false`. See below.                              |
| `defaultValue`       | string, number or boolean   | Optional.                                                    |
| `options`            | array of `{ value, label }` | For `select`. Up to 50.                                      |
| `min`, `max`, `step` | number                      | Optional, for `number`.                                      |

Values are strings, numbers or booleans. Strings are at most 4,000 characters.

### Secret fields

A field with `secret: true` is never sent back to the form after it is saved. The form shows dots instead. If the user edits the connection and leaves the field as it is, Ajour keeps the saved value.

::: warning Secrets are not encrypted
Ajour stores connection values, secrets included, in a JSON file that only the user can read. It does not encrypt them. Tell users which permissions your plugin needs, so they can give a token no more than that.
:::

### Reserved fields

Ajour handles four field IDs itself. Declare them so the form shows them, with your labels.

| ID                        | Type     | Meaning                                                         |
| ------------------------- | -------- | --------------------------------------------------------------- |
| `label`                   | text     | Required. The connection's name in Ajour.                       |
| `tenantLabel`             | text     | Required. The account, site or client, shown next to the label. |
| `autoSync`                | checkbox | Sync on a timer while Ajour is open. Defaults to `false`.       |
| `autoSyncIntervalMinutes` | number   | Minutes between automatic syncs, 1 to 1440. Defaults to 15.     |

Ajour removes these from `config` before it calls your plugin. They reach you as properties of the [connection](/developers/connector-api#connection) instead.

### Imported task icon

A connector can also declare a `taskIconDisplayMode` select field. Ajour reads it to decide which icon an imported item shows:

| Value      | Icon                                                           |
| ---------- | -------------------------------------------------------------- |
| `always`   | Always the plugin's icon. The default.                         |
| `fallback` | The item's project icon, or the plugin's icon with no project. |
| `never`    | The item's project icon, never the plugin's.                   |

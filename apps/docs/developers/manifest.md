# Manifest

Every plugin has a `plugin.json` file at its root. Ajour reads it when it installs or loads the plugin, and refuses the plugin if it does not match the schema below. Unknown keys are ignored.

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

| Field              | Type   | Rules                                                                                                                                                                                                                                                                              |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | string | Lowercase letters and digits, separated by single `.`, `_` or `-`. Up to 120 characters. Use the same ID as in your [plugin source](/developers/plugin-source), which allows no dots.                                                                                              |
| `version`          | string | Semver: `1.2.3` or `1.2.3-beta.1`.                                                                                                                                                                                                                                                 |
| `apiVersion`       | number | Must be `3`, the current plugin API.                                                                                                                                                                                                                                               |
| `displayName`      | string | 1 to 120 characters.                                                                                                                                                                                                                                                               |
| `description`      | string | Optional. Up to 500 characters.                                                                                                                                                                                                                                                    |
| `iconSvg`          | string | Inline SVG markup, up to 20,000 characters.                                                                                                                                                                                                                                        |
| `entrypoint`       | string | Relative path to a `.ts`, `.mts`, `.js`, `.mjs` or `.cjs` file inside the package. TypeScript runs as written: see [Plugin files](/developers/plugin-source#plugin-files). No symlinks. Leave it out for a plugin that runs no code, with only `agentTask` or `projectProperties`. |
| `capabilities`     | object | At least one of `connector`, `codeHost`, `calendar`, `team`, `agentTask` and `projectProperties`. See below.                                                                                                                                                                       |
| `connectionFields` | array  | 1 to 50 [connection fields](#connection-fields). Optional, and empty by default, for a plugin that runs no code.                                                                                                                                                                   |

The `id` is permanent. It names the install folder, and it is the `source` of every item your plugin syncs. Changing it orphans the user's connections and items.

## Capabilities

```json
"capabilities": {
  "connector": { "settle": true },
  "codeHost": {}
}
```

| Capability              | Means                                                                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connector`             | The backlog capability. The plugin exports `syncConnection`. See [Backlog API](/developers/backlog-api).                                                                                                                                                                                       |
| `connector.settle`      | Optional. `true` if the plugin exports `listSettleStates` and `writeSettle`, and can write states and priorities. Without it, Ajour settles items locally and never writes.                                                                                                                    |
| `connector.comments`    | Optional. The plugin lists and posts comments on its items, with the features it declares. See [Backlog API](/developers/backlog-api#listitemcomments).                                                                                                                                        |
| `connector.description` | Optional. `{ "write": true, "maxLength": 1000000 }`. The plugin's sync sends each item's full `description`, and with `write` it writes the user's edits back. `maxLength` is the source's limit, measured as the source measures it. See [Backlog API](/developers/backlog-api#descriptions). |
| `codeHost`              | The plugin exports `syncPullRequests`. See [Code host API](/developers/code-host-api).                                                                                                                                                                                                         |
| `calendar`              | The plugin exports `listCalendarEvents`. Read-only. See [Calendar API](/developers/calendar-api).                                                                                                                                                                                              |
| `team`                  | `{ "apiVersion": 1 }`. The plugin exports `createTeam` and `syncTeamProjects`, and keeps a team's shared projects in step. See [Team API](/developers/team-api).                                                                                                                               |
| `agentTask`             | The plugin declares tasks that a coding agent runs from a prompt. No plugin code runs. See [Agent tasks](#agent-tasks).                                                                                                                                                                        |
| `projectProperties`     | Text properties the plugin adds to every project. No plugin code runs. See [Project properties](#project-properties).                                                                                                                                                                          |

The backlog capability is declared under the `connector` key until plugin API 4.

Ajour only calls the functions your capabilities declare.

When a plugin declares more than one of `connector`, `codeHost`, `calendar` and `team`, the user turns each on and off separately, as **Backlog items**, **Pull requests**, **Calendar events** and **Projects**. A capability that an update adds starts off for users who had the plugin. Agent tasks and project properties follow the plugin's own switch.

## Agent tasks

An agent task is a Markdown prompt that Ajour gives to the user's coding agent, Claude Code, Codex or OpenCode, with the Ajour MCP tools and a Chrome window. Ajour only reads the prompt file. A plugin that declares only `agentTask` runs no code and needs no `entrypoint`.

A task can run once the user has turned on MCP, picked an installed agent in **Settings › Agents**, and filled the task's required settings. Until then, the button is disabled and says what is missing. One task runs at a time.

```json
"capabilities": {
  "agentTask": {
    "tasks": [
      {
        "id": "commit-week",
        "label": "Commit to Workday",
        "placement": "commit-week",
        "prompt": "prompts/commit-week.md",
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

| Key               | Type   | Rules                                                                                                                                                                                                            |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | string | Lowercase letters, digits and `-`, up to 63 characters, starting with a letter or digit. Keep it unique in the plugin.                                                                                           |
| `label`           | string | The button label on the Commit page. 1 to 60 characters.                                                                                                                                                         |
| `placement`       | string | `commit-week`: a button next to **Mark as committed** on the Commit page. `submit-week`: a button alongside **Submit week**, greyed out like it until every change is committed. Both act on the week on screen. |
| `prompt`          | string | Relative path to a Markdown file in the package. A regular file, no symlinks, at most 64 KB.                                                                                                                     |
| `estimateMinutes` | number | A whole number from 1 to 240: how long a run usually takes. The agent panel uses it to tell a slow run from a stuck one.                                                                                         |
| `weekLink`        | string | Optional. A URL template for **Open the week in…**, up to 500 characters. Shown only when it fills to an `https:` URL.                                                                                           |
| `settings`        | array  | Optional. Up to 20 fields with the [connection field](#connection-fields) keys. The user fills them on the plugin's page, under Tasks. Tasks share a setting by its `id`: declare it in each task that uses it.  |
| `tools`           | array  | Plugin API 4 only, and required there. The Ajour MCP data tools the task's run may use, such as `get_week_changes`. The run's agent sees only these and the session tools; Ajour refuses a call to any other.    |

A `submit-week` task looks the same, such as `"id": "submit-week"`, `"label": "Check Workday and submit"`, `"placement": "submit-week"`, `"prompt": "prompts/submit-week.md"`. Its prompt ends with the `submit_week` tool.

A plugin can declare up to 10 tasks.

The tasks of a plugin share their settings. A setting `id` holds one value for every task that declares it, and the plugin's page asks for it once, with the label, type and default of the first task that declares it. Each task still decides with `required` whether it needs the setting to run.

### Slots

The prompt and `weekLink` can use these slots. A slot Ajour does not know fails the install.

::: v-pre

| Slot                | Value                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| `{{weekOf}}`        | The ISO date of the week's Monday, such as `2026-10-12`.                |
| `{{sessionId}}`     | The agent session Ajour opened for the run. Empty in `weekLink`.        |
| `{{settings.<id>}}` | The value of the task setting `<id>`, its default, or empty when unset. |

:::

A setting marked `secret` can fill neither the prompt nor `weekLink`. The prompt goes to the agent, and the user opens the week link with a click, to a host the plugin chooses. Ajour refuses to run a task whose prompt uses a secret setting, and a `weekLink` that uses one is not shown: the Commit page says why in its place.

### What the agent gets

Ajour puts its own rules before your prompt. The agent must report in its session, ask the user only when it cannot go on, mark each change as committed once the external tool saved it, and never type a password or a code. Your prompt describes the steps in the external tool. The agent can use the [MCP tools](/app/agents#what-agents-can-do), including `get_week_changes`, which lists the week's added, updated and deleted entries, each with a stable `externalId` and a `version`, and `mark_entries_committed`, which takes each applied change's `entryId` and `version`. Ajour refuses the call when the user changed an entry since the agent read it. `get_week_status` gives a week's lock state, uncommitted change count, committed hours and pace, with a `version`. `submit_week` takes that `version` and locks the week, which a `submit-week` task calls as its last step. Ajour refuses it when the week changed since the agent read its status.

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

| Key                  | Type                        | Rules                                                                                                                                                                                         |
| -------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | string                      | 1 to 120 characters. Keep it unique: values are keyed by it.                                                                                                                                  |
| `label`              | string                      | The form label. 1 to 120 characters.                                                                                                                                                          |
| `type`               | string                      | `text`, `password`, `url`, `select`, `number` or `checkbox`.                                                                                                                                  |
| `placeholder`        | string                      | Optional. Up to 240 characters.                                                                                                                                                               |
| `helpText`           | string                      | Optional. Shown under the field. Up to 500 characters.                                                                                                                                        |
| `required`           | boolean                     | Defaults to `false`.                                                                                                                                                                          |
| `secret`             | boolean                     | Defaults to `false`. See below.                                                                                                                                                               |
| `defaultValue`       | string, number or boolean   | Optional.                                                                                                                                                                                     |
| `options`            | array of `{ value, label }` | For `select`. Up to 50.                                                                                                                                                                       |
| `min`, `max`, `step` | number                      | Optional, for `number`.                                                                                                                                                                       |
| `capability`         | string                      | Optional. `connector`, `codeHost`, `calendar` or `team`: the capability the field configures. The form hides the field, and skips its required check, while the user has that capability off. |

Values are strings, numbers or booleans. Strings are at most 4,000 characters. Without a `defaultValue`, a checkbox starts unchecked, a number at `min` or 0, and other fields empty.

### Secret fields

A field with `secret: true` is never sent back to the form after it is saved. The form shows dots instead. If the user edits the connection and leaves the field as it is, Ajour keeps the saved value.

::: warning Secrets are not encrypted
Ajour stores connection values, secrets included, in a JSON file that only the user can read. It does not encrypt them. Tell users which permissions your plugin needs, so they can give a token no more than that.
:::

### Reserved fields

Ajour handles these field IDs itself. Declare the ones that apply, so the form shows them with your labels.

| ID                        | Type     | Meaning                                                                                                                               |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `label`                   | text     | Required. The connection's name in Ajour.                                                                                             |
| `tenantLabel`             | text     | Required. The account, site or client, shown next to the label.                                                                       |
| `autoSync`                | checkbox | Sync backlog items on a timer while Ajour is open, straight into the backlog. Defaults to `false`.                                    |
| `autoSyncIntervalMinutes` | number   | Minutes between automatic syncs, 1 to 1440. Defaults to 15. A team syncs on it whenever **Projects** is on.                           |
| `pullRequestAutoSync`     | checkbox | Sync pull requests on the timer. Without this field, pull requests follow `autoSync`.                                                 |
| `agentAccess`             | select   | Do not declare it. Ajour adds **Agent access** to a plugin with comments or that writes descriptions, and drops a field with this ID. |
| `allowLossyConversion`    | checkbox | Do not declare it. Ajour adds **Allow lossy conversion** to a plugin that writes descriptions, and drops a field with this ID.        |

Ajour removes these from `config` before it calls your plugin, and from the `normalizedConfig` you return. The first four reach you as properties of the [connection](/developers/backlog-api#types) instead.

### Imported task icon

A backlog plugin can also declare a `taskIconDisplayMode` select field. Ajour reads it to decide which icon an imported item shows:

| Value      | Icon                                                           |
| ---------- | -------------------------------------------------------------- |
| `always`   | Always the plugin's icon. The default.                         |
| `fallback` | The item's project icon, or the plugin's icon with no project. |
| `never`    | The item's project icon, never the plugin's.                   |

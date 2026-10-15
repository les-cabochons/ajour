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
| `entrypoint`       | string | Relative path to a `.js`, `.mjs` or `.cjs` file inside the package. No symlinks.                                                                                                   |
| `capabilities`     | object | At least one of `connector` and `codeHost`. See below.                                                                                                                             |
| `connectionFields` | array  | 1 to 50 [connection fields](#connection-fields).                                                                                                                                   |

The `id` is permanent. It names the install folder, and it is the `source` of every item your connector syncs. Changing it orphans the user's connections and items.

## Capabilities

```json
"capabilities": {
  "connector": { "settle": true },
  "codeHost": {}
}
```

| Capability         | Means                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connector`        | The plugin exports `syncConnection`. See [Connector API](/developers/connector-api).                                                                                        |
| `connector.settle` | Optional. `true` if the plugin exports `listSettleStates` and `writeSettle`, and can write states and priorities. Without it, Ajour settles items locally and never writes. |
| `codeHost`         | The plugin exports `syncPullRequests`. See [Code host API](/developers/code-host-api).                                                                                      |

Ajour only calls the functions your capabilities declare.

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

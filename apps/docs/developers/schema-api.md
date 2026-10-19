# Schema API

A schema maps Ajour's projects and tasks to the columns of another tool's files, and back. Ajour owns the files: it reads and writes the Excel workbook. The schema only declares datasets and their columns, and converts between projects and rows. It never sees a file and never stores anything.

The schema API is version 1, separate from plugin API version 3.

::: warning Not installable yet
Ajour cannot install packaged schema plugins yet. It loads them only from the `plugins/` folder at the root of an Ajour checkout, in development. The [Workday](/plugins/workday) schema is the only one so far, and it is not released. Expect this page to change when installation lands.
:::

## Manifest

```json
{
  "id": "workday-project-data",
  "version": "1.0.0",
  "apiVersion": 1,
  "displayName": "Workday",
  "description": "Map projects and tasks to the Workday layout.",
  "iconSvg": "<svg …>…</svg>",
  "entrypoint": "dist/plugin.mjs",
  "capabilities": {
    "projectDataShape": {
      "apiVersion": 1,
      "datasets": [
        {
          "id": "projects",
          "displayName": "Projects",
          "columns": [
            {
              "key": "project",
              "header": "Project",
              "type": "string",
              "required": true
            },
            { "key": "task", "header": "Task", "type": "string" },
            { "key": "billable", "header": "Billable", "type": "string" },
            {
              "key": "budget_hours",
              "header": "Budget hours",
              "type": "number",
              "width": 14
            }
          ]
        }
      ]
    }
  }
}
```

- `id` follows the same rules as for other plugins. `default` is reserved for Ajour's built-in schema.
- `datasets`: 1 to 10. Each becomes a worksheet named after `displayName`.
- `columns`: 1 to 100 per dataset. `key` starts with a letter and holds letters, digits and `_`. `header` is the column title in the file. `type` is `string`, `number` or `boolean`. `width` is the column width in characters, 8 to 80.

## Functions

```ts
export async function exportProjects(projects: ExportProject[]): Promise<{
  datasets: { id: string; rows: Record<string, string | number | boolean>[] }[];
}>;

export async function importProjects(
  datasets: { id: string; rows: Record<string, string | number | boolean>[] }[],
): Promise<{ projects: ImportProject[] }>;
```

```ts
interface ExportProject {
  name: string;
  code?: string;
  color: string;
  status: "active" | "archived";
  tasks: {
    name: string;
    status: "active" | "archived";
    billable: boolean;
    /** Milliseconds. */
    budgetMs?: number;
    adjustmentMs?: number;
  }[];
}

/** Like ExportProject, with fewer required fields: files often leave them out. */
interface ImportProject {
  name: string;
  code?: string;
  color?: string;
  status: "active" | "archived";
  tasks: {
    name: string;
    status?: "active" | "archived";
    billable?: boolean;
    budgetMs?: number;
    adjustmentMs?: number;
  }[];
}
```

Ajour checks your datasets against the manifest:

- On export, every declared dataset must be present, with no unknown dataset or column. Required columns must have a value, and every value must have the declared type.
- On import, unknown datasets and columns are refused. Types are not checked, since files hold anything. Convert and validate values yourself, and throw a message with the row number, such as `Row 4 is invalid. A project name is required.`

Each dataset holds at most 100,000 rows.

## Example

The Workday schema writes one row per task, turns `billable` into `billable` or `non_billable`, and converts milliseconds to hours rounded to four decimals. On import, it accepts `yes` and `no` for billable and a decimal comma in hours, and skips blank rows.

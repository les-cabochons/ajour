# Schema API

A schema maps another tool's files to Ajour's projects and tasks, and can map them back. Ajour owns the files: it reads and writes the Excel workbook. On import, the schema gets every worksheet as rows of cells and returns projects. On export, it gets projects and returns rows for the datasets it declares. It never sees a file and never stores anything.

The schema API is version 1, separate from plugin API version 3.

::: warning Not installable yet
Ajour cannot install packaged schema plugins yet. It loads them only from the `plugins/` folder at the root of an Ajour checkout, in development. The [Workday](/plugins/workday) schema is the only one so far, and it is not released. Expect this page to change when installation lands.
:::

## Manifest

```json
{
  "id": "acme-projects",
  "version": "1.0.0",
  "apiVersion": 1,
  "displayName": "Acme",
  "description": "Map projects and tasks to the Acme layout.",
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
- `datasets` is the export layout, and is optional. Leave it out and the schema only imports: Settings offers no export with it, and you don't write `exportProjects`. With it, 1 to 10 datasets. Each becomes a worksheet named after `displayName`. Its `id` starts with a letter and holds letters, digits, `_` and `-`, unique in the schema.
- `columns`: 1 to 100 per dataset. `key` starts with a letter and holds letters, digits and `_`, unique in the dataset. `header` is the column title in the file. `type` is `string`, `number` or `boolean`. `required` defaults to `false`. `width` is the column width in characters, 8 to 80.

## Functions

```ts
export async function exportProjects(projects: ExportProject[]): Promise<{
  datasets: {
    id: string;
    rows: Record<string, string | number | boolean | null>[];
  }[];
}>;

export async function importProjects(
  sheets: {
    /** The worksheet's name, such as `Récapitulatif`. */
    name: string;
    /** Row 1 of the worksheet is `rows[0]`. Each row runs from column A to its last value. */
    rows: (string | number | boolean | null)[][];
  }[],
): Promise<{ projects: ImportProject[] }>;
```

`importProjects` gets every worksheet of the file, in order. A cell is text, a number, a boolean or `null` when empty. A date is ISO 8601 text, such as `2026-06-01T00:00:00.000Z`. A formula is its last calculated result, and an Excel error its code, such as `#N/A`.

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
    /** Whole milliseconds. */
    budgetMs?: number;
    /** Whole milliseconds, can be negative. */
    adjustmentMs?: number;
  }[];
}

/** Like ExportProject, with fewer required fields: files often leave them out. */
interface ImportProject {
  /**
   * Leave it out when the file doesn't name its project, such as a project
   * plan. Ajour then takes the file only from Import tasks… on a project.
   */
  name?: string;
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

On export, Ajour checks your datasets against the manifest. Every declared dataset must be present once, with no unknown dataset or column. Required columns must have a value, and every value must have the declared type. An empty string or `null` counts as no value.

On import, Ajour checks nothing in the sheets but their size. Find the worksheets and rows you need, convert and validate the values yourself, and throw a message the user can act on, with the worksheet and row, such as `Row 4 is invalid. A project name is required.`

Ajour merges the projects you return by name, and the tasks of a project by name. A task field you leave out keeps the value Ajour has.

## Import tasks

Import tasks… on a project's page uses the schema picked in Settings › Projects, when it is a plugin. Ajour calls the same `importProjects`. It expects one project and adds or updates its tasks in the open project. When that project has a `name` that isn't the open project's, Ajour refuses the file.

## Limits

An imported file holds at most 100 worksheets, 100,000 rows per worksheet and 1,000 cells per row. Each exported dataset holds at most 100,000 rows. Ajour exports at most 10,000 projects, each with at most 10,000 tasks.

## Example

The Workday schema only imports. From Workday's project export, it reads the project's name and ID in the `Récapitulatif` worksheet and its tasks in `Ressources des tâches`. From Workday's project plan export, which names no project, it returns one project without a name, for Import tasks….

# Workday

::: info Coming soon
The Workday plugin is not available yet. The catalog lists it as **Coming soon**.
:::

The Workday plugin is a schema. It maps your projects and tasks to the column layout Workday imports and exports, so you can move your project list between Ajour and Workday as an Excel file.

It does not connect to Workday. It never signs in to Workday, reads from it or writes to it. Ajour reads and writes the file. The plugin only decides which columns the file has and how each project and task becomes a row.

## How it maps projects

The file has one row per task, or one row for a project with no tasks.

| Column             | Contents                        |
| ------------------ | ------------------------------- |
| `project`          | The project's full name         |
| `code`             | The project code                |
| `color`            | The project color               |
| `status`           | `active` or `archived`          |
| `task`             | The task's name                 |
| `task_status`      | `active` or `archived`          |
| `billable`         | `billable` or `non_billable`    |
| `budget_hours`     | The task's budget, in hours     |
| `adjustment_hours` | The task's adjustment, in hours |

On import, the plugin also accepts `true`, `yes`, `false` and `no` for billable, and a decimal comma in hours. It skips blank rows, and tells you the row number of a row it cannot read.

## Use it

Once installed, pick **Workday** under **Schema** in **Settings › Projects**, then export or import. See [Import and export](/projects/import-export).

## And the timesheet?

To report your hours in Workday, use [Commit your week](/time/commit). It lists your changes and prepares lines with the project, task, hours and comments that you copy into Workday. To have an agent enter them for you, see [Workday (agent)](/plugins/workday-agent).

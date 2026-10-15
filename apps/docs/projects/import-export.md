# Import and export projects

Ajour exports your projects and tasks to an Excel file, and imports them back. Use it to set up a workspace from your company's project list, or to move projects to another machine.

<Shot name="settings-projects" alt="Settings › Projects with the schema, export and import" />

Open **Settings › Projects**, or choose **Import and export…** in the **…** menu of the Projects page.

## Schema

A schema decides which columns the file has and how each project and task becomes a row. **Ajour default** works without any plugin. Its sheet has these columns:

| Column             | Contents                     |
| ------------------ | ---------------------------- |
| `project`          | The project's full name      |
| `code`             | The project code             |
| `color`            | The project color            |
| `status`           | `active` or `archived`       |
| `task`             | The task's name              |
| `task_status`      | `active` or `archived`       |
| `billable`         | Whether the task is billable |
| `budget_hours`     | The task's budget            |
| `adjustment_hours` | The task's adjustment        |

A schema plugin, such as [Workday](/plugins/workday), can map the same data to another tool's layout. Pick it under **Schema** once it is installed.

## Export

Select the projects to export, then press **Export to Excel**. Ajour saves a file named `projects-YYYY-MM-DD.xlsx`, with one row per task.

## Import

Under **Import projects**, choose a `.xlsx` file with a `Projects` sheet and press **Import workbook**. Ajour merges projects by name, so a project that already exists is updated instead of copied.

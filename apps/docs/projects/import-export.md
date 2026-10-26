# Import and export projects

Ajour exports your projects and tasks to an Excel file, and imports them back. Use it to set up a workspace from your company's project list, or to move projects to another machine.

<Shot name="settings-projects" alt="Settings › Projects with the schema, export and import" />

Open **Settings › Projects**, or choose **Import and export…** in the **…** menu of the Projects page. In the narrow view, press **Import and export** above the Projects list.

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

A schema plugin, such as [Workday](/plugins/workday), reads another tool's files. Pick it under **Schema** once it is installed. A schema that only imports, like Workday, has no export: the **Export projects** section says so.

## Export

Select the projects to export, or press **Select all**, then press **Export to Excel**. Ajour saves a file named `projects-YYYY-MM-DD.xlsx`, with one row per task. A project without tasks gets one row of its own, so you can import it again.

## Import

Under **Import projects**, choose a `.xlsx` file and press **Import workbook**. With **Ajour default**, the file needs a `Projects` sheet. Ajour merges projects by name, so a project that already exists is updated instead of copied, and its missing tasks are added.

Some files don't say which project they are for, such as Workday's project plan. Ajour refuses them here: open the project and use [Import tasks…](/projects/tasks#import-tasks-from-excel) instead.

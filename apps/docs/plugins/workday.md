# Workday

::: info Coming soon
The Workday plugin is not available yet. The catalog lists it under **Schemas** as **Coming soon**.
:::

The Workday plugin is a schema. It reads the Excel files Workday exports for a project, so you can create the project and its tasks in Ajour from them. It only imports: to export projects, pick **Ajour default**.

It does not connect to Workday. It never signs in to Workday, reads from it or writes to it. Ajour reads the file. The plugin only finds the project and its tasks in it.

It reads Workday in French.

## Import a project

In Workday, open the project and export it to Excel. The file is named after the project, such as `114599_Peoples_Group_-_Support_&_Maintenance_[Q-08315].xlsx`, and has a **Récapitulatif** sheet.

In **Settings › Projects**, pick **Workday** under **Schema**, choose the file under **Import projects** and press **Import workbook**. Ajour creates the project, or merges it into the project of the same name:

| Ajour             | Workday                                                   |
| ----------------- | --------------------------------------------------------- |
| Full name         | **Nom du projet**, without the ID                         |
| Code              | **Identifiant du projet**                                 |
| Archived          | **Inactif** is **Oui**                                    |
| One task per line | **Ressources des tâches**, the **Tâche de projet** column |

A task named **Regular**, Workday's task with no name of its own, takes its phase's name, such as **Soutien et optimisation**. Two tasks with the same name in different phases become one task.

Import the file again to add the project's new tasks. Tasks you added in Ajour stay.

## Import a project plan

The project plan export, `View_Project_Planner_Composite_View.xlsx`, also says which tasks are closed or not billable, but not which project it is for. Open the project in Ajour and choose **Import tasks…** in its properties, with **Workday** picked under **Schema** in **Settings › Projects**. Ajour adds the new tasks and updates the others:

| Ajour        | Workday                                                                |
| ------------ | ---------------------------------------------------------------------- |
| Task name    | **Nom personnalisé de la tâche**, or the phase's name when it is empty |
| Archived     | **Fermé** is **Oui**                                                   |
| Not billable | **Non facturable** is **Oui**                                          |
| Budget       | **Heures estimatives**, when above 0                                   |

A task closed in Workday is archived in Ajour. A task you archived in Ajour stays archived, even when Workday has it open. When two tasks share a name, the open one wins.

## And the timesheet?

To report your hours in Workday, use [Commit your week](/time/commit). It lists your changes and prepares lines with the project, task, hours and comments that you copy into Workday. To have an agent enter them for you, see [Workday (agent)](/plugins/workday-agent).

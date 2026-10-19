# Jira

The Jira plugin syncs your Jira issues into Ajour's backlog. It writes estimate changes back, and when you settle an issue, its new status and priority.

## Set up

1. [Install the plugin](/plugins/#install-a-plugin) from **Settings › Plugins**, and turn it on.
2. Create an Atlassian API token at [id.atlassian.com › Security › API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
3. In Ajour, open the plugin and press **Add a connection**. Fill in the fields below, and press **Add connection**.
4. Press **Sync**. The issues wait in [Sync review](/plugins/sync-review). Pick the ones you want and press **Sync selected to backlog**.

## Connection fields

| Field                            | What to enter                                                                |
| -------------------------------- | ---------------------------------------------------------------------------- |
| **Connection label**             | A name for this connection, such as `Product backlog`.                       |
| **Workspace**                    | The site or client, such as `Acme Jira`.                                     |
| **Site URL**                     | `https://your-domain.atlassian.net`.                                         |
| **Email**                        | The email of your Atlassian account.                                         |
| **API token**                    | The token from step 2. Ajour never shows it again.                           |
| **Project key**                  | Optional. Sync one project only, such as `ENG`.                              |
| **Import scope**                 | **Assigned to me** (default), or **Open issues**.                            |
| **Imported task icon**           | Whether imported issues show the Jira icon, or their project's icon.         |
| **Original estimate field**      | The field name or ID of the original estimate.                               |
| **Remaining field**              | The field name or ID of the remaining estimate.                              |
| **Completed field**              | The field name or ID of the time spent.                                      |
| **Auto sync to backlog**         | Sync on a timer while Ajour is open, and add issues straight to the backlog. |
| **Auto sync interval (minutes)** | How often to sync, from 1 to 1440. Defaults to 15.                           |

## What it syncs

The plugin fetches issues that are not done, most recently updated first, up to 200. With **Assigned to me**, only issues assigned to you. Subtasks become subitems of their parent. Descriptions are converted to Markdown, and stop at 4,000 characters.

Comments stay in Jira. The item page shows none for a Jira issue.

When an issue Ajour tracks reaches the **Done** status category, Ajour archives it.

## Priorities

Jira priorities map to Ajour's levels by name:

| Jira        | Ajour  |
| ----------- | ------ |
| Highest     | Urgent |
| High        | High   |
| Medium      | Medium |
| Low, Lowest | Low    |

When Ajour writes a level, it sends Highest, High, Medium or Low. Custom priority names map to no priority.

## What it writes

- **Estimates**: when you change an estimate in Ajour, the next sync writes it to the field you mapped. Conflicts wait in [Sync review](/plugins/sync-review).
- **Status and priority**: when you settle an issue, Ajour sets the priority first, then moves the issue with the Jira transition that leads to the status you picked. The settle dialog lists the current status and the statuses the issue's transitions can reach. Both writes go after the Undo toast closes.

If no transition leads to the status, the write fails with a message such as `Jira has no transition from "In Progress" to "Done" for ENG-12.`

## Source

[les-cabochons/ajc-jira](https://github.com/les-cabochons/ajc-jira) on GitHub, MIT license.

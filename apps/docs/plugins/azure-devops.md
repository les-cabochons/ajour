# Azure DevOps

The Azure DevOps plugin syncs your work items into Ajour's backlog, with their comments. It writes estimate changes back, and when you settle an item, its new state and priority. It also brings in your pull requests. See [Pull requests](#pull-requests).

<Shot name="settings-plugin-azure-devops" alt="The Azure DevOps plugin page" />

## Set up

1. [Install the plugin](/plugins/#install-a-plugin) from **Settings › Plugins**, and turn it on.
2. In Azure DevOps, create a personal access token. Open **User settings › Personal access tokens › New Token**, and give it the **Work Items** scope:
   - **Read** to sync items and read their comments.
   - **Read & write** to also write estimates, states and priorities, and to post, edit and delete comments and react to them.
   - To mention anyone in the organization, add **Identity › Read**. Without it, mentions suggest only the people on the item.
   - For pull requests, add **Code › Read**, and **Project and Team › Read** for team review requests.
3. In Ajour, open the plugin and press **Add a connection**. Fill in the fields below, and press **Add connection**.
4. Press **Sync**. The items wait in [Sync review](/plugins/sync-review). Pick the ones you want and press **Sync selected to backlog**.

::: tip
Set an expiry date on the token. When it expires, the connection shows an error, and you paste a new token with **Edit**.
:::

## Connection fields

| Field                                            | What to enter                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Connection label**                             | A name for this connection, such as `Contoso`.                                                                                         |
| **Tenant**                                       | The organization or client, shown next to the label.                                                                                   |
| **Organization URL**                             | `https://dev.azure.com/your-org`.                                                                                                      |
| **Personal Access Token**                        | The token from step 2. Ajour never shows it again.                                                                                     |
| **Import scope**                                 | **Assigned to me** (default), or **Open tasks across organization**.                                                                   |
| **Imported task icon**                           | Whether imported items show the Azure DevOps icon, or their project's icon.                                                            |
| **Priority field**                               | The field that holds priority, such as `Microsoft.VSTS.Common.Priority`. Required to write priorities.                                 |
| **Urgent / High / Medium / Low priority values** | Which values of the priority field mean each level. See below.                                                                         |
| **Original estimate field**                      | The field for the original estimate, such as `Microsoft.VSTS.Scheduling.OriginalEstimate`.                                             |
| **Remaining field**                              | The field for remaining work, such as `Microsoft.VSTS.Scheduling.RemainingWork`.                                                       |
| **Completed field**                              | The field for completed work, such as `Microsoft.VSTS.Scheduling.CompletedWork`.                                                       |
| **Auto sync to backlog**                         | Sync on a timer while Ajour is open, and add items straight to the backlog.                                                            |
| **Sync pull requests automatically**             | Pull requests only. Sync them on the interval while Ajour is open. On by default.                                                      |
| **Only these projects or repositories**          | Pull requests only. Optional, comma-separated. `Fabrikam` is a project, `Fabrikam/api` a repository.                                   |
| **Never these projects or repositories**         | Pull requests only. Optional, same format.                                                                                             |
| **Hide draft pull requests**                     | Pull requests only. Off by default.                                                                                                    |
| **Include team review requests**                 | Pull requests only. On by default. Needs **Project and Team › Read**.                                                                  |
| **Sync interval (minutes)**                      | How often to sync, from 1 to 1440. Defaults to 15.                                                                                     |
| **Agent access to comments**                     | Ajour's own. What agents may do with the comments of this connection's items. See [Agents and MCP](/app/agents#comments).              |
| **Allow lossy conversion**                       | Ajour's own. Off by default. Lets you edit descriptions with formatting Markdown cannot hold; each save names the loss and asks first. |

Leave an estimate field empty to never sync that estimate.

## What it syncs

The plugin reads the 200 most recently changed work items of these types, and keeps the open ones: Task, Product Backlog Item, User Story, Requirement, Issue and Bug. With **Assigned to me**, only items assigned to you.

Each item brings its title, type, state, priority, estimates and description. A description stored as Markdown in Azure DevOps arrives as written, so it can start with [frontmatter](/backlog/items#frontmatter). An HTML description is converted to Markdown. Descriptions stop at 4,000 characters. Parents of your items come along, so subitems keep their context.

When an item reaches a done category in Azure DevOps, **Completed** or **Removed**, Ajour archives it, even if it no longer matches the query. **Resolved** counts as open.

## Comments

A synced work item shows its Azure DevOps comments on its page. You can post comments in Markdown, edit and delete your own, react, and mention people with **@**. See [Comments](/backlog/comments).

- The people picker suggests the people on the item first: who it is assigned to, who created and last changed it, and who wrote its newest 100 comments. With **Identity › Read**, it also searches the organization's users.
- A mention notifies the person in Azure DevOps.
- When someone else comments on an item you settled, the next sync brings it back to your plate. With many settled items, it can take a few syncs.

Ajour reads comments from Azure DevOps when you open the item, keeps them in memory for five minutes, and never stores their text.

## Priorities

Ajour has four priority levels. Each level's field holds the values of the Azure DevOps priority field that mean that level:

- A whole number, such as `1`.
- A range, such as `1-25`.
- Nothing, to leave the level unused. Ajour then cannot write that level.

The defaults are `1`, `2`, `3` and `4`, the values of the standard priority field. For a custom field that runs from 1 to 100, you could use `1-25`, `26-50`, `51-75` and `76-100`.

An item whose value is in no range, or has no priority, gets no priority in Ajour. When Ajour writes a level, it sends the lowest value of the level's range. Ajour refuses ranges that overlap.

## What it writes

- **Estimates**: when you change an estimate in Ajour, the next sync writes it to the field you mapped. If the estimate also changed in Azure DevOps, Ajour asks you which to keep in [Sync review](/plugins/sync-review).
- **State and priority**: when you settle an item, Ajour writes the state and priority in one update. When you move an item to another workflow state, it writes the state only. Both writes go after the Undo toast closes. See [Settle and snooze](/backlog/settle-and-snooze).
- **Comments**: a comment you post or edit goes at once. A delete goes when its Undo toast closes.

Work item URLs must belong to the organization of the connection. The plugin refuses to write elsewhere.

## Pull requests

Pull requests sync on the connection's interval while **Sync pull requests automatically** is on, and when you press **Sync** on the Pull requests page. The plugin lists active pull requests across the organization that you created, or where you or one of your teams is a reviewer. See [Pull requests](/pull-requests/).

- A reviewer who has not voted yet is asked to review. An approval, with or without suggestions, is an approval. **Waiting for author** and **Rejected** ask for changes.
- Ajour counts comments and `@` mentions of you, but does not store their text.
- Checks come from the branch's build and status policies.
- Teams count only when they are Azure DevOps teams, not other security groups.

Turn off **Backlog items** under **Capabilities** on the plugin's page to use only pull requests. The work item fields then hide, and the token needs no work item access.

If you had the plugin before it brought pull requests, the update added them turned off. Turn on **Pull requests** under **Capabilities**, then edit your connection so Ajour checks that the token can read code.

## Source

[les-cabochons/ajc-azure-devops](https://github.com/les-cabochons/ajc-azure-devops) on GitHub, MIT license.

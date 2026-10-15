# Settings

Press <kbd>⌘</kbd> <kbd>,</kbd> or **Settings** at the bottom of the sidebar. **Back to app** returns to the page you were on.

<Shot name="settings-general" alt="Settings › General" />

Settings has three groups: **App**, **Work** and **Data**.

## General

| Setting                         | What it does                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Theme**                       | **System** (default), **Light** or **Dark**.                                                                                                           |
| **Changes end a snooze early**  | Brings back snoozed pull requests when someone asks you to act, and snoozed backlog items when their source state or priority changes. Off by default. |
| **Density**                     | **Comfortable** or **Compact** sidebar rows.                                                                                                           |
| **Time capacity**               | The hours you plan to work each weekday. Defaults to 8 hours Monday to Friday.                                                                         |
| **Hide non-working days**       | Hides days with 0 hours of capacity, such as weekends, from the day strip and the Week view. Time logged on them still counts. Off by default.         |
| **Over-capacity warning**       | Flags days and weeks over capacity. On by default.                                                                                                     |
| **Under-target submit warning** | Asks before you submit a week under its target. On by default.                                                                                         |
| **Update track**                | **Stable** or **Nightly**. See [Install Ajour](/start/install#updates).                                                                                |

## Plugins

Install, activate and connect plugins. See [Plugins](/plugins/).

## MCP

Let AI agents such as Claude Code or Codex use your Ajour data. See [Agents and MCP](/app/agents).

## Backlog

- **Subitems**: when you close a parent with open subitems, **Ask** (default), **Include them** or **Leave them**.
- **Settle rules**: per source project, ask with the settle dialog or apply a fixed state and priority. See [Settle and snooze](/backlog/settle-and-snooze#settle-rules).

## Workflow

Your workflow states, and how source states map to them. See [Workflow states](/backlog/workflow).

## Projects

Import and export projects and tasks. See [Import and export](/projects/import-export).

## Time entries

<Shot name="settings-time-entries" alt="Settings › Time entries with export and import" />

- **Export time entries**: pick a date range and press **Export to Excel**. The file has the date, project, task, note and hours of each entry.
- **Import time entries**: choose a `.xlsx` file with a `Time entries` sheet and press **Review import**. Each row shows **Ready to add** or **Potential conflict**. Press **Add** or **Dismiss** per row, or **Add all ready**.

## Sync review

Items and estimate changes from connectors that wait for your decision. See [Sync review](/plugins/sync-review).

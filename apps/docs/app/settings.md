# Settings

Press <kbd>⌘</kbd> <kbd>,</kbd> or **Settings** at the bottom left of the sidebar. **Back to app** returns to the page you were on.

<Shot name="settings-general" alt="Settings › General" />

Settings has three groups: **App**, **Work** and **Data**.

## General

| Setting                         | What it does                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Theme**                       | **System** (default), **Light** or **Dark**.                                                                                                                                    |
| **Changes end a snooze early**  | Brings back snoozed pull requests when someone asks you to act, and snoozed backlog items when their source state or priority changes. Off by default.                          |
| **Density**                     | **Comfortable** or **Compact** sidebar rows.                                                                                                                                    |
| **Time capacity**               | The hours you plan to work each weekday. Defaults to 8 hours Monday to Friday.                                                                                                  |
| **Over-capacity warning**       | Flags days more than 50% over their capacity, such as a 13-hour day against 8 hours, and weeks over theirs. On by default.                                                      |
| **Hide non-working days**       | Hides days with 0 hours of capacity, such as weekends, from the day strip and the Week view. Time logged on them still counts. Off by default.                                  |
| **Under-target submit warning** | Asks before **Submit week** locks a week behind its targets. On by default.                                                                                                     |
| **Pace tolerance**              | How far, in percent, a week may be ahead of or behind its targets before **Submit week** or an agent asks you. 20 by default. Going over the week's target always asks.         |
| **Update track**                | **Stable** or **Nightly**. **Check again** checks now, and **Update and restart** or **View release** shows when a version is available. See [Updates](/start/install#updates). |

## Plugins

Install, activate and connect plugins. See [Plugins](/plugins/).

## MCP

Let AI agents such as Claude Code or Codex use your Ajour data. See [Agents and MCP](/app/agents).

## Agents

Pick the coding agent, the browser and the model Ajour uses for plugin tasks, such as entering your week in Workday. See [Agent tasks](/app/agents#agent-tasks).

## Backlog

- **Subitems**: when you close a parent with open subitems, **Ask** (default), **Include them** or **Leave them**.
- **Settle rules**: per source project, ask with the settle dialog or apply a fixed state and priority. See [Settle and snooze](/backlog/settle-and-snooze#settle-rules).
- **Descriptions**: **Ask before opening description links**, on by default. See [Description](/backlog/items#description).

## Workflow

Your workflow states, and how source states map to them. See [Workflow states](/backlog/workflow).

## Projects

Import and export projects and tasks. See [Import and export](/projects/import-export).

## Calendar

**Calendar** shows while a calendar plugin, such as [Calendar address (ICS)](/plugins/ics), is on and has a connection. It sets which events the Time page suggests as entries. See [Calendar suggestions](/time/calendar-suggestions).

<Shot name="settings-calendar" alt="Settings › Calendar with the suggestion filters and a remembered meeting" />

| Setting                                 | What it does                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Hide all-day events**                 | Leaves out holidays, trips and other events without a time. On by default.                       |
| **Hide meetings you declined**          | On by default. Needs your email on the calendar connection, or a calendar that lists your reply. |
| **Hide events marked free**             | Leaves out reminders and other events that do not block your time. On by default.                |
| **Hide meetings you have not answered** | Leaves out invitations you have not accepted, declined or marked tentative. Off by default.      |
| **Hide events shorter than**            | In minutes. 0, the default, shows every length.                                                  |
| **Refresh every**                       | How often Ajour reads your calendar while its window shows, in minutes. 10 by default.           |

**Remembered meetings** lists the recurring meetings Ajour fills in for you, and the ones you hid. Press **Remove** to choose again next time.

## Time entries

<Shot name="settings-time-entries" alt="Settings › Time entries with export and import" />

- **Export time entries**: pick a date range and press **Export to Excel**. The file has the date, project, task, note and hours of each entry.
- **Import time entries**: choose a `.xlsx` file with a `Time entries` sheet and press **Review import**. Each row shows **Ready to add** or **Potential conflict**. Press **Add** or **Dismiss** per row, or **Add all ready** or **Dismiss all**.

## Sync review

Items and estimate changes from backlog plugins that wait for your decision. See [Sync review](/plugins/sync-review).

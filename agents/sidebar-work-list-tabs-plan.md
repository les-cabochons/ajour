# Sidebar work list tabs

Requested after issue #78. Replace the stacked pull request and backlog sidebar
lists with Backlog and Pull requests tabs in the same area under navigation.

- Use the existing Tabs control and keep the current list components as panels.
- Show only one list at a time. Keep Up next, Snoozed and Settled in Backlog.
- Opening either feature selects its matching sidebar tab. Manual tab selection
  changes the sidebar only and lasts while the shell is mounted.
- Hide the tab control when no code host is enabled and show the backlog list.
- Keep the current page navigation, rail and narrow view behavior.
- Verify tab clicks, keyboard switching, local actions, plugin deactivation and
  compact sidebar width in Chromium. Check types, unit tests and formatting.
- Update PR #105 and the installed local preview build, preserving its runtime
  fix and backing up the installed app and user data before replacement.

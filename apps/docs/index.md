---
aside: false
editLink: false
lastUpdated: false
prev: false
next: false
---

<div class="ajour-home">

# Ajour docs

Ajour is a time tracker for people who fill a timesheet every week. It keeps your entries, projects and backlog on your machine, and it can pull your work items and pull requests from Azure DevOps, Jira and GitHub.

<Shot name="time-day" alt="The Day view with a running entry, today's entries and the sidebar" />

## Start here

<DocLinks :items="[
  { icon: 'download', title: 'Install Ajour', text: 'Download the desktop app for macOS or Windows.', link: '/start/install' },
  { icon: 'timer', title: 'Start guide', text: 'Track your first day, from the first entry to a committed week.', link: '/start/' },
  { icon: 'lightbulb', title: 'Concepts', text: 'Projects, tasks, entries, backlog items and how they fit together.', link: '/start/concepts' },
  { icon: 'keyboard', title: 'Keyboard shortcuts', text: 'Every key Ajour listens to, on one page.', link: '/start/shortcuts' },
]" />

## Basics

<DocLinks :items="[
  { icon: 'calendar', title: 'Day view', text: 'Log, start and fix the entries of one day.', link: '/time/day-view' },
  { icon: 'list', title: 'Week view', text: 'See and edit a whole week in a grid.', link: '/time/week-view' },
  { icon: 'send', title: 'Commit your week', text: 'Copy the changes of your week into your timesheet tool and mark them as committed.', link: '/time/commit' },
  { icon: 'backlog', title: 'Backlog', text: 'Plan the work you will spend time on.', link: '/backlog/' },
  { icon: 'projects', title: 'Projects', text: 'Group tasks, set budgets and assign shortcuts.', link: '/projects/' },
  { icon: 'command', title: 'Command palette', text: 'Find anything and run any action from the keyboard.', link: '/app/command-palette' },
]" />

## Plugins

<DocLinks :items="[
  { icon: 'plug', title: 'Plugins overview', text: 'Install, activate and connect plugins.', link: '/plugins/' },
  { icon: 'inbox', title: 'Azure DevOps', text: 'Sync work items and write estimates, states and priorities back.', link: '/plugins/azure-devops' },
  { icon: 'inbox', title: 'Jira', text: 'Sync Jira issues and write estimates, statuses and priorities back.', link: '/plugins/jira' },
  { icon: 'pullRequest', title: 'GitHub', text: 'List the pull requests you wrote or were asked to review, and sync your issues.', link: '/plugins/github' },
]" />

## Build a plugin

<DocLinks :items="[
  { icon: 'code', title: 'Plugin API', text: 'What a plugin can do, and what it cannot.', link: '/developers/' },
  { icon: 'terminal', title: 'Build a backlog plugin', text: 'Write, run and package a backlog plugin in an afternoon.', link: '/developers/build-a-backlog-plugin' },
]" />

</div>

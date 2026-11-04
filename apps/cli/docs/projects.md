NAME
ajour projects - list projects and active tasks

SYNOPSIS
ajour projects [--format FORMAT]

DESCRIPTION
Lists the active tasks supplied by list_projects, with project codes,
pinned keys and Commits as names. --json prints the unchanged tool output.
Machine columns are project, task, key, commits_as.

OPTIONS
  --format FORMAT    table on a terminal, tsv in a pipe, csv or json.

EXAMPLES
  ajour projects --format csv

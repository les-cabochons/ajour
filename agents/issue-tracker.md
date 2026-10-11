# Issue tracker

Issues and specs live in GitHub Issues for `les-cabochons/ajour`.
Use the `gh` CLI. Write issue titles, descriptions, and comments in English.

## Operations

Run commands from this repository so `gh` resolves its GitHub remote.
When running elsewhere, pass `--repo les-cabochons/ajour`.

- Create an issue:
  `gh issue create --title "..." --body-file <path>`
- Read an issue:
  `gh issue view <number> --json number,title,body,labels,comments`
- List open issues:
  `gh issue list --state open --json number,title,body,labels,assignees`
- Comment:
  `gh issue comment <number> --body-file <path>`
- Add or remove labels:
  `gh issue edit <number> --add-label "..." --remove-label "..."`
- Close an issue:
  `gh issue close <number> --comment "..."`

For multiline descriptions and comments, write the exact text to a
temporary file and pass it with `--body-file`.

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the GitHub issue.

## Pull requests as a triage surface

PRs as a request surface: no.

## Wayfinding operations

- A map is one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child tickets use native GitHub sub-issues. If unavailable, add
  `Part of #<parent>` to each child and link it in the map's task list.
- Child labels use `wayfinder:<type>`, where the type is `research`,
  `prototype`, `grilling`, or `task`.
- Represent blockers with native GitHub issue dependencies. If unavailable,
  add `Blocked by: #<number>` to the child body.
- The next available ticket is the first open child in map order with no
  assignee and no open blockers.
- Claim a ticket with `gh issue edit <number> --add-assignee @me`.
- Resolve a ticket by commenting with the result, closing it, and adding
  a link to the result in the map's Decisions-so-far section.

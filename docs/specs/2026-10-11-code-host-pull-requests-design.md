# Pull Requests Through a Code Host Plugin

- Date: 2026-10-11
- Status: Agreed in a grilling session, ready for slicing
- Scope: plugin capabilities, code host contract, pull request list and lifecycle, sidebar, review client, content cache, time tracking
- Decisions: [ADR 0002](../adr/0002-pull-request-writes-are-immediate.md), [ADR 0003](../adr/0003-code-host-review-client-is-host-rendered.md)
- Terms: `GLOSSARY.md`, sections "Code review" and "Extensions"

## Summary

Ajour shows the user's pull requests and lets them review, comment, edit and merge without leaving the app. Everything arrives through a plugin with the new **code host** capability, so a user who never installs one never sees pull requests. GitHub comes first, in `les-cabochons/ajc-github`. Azure DevOps can add the capability to its existing plugin later.

A pull request is its own kind of thing, separate from a backlog item. It reuses the backlog lifecycle words: active, settled, snoozed, returned. Ajour unsettles a pull request on its own when someone asks the user to act on it. Time spent on a pull request is recorded against the project and task given by a repository rule.

## Goals

- Show pull requests the user authored or was asked to review, from every code host connection.
- Put the ones that need the user in the sidebar, in their own section.
- Offer a complete review client for existing pull requests, built on Pierre Diffs and Pierre Trees.
- Let the user track time on a pull request with one click after the first time.
- Keep everything invisible when no code host plugin is installed and enabled.

## Non-Goals

- Creating pull requests, editing code, reading CI logs, editing labels or reviewers.
- Desktop notifications.
- Pull requests in the sidebar's "Up next" card or interleaved with backlog items.
- Plugin-provided UI. Ajour renders every screen (ADR 0003).
- Using Ajour without the local API. Code host features need it, like connectors.

## Plugin capabilities

A plugin provides one or more capabilities: connector, schema or code host. The manifest and the catalog list capabilities instead of the single `type`. One package can be a connector and a code host.

The code host capability covers:

- Validate a connection.
- Sync: return the user's open pull requests (authored or review requested, including team requests when enabled) as provider-neutral facts, plus pull requests closed since the last sync.
- Content: files, patches and file contents for expanded context, at a given head.
- Conversation: description, timeline, review threads and comments.
- Browse: search pull requests the user authored or reviewed, with filters, one page at a time.
- Writes: submit a review (approve, request changes, comment) with its draft comments, post a single comment, reply, resolve or unresolve a thread, set a file viewed or not viewed, edit the title, toggle draft and ready, merge with a method the repository allows.

Calls stay stateless worker calls, as for connectors. The `apiVersion` goes up.

### Provider-neutral facts

Sync returns facts and Ajour derives the lifecycle from them. For each pull request: connection, repository, number, URL, title, author, whether the user is the author, draft flag, state (open, merged, closed), head identifier and time of the last push, requested reviewers (users and teams, with whether the user is among them), reviews (author, verdict, time), comments and replies (author, author is a bot, time, thread, mentions of the user), check summary, mergeability.

Bots are recognized by the provider's account type.

## Settings

The code host connection form, rendered by the host from declared fields:

- Host URL (default `https://github.com`, change it for GitHub Enterprise).
- Token (secret).
- Include and exclude organizations and repositories.
- Hide drafts.
- Include team review requests (on by default).
- Automatic sync and its interval (default 5 minutes).

A user can have several connections, for example GitHub Enterprise for work and github.com for personal work.

Ajour-owned pull request settings:

- Cache size limit (default 500 MB).
- Repository rules, editable and removable.

Sidebar setting, shared with backlog items: **Changes end a snooze early**, off by default.

## Lifecycle

### States

A pull request is **active** or **settled**, and an active one can be **snoozed**. **Returned** marks a pull request that came back on its own and was not opened since. These mean the same as for backlog items.

Initial state when Ajour first sees a pull request:

- Review requested from the user: active.
- Authored by the user: settled.

The user can settle, unsettle and snooze a pull request. All three stay local: the code host never learns about them. Settling never removes the user as a reviewer.

### What unsettles a pull request

As reviewer:

| Event                                                 | Unsettles |
| ----------------------------------------------------- | --------- |
| Review requested or re-requested                      | Yes       |
| Author replies in a thread the user is part of        | Yes       |
| New commits after the user requested changes          | Yes       |
| New commits after the user only approved or commented | No        |
| The user is mentioned                                 | Yes       |
| Another reviewer reviews or comments                  | No        |

As author:

| Event                                   | Unsettles |
| --------------------------------------- | --------- |
| A review of any verdict                 | Yes       |
| A comment by another person             | Yes       |
| A comment by a bot                      | No        |
| Checks fail or a merge conflict appears | No        |

The user's own actions never unsettle anything. Unsettling marks the pull request returned.

### Snooze and unsettling events

By default an unsettling event does not end a snooze: the pull request returns at the chosen time, marked returned. With **Changes end a snooze early** on, an unsettling event ends the snooze at once. For a synced backlog item, the same setting makes a change of source state or priority end its snooze.

### Closing

A merged or closed pull request leaves the sidebar at once, whatever its state. It stays under "Recently closed" on the pull request page for 7 days, then leaves the local list. Its cached content is evicted when it closes.

## Pull request page

A main navigation entry, "Pull requests", shown only while a plugin with the code host capability is installed and enabled.

Groups: **Active**, **Settled**, **Recently closed**. Each row shows title, repository and number, the reason it is active (review requested, changes requested, new reply, and so on), age, check status and time tracked so far. Row actions: open in the code host, start timer, settle or unsettle, snooze. With more than one connection, rows show a small connection label.

**Browse** searches the code host live for pull requests the user authored or reviewed, filtered by repository, state, author and title text, one page at a time. A browsed pull request opens in the review client and goes through the cache. It never joins the local list, never settles and never appears in the sidebar.

## Sidebar

Backlog and Pull requests tabs alternate the expanded sidebar's lists. Switching tabs changes only the sidebar. Opening either feature selects its matching tab. The Backlog panel keeps Up next, Snoozed and Settled. The Pull requests panel holds active, unsnoozed pull requests, longest waiting first by the event that made each item active. Settled pull requests do not appear in the sidebar. Without an enabled code host, the sidebar shows the backlog list without tabs.

Ctrl-click (Windows, Linux) or Cmd-click (macOS) on any row with a source URL opens it in the default browser: pull requests and synced backlog items, in the sidebar, on the Backlog page and on the pull request page. A plain click opens the item in Ajour. The context menu has "Open in GitHub" (or the source tool's name) with the shortcut shown.

## Review client

Opening a pull request shows:

- Header: title (editable), state, draft or ready toggle, checks summary with links, Start timer or Switch timer, merge.
- Description rendered from Markdown, and the conversation timeline.
- File tree (Pierre Trees) and diff (Pierre Diffs), split or unified, with expandable context.
- Inline comments, replies, resolving threads, suggested changes.
- A viewed checkbox per file, synced with the code host.

### Draft review

Inline comments collect in a **draft review** stored locally. It survives a restart and is submitted all at once with a verdict: approve, request changes or comment. "Add single comment" posts at once. Replies in existing threads post at once.

### Writes

Writes go to the code host as soon as the user acts (ADR 0002). A failed write keeps the draft or the edit and offers a retry. Nothing is queued. Merge asks for confirmation first, with the method and the commit title, using only methods the repository allows.

### Changes during a review

- New commits show a banner, "3 new commits. Refresh". The diff does not move until the user refreshes.
- After a refresh, a draft comment whose line is gone stays in the draft review, marked outdated.
- Viewed marks on files that changed are cleared, as on GitHub.
- If the pull request closes while a draft review exists, Ajour keeps the draft and offers to post it as comments or discard it.

### Keyboard

The review client is keyboard-first: next and previous file, next and previous thread, mark viewed, comment on the selected line, submit, open the submit dialog. The keys go in `docs/agents/ux-spec.md` and must not collide with the existing keyboard model.

## Content cache

Pull request content is too large for browser storage. The local API caches it on disk under `userData`, up to the user's size limit.

- Each sync preloads content for active pull requests. Settled and browsed pull requests load when opened.
- A new head drops the old content. Active pull requests are fetched again.
- Eviction: closed pull requests at once, then the least recently opened.
- Never evicted: draft reviews and the pull request list, both stored apart from the cache.

## Time

Opening a review never starts a timer. The header button reads **Start timer**, or **Switch timer** when another entry is running.

The first time the user starts a timer on a pull request from a repository with no **repository rule**, Ajour asks for the project and task, with "Use for all pull requests in owner/repo" checked. Later starts go straight through. Rules are matched per connection.

A time entry started from a pull request keeps its own copy of the pull request title and URL, and its note defaults to the title. The pull request page and detail show the time tracked on each pull request.

## Disabling and removing

- Disabling or uninstalling the plugin hides the navigation entry, the settings page and the sidebar section at once. The local list, lifecycle state, draft reviews and repository rules stay, so enabling it again restores everything.
- Time entries keep their copy of the title and URL, and the link still opens in the browser.
- Removing a connection deletes its pull requests, draft reviews and cached content, after a confirmation that says how many draft reviews will be lost.

## Delivery slices

Each slice spans this repository and `les-cabochons/ajc-github`, and ships behind the plugin being installed.

1. Plugin capabilities and the code host contract.
2. Pull request list, lifecycle and sidebar.
3. Read-only review client and content cache.
4. Review writes.
5. Time on pull requests.
6. Browse old pull requests.

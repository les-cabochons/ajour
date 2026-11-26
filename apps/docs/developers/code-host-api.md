# Code host API

A code host provides the user's pull requests as facts: who wrote them, who was asked to review, what reviews and comments happened, and when. Ajour decides from these facts which pull requests need the user. The plugin never decides. This page is the reference for plugin API version 4.

Declare `"codeHost": {}` in the manifest's [capabilities](/developers/manifest#capabilities), and export `validateConnection`, as for a backlog plugin, and `syncPullRequests`.

## syncPullRequests

```ts
export async function syncPullRequests(
  connection: PluginConnection,
  request: { tracked: { repository: string; number: number }[] },
): Promise<CodeHostSyncResult>;
```

Ajour calls it when the user presses **Sync** in Deck, and on the connection's timer while automatic pull request sync is on. See `pullRequestAutoSync` in [Reserved fields](/developers/manifest#reserved-fields). Return:

- `viewer`: the user the token belongs to.
- `instanceUrl`: optional, the code host's URL, such as `https://github.com`. Never secret. With `viewer`, it lets a new connection to the same account take over the pull requests of a removed one.
- `pullRequests`: every open pull request the user wrote, was asked to review, or reviewed. At most 1,000.

`tracked` lists the pull requests Ajour already tracks, at most 1,000. Return a tracked pull request that closed or merged, even if your searches no longer find it, so Ajour sees it close. A tracked open pull request missing from the result means it no longer passes the connection's filters.

### What to report

Report facts, never conclusions. Ajour computes "on your plate" from them:

- `reviewRequests` with `includesViewer: true` when the request is for the user, directly or through a team.
- `reviews` and `comments` with their authors and times. Set `mentionsViewer` when the text mentions the user. Do not send the text itself.
- `baseRef`, optional: the name of the branch the pull request merges into, such as `main`. Deck names it above the diff.
- `lastPushedAt` and `lastPushActor`, so Ajour can tell new commits after a change request. Leave `lastPushActor` out if you cannot attribute the push. Ajour then never treats it as someone else's.
- `checks` and `mergeability`.
- `approvals`, optional: each reviewer's current vote, one entry per reviewer, at most 100. Include a reviewer who was asked and hasn't voted yet, with `vote: "none"`.

Times are Unix milliseconds. A repository is its full name, such as `acme/api`.

## Types

```ts
interface CodeHostUser {
  login: string;
  displayName?: string;
  /** The code host marks the account as a bot. */
  isBot: boolean;
  avatarUrl?: string;
}

interface CodeHostSyncResult {
  viewer: CodeHostUser;
  instanceUrl?: string;
  pullRequests: CodeHostPullRequestFacts[];
}

interface CodeHostPullRequestFacts {
  repository: string;
  number: number;
  id: string;
  url: string;
  /** 1 to 1,000 characters. */
  title: string;
  author: CodeHostUser;
  state: "open" | "merged" | "closed";
  draft: boolean;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  viewerIsAuthor: boolean;
  headSha: string;
  /** Optional. */
  baseRef?: string;
  lastPushedAt: number;
  lastPushActor?: CodeHostUser;
  /** At most 100. */
  reviewRequests: {
    kind: "user" | "team";
    name: string;
    includesViewer: boolean;
  }[];
  /** At most 500. Tells a re-request apart while the same reviewer is pending. */
  reviewRequestEvents?: {
    id: string;
    author: CodeHostUser;
    createdAt: number;
    includesViewer: boolean;
  }[];
  /** At most 500. */
  reviews: {
    id: string;
    author: CodeHostUser;
    verdict: "approved" | "changes_requested" | "commented" | "dismissed";
    submittedAt: number;
    mentionsViewer?: boolean;
  }[];
  /** At most 2,000. */
  comments: {
    id: string;
    author: CodeHostUser;
    createdAt: number;
    /** The review thread. Absent for conversation comments. */
    threadId?: string;
    mentionsViewer: boolean;
  }[];
  checks: "none" | "pending" | "success" | "failure";
  mergeability: "mergeable" | "conflicting" | "unknown";
  /** At most 100, one per reviewer. Optional. */
  approvals?: {
    /** A person, or a team or group asked to review. */
    reviewer: CodeHostUser;
    /** `rejected` is Azure DevOps's Reject; `none` is asked, with no vote yet. */
    vote: "approved" | "changes_requested" | "rejected" | "none";
    /** The code host's policy requires this reviewer's approval. */
    required?: boolean;
  }[];
}
```

The schemas are in [`packages/shared/code-host.ts`](https://github.com/les-cabochons/ajour/blob/main/packages/shared/code-host.ts).

## Review operations

The contract also defines operations for reviewing in Ajour: `getPullRequestContent`, `getFileContent`, `getPullRequestConversation`, `getChecks`, `getLinkedTickets`, `getPullRequestVersions`, `browsePullRequests`, `submitReview`, `postComment`, `replyToThread`, `setThreadResolved`, `setFileViewed`, `updatePullRequest` and `mergePullRequest`. Each takes `(connection, request)`.

### What Deck reads

When the user opens a pull request in Deck, Ajour calls `getPullRequestContent`, then `getFileContent` for each changed file: at `baseSha` with `previousPath` (or `path`) unless the file was added, and at `headSha` with `path` unless it was removed. It builds the diff itself, with Review Deck's `buildDiff`, so its hunk ids are Review Deck's.

- `getPullRequestContent` returns `headSha`, `baseSha` and at most 3,000 `files`. `baseSha` is the commit the head's diff starts from, the merge base of the base branch and the head, not the base branch's tip. On Azure DevOps it is the latest iteration's common commit, the comparison Review Deck shows, and `headSha` that iteration's source commit. Ajour reads each file's `path`, `previousPath` and `status` only, and ignores `patch`, which you may leave out.
- `getFileContent` returns `{ kind: "text", content }` with at most 5,000,000 characters, `{ kind: "binary" }` for a binary file or one too long to send, or `{ kind: "missing" }` when the file isn't at that commit.

Ajour reads three files at a time. The GitHub and Azure DevOps plugins implement both.

While it builds the guide, Ajour also calls `getLinkedTickets` for the pull request's summary. It returns at most 50 `tickets`, the issues the pull request closes or is linked to on GitHub, or its linked work items on Azure DevOps, in your code host's order. Each has its `number` (an issue's number or a work item's id), the issue's `repository` (leave it out for a work item), its `title`, its `body` as your code host stores it (Markdown on GitHub, HTML on Azure DevOps, at most 65,536 characters), its `url` and its `state` in your code host's own words, such as `Open`, `Closed` or `Active`. Return `{ tickets: [] }` when none is linked. The first ticket's title heads the summary. Ajour shows the titles and states, never the bodies, and keeps them with the guide. A plugin without the operation, or one that fails, still opens: the summary says the tickets couldn't be read. The GitHub and Azure DevOps plugins implement it.

The review page also calls, beside the diff:

- `getPullRequestConversation`: the `description` in markdown, the `timeline` (at most 5,000 comments, reviews, commits and other events, oldest first), the review `threads` (at most 2,000) with their `path`, `side` (`base` or `head`), `line` and `startLine` on that side, `resolved`, `outdated` and comments, the `viewedPaths` the user marked viewed, and the `mergeMethods` the repository allows. Leave `line` out when a thread no longer maps to a line of the latest diff. Ajour shows a thread beside its line, and one it can't place in the conversation at the end.
- `getChecks`: the checks on the pull request's head, at most 500, each with its `name`, its `state` and an optional `url`. `state` is `pending` (queued, running or expected), `success`, `failure` (failed, errored, timed out or cancelled) or `skipped` (skipped, neutral or not applicable).

- `getPullRequestVersions`: the pull request's versions, oldest first, at most 500. A version is a push on GitHub and an iteration on Azure DevOps. Each has a `number` from 1 in push order, its `headSha`, the `baseSha` its diff starts from when the code host says, its `pushedAt` time, `forced` when the push rewrote the branch, and the `commits` it brought (at most 250, oldest first, each with its `sha`, `headline`, `authorName` and `createdAt`). The last version's `headSha` is the pull request's head. Set `versionName` to `iteration` when the code host calls them iterations, so Deck says so; it says pushes otherwise. Deck lists them above the diff and compares the version the user last reviewed with the latest, reading both through `getFileContent`.

A plugin without one of them still opens: the page says the code host doesn't offer it. The GitHub and Azure DevOps plugins implement all three.

### What Deck writes

Deck writes through these operations, each sent as soon as the user acts, with no Undo window and nothing queued (ADR 0002). Ajour keeps the draft review itself, so the code host holds no pending review.

- `postComment`: one comment, `body` in markdown, on lines when `anchor` names a `path`, a `side`, a `line` and an optional `startLine` on that side, at the `headSha` the user reviewed, or on the whole pull request without one. Return the new comment's `commentId`. It takes `submissionId` and `firstTriedAt` as `submitReview` does, below.
- `submitReview`: a review at `headSha`, with its `verdict` (`approve`, `request_changes` or `comment`), an optional `body`, the summary, and every line comment of the draft in `comments` (at most 500), each with its anchor and `body`. Return a `reviewId`. Send it in one call where the host can, so a failure leaves nothing behind; Ajour keeps the draft and offers Retry when you throw. A host with no review object, such as Azure DevOps, posts each comment and then sets the vote: the GitHub plugin maps the verdicts to `APPROVE`, `REQUEST_CHANGES` and `COMMENT`, and the Azure DevOps plugin votes 10 for approve and -5, "Wait for author", for request changes, and leaves the vote for a comment. Ajour labels request changes "Wait for author" for Azure DevOps. Make a retry safe with `submissionId`, below.
- `replyToThread`: a reply, `body` in markdown, at the end of the thread `threadId` names, as `getPullRequestConversation` gave it. Return the new comment's `commentId`. It takes `submissionId` and `firstTriedAt` as `submitReview` does, below: the GitHub plugin marks the reply as it marks a comment and reads the thread's comments back to the first try; the Azure DevOps plugin, whose comments hold no properties, answers `{ uncertain: true }` on a retry when the thread has a comment of the user's from around the first try on.
- `setThreadResolved`: resolves the thread `threadId` names, or opens it again when `resolved` is false, and returns the thread's `resolved` state. The Azure DevOps plugin sets the thread's status to Resolved (`fixed`) or Active.
- `setFileViewed`: marks the file at `path` viewed for the user, or not, and returns `viewed`. `headSha` is the head the user viewed it at: refuse to mark it viewed once the pull request moved on, so the code host never shows as viewed code the user didn't read. Deck calls it when a file's hunks all become viewed, or stop being; its per-hunk marks stay on the user's computer. Leave it out when the code host keeps no per-file viewed state, as the Azure DevOps plugin does: Ajour then keeps the marks on the computer, and stops calling it for the page. The GitHub plugin uses GitHub's own Viewed box, which `viewedPaths` reads back.
- The optional `submissionId` of `submitReview`, `postComment` and `replyToThread` (letters, digits, `-` and `_`, at most 100) names the write across tries and restarts: Ajour keeps it with the draft, or with the comment, until your operation returns, and sends the same one when the user retries the same write. On a retry Ajour also sends `firstTriedAt`, when the first try was sent, in Unix milliseconds. Mark what you post with the id, and on a retry look back to `firstTriedAt` for what carries it, so a retry after an uncertain failure, such as an answer lost after the host took the review, sends only what's missing. The GitHub plugin puts `<!-- ajour-review: … -->` on the first line of the body, finds it anywhere in an edited body, and reads the reviews or comments newest first, page by page, back to the first try; the Azure DevOps plugin sets the thread property `Ajour.ReviewSubmission` and posts only the places with no thread of that submission. Without an id, post everything. Never match on words or time alone: that holds back a new comment that reads like an old one.
- When a retry can't tell, answer `{ uncertain: true }` and post nothing: a post of the user's since the first try names no submission, as when someone edited the mark out, or you couldn't read back to the first try. Ajour tells the user the review or comment may already be there, and posts again only when they choose to, as a new submission.
- Ajour runs the writes of one `submissionId` on a connection one at a time, so two windows retrying the same draft don't both find nothing and both post. A try that waited behind another runs as a retry, with that one's `firstTriedAt`.
- Check the head before writing: refuse a `headSha` the pull request doesn't have, and an approval that a vote on the whole pull request would give to commits the user didn't read.

### What the author writes

On a pull request the user opened (`viewerIsAuthor`), Deck edits the title, toggles draft and ready, and merges, each sent as soon as the user acts (ADR 0002).

- `updatePullRequest`: the new `title`, the `draft` state, or both. Return the `title` and `draft` the code host holds after the update, which Deck shows. Setting a draft state the pull request already has changes nothing. The GitHub plugin edits the title over REST and changes the draft state through GraphQL; the Azure DevOps plugin sends both in one update of the pull request.
- `mergePullRequest`: merge with `method`, one of the conversation's `mergeMethods`, at `headSha`, the head the user read, with an optional `commitTitle` and `commitMessage`. Deck asks the user first, offers only the `mergeMethods` you return, and sends no commit title for `rebase`. Return the `mergeCommitSha`, or leave it out while the code host is still completing the merge, as Azure DevOps can; Deck then holds Merge until the next sync. Throw when the code host answers that the merge failed, such as Azure DevOps's `conflicts`, `rejectedByPolicy` or `failure` merge status.
- A merge happens at most once, and only at that head. Before you merge, read the pull request: one already merged at `headSha` is a retry whose first answer was lost, so return that merge and merge nothing again; refuse one merged at another head, one that's closed, a draft, and one whose head moved on. Then merge with the head attached, so the code host refuses it if a push lands in between: GitHub's `sha`, Azure DevOps's `lastMergeSourceCommit`. When the merge call fails, read the pull request again, since the code host may have merged before its answer was lost.
- Ajour runs the merges of one pull request on a connection one at a time, so a second window's merge finds the first one's.
- Return `mergeMethods` from what the repository allows: GitHub's repository settings, or the target branch's "Limit merge types" policies on Azure DevOps (`_apis/git/policy/configurations`, filtered by repository and branch).

Put the write endpoints and operations behind their own access choice, such as the official plugins' `reviewPullRequests`, "Review pull requests", so a connection reads pull requests without being able to write to them. An update that adds the choice asks for consent once, and the choice starts off.

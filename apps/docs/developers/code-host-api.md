# Code host API

A code host provides the user's pull requests as facts: who wrote them, who was asked to review, what reviews and comments happened, and when. Ajour decides from these facts which pull requests need the user. The plugin never decides. This page is the reference for plugin API version 3.

Declare `"codeHost": {}` in the manifest's [capabilities](/developers/manifest#capabilities), and export `validateConnection`, as for a backlog plugin, and `syncPullRequests`.

## syncPullRequests

```ts
export async function syncPullRequests(
  connection: PluginConnection,
  request: { tracked: { repository: string; number: number }[] },
): Promise<CodeHostSyncResult>;
```

Ajour calls it when the user presses **Sync** on the Pull requests page, and on the connection's timer while automatic pull request sync is on. See `pullRequestAutoSync` in [Reserved fields](/developers/manifest#reserved-fields). Return:

- `viewer`: the user the token belongs to.
- `instanceUrl`: optional, the code host's URL, such as `https://github.com`. Never secret. With `viewer`, it lets a new connection to the same account take over the pull requests of a removed one.
- `pullRequests`: every open pull request the user wrote, was asked to review, or reviewed. At most 1,000.

`tracked` lists the pull requests Ajour already tracks, at most 1,000. Return a tracked pull request that closed or merged, even if your searches no longer find it, so Ajour sees it close. A tracked open pull request missing from the result means it no longer passes the connection's filters.

### What to report

Report facts, never conclusions. Ajour computes "on your plate" from them:

- `reviewRequests` with `includesViewer: true` when the request is for the user, directly or through a team.
- `reviews` and `comments` with their authors and times. Set `mentionsViewer` when the text mentions the user. Do not send the text itself.
- `lastPushedAt` and `lastPushActor`, so Ajour can tell new commits after a change request. Leave `lastPushActor` out if you cannot attribute the push. Ajour then never treats it as someone else's.
- `checks` and `mergeability`.

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
}
```

The schemas are in [`packages/shared/code-host.ts`](https://github.com/les-cabochons/ajour/blob/main/packages/shared/code-host.ts).

## Review operations

The contract also defines operations for reviewing in Ajour: `getPullRequestContent`, `getFileContent`, `getPullRequestConversation`, `browsePullRequests`, `submitReview`, `postComment`, `replyToThread`, `setThreadResolved`, `setFileViewed`, `updatePullRequest` and `mergePullRequest`. Each takes `(connection, request)`.

::: info Not used yet
Ajour does not call the review operations yet, and the GitHub plugin does not export them. Implement `syncPullRequests` only. The operations and their schemas may change before Ajour uses them.
:::

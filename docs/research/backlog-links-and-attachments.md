# Attachments and links in Azure DevOps, Jira Cloud and GitHub issues

Research for the map "Links and attachments on synced backlog items". Checked
on 2026-10-19 against Azure DevOps REST 7.1, the Jira Cloud REST v3 OpenAPI
spec, and the GitHub REST and GraphQL docs. Facts marked _unverified_ need a
live check.

## Summary

Azure DevOps and Jira Cloud both have public APIs to read and write
attachments and links. GitHub issues have no attachments API at all: files
exist only as URLs in the issue text and comments. Links to pull requests,
commits and branches are the weak spot: Jira has no supported read API, and
GitHub has it in GraphQL only.

| Concept                                  | Azure DevOps                                                | Jira Cloud                                                   | GitHub issues                                                    |
| ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Attached files list                      | `relations` where `rel` is `AttachedFile` (needs `$expand`) | `fields=attachment`                                          | None: URLs in the text only                                      |
| File download                            | `GET wit/attachments/{id}` with `vso.work`                  | `GET attachment/content/{id}` (303 redirect)                 | URL only; private signed URLs expire (_unverified_ lifetime)     |
| File upload                              | `POST wit/attachments`, then `add /relations/-`; 60 MB      | Multipart with `X-Atlassian-Token: no-check`; `uploadLimit`  | No API                                                           |
| File delete                              | `remove /relations/{i}` (by position)                       | `DELETE attachment/{id}`                                     | No API                                                           |
| Web links                                | `Hyperlink` relation                                        | Remote links (`remotelink`), also Confluence pages           | None                                                             |
| Typed links between items                | Related, Duplicate, Tested By, Affects and others           | `issuelinks` with the site's `issueLinkType`s                | Duplicate events only                                            |
| Parent and child                         | `Hierarchy-Forward` and `Hierarchy-Reverse`                 | `parent` and `subtasks` fields                               | Sub-issues (REST)                                                |
| Dependencies                             | `Dependency-Forward` and `Dependency-Reverse`               | The "Blocks" link type, per site                             | `dependencies/blocked_by` and `blocking` (REST)                  |
| Pull requests, commits, branches, builds | `ArtifactLink` with `vstfs:///` URIs, parsed by hand        | No supported read API                                        | GraphQL `closedByPullRequestsReferences` and `linkedBranches`    |
| Link writes                              | JSON Patch on `/relations` with `test /rev`                 | `POST /issueLink`, `DELETE /issueLink/{id}`, remotelink CRUD | Sub-issues and dependencies (REST), pull request links (GraphQL) |

## What the plugins read today

None of the three backlog plugins reads attachments or links. Each reads only
the parent and child relationship it needs for the hierarchy.

- **ajc-azure-devops** sends two `workitemsbatch` calls per chunk of 200 ids:
  one with `fields`, one with `$expand: "Relations"`, because Azure DevOps
  rejects the two together (`src/azure-devops.ts`, `fetchWorkItems`). It keeps
  only `Hierarchy-Forward` and `Hierarchy-Reverse`, and its relation type
  declares only `rel` and `url`. Description images keep their
  `_apis/wit/attachments/<guid>` URLs as plain Markdown images.
- **ajc-jira** requests `summary, description, status, assignee, project,
issuetype, priority, parent, subtasks` and the estimate fields, not
  `attachment` or `issuelinks`. It drops ADF media nodes from descriptions.
  On `main` it declares API 3 and has no comment operations.
- **ajc-github** reads issues through GraphQL with `id number url title body
state stateReason repository assignees`. It reads no parent, sub-issues or
  linked pull requests, so every item has depth 0.
- **ajc-azure-repos** and the Azure DevOps plugin's pull request sync read no
  work item links.
- Every plugin's HTTP helper parses JSON, so none can return file bytes.

## Azure DevOps

### Reading relations

- `$expand=relations` (or `all`) works on
  [Get Work Item](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1),
  [List](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/list?view=azure-devops-rest-7.1)
  and
  [Get Work Items Batch](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-7.1),
  200 ids at most. Reading needs `vso.work`.
- `$expand` cannot be combined with `fields`. The reference pages do not say
  so; the error "The expand parameter can not be used with the fields
  parameter." is confirmed in
  [microsoft/azure-devops-node-api#601](https://github.com/microsoft/azure-devops-node-api/issues/601).
- A relation is `{rel, url, attributes}`. Work item links carry `isLocked`
  and `comment`. `AttachedFile` adds `id`, `name`, `resourceSize`,
  `resourceCreatedDate`, `resourceModifiedDate`, `authorizedDate`,
  `revisedDate` and `comment`
  ([Updates sample](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/updates/list?view=azure-devops-rest-7.1)).
  Hyperlinks carry the dates and `comment`, without `name` or size.

### Kinds of relation

[Work Item Relation Types](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-relation-types/list?view=azure-devops-rest-7.1)
(`GET _apis/wit/workitemrelationtypes`) returns:

- resource links: `AttachedFile`, `Hyperlink`, `ArtifactLink`;
- work item links: `System.LinkTypes.Hierarchy-Forward` and `-Reverse`
  (Child, Parent), `Related`, `Dependency-Forward` and `-Reverse` (Successor,
  Predecessor), `Duplicate-Forward` and `-Reverse`,
  `Microsoft.VSTS.Common.TestedBy-*`, `Affects-*`, and the shared steps and
  parameters types. Each type has `topology`, `directional`, `isForward`,
  `oppositeEndReferenceName` and `singleTarget`.
- Links to another organization are `System.LinkTypes.Remote.Related` and
  `Remote.Dependency-*`
  ([link type reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/link-type-reference?view=azure-devops)).

An `ArtifactLink`'s `attributes.name` is its type.
[Artifact Link Types](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/artifact-link-types/list?view=azure-devops-rest-7.1)
lists Branch, Build, Fixed in Changeset, Fixed in Commit, Found in build,
Integrated in build, Pull Request, Source Code File, Tag, Test Result and
others. The link type reference adds Wiki, Integrated in release environment,
and GitHub Commit, Pull Request and Issue, which work only for repositories
connected to Boards.

### Artifact URIs

There is no documented API that resolves a `vstfs:///` URI. The Git formats,
from Microsoft's
[azure-devops-mcp#279](https://github.com/microsoft/azure-devops-mcp/issues/279):

- `vstfs:///Git/Ref/{projectId}%2F{repoId}%2FGB{branch}`
- `vstfs:///Git/Commit/{projectId}%2F{repoId}%2F{sha}`
- `vstfs:///Git/PullRequestId/{projectId}%2F{repoId}%2F{prId}`

The pull request API's `artifactId` uses a lowercase `%2f`, and one Microsoft
example puts a project name in the first segment, so compare without regard to
case and decode the separator. Titles and states come from the Git or Build
APIs, which need `vso.code` or `vso.build`. The GitHub, Build and Wiki formats
are _unverified_. The reverse lookup, from an artifact to its work items, is
[`POST _apis/wit/artifacturiquery`](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/artifact-uri-query/query?view=azure-devops-rest-7.1).

### Attachments

- Download:
  [`GET _apis/wit/attachments/{id}?fileName=&download=true`](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/attachments/get?view=azure-devops-rest-7.1),
  with `vso.work`.
- Upload:
  [`POST _apis/wit/attachments?fileName=`](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/attachments/create?view=azure-devops-rest-7.1)
  as octet-stream, with `vso.work_write`, then a PATCH `add /relations/-` with
  `{rel: "AttachedFile", url, attributes: {comment}}`. Chunked upload is
  required above 130 MB.
- Limits: 60 MB per file and 100 attachments per work item
  ([limits](https://learn.microsoft.com/en-us/azure/devops/organizations/settings/work/object-limits?view=azure-devops)).
- Whether images pasted into a description or comment also appear as
  `AttachedFile` relations is _unverified_. Community reports say they do not.

### Writing links

- Add with `add /relations/-`. Remove strictly by position, `remove
/relations/{i}`, so a concurrent change can shift the index. Microsoft's
  samples start each patch with `{"op": "test", "path": "/rev", "value": N}`;
  on failure, read the relations again and retry.
- Edit a link comment with `replace /relations/{i}/attributes/comment`.
- Limits: 1,000 links per work item, and 10,000 revisions through the REST API.

### Change detection

- In the Updates sample, adding an attachment bumps `System.Rev` and
  `System.ChangedDate`, but several updates that change only work item links
  share a `rev` and change no fields. Link changes made from the other item may
  therefore not show in `Rev`. This is inferred from the sample (_unverified_).
- `System.AttachedFileCount`, `HyperLinkCount`, `ExternalLinkCount`,
  `RelatedLinkCount`, `RemoteLinkCount` and `CommentCount` can be read with
  `fields`, without expanding relations
  ([fields](https://learn.microsoft.com/en-us/azure/devops/boards/queries/linking-attachments?view=azure-devops)).
- [`_apis/wit/reporting/workitemlinks`](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/reporting-work-item-links/get?view=azure-devops-rest-7.1)
  is an incremental feed of work item links.

## Jira Cloud

### Attachments

- `fields=attachment` returns `{id, filename, author, created, size, mimeType,
content, thumbnail}`.
- `GET /rest/api/3/attachment/content/{id}` answers 303 with a `Location`
  header; `redirect=false` answers 200. `Range` is supported. The spec does not
  name the redirect host. Thumbnails: `/attachment/thumbnail/{id}`.
- Upload: `POST /issue/{key}/attachments`, multipart with a `file` field and
  the required `X-Atlassian-Token: no-check` header. 413 means a size, count or
  per-issue limit.
- Delete: `DELETE /attachment/{id}`, with the "Delete own" or "Delete all
  attachments" project permission.
- `GET /attachment/meta` returns `{enabled, uploadLimit}` in bytes.
- Per issue: 2,000 attachments, 2,000 issue links and 2,000 remote links
  ([field limits](https://support.atlassian.com/jira/kb/work-item-field-limits-in-jira-cloud/)).
- Spec:
  [issue attachments](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-attachments/).

### Issue links

- `fields=issuelinks` returns `{id, type: {name, inward, outward},
inwardIssue | outwardIssue}`.
- `GET /issueLinkType` lists the site's types, such as Duplicate ("duplicates",
  "is duplicated by") and Blocks ("blocks", "is blocked by").
- Create with `POST /issueLink` `{type: {name}, inwardIssue, outwardIssue,
comment?}`; it returns no body, so read the new id back from `issuelinks`.
  Delete with `DELETE /issueLink/{id}`. Linking must be on for the site
  ([issue links](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-links/)).
- Parent and child: the `parent` field and `subtasks`. Epic Link and Parent
  Link are deprecated in REST
  ([notice](https://community.developer.atlassian.com/t/deprecation-of-the-epic-link-parent-link-and-other-related-fields-in-rest-apis-and-webhooks/54048)).

### Remote links

- `GET /issue/{key}/remotelink`. `POST` creates or updates by `globalId`; a
  Confluence page's `globalId` looks like `appId=…&pageId=…`. `PUT` and
  `DELETE …/remotelink/{linkId}`, or `DELETE ?globalId=`.
- Shape: `{id, globalId, application, relationship, object: {url, title,
summary, icon, status}}`.

### Development information

- No supported public API reads an issue's pull requests, commits or branches.
  The
  [Development Information API](https://developer.atlassian.com/cloud/jira/software/rest/api-group-development-information/)
  is for provider apps and reads by repository.
- The Development field returns only a pull request summary in Cloud
  ([JRACLOUD-92947](https://jira.atlassian.com/browse/JRACLOUD-92947),
  "Gathering Interest").
- `/rest/dev-status/…` is internal and can change without notice.

### Search

`/rest/api/3/search/jql` returns only `id` unless fields are named, so ask for
`attachment,issuelinks`. The documented caps are 20 comments and 20 changelogs
per issue
([RFC-61](https://community.developer.atlassian.com/t/rfc-61-evolving-search-capabilities-addressing-scalability-with-a-new-enhanced-search-api/83027));
no truncation is documented for attachments or links.

## GitHub issues

### Attachments

- No REST or GraphQL endpoint lists, uploads or deletes issue attachments.
- The editor turns an upload into an anonymized URL. Limits: 10 MB for images,
  10 or 100 MB for videos, 25 MB for other files
  ([attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)).
  Private repository attachments need a login since May 2023
  ([changelog](https://github.blog/changelog/2023-05-08-more-secure-private-attachments)).
- `Accept: application/vnd.github.html+json` or `full+json` adds `body_html`
  ([issues](https://docs.github.com/en/rest/issues/issues#get-an-issue)).
- Private images are served from signed
  `private-user-images.githubusercontent.com` URLs that expire after about five
  minutes, by community reports (_unverified_). They cannot be cached.

### Links

- **Sub-issues**: REST `GET …/issues/{n}/sub_issues`, `GET …/parent`,
  `POST …/sub_issues`, `DELETE …/sub_issue`, `PATCH …/sub_issues/priority`
  ([REST](https://docs.github.com/en/rest/issues/sub-issues)), generally
  available since 2025-04-09
  ([changelog](https://github.blog/changelog/2025-04-09-evolving-github-issues-and-projects/)).
  Issues carry `sub_issues_summary` and `parent_issue_url`.
- **Dependencies**: REST `…/dependencies/blocked_by` (GET, POST with
  `issue_id`, DELETE) and `…/dependencies/blocking` (GET)
  ([REST](https://docs.github.com/en/rest/issues/issue-dependencies)),
  generally available since 2025-08-21, at most 50 per relationship
  ([changelog](https://github.blog/changelog/2025-08-21-dependencies-on-issues/)).
  Issues carry `issue_dependencies_summary`.
- **Linked pull requests and branches**: GraphQL
  `Issue.closedByPullRequestsReferences(includeClosedPrs, excludeUserLinked)`
  and `linkedBranches`; writes through `addCloseIssueReferences`,
  `removeCloseIssueReferences`, `createLinkedBranch` and `deleteLinkedBranch`.
  REST only has the
  [timeline](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types):
  `cross-referenced`, `connected`, `disconnected` and `referenced`.
- **Duplicates**: `marked_as_duplicate` and `unmarked_as_duplicate` timeline
  events. GraphQL has only `unmarkIssueAsDuplicate`.
- **Tasklists** were retired on 2025-04-30
  ([changelog](https://github.blog/changelog/2025-02-18-github-issues-projects-february-18th-update/));
  `trackedIssues` and `trackedInIssues` are legacy.
- A fine-grained token reads all of these with Issues: read and writes with
  Issues: write
  ([permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)).
  Pull request details through GraphQL probably also need Pull requests: read
  (_unverified_).

## To check live

On a real Azure DevOps organization:

- whether pasted images appear as `AttachedFile` relations;
- whether web URLs built from the ids in a `vstfs` URI open, or need names;
- the `vstfs` formats of GitHub, Build and Wiki links;
- whether a link added from the other work item bumps this item's `Rev`;
- that `$expand` and `fields` still fail together.

On a real Jira site and GitHub repository:

- which attachment URL opens in the browser with the user's session;
- the host Jira's content redirect goes to;
- how long a private GitHub image URL stays valid.

# Review Deck's saved guides in Azure DevOps

Research for [ajour#593](https://github.com/les-cabochons/ajour/issues/593), part of map [ajour#592](https://github.com/les-cabochons/ajour/issues/592). Checked 2026-11-04.

Sources:

- Review Deck at `les-cabochons/review-deck` `main`, commit `c4243e98d0d1c418a4ccafb70c2fb6aa2207eb70` (2026-11-04). Paths below are relative to that repository. Short paths such as `ui/App.tsx`, `adoHost.ts` or `saved.ts` are under `extension/src/`, and `src/...` is the shared pipeline at the root.
- `microsoft/azure-devops-extension-api` at commit `dcf55c3e66548041c9037b8c4be3fb4f7ea9d08d` (2026-10-26).
- Microsoft Learn pages, linked where cited.

Nothing here was tested against a live organization. Claims that rest on the docs or the source alone say so.

## Answer

Yes, with a token outside the extension, if the token has the `vso.extension.data_write` scope. Ajour can read and write the `saved-reviews` collection over plain REST on `extmgmt.dev.azure.com`. The Azure DevOps plugin's PAT needs one more scope, **Extension data (read and write)**. Review Deck shows a guide Ajour wrote only if the guide matches what Review Deck would build itself:

- the same comparison (`iteration`, `compareTo`),
- the same mode, meaning the same backend and AI-title settings,
- `format: 4`,
- groups that cover exactly the hunk IDs Review Deck's own diff produces.

If any check fails, Review Deck groups the pull request again and overwrites that comparison's entry. Nothing checks a commit SHA. "Current" means the same ADO iteration pair, plus a `madeWith` title and description that match, or else the page shows a "Description changed" hint.

## 1. The endpoint, the token and the scope

**Endpoint.** Extension documents live under the Extension Management service:

```
{GET|POST|PUT|PATCH|DELETE} https://extmgmt.dev.azure.com/{organization}/_apis/ExtensionManagement/InstalledExtensions/{publisherName}/{extensionName}/Data/Scopes/{scopeType}/{scopeValue}/Collections/{collectionName}/Documents/{documentId}
```

- The route template and verbs come from the official client: create is POST, get and list are GET, set is PUT, update is PATCH and delete is DELETE. All are `7.2-preview.1` in that client (`src/ExtensionManagement/ExtensionManagementClient.ts:145-312` in `azure-devops-extension-api`).
- The host `extmgmt.dev.azure.com/{organization}` is the Extension Management host in the REST reference ([Installed Extensions - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/extensionmanagement/installed-extensions/list?view=azure-devops-rest-7.1)).
- The [Data and Setting Storage](https://learn.microsoft.com/en-us/azure/devops/extend/develop/data-storage?view=azure-devops) page names the same `_apis/ExtensionManagement/InstalledExtensions/{publisherName}/{extensionName}/Data/Scopes/.../Collections/.../Documents` route for settings.
- The REST reference has **no page** for the Data operations. The only Extension Management group it documents is Installed Extensions. So no Microsoft page states the scope header for these routes. Unconfirmed from Microsoft.
- Organization-wide data uses scope type `Default` and scope value `Current`. Per-user data uses `User` and `Me` (`IDocumentOptions` and `ExtensionDataCollection` comments, `src/Common/CommonServices.ts:388-427`). When an extension passes no scope, the data is project collection wide ([Data and Setting Storage](https://learn.microsoft.com/en-us/azure/devops/extend/develop/data-storage?view=azure-devops), "Data scoping" and "Get a document by ID").
- Review Deck's own backend reads extension data with exactly this URL, `.../Data/Scopes/Default/Current/Collections/project-settings/Documents/{projectId}` with `api-version=7.1-preview.1` (`backend/src/stacks/settings.ts:26-28`).

**Scope.** Microsoft's scope table lists:

- `vso.extension.data`, "Extension data (read)": "Grants the ability to read data (settings and documents) stored by installed extensions."
- `vso.extension.data_write`, "Extension data (read and write)": "Grants the ability to read and write data (settings and documents) stored by installed extensions." It inherits `vso.extension.data`.

Both are on the [OAuth 2.0 scopes](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops#available-scopes) page, which says Microsoft Entra ID OAuth and Azure DevOps OAuth "use the same scope definitions". Neither scope is marked high privilege. Writing a guide needs `vso.extension.data_write`.

**Does a token not issued to the extension work?** Probably yes, but nobody has tested it.

- The scope description covers data "stored by installed extensions" with no restriction to the calling extension.
- The one restriction Microsoft documents applies to **extension** tokens: "An extension access token can access only data associated with its publisher ID and extension ID. Requests for another extension's data return HTTP 401" ([Data scoping](https://learn.microsoft.com/en-us/azure/devops/extend/develop/data-storage?view=azure-devops)). Nothing documents a similar restriction on PATs or Entra tokens.
- Review Deck itself depends on this. Its restack backend reads `project-settings` with a PAT (`Basic` auth, `backend/src/stacks/ado.ts:60`) or a managed identity's Entra token (`:61`). Its setup asks for a PAT with "_Extension data (read)_" (`docs/stacks.md:99-100`). The same doc also says "I expect organization members to be able to read it, but haven't confirmed that for a managed identity" (`docs/stacks.md:109-111`).
- Review Deck's docs say "extension data has no access control of its own. A project member who calls the extension data REST API directly could change the setting" (`docs/azure-backend.md:24-26`, also `:146-149`). That is the author's statement, not Microsoft's.

**Unconfirmed:** that a PAT or Entra token with `vso.extension.data_write` can **write** `Cabochonio.review-deck` documents. No source shows a write from outside the extension, and Review Deck's backend only reads. The first ticket that writes should prove it on a real organization with a GET, then a PUT carrying `__etag`.

**Ajour today.** The Azure DevOps plugin uses a PAT the user pastes, with Work Items, Identity, Code (read) and Project and Team scopes (`apps/docs/plugins/azure-devops.md:10-15`). Ajour would add Extension data (read) to show published guides, and Extension data (read and write) to publish. Azure DevOps OAuth no longer accepts new app registrations and is "scheduled for full deprecation in 2026" ([OAuth 2.0](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops)). A broker-held OAuth token would therefore be an Entra token.

## 2. Does it matter that the extension is private?

Review Deck is private: `"public": false`, publisher `Cabochonio`, id `review-deck` (`extension/vss-extension.json:2-8`). Its id is `Cabochonio.review-deck`, which is also the backend's default (`backend/src/stacks/settings.ts:8`).

- The data route is keyed by the **installed** extension (`InstalledExtensions/{publisherName}/{extensionName}`), so the extension must be installed in the organization. A private extension has to be shared with that organization first.
- No Microsoft page found says that a private extension's data is treated differently from a public extension's. **Unconfirmed**, but no source points to a difference.
- Ajour should not hard-code the id. Review Deck's backend takes the id from the request because the installed id can differ (`backend/src/stacks/settings.ts:4-14`), for example a fork published under another publisher. Ajour can read the installed id with Installed Extensions - List, which needs `vso.extension`.

## 3. Where a guide is stored

| What              | Value                                                                                                                                                                                                                                                       | Source                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Collection        | `saved-reviews`                                                                                                                                                                                                                                             | `extension/src/app/adoHost.ts:26`                                |
| Scope             | Organization wide (`getDocument` without `scopeType`, so `Default`/`Current`)                                                                                                                                                                               | `adoHost.ts:325`, `:351-352`                                     |
| Document id       | `[projectId, repositoryId, pullRequestId].join(".")` with every character outside `[A-Za-z0-9.-]` replaced by `_`                                                                                                                                           | `adoHost.ts:322`                                                 |
| `projectId`       | The project the hub runs in. A pull request in another project opens in that project's hub, so this is the pull request's project.                                                                                                                          | `adoHost.ts:60`, `:92-96`                                        |
| `repo`            | The repository **id** (GUID), not its name                                                                                                                                                                                                                  | `ui/App.tsx:89`, `ui/hub/HubPage.tsx:273`, `app/hashRoute.ts:15` |
| Document body     | `{ id, comparisons: SavedComparison[], __etag }`                                                                                                                                                                                                            | `adoHost.ts:325`, `:348-352`                                     |
| `SavedComparison` | `{ iteration: number, compareTo: number, review: SavedReview }`                                                                                                                                                                                             | `extension/src/review/saved.ts:82-86`                            |
| Comparison order  | The newly grouped one first, then the others, most recently grouped first                                                                                                                                                                                   | `saved.ts:95-120`                                                |
| Limits            | At most 4 comparisons. Older ones are dropped once the document passes 256,000 characters of `JSON.stringify`, but the new one is always kept. Review Deck applies these limits only when **it** saves (`withSaved`). It does not check them when it reads. | `saved.ts:17-20`, `:111-119`                                     |
| Concurrency       | Review Deck reads, merges, and writes with the read `__etag`, or creates the document when none exists. It tries 3 times.                                                                                                                                   | `adoHost.ts:341-358`, `:40`                                      |

Two documents in the collection are ignored: older documents that hold a single comparison and no `comparisons` array (`adoHost.ts:316-320`), and documents whose entries have a non-number `iteration` or `compareTo` (`saved.ts:101-103`).

**Id length, unconfirmed.** Microsoft says a provided `id` "should be limited to 50 characters" ([Create a document](https://learn.microsoft.com/en-us/azure/devops/extend/develop/data-storage?view=azure-devops)). Review Deck's id is two GUIDs and a number, about 78 characters. Review Deck works in production, so the limit seems not to be enforced. Ajour must use the same id anyway.

**Document size, unconfirmed.** Review Deck mentions "the document size limit" (`adoHost.ts:360`), but no Microsoft page found gives its value.

## 4. The `SavedReview` format 4 shape

From `extension/src/review/saved.ts:53-67`, with types from `src/core/types.ts`:

```ts
interface SavedReview {
  format: number; // must be 4 (FORMAT, saved.ts:15)
  mode: { semantic: boolean; llmTitles: boolean };
  madeWith: { title: string; description: string };
  savedAt: number; // ms since the epoch
  fellBack?: true; // omit
  groups: Group[];
  merges: { from: string; into: string; symbol: string }[];
  options: {
    semantic: boolean;
    titler: string;
    weights: Record<SignalName, number>;
    minEdgeWeight: number;
  };
  hunks: Record<
    string,
    { symbol?: string; isTest?: true; mechanical?: MechanicalInfo }
  >;
}

interface Group {
  // src/core/types.ts:93-101
  id: string;
  kind: "semantic" | "misc" | "mechanical";
  hunkIds: string[];
  title: string;
  rationale: string;
  titleSource?: "llm" | "description" | "heuristic"; // types.ts:107
}

interface MechanicalInfo {
  // src/core/types.ts:44-47
  kind:
    | "lockfile"
    | "generated"
    | "rename"
    | "binary"
    | "whitespace"
    | "dependency-manifest";
  reason: string;
}
```

What the page reads after a restore:

- **`groups`**: `kind === "semantic"` groups count as concerns and get colours. `mechanical` groups start collapsed. `title` and `rationale` are shown (`ui/App.tsx:232`, `ui/FilesTab.tsx:670`, `:715-741`, `ui/groupColors.ts:4`). `titleSource` labels who wrote the title, on semantic groups only (`ui/TitleSource.tsx:13-14`).
- **`hunks`**: optional per-hunk facts (`symbol`, `isTest`, `mechanical`), used only for hunks that have them (`saved.ts:65-66`, `:171-189`).
- **`merges`**: defaults to `[]` (`saved.ts:150`).
- **`options`**: copied through without a check (`saved.ts:152`). The extension UI never reads it. Only the CLI's HTML renderer does (`src/render/html.ts:35-36`, `:151-193`). Write a full object anyway, for example `{ semantic: false, titler: "heuristic", weights: {...all six signals}, minEdgeWeight: 0 }`.

## 5. How Review Deck decides a saved guide still fits

On every open, the page builds the comparison it shows. By default that is the latest iteration against the pull request's base (`compareTo: 0`, `ui/comparison.ts:8-10`), and the page loads the saved entry for that exact pair (`ui/App.tsx:174`, `saved.ts:89-93`). The entry is reused only if `restoreReview` (`saved.ts:130-156`, called from `review/analysis.ts:87`) accepts it:

1. **Same comparison.** The entry's `iteration` and `compareTo` equal the shown ones. Azure DevOps iterations never change, so a comparison's diff is fixed (`saved.ts:2-3`). **There is no head commit or SHA check.** A push creates a new iteration, which has no entry yet.
2. **`format === 4`** (`saved.ts:132`).
3. **Same mode** (`saved.ts:133-135`, `:158-160`). The page computes `semantic = backend configured` and `llmTitles = backend configured && project.aiTitles && organization.aiTitles` (`saved.ts:49-51`, `ui/App.tsx:169-173`). The backend setting is the organization-wide `backend` value (`adoHost.ts:33`, `:159-172`). The AI-title switches are the `project-settings/{projectId}` document and the `organization-settings/settings` document (`adoHost.ts:24`, `:35-36`, `:183-199`).
4. **Complete.** `groups` is an array, and `madeWith.title` and `madeWith.description` are strings (`saved.ts:136`).
5. **Not a stale fallback.** If `fellBack` is set, the entry is used only within one hour of `savedAt` (`saved.ts:23`, `:137`).
6. **Covers exactly this diff.** Review Deck rebuilds the diff, parses it, and requires the groups' `hunkIds` to match the parsed hunk IDs in count and membership (`saved.ts:138-142`).

If the entry passes, the page shows it with **`madeWith`'s** title and description (`saved.ts:143-145`). A difference from the pull request's current title or description does not reject the guide. It shows "Description changed ·" next to **Regroup** (`ui/App.tsx:204`, `ui/FilesTab.tsx:277-278`).

If the entry fails, or the reader presses Regroup, the page groups the pull request itself and saves the result as that comparison's entry, replacing the old one (`review/engine.ts:56`, `:80-81`, `saved.ts:111`). There is one exception: Review Deck does not replace a complete entry with a fallback grouping made in the same mode from the same text (`saved.ts:106-110`). **So an entry Ajour publishes in the wrong mode, or with the wrong hunk IDs, is overwritten the first time someone opens the pull request in Review Deck.**

## 6. What a third party must write

For Review Deck to render a guide Ajour wrote:

1. **Address.** Use `PUT` (or `POST` when the document is new) on `.../InstalledExtensions/{publisher}/{extension}/Data/Scopes/Default/Current/Collections/saved-reviews/Documents/{id}`, with `id` built as in section 3 from the project id, repository id and pull request id.
2. **Merge.** First read the document. Put Ajour's entry first in `comparisons`, keep the other entries, and stay within 4 entries and 256,000 characters. Send the read `__etag`, and retry on a conflict (409 or 412, as `adoHost.ts:449-452` treats them). Use `__etag: -1` only if dropping others' changes is acceptable ([etags](https://learn.microsoft.com/en-us/azure/devops/extend/develop/data-storage?view=azure-devops)).
3. **Key.** Use the ADO iteration numbers for `iteration` and `compareTo`. `compareTo` is `0` for the base, which is what the page opens on.
4. **`review`.**
   - Set `format: 4`, `savedAt: Date.now()`, and no `fellBack`.
   - Set `madeWith` to the pull request's current title and description.
   - Set `mode` to the mode readers' pages will compute (section 5, step 3). For an organization without a Review Deck backend, that is `{ semantic: false, llmTitles: false }`. With a backend, it is `semantic: true`, plus the project and organization AI-title switches. All three settings are extension data that the same token can read. A guide written by an Ajour agent in an organization without a backend still has to say `{ semantic: false, llmTitles: false }`. The mode records how the readers' pages would group, not how the guide was made.
   - Set `titleSource` to whichever value fits. It is only a label (`types.ts:103-107`). Whether `"llm"` is right for an agent's titles is a product choice.
5. **Hunk IDs.** They must equal Review Deck's own, so Ajour must reproduce Review Deck's diff:
   - The file list is ADO "iteration changes" for `(iteration, compareTo)`. Folders are skipped, the leading `/` is stripped, and files are sorted by path (`data/adoSource.ts:114-141`).
   - File text is the blob decoded with a default `TextDecoder` (UTF-8) (`data/blobs.ts:135`).
   - Each file goes through `structuredPatch(old, new, …, { context: 3 })` from `diff` 9.0.0 (`review/analysis.ts:152`, `package-lock.json:3481-3483`).
   - These files get no hunks and become a single `path#0` pseudo-hunk: binary files (containing a NUL character), files over 20,000 lines, and files whose text did not change (`review/engine.ts:62-67`, `analysis.ts:147-150`, `src/diff/parse.ts:22`, `:97-109`).
   - A hunk's ID is `${path}#${index}`, where `path` is the new path, or the old path for a deletion (`src/diff/parse.ts:16-21`).
   - The simplest way to match is to vendor Review Deck's `buildDiff` and `parseDiff`, which map #592 already plans.
6. **Every hunk once.** The groups must cover every hunk. The check compares counts and membership, so a duplicated ID together with a missing one would slip through. Do not rely on that.

## Not confirmed

- That a PAT or Entra token can **write** another extension's data. Reading has a documented scope, and Review Deck's backend relies on it, but no live test is recorded.
- That a private extension behaves like a public one for data access.
- The exact Microsoft scope header for the Data routes, because no REST reference page exists for them.
- The document size limit, and whether the 50-character id guidance is enforced.
- Whether both `7.1-preview.1` (used by Review Deck's backend) and `7.2-preview.1` (used by the client) both accept writes. The backend only proves a read with `7.1-preview.1`.

## Outside this question

- The organization-wide `backend` value holds the backend's API key (`adoHost.ts:159-162`). Any member with Extension data (read) can read it, which Review Deck states (`docs/azure-backend.md:144-149`). A broker-held token with this scope can read it too. Ajour should not read or log that value.
- `restoreReview`'s coverage check accepts a duplicated hunk ID in place of a missing one (`saved.ts:141-142`). This is a small bug for a review-deck issue.

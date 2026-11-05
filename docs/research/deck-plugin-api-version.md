# Which plugin API version Deck builds on, and what new code host operations cost there

Research for #594, part of map #592 (Deck). Read on 2026-11-04.

Sources, all read at a fixed commit:

- `les-cabochons/ajour` at `33c0a326` (origin/main). Paths below are relative to this repository.
- `les-cabochons/ajour-plugins`: `main` at `5ca4963`, `feat/github-plugin-api-4` at `456e1bb` (PR ajour-plugins#8), `feat/azure-devops-plugin-api-4` at `bcfacd9` (PR ajour-plugins#9). Paths prefixed `plugins:`.
- Issues #208, #381, #398, #403, their sub-issue states, and the ajour-plugins pull request list (`gh`).
- Microsoft Learn: [Pull Request Threads - Create](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads/create?view=azure-devops-rest-7.1) and the [Azure DevOps scope table](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops#scopes).

## Answer

- **Ajour ships plugin API 3, and runs API 4 only in development builds.** `PLUGIN_API_VERSION` is 3 (`packages/shared/plugins.ts:20`). A packaged build refuses an API 4 manifest (`apps/api/src/plugin-package.ts:348-376`). A build started with `AJOUR_ALLOW_DEVELOPMENT_PLUGINS=1` admits it (`apps/api/src/server.ts:1232-1234`, `:1355`; `apps/api/src/plugin-host.ts:378-379`). The cut-over that makes API 4 the only version is #403, still open.
- **Both plugins ship API 3 on `main`.** GitHub is 0.2.0 and Azure DevOps 1.2.0, both `"apiVersion": 3`. The API 4 ports are open, unmerged PRs (#8 and #9, last commits 2026-10-26). By the #398 comment they wait for #403, which merges every port at once.
- **The code host contract does not depend on the version.** One operation table (`packages/shared/code-host.ts:418-467`) serves API 3 and API 4. The method table differs only for `validateConnection` (`apps/api/src/plugin-methods.ts:47-62`, `:87-90`). Ajour's side of every Deck contract change costs the same on either version.
- **Recommendation: build Deck's plugin work on API 4, and land the Ajour side now.**
  - Base and target branch facts are optional fields that need no new endpoint or scope. They can also go to API 3 `main` if Deck needs them before #403.
  - The writes, the wider Azure DevOps scope and guide publishing go only into the API 4 ports, rebased onto `main`.
  - Reasons:
    - API 3 is removed at the cut-over (#403, ADR 0007, "Plugin API 4 drops compatibility with API 3"), so writes built on API 3 would be built twice.
    - On API 3, a plugin holds the PAT in plain text and can call any host (`apps/docs/developers/runtime.md:44-46`). A Code (Write) and Extension data (Write) token is the case ADR 0010 exists for.
    - On API 4, one release can ask for the wider access in a single consent ("Allow and activate", `packages/shared/plugin-access.ts:31-44`).
  - The cost: Deck's writes and publishing reach packaged builds only with #403.

## Real state of each repository

| Where                                               | Plugin API           | Evidence                                                                                  |
| --------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Ajour, packaged build                               | 3 only               | `plugin-package.ts:356` (`PACKAGED_BUILD = { admitPluginApi4: false }`), `:367-375`       |
| Ajour, development build                            | 3 and 4 side by side | `plugin-host.ts:378-379`, `server.ts:1236-1241` (`SplitPluginRuntime`)                    |
| Ajour SDK `@ajour/plugin-sdk` 0.1.0                 | 4                    | `packages/plugin-sdk/index.ts:19`, not published on npm (#381, Out of Scope)              |
| `plugins:main` GitHub 0.2.0                         | 3                    | `plugins/github/plugin.json:3-4`                                                          |
| `plugins:main` Azure DevOps 1.2.0                   | 3                    | `plugins/azure-devops/plugin.json:3-4`, with `assign: true` (`:12`) from ajour-plugins#26 |
| `feat/github-plugin-api-4` GitHub 0.3.0             | 4                    | `plugin.json:3-4`, `network` at `:102-133`, `runtime` at `:134`                           |
| `feat/azure-devops-plugin-api-4` Azure DevOps 1.2.0 | 4                    | `plugin.json:3-4`, `network` at `:64`, `connectionAccess` at `:226`                       |

Of #381's sub-issues, #382 to #396, #437 and #449 are closed. The six plugin ports (#397 to #402) and the cut-over (#403) are open.

Two facts about the API 4 branches matter before building on them:

- **The Azure DevOps port is behind `main`.** It branched before ajour-plugins#26 (assignees, `0dc8cb7`, merged as 1.2.0). The port also calls itself 1.2.0, but it lacks `capabilities.connector.assign` and `searchAssignees`. Ajour's own API 3 access list already gates `searchAssignees` under `peopleSearch` (`packages/shared/connection-access.ts:78-87`), and the port's manifest doesn't. GitHub reports PR #9 as `MERGEABLE`, which is a text merge only. A rebase must carry the assignee work and pick a new version number.
- **The vendored SDK is stale.** Both branches depend on `vendor/ajour-plugin-sdk-0.1.0.tgz`, packed from Ajour `7b0e4daa` on 2026-10-26 (`plugins:vendor/README.md`). Since then the SDK has changed in `6578858b`, `7f8ad68e`, `03ff8b16`, #545, #550, #551, #552, #566 and #572 (`git log 7b0e4daa..origin/main -- packages/plugin-sdk`), and #566 added `searchAssignees` and `connector.assign`.

What exists for pull requests today:

- **Plugins:** both export only `syncPullRequests` among the 12 code host operations (`plugins:plugins/github/src/plugin.ts:53` and `plugins/azure-devops/src/plugin.ts:352` on `main`).
- **The web app:** it calls only `syncPullRequests` (`apps/web/src/lib/app-api.ts:143-160`).
- **The route:** it is declared at `apps/api/src/routes.ts:225-227` and handled at `apps/api/src/server.ts:2874-2958`. The map's `server.ts:369` is out of date.
- **The API 4 Azure DevOps manifest:**
  - It already puts all 12 code host operations under the `pullRequests` choice (`plugin.json:252-271`), with the token scope "Code (Read), and Project and Team (Read) for teams" (`:255`).
  - It declares only read endpoints for pull requests: repositories, pull requests, threads, iterations, policy evaluations and teams. No write endpoint exists.
- **The API 4 GitHub manifest:** it allows REST only for issues and activity, plus `POST /graphql` (`plugin.json:110-129`).

## How a change flows through the version Deck uses

Ajour derives most of the plumbing from the shared operation table. A new field or operation goes through these places.

**Derived, no edit needed:**

- `codeHostOperationSchema`, which the route's operation enum parses (`code-host.ts:471-476`, `server.ts:2878`).
- The plugin method table (`plugin-methods.ts:56`, `connectionOperations(codeHostOperations)`).
- Result validation (`plugin-host.ts:727-748`).
- API 3 access for Azure DevOps. Its `pullRequests` choice is `Object.keys(codeHostOperations)` (`connection-access.ts:70-77`), so a new operation falls under it automatically.

**Must be edited, and the build or tests catch a miss:**

- `CODE_HOST_EVENTS` in `apps/api/src/operation-events.ts:30-43` (`satisfies Record<CodeHostOperation, …>`). The event goes in the catalog (`packages/wide-events/lib/ajour-catalog.ts`, next to `:1951-1960`) and in the table in `docs/logging-strategy.md:1005`. ADR 0011 keeps a guide's text out of the event.
- The SDK's generated contract. Run `corepack pnpm --filter @ajour/plugin-sdk generate` (`packages/plugin-sdk/scripts/generate-contract.mjs:1-10`). `packages/plugin-sdk/tests/contract.test.ts:54-62` fails while `lib/contract.ts` is stale. The code host types come from `scripts/contract-source.ts:105-106`.

**Must be edited, and nothing catches a miss:**

- `OPERATION_LABELS` in `apps/web/src/domain/plugins/plugin-access-model.ts:65-93`. An unlisted operation shows its raw name in the Access section. `updatePullRequest` and `mergePullRequest` are already missing from the list.
- `codeHostRequestFields` and `codeHostResultFields` in `server.ts:724-767`, for any count worth logging.
- `apps/docs/developers/code-host-api.md`. It still says "plugin API version 3" (`:3`), and its Types section is at `:35`.

## Cost 1: base and target branch facts

The target is the branch a pull request merges into, and the head (source) is the branch it comes from. Stacks need both names: one pull request's target is another's head.

Ajour:

1. **Add the fields as optional.** Add them to `codeHostPullRequestFactsSchema` (`packages/shared/code-host.ts:127-144`), for example `baseRef` and `headRef`; the names are not settled. They must be optional for two reasons:
   - The web stores facts with this schema (`apps/web/src/domain/pull-requests/pull-request-lifecycle.ts:500`), and `normalizePullRequests` drops every stored pull request that fails to parse (`:521-528`). A required field would silently erase every saved pull request, with its snooze and settle state, at the first load.
   - A plugin that hasn't been updated sends no such field, and the host validates results with the same schema (`plugin-host.ts:735-746`).
2. **Regenerate the SDK contract** (see above). This adds no new operation, event or label.
3. **Update the docs:** `apps/docs/developers/code-host-api.md`, Types.

The schemas are plain `z.object`, which drops unknown keys (no `strict` or `passthrough` in `code-host.ts`). So an updated plugin is harmless against an older Ajour: the extra fields are dropped. Release order doesn't matter.

Plugins. Neither needs a new endpoint or scope:

- **GitHub:** the GraphQL selection already reads `headRefName` (`plugins:plugins/github/src/github.ts:190` on `main`, `:209` on the API 4 branch). Add `baseRefName` and map both. `POST /graphql` is already allowed on API 4.
- **Azure DevOps:** the pull request list it already fetches (`plugins:plugins/azure-devops/src/pull-requests.ts:485`) is the Git Pull Requests resource. The `AzurePullRequest` type (`:129-141`) declares no ref fields. Map `sourceRefName` and `targetRefName` from that response. Whether the list response always carries both fields is **unconfirmed** here. Check it against a fixture or the REST reference when building.
- **Both:** update the hand-copied `src/contract.ts` mirror (see the last section).

## Cost 2: a new write operation, publishing a guide

Deck also needs a read: "A published guide for the current head wins over Ajour's own" (#592). That is at least two operations, for example `getPublishedGuide` and `publishGuide`. The names and payloads wait on #593 and #596.

Ajour:

1. **The operations:** request and result schemas, plus two entries in `codeHostOperations` (`code-host.ts:418-467`). The route, method table, SDK types and API 3 access follow automatically (see above).
2. **A capability flag.** `codeHost` is an empty object today (`packages/shared/plugins.ts:332`), and the API 4 capabilities extend the same schema (`packages/shared/plugin-api-4.ts:560`). Only Azure DevOps publishes, so the web needs to know which plugin can. Otherwise a call to GitHub fails with "does not export publishGuide()" (`apps/api/src/plugin-worker-lifetime.ts:452-454`). Add something like `codeHost: { publishGuide?: boolean }`. The access summary compares only capability keys (`plugin-access.ts:106-108`), so the flag alone doesn't count as wider access. The new endpoints and access operations do.
3. **Events, catalog, labels and docs** (see above).
4. **Web:** a call in `apps/web/src/lib/app-api.ts`, and the Deck UI.

Plugin, Azure DevOps on API 4:

1. **Code:** export `getPublishedGuide` and `publishGuide` from `src/plugin.ts`, using `ajour.http`.
2. **Manifest:** declare the extension data host and endpoints (Cost 4) and an access choice that unlocks the two operations (Cost 3).
3. **Capability:** set the new flag under `capabilities.codeHost`.
4. **Tests:** test against the SDK fake, asserting method, path and access (the #381 testing decisions).

Plugin, GitHub: nothing. The guide never leaves Ajour (#592).

## Cost 3: a wider Azure DevOps token scope

Microsoft's scope table has `vso.code` "Code (read)", `vso.code_write` "Code (read and write)", which "create and manage pull requests and code reviews", and `vso.threads_full` "PR threads". Creating a pull request thread accepts either `vso.code_write` or `vso.threads_full` (Pull Request Threads - Create, Security). Extension data has `vso.extension.data` (read) and `vso.extension.data_write` (read and write). None of these is in the plugin's help text today (`plugins:plugins/azure-devops/plugin.json`, `personalAccessToken.helpText`).

How Ajour handles a scope:

- A token scope is only text on an access choice (`plugin-api-4.ts:505-517`, `tokenScope`). Ajour checks nothing against the token.
- Enforcement works through the choices:
  - **Operation level.** The route refuses an operation whose choice is off (`server.ts:3556-3575`, `connection-access.ts:146-158`). An operation that no choice lists is not gated.
  - **Endpoint level, API 4 only.** The broker refuses a request whose endpoint `access` choice is off (`apps/api/src/broker-policy.ts:220-262`).
- New choices start off (`connection-access.ts:12-18`).
- Changing a choice's `tokenScope` text alone doesn't widen access. Adding an operation to a choice, moving an operation to another choice, or adding endpoints does (`plugin-access.ts:31-44`, `:266-330`). A widening update installs inactive until the user allows it.

Recommended shape: keep `pullRequests` as reading (Code (Read)), and add two choices, each starting off:

- **Review pull requests:** Code (Read & write). It holds `submitReview`, `postComment`, `replyToThread`, `setThreadResolved`, `setFileViewed`, `updatePullRequest` and `mergePullRequest`, plus their write endpoints. This keeps #381's rule that new and migrated connections read only (user stories 34-37).
- **Publish guides:** Extension data (Read & write). It holds the two guide operations, plus the extension data endpoints. Reading a published guide only needs Extension data (Read). Whether reading should sit under a choice of its own is a product call for the spec.

Where the change goes:

- **API 4:** the manifest's `connectionAccess`, in the rebased port (`plugin.json:226-283` on the branch). The 7 write operations leave `pullRequests` (`:252-271`) for the new choice.
- **API 3, only if Deck ships writes before #403:** Ajour's own copy in `AZURE_DEVOPS_API_3_ACCESS` (`packages/shared/connection-access.ts:42-87`). Without that edit, every new operation falls under `pullRequests` by `Object.keys(codeHostOperations)`, so Code (Read) would wrongly appear to cover writes. The comment at `:38-41` says the API 4 manifest "declares the same", so both copies change together.
- **The plugin's `personalAccessToken` help text**, in both cases.

Not confirmed: whether a PAT can be created with only "PR threads" (`vso.threads_full`) instead of Code (Read & write). The scope table lists it, but the PAT creation UI was not checked. The scopes for votes, viewed-file marks, pull request updates and merges were not checked one by one.

## Cost 4: new endpoints in the allow-list

- **API 3:** there is no allow-list. A plugin calls `fetch` to any host (`runtime.md:44-46`). The access summary of an API 3 manifest is empty: "it reaches nothing through the broker" (`plugin-access.ts:47-49`).
- **API 4:** each endpoint is a method and a path pattern, with `*` for one segment and `**` for the rest. It sits on the base address (`network.endpoints`) or on a derived host, with an optional `access` choice (`plugin-api-4.ts:115-128`). An `access` value must name a declared choice (`:710-735`). A derived host is a list of host forms tried in order, which must stay within the address the user saved (`:254-300`). The Azure DevOps port already does this for people search, with `vssps.{host}` and `{match}.vssps.visualstudio.com` (branch `plugin.json`, `derivedHosts`). The broker and the SDK's fake share the matching rules (`packages/shared/plugin-request-rules.ts:1-7`, copied into the SDK by the generator).

For Deck on Azure DevOps:

- **Reading content for the review page** needs endpoints the port lacks, such as iteration changes and file items under `/*/_apis/git/repositories/*/…`, gated by `pullRequests`. The exact paths depend on how `getPullRequestContent` and `getFileContent` are built. Not enumerated here.
- **Writes** need the thread POST and PATCH paths and the reviewer vote path, gated by the review choice. Thread creation is `POST {org}/{project}/_apis/git/repositories/{repositoryId}/pullRequests/{pullRequestId}/threads` (Microsoft Learn).
- **Extension data** is a new derived host (for example `extmgmt.{host}` with a visualstudio.com form, as for `vssps`), gated by the publish choice. The host, path, methods and any concurrency header are **not confirmed** here. #593 owns them. Review Deck itself goes through the extension SDK's data manager (`getDocument`, `setDocument` with `__etag`, `createDocument` in `review-deck:extension/src/app/adoHost.ts`), not raw REST, so it gives no URL to copy.
- **GitHub content** needs new REST endpoints on the `rest` derived host, such as pull request files and contents. Alternatively it stays on `POST /graphql`, which is already allowed and is the "GraphQL breadth" G2 limit (#381, Further Notes).

Every added endpoint, derived host form and access operation widens access. That is one consent per release, so batching Deck's additions into as few releases as possible keeps the prompts down.

## How the hand-copied contract mirrors stay in step

They don't, mechanically.

- **On API 3 `main`,** `plugins/github/src/contract.ts:1-2` and `plugins/azure-devops/src/contract.ts:183-185` are copies with no generator, test or CI check against Ajour. The GitHub header points at `packages/shared/connectors.ts`, which no longer exists in Ajour. The public docs tell authors to copy types by hand ("Ajour has no SDK package", `apps/docs/developers/build-a-backlog-plugin.md:122`). Drift shows only at runtime:
  - A missing required field fails Ajour's result parse (`plugin-host.ts:735-746`).
  - An extra field is dropped silently.
- **On the API 4 branches,** each export is typed from the SDK (`plugins:plugins/github/src/plugin.ts:1-2`, for example `NonNullable<PluginModule["syncPullRequests"]>`). The plugins repo CI runs `typecheck` per plugin (`plugins:.github/workflows/build.yml`, "Run checks"), so a result that doesn't fit the vendored SDK fails the build. But:
  - Both ports keep their local `src/contract.ts` for internal types (GitHub header unchanged at `:1-2`, Azure DevOps at `:175`).
  - The SDK is a tarball refreshed by hand (`plugins:vendor/README.md`: `pnpm pack`, repoint `package.json`, record the commit). It is only as current as the last pack, and today it predates #566.
- **Inside Ajour,** the SDK contract is generated from the shared schemas and guarded by the `--check` test (`contract.test.ts:54-62`).

The chain for each Deck contract change:

1. Change `packages/shared/code-host.ts` and run `pnpm --filter @ajour/plugin-sdk generate`. The test enforces this step.
2. Pack the SDK and replace `plugins:vendor/ajour-plugin-sdk-*.tgz`. Nothing enforces this step.
3. Update the plugin. Its typecheck then enforces the result types.

To close the gap:

- Replace each plugin's local code host types with the SDK's (`CodeHostOperations`, exported through `packages/plugin-sdk/index.ts:3`).
- Bump the tarball's version on every contract change, so a stale vendor copy is visible in `package.json`.
- Publishing the SDK on npm (out of scope in #381) would replace the tarball with a version range.

## Not confirmed

- That the Azure DevOps pull request list response always includes `sourceRefName` and `targetRefName`.
- The extension data REST host, paths, methods and headers for `saved-reviews` (#593).
- Whether "PR threads" (`vso.threads_full`) can be chosen when creating a PAT, and the exact scopes of votes, viewed marks, updates and merges.
- When #403 lands. No date is recorded on the issue.

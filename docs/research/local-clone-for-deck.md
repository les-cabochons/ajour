# Local clones for Deck agent context

Research for [#644](https://github.com/les-cabochons/ajour/issues/644),
2026-11-05. Context: [chat #642](https://github.com/les-cabochons/ajour/issues/642)
and [Deck map #592](https://github.com/les-cabochons/ajour/issues/592).
This is a recommendation for the future spec, not shipped behavior.

## Recommendation

Let the user choose a clone once per repository and execution environment.
Suggest previously chosen clones whose remotes match, but do not scan their disk.
Fetch an exact PR head into an Ajour-owned ref, verify its SHA, and create a
detached worktree in Ajour's cache for the agent's real-file tools.
Keep object reads for individual files and fall back to PR-only chat whenever
local context is unavailable. Record the external-Git credential exception
described below before implementation.

## What Ajour knows today

Inspected Ajour main at `d1ae333707146f27bcca8d5083c47a5e2488daef`,
including `apps/desktop`'s WSL/CLI work, and maintained plugins at
`7d0fc6f869f00689acf19149619df4136484ab2d`.

- [Shared PR contracts](../../packages/shared/code-host.ts), lines 102-168,
  carry `repository`, `number`, PR web `url`, and `headSha`. The sync envelope
  has optional `instanceUrl`. They have no clone URL, stable repository ID,
  source branch, or fork repository. A PR web URL is not a Git remote URL.
- [GitHub mapping](https://github.com/les-cabochons/ajour-plugins/blob/7d0fc6f869f00689acf19149619df4136484ab2d/plugins/github/src/github.ts)
  emits the target repository's `nameWithOwner`, such as `acme/api`, and
  `headRefOid` as `headSha`. It fetches `headRefName` and `headRepository`
  internally for push attribution but does not expose them in shared facts.
- [Azure DevOps mapping](https://github.com/les-cabochons/ajour-plugins/blob/7d0fc6f869f00689acf19149619df4136484ab2d/plugins/azure-devops/src/pull-requests.ts)
  emits `Project/Repo`, not just a repo name. Its envelope supplies the
  organization/collection URL. It reads repository and project IDs internally,
  but discards them in facts. `headSha` comes from `lastMergeSourceCommit`,
  then the latest iteration's source commit, then the sentinel `unknown`.
  Reject that sentinel for local reads; the shared SHA schema accepts it.
- [Desktop architecture](../agents/architecture.md), lines 885-891, and
  [the CLI controller](../../apps/desktop/electron/cli-command.cjs), lines
  1001-1041, support WSL 2 with distro names, argument-based `wsl.exe --exec`
  and `wslpath`. WSL 1 is explicitly unsupported. This does not yet provide
  a WSL coding-agent runner or clone registry.
- [Agent runner](../../apps/api/src/agent-runner/runner.ts), lines 544-587,
  creates a run directory and uses it as the CLI's `cwd`. Its cleanup at
  line 759 recursively removes that directory. A Deck worktree needs an
  explicit lease and worktree-aware cleanup instead of that generic removal.

The Deck API 4 spec should add optional, structured local-context metadata:
target instance and repository identity, safe HTTPS/SSH clone addresses,
source repository identity/address for forks, and full source ref name.
Keep the expected head SHA authoritative. Prefer GitHub repository IDs and
ADO project/repository IDs for rename stability. Existing name-based facts
remain valid when the plugin cannot supply this metadata.

## Finding and remembering the clone

Use a native folder picker with an explicit Windows/native or WSL distro
choice. Validate the folder through Git, accepting both a `.git` directory
and a linked worktree's `.git` file. Resolve the top level and common Git
directory with [git rev-parse](https://git-scm.com/docs/git-rev-parse).
Do not treat an arbitrary folder named like the repository as a match.

Read fetch addresses through `git remote get-url --all origin` and, for fork
clones, other remotes such as `upstream`. The command expands configured URL
rewrites; see [git remote](https://git-scm.com/docs/git-remote).
Matching and fetching are separate: match a normalized identity, retain the
user's chosen remote/transport for fetching. Do not rewrite their Git config.

Suggested equivalence rules, based on the hosts' documented address forms:

| Addresses                                                                                                  | Match identity                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `https://github.com/acme/api.git`, `git@github.com:acme/api.git`, `ssh://git@github.com/acme/api.git`      | GitHub instance `github.com`, owner `acme`, repo `api`                                    |
| `https://dev.azure.com/org/My%20Project/_git/api`, `https://user@dev.azure.com/org/My%20Project/_git/api`  | ADO organization `org`, project `My Project`, repo `api`                                  |
| `git@ssh.dev.azure.com:v3/org/My%20Project/api`, `ssh://git@ssh.dev.azure.com/v3/org/My%20Project/api`     | Same ADO identity after segment decoding                                                  |
| `https://org.visualstudio.com/My%20Project/_git/api`, legacy `.../DefaultCollection/My%20Project/_git/api` | Same Services identity when the organization alias is known                               |
| Old `vs-ssh.visualstudio.com` addresses                                                                    | Accept documented aliases; confirm the repo identity through host metadata when ambiguous |
| Enterprise GitHub or ADO Server                                                                            | Preserve host, port and collection/base path; never merge instances by repo name alone    |

Git supports URL and SCP-style transports in its [fetch manual](https://git-scm.com/docs/git-fetch).
Microsoft documents [HTTPS cloning](https://learn.microsoft.com/en-us/azure/devops/repos/git/clone?view=azure-devops)
and [current and legacy SSH addresses](https://learn.microsoft.com/en-us/azure/devops/repos/git/use-ssh-keys-to-authenticate?view=azure-devops).
The table specifies proposed matching behavior, not a tested production parser.

Strip one optional `.git` suffix and trailing slash for known host forms.
Decode path segments once, reject decoded separators and malformed encodings,
and compare hostnames case-insensitively. Use provider-specific name comparison,
not lowercasing every filesystem path. Drop usernames for identity comparison;
refuse password/token-bearing addresses and query/fragment credentials rather
than saving them. SSH aliases, custom ports and ambiguous ADO short URLs need
explicit confirmation or metadata resolution, not guessed equivalence.

Start with the user's previously selected clone locations. A later optional
"Search this folder" can scan a user-selected development root with depth and
time limits, including `.git` files. Do not enumerate drives, home directories,
editor databases or WSL distributions automatically. Offer multiple matches
for selection; do not silently choose between two clones.

Store this as a versioned, machine-local desktop setting under the selected
Electron `userData` directory, alongside existing desktop settings. Suggested
record: repository key, execution environment, chosen absolute path, common
Git directory, remote name, and last successful validation. This follows
[main.cjs](../../apps/desktop/electron/main.cjs)'s release/dev user-data separation.
Do not put absolute paths in synced project records, plugin secrets or the
evictable content cache. A replacement connection can reuse the mapping only
after identity validation. Revalidate the path and remote before every use.

## Paths and execution environments

Native Windows, macOS and Linux mappings contain native absolute paths.
A WSL mapping contains `{ kind: "wsl", distro, path: "/home/alex/src/api" }`.
The distro is part of identity: the same Linux path in two distros is different.
Validate the distro against main's WSL inventory, following the existing CLI
controller. Keep all Git commands, worktree paths and the coding CLI in the
same environment. A WSL worktree belongs in a Linux-side Ajour cache, not a
Windows linked worktree reached through a UNC path.

Use `wsl.exe -d <distro> --exec git ...` with arguments, and `wslpath` for
explicit Windows path translation. Do not assume `/mnt/c` or infer the distro
from a drive letter. Selecting `\\wsl.localhost\Ubuntu\home\...` should become
an Ubuntu mapping, not a Windows Git invocation. Microsoft recommends keeping
files in the filesystem used by the tools for
[WSL performance and interoperability](https://learn.microsoft.com/en-us/windows/wsl/filesystems).
Do not mix Windows and WSL Git on the same linked-worktree registration.

Use short hashed cache directory components, not repo titles or branch names.
Pass paths with spaces as individual arguments with no shell interpolation.
Windows-invalid names, path-length failures, symlinks and case-colliding files
can still prevent materialization. Offer PR-only context or an eligible WSL
clone instead. macOS behavior is documentation-based here, not locally tested.

## Fetching and verifying the head

First try the exact expected SHA locally. Use `git cat-file -e <sha>^{commit}`,
after validating a full object ID and rejecting values such as `unknown`.
Object existence alone does not prove all blobs are local in a partial clone.
If a fetch is needed, choose an explicit remote and source ref, then a unique
destination such as `refs/ajour/deck/<repo-key>/<pr>/<attempt>/head`.

```sh
git -C "<clone>" fetch --no-tags --no-write-fetch-head \
  --no-recurse-submodules --no-auto-maintenance --refmap= \
  <chosen-remote> +refs/pull/17/head:refs/ajour/deck/<repo-key>/17/<attempt>/head
```

These [fetch options](https://git-scm.com/docs/git-fetch) avoid updating
`FETCH_HEAD`, automatic tags, configured remote-tracking mappings and automatic
maintenance. Do not run `pull`, switch branches, stash, reset or clean.
Fetch still writes objects and the private ref into the clone's shared Git
directory. It is not a zero-write operation on the repository.

For GitHub, fetch `refs/pull/N/head` from the **target** repository, including
fork PRs. GitHub documents this ref and preservation of proposed commits even
when the fork disappears in [checking out PRs locally](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/checking-out-pull-requests-locally).
Never use the synthetic merge ref for head context.

For ADO, prefer the full `sourceRefName` fetched from its source repository.
For a fork use `forkSource.repository`, not the target repository's same-named
branch. The [PR REST model](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1)
distinguishes source ref, fork source, last source commit and last merge commit.
Do not add a permanent fork remote; an explicitly approved source address can
be used for that fetch alone.

ADO's `refs/pull/N/merge` is a possible fallback for **obtaining objects**.
Microsoft documents this [build ref](https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables?view=azure-devops)
and states that [PR validation builds run merged source and target code](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/azure-repos-git?view=azure-devops).
Fetch it to a separate private ref, then use the expected head SHA only if
that exact commit became available. Never label the merge tip as the head,
and do not assume a fixed parent number. Conflicting, pending or deleted PRs
may have no usable merge ref. No live ADO availability claim was tested here.

After fetch, compare the fetched source tip with the facts' expected head.
If a force-push raced the read, refresh PR facts once and retry under a new
head key. Never reuse a worktree for a different SHA. An old expected commit
may already exist locally, but do not silently combine it with a newer diff.
Fetching a raw SHA can fail under server reachability policy, so it is no
guarantee of recovering a deleted branch or an old force-pushed head.

## Real files versus object reads

| Method                                                                 | Speed and disk                                                                                                   | Safety and usefulness                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `git show <sha>:<path>` or a persistent `git cat-file --batch` process | No whole-tree checkout; pays for requested objects. Batch avoids one Git startup per file.                       | Raw tracked blobs, no normal checkout filters. Good for Deck file reads. CLI file tools cannot browse these without a new tool adapter. |
| Detached linked worktree at verified SHA                               | Writes a full tree plus its own index and metadata; shares the existing object store. Reuse by SHA while leased. | Gives the agent normal files and search tools. Must control hooks, filters, cleanup and agent permissions.                              |

Use [git ls-tree](https://git-scm.com/docs/git-ls-tree) with NUL-delimited
output for paths and [git cat-file](https://git-scm.com/docs/git-cat-file)
for raw blobs. Avoid `--filters`, `--textconv` or shell-built revision paths.
Normal object reads contain committed content, not the user's dirty files.

The proposed materialization uses `git -C <clone> ... worktree add --detach
<cache-path> <verified-sha>`. A linked worktree has independent HEAD and index
but shares repository data; see [git worktree](https://git-scm.com/docs/git-worktree).
Disable hooks through a per-command `core.hooksPath` pointing to an existing,
empty Ajour-owned directory. Git documents that worktree creation can run
[post-checkout hooks](https://git-scm.com/docs/githooks).

Before checkout, inspect configured filter drivers. Disable each driver's
`process`, `smudge` and `required` through per-command overrides, without
editing the user's config. A configured required filter can otherwise make
checkout fail, as the experiment below showed. Filters and line-ending
conversion mean checkout files need not equal raw blobs byte for byte;
Deck's authoritative diff/file tools should continue to use committed blobs.
See [Git attributes and filters](https://git-scm.com/docs/gitattributes).

Do not install dependencies, initialize submodules or run repository scripts.
A worktree is **not an agent security boundary**: its `.git` points back to
the user's shared Git directory. Use the coding CLI's read-only permissions
and restricted commands, with host writes available only through Deck tools.
If the selected CLI cannot enforce those permissions, keep it on PR-only
tools. A prompt saying "read only" cannot guarantee branch preservation.

## Credentials and ADR 0010

A normal external Git fetch uses the user's configured Git authentication.
HTTPS uses [credential helpers and credential contexts](https://git-scm.com/docs/gitcredentials);
SSH uses the user's SSH configuration, keys and agent. Its identity can differ
from Ajour's plugin connection. The broker's PAT does not automatically reach
Git, and a working API connection does not prove Git access.

[ADR 0010](../adr/0010-ajours-broker-holds-every-credential.md) says Ajour holds every credential
and makes every authenticated request. A core-run external Git fetch bypasses
the broker's endpoint grants, redirect policy and network checks even though
it does not reveal broker credentials to a plugin. This is a real exception
to the wording, not something the current ADR already authorizes.

Recommend documenting a narrow exception for user-selected local Git
repositories and their Git-owned authentication, with a one-time explanation:
"Ajour uses your Git sign-in to fetch this pull request. This can differ from
your Ajour connection." Approval of this research does not amend the ADR.
If the exception is rejected, use already-present commits and PR-only tools;
broker-mediated Git transport would be a separate, larger design.

Only trusted core code launches Git; a plugin returns metadata, never a command.
Do not export broker tokens through arguments, environment, askpass, config
files or `http.extraHeader`. Validate fetch targets, reject custom transport
helpers, and do not blindly execute plugin-provided or credential-bearing URLs.
User Git configuration, credential helpers and SSH commands remain trusted
local configuration, outside broker policy. Use bounded subprocesses with
cancellation and noninteractive authentication. `GIT_TERMINAL_PROMPT=0` alone
does not suppress every GUI helper or SSH prompt; configure those separately
and direct sign-in problems to the user's terminal rather than hanging Deck.
Errors/logs must redact credentials and must not publish raw remote addresses.

## Cleanup, cache accounting and failure behavior

Keep an Ajour manifest of owned private refs and worktree paths, their exact
head SHA, environment and active run leases. Serialize preparation/removal
per common Git directory. On close or LRU eviction, cancel or drain users of
the worktree before removing it. A running chat pins its snapshot until release.

Use `git worktree remove <owned-path>` first. If a disposable agent worktree
has modifications, force removal only after verifying ownership, the resolved
path under Ajour's cache, and absence of active leases. Delete only owned
private refs, with [git update-ref -d <ref> <expected-old-sha>](https://git-scm.com/docs/git-update-ref)
so concurrent replacement survives. Do not remove a user branch or run GC.

After a crash, inspect `git worktree list --porcelain -z` and reconcile the
manifest. For missing directories use `git worktree prune --dry-run --verbose`
before prune. Prune operates repository-wide, so run it only when every
eligible stale registration belongs to Ajour; otherwise defer to the user.
Do not use `--expire=now` on a real user's clone just to remove one entry.
Retry Windows busy-file failures after processes exit, leaving cleanup pending
rather than force-deleting unrelated paths.

Count materialized files against #596's 1 GB cache policy, account for filesystem
allocation rather than only text sizes, and refuse a tree that cannot fit after
eviction. Objects fetched into the user's clone are outside that evictable
cache: deleting a worktree/ref does not immediately recover them. State this
limit rather than claiming the 1 GB budget caps all disk growth.

| Case                                                        | Handling and user-facing result                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No clone selected                                           | Chat opens on PR tools. "Repository context isn't connected. Choose a local clone." Choosing is optional.                                                                                                                                                                                                                                                                 |
| Moved clone or changed remote                               | Disable mapping and offer Locate clone or Change clone; never silently remap it.                                                                                                                                                                                                                                                                                          |
| Missing Git, inaccessible WSL distro, unsupported WSL 1     | Explain the failing environment and offer another clone or PR-only chat. Do not start distros merely to search.                                                                                                                                                                                                                                                           |
| Auth failure, offline, deleted branch/fork, unreachable SHA | "Couldn't prepare repository context at this head. Chat can still use this pull request." Offer Retry and Git sign-in guidance for auth failures. Never switch the user's branch to repair it.                                                                                                                                                                            |
| Shallow clone                                               | Fetch the explicit PR/source ref without automatically unshallowing. A head tree does not need full ancestry. Surface server/shallow-boundary refusals; do not silently rewrite depth policy.                                                                                                                                                                             |
| Partial clone                                               | Both object reads and checkout can lazily fetch missing promised objects. Bound/cancel them and mark failed hydration as incomplete context, not a missing source file. See [partial-clone design](https://git-scm.com/docs/partial-clone).                                                                                                                               |
| LFS                                                         | Skip automatic hydration. Explain that LFS files contain pointers and are unavailable as full assets. [Git LFS](https://git-lfs.com/) stores payloads separately. `GIT_LFS_SKIP_SMUDGE=1` applies if its filter is used, but disabling filters is the broader policy. See [LFS configuration](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-config.adoc). |
| Submodules                                                  | Leave uninitialized; report omitted nested repositories. Their commits and credentials are separate.                                                                                                                                                                                                                                                                      |
| Checkout fails or disk is full                              | Remove only owned partial artifacts, keep the mapping, and keep PR tools available. Never offer files from an incomplete worktree as complete context.                                                                                                                                                                                                                    |

Show "Repository context ready at <short SHA>" only after verification and
successful materialization. Capture exactly that SHA in the chat session.
The consent required by #642 still names the agent provider and says local
clone contents may be sent there. Git sign-in disclosure does not replace it.

## Local experiments and limits

All fixture repositories were newly created under temporary directories.
No experiment ran in an existing user clone. Git config was isolated with
`GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` set to the null device. No
GitHub/ADO credentials or live host fetches were used. Publishing this note
uses the task's research worktree separately.

The same Python subprocess fixture ran on Windows with Git
`2.46.0.windows.1`, and inside Ubuntu WSL with Git `2.43.0`, using Linux `/tmp`.
It created 400 small text files, committed a base, cloned a local bare remote,
then added `head only.txt` in a second commit exposed as `refs/pull/17/head`.
The simulated user's clone retained a dirty tracked file and an untracked file.
All paths included spaces. Fetch used the exact flags above; checkout disabled
hooks. Assertions passed in both environments:

1. Detached worktree HEAD equalled the expected commit and had no symbolic branch.
2. User HEAD, index bytes, porcelain status, local/remote branch refs, tags,
   and `FETCH_HEAD` bytes matched their pre-operation values.
3. `git show <head>:head only.txt` returned the head content, while the dirty
   original file stayed untouched.
4. A separate `file://` clone made with `--depth=1` fetched and read the PR
   head while remaining shallow.
5. A made-up full SHA failed with exit 128.
6. Normal worktree removal and expected-old-SHA private-ref deletion succeeded.
   Deleting another fixture worktree's directory and pruning with
   `--expire=now` removed its stale registration. That immediate-expiry command
   was limited to disposable fixtures.

Single-run observations, not benchmarks or budgets:

| Observation                                           |  Windows | Ubuntu WSL |
| ----------------------------------------------------- | -------: | ---------: |
| Local PR-ref fetch                                    | 205.7 ms |    14.7 ms |
| Detached checkout of 401 files                        | 405.9 ms |    63.1 ms |
| One `git show` including process startup              |  54.4 ms |     3.6 ms |
| Worktree logical file bytes, including `.git` pointer |  535,313 |    503,283 |
| Shared object store file bytes after fetch            |   39,555 |     38,510 |

These measure a tiny local transport, different filesystems and Git builds,
not network latency or a Windows-versus-WSL product comparison. Default
checkout conversion also changes the worktree byte count. Object-store totals
are not incremental fetch costs, and logical bytes are not allocated disk.
The useful evidence is that object reads avoid materializing 401 files and a
linked worktree does not copy the object database.

A second isolated fixture enabled `uploadpack.allowFilter` on its bare remote,
then used `clone --filter=blob:none --no-checkout file://...`. In both runtimes,
`git show HEAD:a.txt` increased the partial clone's pack count from one to two:
an object read performed lazy fetch. A required fixture smudge command of
`false`, with a `cat` clean filter, made worktree checkout exit 128. Per-command
empty `process`/`smudge` and `required=false` overrides allowed checkout;
raw `git show` worked without the filter.

To reproduce the essential preservation check in a disposable fixture:

```sh
git init -b main seed
git -C seed -c user.name=Fixture -c user.email=fixture@example.invalid commit --allow-empty -m base
git clone --bare seed remote.git
git clone remote.git "user clone"
git -C seed -c user.name=Fixture -c user.email=fixture@example.invalid commit --allow-empty -m head
git -C seed push ../remote.git HEAD:refs/pull/17/head
# Record HEAD, index bytes, refs, status and FETCH_HEAD before this fetch.
git -C "user clone" fetch --no-tags --no-write-fetch-head --no-recurse-submodules --no-auto-maintenance --refmap= origin +refs/pull/17/head:refs/ajour/fixture/17/head
git -C "user clone" worktree add --detach "../cache with spaces/head" refs/ajour/fixture/17/head
# Compare the recorded state, then remove only this fixture worktree and ref.
git -C "user clone" worktree remove "../cache with spaces/head"
git -C "user clone" update-ref -d refs/ajour/fixture/17/head
```

Run only inside a fresh temp directory with isolated Git config and hooks.
The empty-commit recipe demonstrates refs and detachment; add files, dirty
edits and byte comparisons to reproduce the fuller assertions above.

Not executed: macOS, live GitHub fork fetches, live ADO source/merge ref
availability, actual credential helpers/SSH auth, real LFS hydration, Windows
case collisions or long paths, and agent permission enforcement. Those remain
implementation acceptance cases, along with concurrent fetch/close/evict and
startup cleanup. The external-Git ADR decision and WSL agent launch support
must be settled before claiming this feature works end to end.

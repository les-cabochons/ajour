# Ajour fetches pull requests into the user's clone with the user's Git setup

This is a narrow exception to [ADR 0010](0010-ajours-broker-holds-every-credential.md), for one thing only: Ajour's own code fetching a pull request into a local clone the user chose. Everything else there stands. It also extends [ADR 0022](0022-ajour-runs-git-itself-for-hand-off-worktrees.md), which said nothing but hand-off worktrees runs git.

Deck's asks can read the whole codebase at a pull request's head when the user has a local clone of its repository (#644, #795). The clone is rarely at that head, and the head is often a commit the clone doesn't have yet: someone else's push, or a fork's. So Ajour fetches it. ADR 0010 says the broker holds every credential and makes every authenticated request. A fetch from the user's remote doesn't go through the broker: it runs `git fetch` in the user's clone, and git signs in as the user's Git setup says, with their credential helper, SSH keys and agent, URL rewrites and proxy. That identity can differ from the Ajour connection's, and the broker's endpoint allowlist, private-address checks and redirect rules don't apply to it.

**The exception, and its limits.**

- Core code only, never a plugin. A plugin returns metadata, the pull request's clone addresses and its fork (`repositoryIdentity`, `headRef`), never a command. The local API decides what to run.
- A fetch only, of one pull request's head, into private refs, `refs/ajour/deck/<id>/head`. No pull, no checkout of the user's branches, no stash, reset, clean or garbage collection.
- From the remote the user's clone already has, chosen when the user picked the clone because its address names the repository. A fork's branch on Azure DevOps comes from a remote that names the fork, or else from the fork's address with the same transport as that remote, for that fetch alone: Ajour adds no remote and never writes the user's Git configuration.
- No credential of Ajour's reaches git: no token in an argument, the environment, a helper, a config file or a header. Git uses only what the user set up for it.
- Every call runs as ADR 0022's do: an argument list and no shell, `safe.bareRepository=explicit` and `GIT_OPTIONAL_LOCKS=0`, no prompt (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`), a deadline, and capped output. Every call also runs with none of the clone's hooks (`core.hooksPath` at an empty folder of Ajour's), no file system monitor and no automatic maintenance or garbage collection.

**The fetch.** When the clone already has the head commit, nothing is fetched. Otherwise Ajour runs `git fetch --no-tags --no-write-fetch-head --no-recurse-submodules --no-auto-maintenance --refmap= <remote> +<ref>:refs/ajour/deck/<id>/head`, where `<ref>` is `refs/pull/N/head` on GitHub, which keeps a fork's head in the repository itself, and the source branch, `refs/heads/<headRef>`, on Azure DevOps. Never `refs/pull/N/merge`: it is a merge Azure DevOps makes, not the head. Ajour then checks that the exact head commit the pull request names is in the clone: a newer push leaves it reachable, a force-push may not, and then the clone isn't read. The private ref is then set to that commit, so git keeps it while Deck reads it. The user's `HEAD`, index, branches, working files and `FETCH_HEAD` stay as they were. Objects and the private ref are written into the clone's shared Git folder: a fetch is not a zero-write operation.

**The worktree.** The agent reads a detached worktree at the head, `git worktree add --detach`, under the content cache's folder (`deck-cache/worktrees/<id>`, named by a hash of the cache entry's key, so no repository or commit is in a path). It is checked out with no hooks, with every configured filter driver's `smudge` and `process` off and none required, Git LFS files left as pointers, no submodules, and `core.symlinks=false`, so a committed link is a plain file holding its target and can't point the agent outside the worktree. The worktree goes with its cache entry: when the entry leaves, Ajour removes the worktree with `git worktree remove --force --force` and the private ref with `git update-ref -d`. At start it removes the worktrees and refs of Deck's that no entry holds. `git worktree prune` runs only when every registration it would drop is one of Deck's, so the user's own worktrees whose folders are away stay registered.

**WSL.** A clone in a WSL distribution, chosen through its `\\wsl.localhost\<distro>\…` path, runs git there through `wsl.exe -d <distro> --exec env … git`, each value its own argument. Its worktree lives in the distribution, under `~/.cache/ajour/deck-worktrees/<id>`, and the agent reads it through `\\wsl.localhost`. Windows git never touches a Linux worktree's registration.

**Only reading.** A linked worktree shares the clone's Git folder, so it is no sandbox. The agent's own read-only file tools are rooted at the worktree, and its write and shell tools stay off: Claude Code gets only Read, Grep and Glob, with the worktree as its one other folder and `dontAsk` refusing anything else; OpenCode allows `read`, `grep`, `glob` and `list` and refuses an outside folder but the worktree. Codex reads files only through its shell, which stays off, so on Codex asks read the pull request alone. Ajour never runs anything in the clone or the worktree.

**When it fails.** No clone chosen, a clone that's gone or whose remote changed, no git, a WSL distribution that doesn't answer, a failed or timed-out fetch, a head the remote doesn't have, or a checkout that fails: the ask runs on the pull request alone, and its answer says why. No reason holds a path, a remote address or what git printed, so none reaches an event (ADR 0011).

## Considered options

- **Read only commits the clone already has.** Rejected. Most pull requests by other people would have no head there, so asks would rarely read the clone.
- **Fetch through the broker, with the connection's token.** Rejected for now. The broker speaks HTTP for plugins, not Git's transports, and the user's Git sign-in is what already reaches their remote, SSH included. Broker-mediated Git transport would be a separate, larger design.
- **Read objects with `git show <sha>:<path>` instead of a worktree.** Rejected. The CLI's own file and search tools need real files; a new tool for each would rebuild them.
- **Fetch `refs/pull/N/merge` on Azure DevOps.** Rejected. It is a synthetic merge with the target branch, never the head.
- **Ask the user to confirm each fetch.** Rejected. The consent dialog already says what leaves the machine, and choosing the clone says Ajour fetches into it with the user's Git sign-in.

## Consequences

- Ajour's own code now runs git in a folder that isn't a repository folder of a project: the clone the user chose, which the local API keeps in its machine-local state (never synced, never in the content cache) and checks again before every use. Git runs through `apps/api/src/git-process.ts`, the runner hand-off worktrees use too.
- The user's Git setup reaches whatever its remote names. A credential helper that pops up a window, or an SSH key with a passphrase, makes the fetch fail rather than wait: the answer says Ajour couldn't fetch, and points at `git fetch` in the clone.
- Objects fetched into the clone stay there after the worktree and the ref go: the cache's cap counts the cache's files, not the clone's Git folder or the worktrees' checkouts.
- The agent's provider gets what the agent reads in the worktree, as it gets the pull request's own content. The consent dialog and the privacy policy say so, and that the fetch uses the user's Git sign-in.
- `deck.ask` records what the turn did with the clone (`read`, `not_chosen`, or why it couldn't), never a path.

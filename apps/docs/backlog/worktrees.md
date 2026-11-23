# Worktrees for hand offs

A hand off sends a backlog item to a coding tool, such as Claude Code or Codex, which then works on it in one of the project's repository folders. Hand offs need the desktop app and a hand-off plugin, such as **Agent handoff**.

Ajour can start each hand off in a **worktree**: a second copy of the repository, made by git, with its own folder and its own branch. Two tools can then work on two items of the same project at once, and neither touches the files of the other.

## Choose where a hand off starts

**Start in** decides where a hand off runs:

- **Main folder**: the repository folder itself, on whatever branch is checked out there.
- **New worktree**: a new folder and a new branch for the item. A fresh install uses this.
- **Ask each time**: a dialog asks when you pick a tool.

Set the default in **Settings › Worktrees**. It applies to this computer and never syncs to another one.

Press **Hand off** on an item's page. The row under the title says where this hand off will start, before you pick a tool.

<Shot name="handoff-start-in" alt="The hand-off sheet with the Start in row, New worktree from origin/main, above the tools" />

- Click the **top line** to choose **Main folder**, **New worktree** or a worktree the item already has, for this hand off only.
- Click the **bottom line**, such as **From origin/main**, to start the new branch from another branch. Type to find one. Ajour remembers your pick for that repository folder.
- **Review prompt…** offers the same two choices under the prompt.

An item that already has a worktree starts there again, so a second tool sees the work of the first. This works even if a tool switched the worktree to a branch of its own: the next tool works on that branch. Choose **New worktree** to get another one, such as `aj-4821-2`.

A project with several repository folders asks which folder first. A folder that is not a git repository, or a computer without git, always starts in the main folder.

### One project, another place

A project can use another place than the default. Open the project's page and find **Repositories**. **Hand offs start in** reads **Settings (New worktree)** until you choose for the project. Pick **Main folder**, **New worktree** or **Ask each time** to override the default for this project on this computer. Pick **Settings** to follow the default again.

<Shot name="project-repositories" alt="The Repositories section of a project page, with Hand offs start in and the worktrees under each repository folder" />

## Where worktrees live

A worktree lives inside its repository folder:

```text
atlas-web/
  .ajour/
    worktrees/
      aj-4821/      the worktree of item 4821
      aj-4821-2/    a second worktree of the same item
```

- **The folder** is named `aj-` and the item's key, then `-2`, `-3` for the item's next ones. An item you made by hand has no key, so its folder gets the start of the item's own id, such as `aj-1b9d6bcd`.
- **The branch** is new, named by your branch template, such as `4821-week-grid-keyboard-editing-of-cells`. A name that is taken gets `-2`.
- **The source** is the default branch of the remote, such as `origin/main`, unless you picked another. Ajour fetches it first. Without a network, the branch starts from the last fetched copy and the toast says so. The new branch does not track its source, so a plain `git push` never targets `main`.
- **Git status stays clean.** Ajour adds `/.ajour/` to the repository's local exclude file, `.git/info/exclude`, and writes a `.gitignore` holding `*` inside `.ajour`, which wins over a repository `.gitignore` that lets folders back in. No committed file changes, and the worktrees never show as untracked files.

::: warning Other tools may read the copies
Git ignores `.ajour/worktrees`, but a test runner, a linter or a search tool that walks the repository folder may not. It then finds every file once per worktree: tests run twice, a search lists the same line several times, and a linter reports files of a branch you are not on.

Tell each tool to skip the folder. A tool that reads `.gitignore`, such as Prettier, also skips it once you add `.ajour/` there.

| Tool     | Setting                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------ |
| ESLint   | `{ ignores: [".ajour/**"] }` as an entry of its own in `eslint.config.js`                              |
| Prettier | `.ajour/` in `.prettierignore`                                                                         |
| Vitest   | `"**/.ajour/**"` in `test.exclude`, beside `...configDefaults.exclude`                                 |
| Jest     | `"/.ajour/"` in `testPathIgnorePatterns`, beside `"/node_modules/"`, and in `modulePathIgnorePatterns` |
| VS Code  | `"**/.ajour/**": true` in `search.exclude` and `files.watcherExclude`                                  |

:::

## See your worktrees

**On the item.** Once an item has a worktree, its **Handoffs** card names it above the threads that run in it, with its status: **Clean**, or the number of changed and untracked files, such as **3 changes**. The **…** on that line opens the worktree in a terminal, shows it in your file manager, copies its path or deletes it.

<Shot name="handoff-card-worktree" alt="The Handoffs card with the worktree aj-48213, 3 changes and 2 threads, above its two threads" />

**On the project.** The project page lists each repository folder's worktrees under it, with the item's title and the status.

**On this computer.** **Settings › Worktrees** lists every worktree, by project.

<Shot name="settings-worktrees" alt="Settings › Worktrees with Start in, the two clean-up rules and the worktrees of two projects" />

| Status              | Meaning                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| **Working**         | A tool is working in it. **Needs you** when a thread waits for you.             |
| **Clean**           | Nothing to commit.                                                              |
| **3 changes**       | It holds 3 changed or untracked files.                                          |
| **Goes Nov 22**     | The first day a clean-up rule removes it, if nothing changes. In Settings only. |
| **Kept: 3 changes** | Clean up would remove it, and keeps it for that reason. In Settings only.       |
| **Missing**         | Its folder is gone, such as after you deleted it yourself.                      |

## Delete a worktree

Press **Delete** on a worktree's row, or **Delete worktree…** in its menu on the Handoffs card. Ajour always asks first, because a delete can't be undone.

<Shot name="worktree-delete" alt="The dialog Delete aj-48213?, with the uncommitted files, a warning that a tool is still working in it and the checkbox to delete the branch" />

- **The files you would lose** are listed: every changed and untracked file, as `git status` shows them.
- **A warning** names each tool that is still working in the worktree, or waiting for you there.
- **Also delete the branch** is unticked. It says how many of the branch's commits are on no remote. Leave it unticked and the branch stays, with every commit.
- **A worktree on another branch**, such as one a tool made there, says which branch it is on now. That branch always stays: the box deletes only the branch Ajour made.
- **A worktree on no branch** says so. When it holds commits that no branch has, the dialog says how many the delete loses, such as **Deleting the worktree loses 2 commits that are on no branch**. Create a branch there first to keep them.

If a file changed in the worktree after the dialog opened, such as one a tool just wrote, or a tool made a commit there, Ajour deletes nothing. The dialog shows what the worktree holds now and says it changed. Press **Delete worktree** again to delete it as it is.

Deleting removes the worktree's folder with everything in it, including files git ignores, such as `node_modules` or a local `.env`. The item's threads stay on the item. A toast confirms it: **Deleted aj-4821**, or **Deleted aj-4821 and its branch** when you ticked the box.

A worktree whose folder you deleted yourself shows as **Missing**. **Forget** removes it from Ajour's list. It deletes nothing.

Removing a repository folder from a project never deletes files: its worktrees and branches stay on disk, and leave Ajour's lists.

## Automatic clean up

Ajour removes the worktrees you no longer need, by two rules in **Settings › Worktrees**. Each rule has a switch and a delay.

| Rule                                   | Removes                                                                                    | By default         |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------ |
| **Remove worktrees of finished items** | The worktrees of an item that is done, settled or archived, once the delay has passed.     | On, after 3 days   |
| **Remove unused worktrees**            | A worktree with no hand off and no thread change for the delay, whatever its item's state. | Off, after 30 days |

Ajour checks when it starts, then once an hour. **Clean up now** checks at once.

Clean up never removes a worktree:

- with **uncommitted or untracked files**;
- with a thread that is **Working** or **Needs you**, also one that is not on the item, such as a thread you removed from it or started yourself in the worktree. For a thread that is not on the item, Ajour can only ask a tool whose plugin is on and that lists its threads;
- with a hand off or a thread change **in the last hour**;
- whose tool **can't say** what its threads are doing, such as when its plugin is off, or lists so many threads there that it may have left one out;
- **on another branch** than the one Ajour made it on;
- that is **no longer the folder Ajour made** in `.ajour/worktrees`.

It **never deletes a branch**. Your commits stay, and you can start a new worktree from that branch later: pick it as the source.

A worktree that clean up keeps says why in the list, such as **Kept: 3 changes**. Commit or discard the changes and the next check removes it. An item you reopen is no longer finished, so the first rule leaves its worktree alone.

::: info Ignored files go with the folder
Clean up counts the files `git status` shows. Files git ignores, such as `node_modules`, build output or a local `.env`, do not keep a worktree, and go with it. Keep anything you need outside the worktree, or commit it.
:::

A worktree a tool makes for itself is not in these lists. Ajour does not delete or clean it: the tool that made it does.

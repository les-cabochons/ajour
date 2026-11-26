import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commit, git, newRepository } from "./handoff-worktree-harness.ts";

/*
 * A user's clone of a repository on a bare "host" remote (#795), with
 * everything a fetch must leave alone: a dirty tracked file, an untracked
 * file, a second branch and a FETCH_HEAD. The pull request's head is a
 * commit only the host has, under `refs/pull/17/head` as GitHub keeps it
 * and on the branch `feature/login` as Azure DevOps does. Every path has a
 * space in it. Call `useHermeticGit` first.
 */
export interface DeckCloneFixture {
  root: string;
  /** The bare remote, as its clone address. */
  host: string;
  /** The user's clone. */
  clone: string;
  /** Where Ajour keeps its worktrees. */
  worktrees: string;
  base: string;
  head: string;
  /** Everything a fetch must leave as it was, read now. */
  userState(): Promise<Record<string, string>>;
  remove(): Promise<void>;
}

export async function deckCloneFixture(): Promise<DeckCloneFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "deck clone "));
  const seed = path.join(root, "seed repo");
  const host = path.join(root, "host remote.git");
  const clone = path.join(root, "user clone");
  await newRepository(seed);
  await writeFile(path.join(seed, "app.ts"), "export const answer = 1;\n");
  await writeFile(path.join(seed, "notes.md"), "base\n");
  // A file in a folder, which a sparse checkout of the user's can leave out.
  await mkdir(path.join(seed, "docs"));
  await writeFile(path.join(seed, "docs", "guide.md"), "# Guide\n");
  const base = commit(seed, ".", "base");
  git(root, "clone", "--quiet", "--bare", seed, host);
  git(root, "clone", "--quiet", host, clone);
  git(clone, "config", "user.name", "User");
  git(clone, "config", "user.email", "user@example.test");
  git(clone, "branch", "my-work");

  await writeFile(path.join(seed, "app.ts"), "export const answer = 42;\n");
  await writeFile(
    path.join(seed, "head only.ts"),
    "export const fresh = true;\n",
  );
  // A committed link that points out of the repository.
  const target = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: seed,
    input: "../../outside",
    encoding: "utf8",
  }).trim();
  git(
    seed,
    "update-index",
    "--add",
    "--cacheinfo",
    `120000,${target},link out`,
  );
  git(seed, "add", "--", "app.ts", "head only.ts");
  git(seed, "commit", "--quiet", "-m", "head");
  const head = git(seed, "rev-parse", "HEAD");
  git(seed, "push", "--quiet", host, "HEAD:refs/pull/17/head");
  git(seed, "push", "--quiet", host, "HEAD:refs/heads/feature/login");

  // The user's own fetch, so FETCH_HEAD exists, then their unsaved work.
  git(clone, "fetch", "--quiet", "origin", "main");
  await writeFile(path.join(clone, "notes.md"), "my unsaved edit\n");
  await writeFile(path.join(clone, "scratch.txt"), "untracked\n");

  const worktrees = path.join(root, "ajour data", "deck-cache", "worktrees");
  await mkdir(worktrees, { recursive: true });

  const gitDir = path.join(clone, ".git");
  const hash = async (file: string) =>
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  return {
    root,
    host,
    clone,
    worktrees,
    base,
    head,
    async userState() {
      return {
        head: git(clone, "rev-parse", "HEAD"),
        symbolicHead: git(clone, "symbolic-ref", "HEAD"),
        index: await hash(path.join(gitDir, "index")),
        fetchHead: await hash(path.join(gitDir, "FETCH_HEAD")),
        status: git(clone, "status", "--porcelain=v1", "--untracked-files=all"),
        branches: git(
          clone,
          "for-each-ref",
          "--format=%(refname) %(objectname)",
          "refs/heads",
          "refs/remotes",
          "refs/tags",
        ),
        notes: await readFile(path.join(clone, "notes.md"), "utf8"),
        scratch: await readFile(path.join(clone, "scratch.txt"), "utf8"),
      };
    },
    remove: () => rm(root, { recursive: true, force: true, maxRetries: 5 }),
  };
}

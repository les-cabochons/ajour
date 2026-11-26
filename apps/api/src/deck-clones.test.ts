import { existsSync, realpathSync } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeckClone } from "../../../packages/shared/deck.ts";
import {
  createDeckClones,
  type DeckCloneEntry,
  type DeckCloneKept,
} from "./deck-clones.ts";
import {
  deckCloneFixture,
  type DeckCloneFixture,
} from "./test-support/deck-clone-fixture.ts";
import { Git } from "./git-process.ts";
import {
  git,
  useHermeticGit,
} from "./test-support/handoff-worktree-harness.ts";

/*
 * Deck's local clone (#795) against real git: a fetch into private refs and
 * a detached worktree at the pull request's head, which leave the user's
 * clone as they left it and go with their cache entry.
 */

const repository = {
  pluginId: "github",
  connectionId: "c1",
  repository: "acme/api",
};

let fixture: DeckCloneFixture;
let restoreGit: () => Promise<void>;
let saved: DeckClone[];
/** Why cleanup left each folder it couldn't prove Deck's, in order. */
let kept: DeckCloneKept[];

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

function clones(
  worktreesFolder = fixture.worktrees,
  liveEntries?: () => Promise<DeckCloneEntry[]>,
) {
  return createDeckClones({
    ...(liveEntries ? { liveEntries } : {}),
    storage: {
      getDeckClones: async () => saved,
      saveDeckClone: async (clone) => {
        saved = [
          ...saved.filter(
            (other) =>
              other.pluginId !== clone.pluginId ||
              other.connectionId !== clone.connectionId ||
              other.repository !== clone.repository,
          ),
          clone,
        ];
      },
      forgetDeckClone: async (source) => {
        const before = saved.length;
        saved = saved.filter(
          (other) =>
            other.pluginId !== source.pluginId ||
            other.connectionId !== source.connectionId ||
            other.repository !== source.repository,
        );
        return saved.length < before;
      },
    },
    worktreesFolder,
    onKept: ({ reason }) => kept.push(reason),
  });
}

const entry = (overrides: Partial<DeckCloneEntry> = {}): DeckCloneEntry => ({
  key: JSON.stringify([
    "github",
    "c1",
    "acme/api",
    17,
    fixture.base,
    fixture.head,
  ]),
  ...repository,
  number: 17,
  head: fixture.head,
  clone: { repositoryIdentity: { cloneUrls: [fixture.host] } },
  ...overrides,
});

beforeEach(async () => {
  restoreGit = await useHermeticGit();
  fixture = await deckCloneFixture();
  saved = [];
  kept = [];
});

afterEach(async () => {
  await fixture.remove();
  await restoreGit();
});

describe("choosing a clone", { timeout: 30_000 }, () => {
  it("keeps the folder and the remote whose address names the repository", async () => {
    const chosen = await clones().choose(
      repository,
      { repositoryIdentity: { cloneUrls: [fixture.host] } },
      path.join(fixture.clone),
    );
    expect(chosen).toMatchObject({
      ...repository,
      environment: { kind: "native" },
      remote: "origin",
    });
    // Git names the folder by its long path, whatever form it was given.
    expect(realpathSync.native(chosen.path)).toBe(
      realpathSync.native(fixture.clone),
    );
    expect(saved).toEqual([chosen]);
  });

  it("refuses a folder none of whose remotes is the repository", async () => {
    await expect(
      clones().choose(
        repository,
        {
          repositoryIdentity: {
            cloneUrls: ["https://github.com/acme/other.git"],
          },
        },
        fixture.clone,
      ),
    ).rejects.toThrow("None of this folder's remotes is acme/api.");
    expect(saved).toEqual([]);
  });

  it("refuses a folder that isn't a Git clone", async () => {
    await expect(
      clones().choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.worktrees,
      ),
    ).rejects.toThrow("This folder isn't a Git clone.");
  });

  it("suggests the known folders whose remotes match", async () => {
    const suggestions = await clones().suggest(
      { repositoryIdentity: { cloneUrls: [fixture.host] } },
      [
        { id: "f1", name: "user clone", path: fixture.clone },
        { id: "f2", name: "worktrees", path: fixture.worktrees },
      ],
    );
    expect(suggestions).toEqual([
      { folderId: "f1", name: "user clone", path: fixture.clone },
    ]);
  });
});

describe(
  "reading the clone at the pull request's head",
  { timeout: 30_000 },
  () => {
    it("fetches the head into a private ref and checks it out in a detached worktree, leaving the user's clone untouched", async () => {
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const before = await fixture.userState();

      const prepared = await deck.prepare(entry());

      expect(prepared.state).toBe("read");
      if (prepared.state !== "read") return;
      // The worktree is under Ajour's folder, both by their real paths: a
      // runner's temp folder can be an 8.3 short name or macOS's `/var` link.
      expect(
        path
          .relative(
            realpathSync.native(fixture.worktrees),
            realpathSync.native(prepared.root),
          )
          .startsWith(".."),
      ).toBe(false);
      expect(
        await readFile(path.join(prepared.root, "head only.ts"), "utf8"),
      ).toBe("export const fresh = true;\n");
      expect(git(prepared.root, "rev-parse", "HEAD")).toBe(fixture.head);
      expect(() => git(prepared.root, "symbolic-ref", "-q", "HEAD")).toThrow();
      expect(await fixture.userState()).toEqual(before);
      expect(
        git(fixture.clone, "for-each-ref", "--format=%(refname)", "refs/ajour"),
      ).toMatch(/^refs\/ajour\/deck\/[0-9a-f]+\/head$/);

      // Asking again reads the same worktree.
      expect(await deck.prepare(entry())).toEqual(prepared);

      await deck.release(entry().key);

      expect(await exists(prepared.root)).toBe(false);
      expect(
        git(fixture.clone, "worktree", "list", "--porcelain"),
      ).not.toContain("detached");
      expect(
        git(fixture.clone, "for-each-ref", "--format=%(refname)", "refs/ajour"),
      ).toBe("");
      expect(await fixture.userState()).toEqual(before);
    });

    it("fetches an Azure DevOps pull request's source branch, never its merge ref", async () => {
      // The clone's remote is an Azure DevOps address the user's Git setup
      // rewrites to the fixture's host, as an `insteadOf` rule would.
      const azure = "https://dev.azure.com/org/Fabrikam%20Web/_git/api";
      git(fixture.clone, "remote", "set-url", "origin", azure);
      git(fixture.clone, "config", `url.${fixture.host}.insteadOf`, azure);
      // Its pull request ref is a merge Ajour must never read as the head.
      git(fixture.host, "update-ref", "-d", "refs/pull/17/head");
      git(fixture.host, "update-ref", "refs/pull/17/merge", fixture.base);
      const deck = clones();
      const source = {
        repositoryIdentity: { cloneUrls: [azure] },
        headRef: "feature/login",
      };
      await deck.choose(repository, source, fixture.clone);
      const before = await fixture.userState();
      // Without its branch, Ajour can't tell which commit is the head.
      expect(
        await deck.prepare(
          entry({ clone: { repositoryIdentity: { cloneUrls: [azure] } } }),
        ),
      ).toMatchObject({ state: "unavailable", failure: "no_head_ref" });

      const prepared = await deck.prepare(entry({ clone: source }));

      expect(prepared.state).toBe("read");
      if (prepared.state !== "read") return;
      expect(git(prepared.root, "rev-parse", "HEAD")).toBe(fixture.head);
      expect(await fixture.userState()).toEqual(before);
    });

    it("runs none of the clone's hooks or filters, and checks links out as plain files", async () => {
      const hooks = path.join(fixture.clone, ".git", "hooks");
      const marker = path.join(fixture.root, "hook ran");
      for (const hook of ["post-checkout", "reference-transaction"]) {
        await writeFile(
          path.join(hooks, hook),
          `#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\n`,
          { mode: 0o755 },
        );
      }
      // A required filter whose smudge fails would stop a plain checkout.
      git(fixture.clone, "config", "filter.secret.smudge", "false");
      git(fixture.clone, "config", "filter.secret.required", "true");
      await writeFile(
        path.join(fixture.clone, ".git", "info", "attributes"),
        "*.ts filter=secret\n",
      );
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );

      const prepared = await deck.prepare(entry());

      expect(prepared.state).toBe("read");
      if (prepared.state !== "read") return;
      expect(await exists(marker)).toBe(false);
      const link = path.join(prepared.root, "link out");
      expect((await lstat(link)).isSymbolicLink()).toBe(false);
      expect(await readFile(link, "utf8")).toBe("../../outside");
    });

    it("falls back with a reason when the head isn't on the remote", async () => {
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const before = await fixture.userState();
      const prepared = await deck.prepare(
        entry({ head: "0123456789abcdef0123456789abcdef01234567" }),
      );
      expect(prepared).toEqual({
        state: "unavailable",
        failure: "head_not_found",
        reason:
          "Your clone's remote doesn't have this pull request's head commit, 0123456.",
      });
      expect(await fixture.userState()).toEqual(before);
      expect(
        git(fixture.clone, "for-each-ref", "--format=%(refname)", "refs/ajour"),
      ).toBe("");
    });

    it("falls back with a reason when the fetch fails", async () => {
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      await rm(fixture.host, { recursive: true, force: true });
      const prepared = await deck.prepare(entry());
      expect(prepared).toMatchObject({
        state: "unavailable",
        failure: "fetch_failed",
        reason:
          "Ajour couldn't fetch this pull request into your clone. Check that git fetch works there.",
      });
    });

    it("falls back with a reason when the clone is gone", async () => {
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      await rm(fixture.clone, { recursive: true, force: true, maxRetries: 5 });
      expect(await deck.prepare(entry())).toEqual({
        state: "unavailable",
        failure: "clone_missing",
        reason:
          "Ajour can't find your clone of acme/api any more. Choose it again in Settings › Agents.",
      });
    });

    it("fetches a fork's branch only from an HTTPS or SSH address on the clone's own host, never a folder", async () => {
      const azure = "https://dev.azure.com/org/Fabrikam%20Web/_git/api";
      git(fixture.clone, "remote", "set-url", "origin", azure);
      git(fixture.clone, "config", `url.${fixture.host}.insteadOf`, azure);
      // A folder that has the branch, which a window could name as the fork.
      const elsewhere = path.join(fixture.root, "elsewhere.git");
      git(fixture.root, "clone", "--quiet", "--bare", fixture.host, elsewhere);
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [azure] } },
        fixture.clone,
      );
      const before = await fixture.userState();

      const prepared = await deck.prepare(
        entry({
          clone: {
            repositoryIdentity: {
              cloneUrls: [azure],
              source: { repository: "Alice/api", cloneUrls: [elsewhere] },
            },
            headRef: "feature/login",
          },
        }),
      );

      expect(prepared).toMatchObject({
        state: "unavailable",
        failure: "no_fork_remote",
      });
      expect(await fixture.userState()).toEqual(before);
      // Nothing was fetched: the clone doesn't have the head.
      expect(() =>
        git(fixture.clone, "cat-file", "-e", `${fixture.head}^{commit}`),
      ).toThrow();
    });

    it("removes what a preparation made when its entry leaves meanwhile", async () => {
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const preparing = deck.prepare(entry());
      const released = deck.release(entry().key);
      const prepared = await preparing;
      await released;

      expect(prepared.state).toBe("read");
      if (prepared.state !== "read") return;
      expect(await exists(prepared.root)).toBe(false);
      expect(
        git(fixture.clone, "for-each-ref", "--format=%(refname)", "refs/ajour"),
      ).toBe("");
    });

    it("stops at once when the ask is stopped, and leaves nothing behind", async () => {
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const stop = new AbortController();
      stop.abort();
      expect(await deck.prepare(entry(), stop.signal)).toMatchObject({
        state: "unavailable",
        failure: "cancelled",
      });
      expect(
        git(fixture.clone, "for-each-ref", "--format=%(refname)", "refs/ajour"),
      ).toBe("");
      expect(
        git(fixture.clone, "worktree", "list", "--porcelain"),
      ).not.toContain("detached");
    });

    it("says when no clone is chosen", async () => {
      expect(await clones().prepare(entry())).toEqual({ state: "not_chosen" });
    });

    it("removes a worktree left behind by an earlier run, even when its folder is gone", async () => {
      const first = clones();
      await first.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const prepared = await first.prepare(entry());
      if (prepared.state !== "read") throw new Error("Not prepared.");
      await rm(prepared.root, { recursive: true, force: true, maxRetries: 5 });

      // A new API: only the cache's live entries keep their worktrees.
      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(
        git(fixture.clone, "worktree", "list", "--porcelain"),
      ).not.toContain("prunable");
      expect(
        git(fixture.clone, "worktree", "list", "--porcelain"),
      ).not.toContain("detached");
      expect(
        git(fixture.clone, "for-each-ref", "--format=%(refname)", "refs/ajour"),
      ).toBe("");
    });

    it("removes a leftover when Ajour's data folder is reached through another name than git prints", async () => {
      // As a short 8.3 name or a link does: git prints the folder's real path.
      const linked = path.join(fixture.root, "data link");
      await symlink(path.dirname(fixture.worktrees), linked, "junction");
      const worktrees = path.join(linked, "worktrees");
      const first = clones(worktrees);
      await first.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const prepared = await first.prepare(entry());
      if (prepared.state !== "read") throw new Error("Not prepared.");
      await rm(prepared.root, { recursive: true, force: true, maxRetries: 5 });

      await clones(worktrees, async () => []).sweepAtStart();

      const listed = git(fixture.clone, "worktree", "list", "--porcelain");
      expect(listed).not.toContain("prunable");
      expect(listed).not.toContain("detached");
    });

    it("reuses, after a restart, the worktree of an entry the cache still holds", async () => {
      const first = clones();
      await first.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const prepared = await first.prepare(entry());
      if (prepared.state !== "read") throw new Error("Not prepared.");

      // A new API: the cache still holds the entry, so its worktree stays.
      const next = clones(fixture.worktrees, async () => [entry()]);
      const run = Git.prototype.run;
      const added: string[][] = [];
      const spy = vi
        .spyOn(Git.prototype, "run")
        .mockImplementation(async function (this: Git, args, ...rest) {
          if (args.includes("worktree") && args.includes("add")) {
            added.push([...args]);
          }
          return run.call(this, args, ...rest);
        });
      try {
        expect(await next.prepare(entry())).toEqual(prepared);
      } finally {
        spy.mockRestore();
      }
      expect(added).toEqual([]);
    });

    it("after a restart, checks out afresh beside a worktree with a file of the user's", async () => {
      const first = clones();
      await first.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const prepared = await first.prepare(entry());
      if (prepared.state !== "read") throw new Error("Not prepared.");
      const mine = path.join(prepared.root, "unsaved.txt");
      await writeFile(mine, "mine\n");

      const next = clones(fixture.worktrees, async () => [entry()]);
      const again = await next.prepare(entry());

      expect(again.state).toBe("read");
      if (again.state !== "read") return;
      expect(again.root).not.toBe(prepared.root);
      expect(await exists(path.join(again.root, "unsaved.txt"))).toBe(false);
      expect(await readFile(mine, "utf8")).toBe("mine\n");
    });

    it("keeps the worktree of an entry still in the cache", async () => {
      const first = clones();
      await first.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const prepared = await first.prepare(entry());
      const next = clones(fixture.worktrees, async () => [entry()]);
      await next.sweepAtStart();
      expect(await next.prepare(entry())).toEqual(prepared);
    });
  },
);

describe(
  "after a restart, an earlier run's worktrees still go",
  { timeout: 60_000 },
  () => {
    const other = () =>
      entry({
        key: JSON.stringify([
          "github",
          "c1",
          "acme/api",
          18,
          fixture.base,
          fixture.head,
        ]),
        number: 18,
      });
    const refs = (clone = fixture.clone) =>
      git(clone, "for-each-ref", "--format=%(refname)", "refs/ajour");

    /** Each entry's worktree, prepared by an API that then stopped. */
    async function preparedByEarlierRun(...entries: DeckCloneEntry[]) {
      const first = clones();
      await first.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const roots: string[] = [];
      for (const each of entries) {
        const prepared = await first.prepare(each);
        if (prepared.state !== "read") throw new Error("Not prepared.");
        roots.push(prepared.root);
      }
      return roots;
    }

    it("Clear cache removes every worktree an earlier run made", async () => {
      const roots = await preparedByEarlierRun(entry(), other());
      const next = clones(fixture.worktrees, async () => []);

      await next.release(entry().key, repository);
      await next.release(other().key, repository);

      for (const root of roots) expect(await exists(root)).toBe(false);
      expect(
        git(fixture.clone, "worktree", "list", "--porcelain"),
      ).not.toContain("detached");
      expect(refs()).toBe("");
    });

    it("an eviction removes that entry's worktree and keeps the others", async () => {
      const [evicted, kept] = await preparedByEarlierRun(entry(), other());
      const next = clones(fixture.worktrees, async () => [other()]);

      await next.release(entry().key, repository);

      expect(await exists(evicted!)).toBe(false);
      expect(await exists(kept!)).toBe(true);
      // One ref is left: the kept entry's.
      expect(refs()).toMatch(/^refs\/ajour\/deck\/[0-9a-f]+\/head$/);
      expect(await next.prepare(other())).toEqual({
        state: "read",
        root: kept,
      });
    });

    it("forgetting the clone removes its worktrees before its mapping goes", async () => {
      const [root] = await preparedByEarlierRun(entry());
      const next = clones(fixture.worktrees, async () => [entry()]);

      expect(await next.forget(repository)).toBe(true);

      expect(saved).toEqual([]);
      expect(await exists(root!)).toBe(false);
      expect(
        git(fixture.clone, "worktree", "list", "--porcelain"),
      ).not.toContain("detached");
      expect(refs()).toBe("");
    });

    it("choosing another clone removes the earlier clone's worktrees", async () => {
      const [root] = await preparedByEarlierRun(entry());
      const another = path.join(fixture.root, "another clone");
      git(fixture.root, "clone", "--quiet", fixture.host, another);
      const next = clones(fixture.worktrees, async () => [entry()]);

      await next.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        another,
      );

      expect(await exists(root!)).toBe(false);
      expect(
        git(fixture.clone, "worktree", "list", "--porcelain"),
      ).not.toContain("detached");
      expect(refs()).toBe("");
      // The next ask reads the clone chosen now.
      const prepared = await next.prepare(entry());
      if (prepared.state !== "read") throw new Error("Not prepared.");
      expect(git(prepared.root, "rev-parse", "--git-common-dir")).toContain(
        "another clone",
      );
    });

    it("at start, removes the worktrees of entries the cache no longer holds", async () => {
      const [gone, kept] = await preparedByEarlierRun(entry(), other());
      const next = clones(fixture.worktrees, async () => [other()]);

      await next.sweepAtStart();

      expect(await exists(gone!)).toBe(false);
      expect(await exists(kept!)).toBe(true);
      // One ref is left: the kept entry's.
      expect(refs()).toMatch(/^refs\/ajour\/deck\/[0-9a-f]+\/head$/);
    });

    it("at start, keeps the folders of a clone that is gone, and says so", async () => {
      const [gone, live] = await preparedByEarlierRun(entry(), other());
      await rm(fixture.clone, { recursive: true, force: true, maxRetries: 5 });
      const next = clones(fixture.worktrees, async () => [other()]);

      await next.sweepAtStart();

      // No clone's git can check them, so nothing removes them.
      expect(await exists(gone!)).toBe(true);
      expect(await exists(live!)).toBe(true);
      expect(kept).toEqual(["not_listed"]);
    });

    it("an eviction during the first sweep still removes that entry's worktree", async () => {
      const [evicted, kept] = await preparedByEarlierRun(entry(), other());
      let live = [entry(), other()];
      let opened!: () => void;
      const gate = new Promise<void>((resolve) => (opened = resolve));
      let read!: () => void;
      const sweepRead = new Promise<void>((resolve) => (read = resolve));
      let first = true;
      const next = clones(fixture.worktrees, async () => {
        const now = live;
        if (!first) return now;
        first = false;
        read();
        await gate;
        return now;
      });

      // The sweep has read the cache, with the entry still in it, when the
      // entry is evicted.
      const sweeping = next.sweepAtStart();
      await sweepRead;
      live = [other()];
      const releasing = next.release(entry().key, repository);
      opened();
      await Promise.all([sweeping, releasing]);

      expect(await exists(evicted!)).toBe(false);
      expect(await exists(kept!)).toBe(true);
      expect(refs()).toMatch(/^refs\/ajour\/deck\/[0-9a-f]+\/head$/);
    });
  },
);

describe(
  "cleanup removes only what Deck made, under its own folder",
  { timeout: 60_000 },
  () => {
    const worktreeList = () =>
      git(fixture.clone, "worktree", "list", "--porcelain");
    const refs = () =>
      git(fixture.clone, "for-each-ref", "--format=%(refname)", "refs/ajour");

    /** The entry's worktree, prepared by an API that then stopped. */
    async function preparedByEarlierRun() {
      const first = clones();
      await first.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const prepared = await first.prepare(entry());
      if (prepared.state !== "read") throw new Error("Not prepared.");
      return prepared.root;
    }

    /**
     * Moves the worktree out of the cache and puts a junction (a symbolic
     * link off Windows) to it where it was, with a file of the user's in it.
     */
    async function linkedOutside(root: string) {
      const outside = path.join(fixture.root, "moved out");
      await rename(root, outside);
      await symlink(outside, root, "junction");
      const marker = path.join(outside, "my file.txt");
      await writeFile(marker, "mine\n");
      return { outside, marker };
    }

    it("at start, keeps a junction where its worktree was, and what it points to", async () => {
      const root = await preparedByEarlierRun();
      const { outside, marker } = await linkedOutside(root);

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(await readFile(marker, "utf8")).toBe("mine\n");
      expect(await exists(path.join(outside, "head only.ts"))).toBe(true);
      expect((await lstat(root)).isSymbolicLink()).toBe(true);
      expect(kept).toContain("linked");
      expect(refs()).toBe("");
    });

    it("a release keeps a junction where its worktree was, and what it points to", async () => {
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const prepared = await deck.prepare(entry());
      if (prepared.state !== "read") throw new Error("Not prepared.");
      const { marker } = await linkedOutside(prepared.root);

      await deck.release(entry().key);

      expect(await readFile(marker, "utf8")).toBe("mine\n");
      expect((await lstat(prepared.root)).isSymbolicLink()).toBe(true);
      expect(kept).toContain("linked");
    });

    it("at start, a gone clone's junction stays, and what it points to", async () => {
      const root = await preparedByEarlierRun();
      const { marker } = await linkedOutside(root);
      await rm(fixture.clone, { recursive: true, force: true, maxRetries: 5 });

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(await readFile(marker, "utf8")).toBe("mine\n");
      expect((await lstat(root)).isSymbolicLink()).toBe(true);
    });

    it("never removes the user's own worktrees or folders under the cache", async () => {
      await preparedByEarlierRun();
      // A worktree the user made there, with work of theirs, and another
      // with a name like Deck's.
      const named = path.join(fixture.worktrees, "my-own-worktree");
      const hashed = path.join(fixture.worktrees, "0123456789abcdef");
      for (const folder of [named, hashed]) {
        git(fixture.clone, "worktree", "add", "--quiet", "--detach", folder);
        await writeFile(path.join(folder, "unsaved.txt"), "mine\n");
      }
      // A folder of theirs with a name like Deck's, and a link to another.
      const plain = path.join(fixture.worktrees, "fedcba9876543210");
      await mkdir(plain);
      await writeFile(path.join(plain, "notes.txt"), "mine\n");
      const elsewhere = path.join(fixture.root, "elsewhere");
      await mkdir(elsewhere);
      await writeFile(path.join(elsewhere, "notes.txt"), "mine\n");
      await symlink(
        elsewhere,
        path.join(fixture.worktrees, "00112233aabbccdd"),
        "junction",
      );

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      for (const folder of [named, hashed]) {
        expect(await readFile(path.join(folder, "unsaved.txt"), "utf8")).toBe(
          "mine\n",
        );
        expect(worktreeList()).toContain(path.basename(folder));
      }
      expect(await readFile(path.join(plain, "notes.txt"), "utf8")).toBe(
        "mine\n",
      );
      expect(await readFile(path.join(elsewhere, "notes.txt"), "utf8")).toBe(
        "mine\n",
      );
      // Deck's own leftover still went.
      expect(worktreeList()).not.toMatch(/[\\/][0-9a-f]{16}\n.*\nHEAD/);
      expect(refs()).toBe("");
    });

    it("never prunes while a registration outside Deck's folder would go with it", async () => {
      const root = await preparedByEarlierRun();
      const elsewhere = path.join(fixture.root, "0123456789abcdef");
      git(fixture.clone, "worktree", "add", "--quiet", "--detach", elsewhere);
      // Both folders are away: git would prune both registrations at once.
      await rm(elsewhere, { recursive: true, force: true, maxRetries: 5 });
      await rm(root, { recursive: true, force: true, maxRetries: 5 });

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(worktreeList()).toContain("0123456789abcdef");
    });

    it("removes nothing when the worktrees folder itself is a junction", async () => {
      const root = await preparedByEarlierRun();
      // The user moved Deck's worktrees folder and left a junction to it.
      const moved = path.join(fixture.root, "moved worktrees");
      await rename(fixture.worktrees, moved);
      await symlink(moved, fixture.worktrees, "junction");
      const mine = path.join(moved, path.basename(root), "unsaved.txt");
      await writeFile(mine, "mine\n");

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(await readFile(mine, "utf8")).toBe("mine\n");
      expect(kept).toContain("linked");
    });

    it("keeps the user's worktree made where Deck's was", async () => {
      const root = await preparedByEarlierRun();
      // Git removed Deck's worktree; the user made one of theirs there.
      git(fixture.clone, "worktree", "remove", "--force", root);
      git(fixture.clone, "worktree", "add", "--quiet", "--detach", root);
      const mine = path.join(root, "unsaved.txt");
      await writeFile(mine, "mine\n");

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(await readFile(mine, "utf8")).toBe("mine\n");
      expect(worktreeList()).toContain(path.basename(root));
      expect(kept).toContain("not_clean");
    });

    it("keeps a folder no clone lists, whatever file is beside it", async () => {
      const folder = path.join(fixture.worktrees, "0123456789abcdef");
      await mkdir(folder);
      await writeFile(path.join(folder, "unsaved.txt"), "mine\n");
      await writeFile(`${folder}.deck`, "unrelated file");

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(await readFile(path.join(folder, "unsaved.txt"), "utf8")).toBe(
        "mine\n",
      );
      expect(kept).toContain("not_listed");
    });

    it("makes no folder for an old mark whose worktree is gone", async () => {
      const id = "0123456789abcdef";
      await writeFile(path.join(fixture.worktrees, `${id}.deck`), "old mark");

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(await exists(path.join(fixture.worktrees, id))).toBe(false);
    });

    /**
     * Releases the entry's worktree, with `swap` run just before git is
     * asked to remove it: after every check Deck makes.
     */
    async function releasedWithSwap(swap: (root: string) => Promise<void>) {
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const prepared = await deck.prepare(entry());
      if (prepared.state !== "read") throw new Error("Not prepared.");
      const run = Git.prototype.run;
      let swapped = false;
      const spy = vi
        .spyOn(Git.prototype, "run")
        .mockImplementation(async function (this: Git, args, ...rest) {
          if (
            !swapped &&
            args.includes("worktree") &&
            args.includes("remove")
          ) {
            swapped = true;
            await swap(prepared.root);
          }
          return run.call(this, args, ...rest);
        });
      try {
        await deck.release(entry().key);
      } finally {
        spy.mockRestore();
      }
      expect(swapped).toBe(true);
      return prepared.root;
    }

    it("keeps the user's file when the worktree is moved and linked just before git removes it", async () => {
      const moved = path.join(fixture.root, "moved out");
      const mine = path.join(moved, "unsaved.txt");

      await releasedWithSwap(async (root) => {
        await rename(root, moved);
        await writeFile(mine, "mine\n");
        await symlink(moved, root, "junction");
      });

      expect(await readFile(mine, "utf8")).toBe("mine\n");
      expect(kept).toContain("git_refused");
    });

    it("keeps the user's own worktree outside the cache when a junction to it is swapped in", async () => {
      const outside = path.join(fixture.root, "my own worktree");
      git(fixture.clone, "worktree", "add", "--quiet", "--detach", outside);
      const mine = path.join(outside, "unsaved.txt");
      await writeFile(mine, "mine\n");

      await releasedWithSwap(async (root) => {
        await rename(root, path.join(fixture.root, "deck's moved"));
        await symlink(outside, root, "junction");
      });

      expect(await readFile(mine, "utf8")).toBe("mine\n");
      expect(worktreeList()).toContain("my own worktree");
    });

    it("keeps the user's folder swapped in just before git removes the worktree", async () => {
      const outside = path.join(fixture.root, "my folder");
      await mkdir(outside);
      await writeFile(path.join(outside, "unsaved.txt"), "mine\n");

      const root = await releasedWithSwap(async (root) => {
        await rename(root, path.join(fixture.root, "deck's moved"));
        await rename(outside, root);
      });

      expect(await readFile(path.join(root, "unsaved.txt"), "utf8")).toBe(
        "mine\n",
      );
    });

    it("removes the worktree when the ask stops just after its checkout", async () => {
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const stop = new AbortController();
      const run = Git.prototype.run;
      let made: string | undefined;
      const spy = vi
        .spyOn(Git.prototype, "run")
        .mockImplementation(async function (this: Git, args, ...rest) {
          const result = await run.call(this, args, ...rest);
          if (args.includes("worktree") && args.includes("add") && !made) {
            made = args[args.indexOf("--") + 1];
            stop.abort();
          }
          return result;
        });
      let outcome;
      try {
        outcome = await deck.prepare(entry(), stop.signal);
      } finally {
        spy.mockRestore();
      }

      expect(outcome).toMatchObject({
        state: "unavailable",
        failure: "cancelled",
      });
      expect(made).toBeTruthy();
      expect(await exists(made!)).toBe(false);
      expect(worktreeList()).not.toContain("detached");
      expect(await exists(`${made}.deck`)).toBe(false);
    });

    it.runIf(process.platform === "win32")(
      "prepares and releases through a differently cased worktrees folder",
      async () => {
        const deck = clones(fixture.worktrees.toUpperCase());
        await deck.choose(
          repository,
          { repositoryIdentity: { cloneUrls: [fixture.host] } },
          fixture.clone,
        );
        const prepared = await deck.prepare(entry());
        if (prepared.state !== "read") throw new Error("Not prepared.");

        await deck.release(entry().key);

        expect(await exists(prepared.root)).toBe(false);
      },
    );

    it("checks out every file when the user's clone is sparse, and leaves it sparse", async () => {
      git(fixture.clone, "sparse-checkout", "set", "src");
      const sparse = () => ({
        patterns: git(fixture.clone, "sparse-checkout", "list"),
        config: git(fixture.clone, "config", "--list", "--show-scope"),
        files: git(fixture.clone, "ls-files", "-t"),
        guide: existsSync(path.join(fixture.clone, "docs", "guide.md")),
      });
      const before = { ...(await fixture.userState()), ...sparse() };
      expect(before.guide).toBe(false);
      const deck = clones();
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );

      const prepared = await deck.prepare(entry());

      expect(prepared.state).toBe("read");
      if (prepared.state !== "read") return;
      expect(
        await readFile(path.join(prepared.root, "docs", "guide.md"), "utf8"),
      ).toBe("# Guide\n");
      expect(
        await readFile(path.join(prepared.root, "head only.ts"), "utf8"),
      ).toBe("export const fresh = true;\n");
      expect(git(prepared.root, "ls-files", "-t")).not.toMatch(/^S /m);
      // Git copies the clone's own worktree settings: the worktree's say it
      // isn't sparse, so git run there later checks out every file too.
      expect(
        git(
          prepared.root,
          "config",
          "--type=bool",
          "--default=false",
          "--get",
          "core.sparseCheckout",
        ),
      ).toBe("false");
      expect({ ...(await fixture.userState()), ...sparse() }).toEqual(before);
    });
  },
);

describe(
  "cleanup removes a worktree only while git status shows nothing in it",
  { timeout: 60_000 },
  () => {
    const worktreeList = () =>
      git(fixture.clone, "worktree", "list", "--porcelain");

    /** The entry's worktree, prepared by `deck`. */
    async function prepared(deck = clones()) {
      await deck.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const made = await deck.prepare(entry());
      if (made.state !== "read") throw new Error("Not prepared.");
      return { deck, root: made.root };
    }

    it("keeps a file the user's Git setup ignores", async () => {
      const { deck, root } = await prepared();
      await writeFile(
        path.join(fixture.clone, ".git", "info", "exclude"),
        "\nprivate-notes.txt\n",
      );
      const mine = path.join(root, "private-notes.txt");
      await writeFile(mine, "my own notes\n");
      // A plain status hides it, and a plain `git worktree remove` deletes
      // it. (Links read as plain files, as Deck checked them out.)
      expect(
        git(root, "-c", "core.symlinks=false", "status", "--porcelain"),
      ).toBe("");

      await deck.release(entry().key);

      expect(await readFile(mine, "utf8")).toBe("my own notes\n");
      expect(worktreeList()).toContain(path.basename(root));
      expect(kept).toEqual(["not_clean"]);
    });

    /** What the user writes over a file of Deck's checkout. */
    const MINE = "export const mine = true;\n";

    it("keeps a file changed under an index flag that hides it from git status", async () => {
      for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
        kept.length = 0;
        const { deck, root } = await prepared();
        git(root, "update-index", flag, "head only.ts");
        const changed = path.join(root, "head only.ts");
        await writeFile(changed, MINE);

        await deck.release(entry().key);

        expect(await readFile(changed, "utf8")).toBe(MINE);
        expect(kept).toEqual(["not_clean"]);
        git(root, "update-index", flag.replace("--", "--no-"), "head only.ts");
        git(root, "checkout", "--", "head only.ts");
        await deck.release(entry().key);
      }
    });

    // Windows git reads a file's creation time as its ctime, so an edit
    // that keeps its size and modification time can't be told there.
    it.skipIf(process.platform === "win32")(
      "keeps an edit that keeps the file's size and time, whatever the clone sets for stat checks",
      async () => {
        git(fixture.clone, "config", "core.checkStat", "minimal");
        git(fixture.clone, "config", "core.trustctime", "false");
        const { deck, root } = await prepared();
        const changed = path.join(root, "head only.ts");
        const before = await stat(changed);
        const same = (await readFile(changed, "utf8")).replace(/[a-z]/, "Z");
        await writeFile(changed, same);
        await utimes(changed, before.atime, before.mtime);

        await deck.release(entry().key);

        expect(await readFile(changed, "utf8")).toBe(same);
        expect(kept).toEqual(["not_clean"]);
      },
    );

    it("keeps a file changed in a checkout of a clone that sets core.ignorestat", async () => {
      git(fixture.clone, "config", "core.ignorestat", "true");
      const { deck, root } = await prepared();
      const changed = path.join(root, "head only.ts");
      await writeFile(changed, MINE);

      await deck.release(entry().key);

      expect(await readFile(changed, "utf8")).toBe(MINE);
      expect(kept).toEqual(["not_clean"]);
    });

    it("keeps a changed file of Deck's checkout", async () => {
      const { deck, root } = await prepared();
      const changed = path.join(root, "head only.ts");
      await writeFile(changed, "export const mine = true;\n");

      await deck.release(entry().key);

      expect(await readFile(changed, "utf8")).toBe(
        "export const mine = true;\n",
      );
      expect(kept).toEqual(["not_clean"]);
    });

    it("keeps the user's file in a worktree whose clone is gone", async () => {
      const { root } = await prepared();
      const mine = path.join(root, "unsaved.txt");
      await writeFile(mine, "mine\n");
      await rm(fixture.clone, { recursive: true, force: true, maxRetries: 5 });

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(await readFile(mine, "utf8")).toBe("mine\n");
      expect(kept).toEqual(["not_listed"]);
    });

    it("a release keeps the worktree of a clone that is gone", async () => {
      const { deck, root } = await prepared();
      await rm(fixture.clone, { recursive: true, force: true, maxRetries: 5 });

      await deck.release(entry().key);

      expect(await exists(path.join(root, "head only.ts"))).toBe(true);
      expect(kept).toEqual(["clone_gone"]);
    });

    it("keeps a folder of the user's beside a mark edited to name it", async () => {
      const { root } = await prepared();
      git(fixture.clone, "worktree", "remove", "--force", root);
      await mkdir(root);
      const mine = path.join(root, "mine.txt");
      await writeFile(mine, "mine\n");
      const stats = await lstat(root, { bigint: true });
      await writeFile(
        `${root}.deck`,
        JSON.stringify({
          kind: "ajour-deck-worktree",
          version: 1,
          id: path.basename(root),
          dev: String(stats.dev),
          ino: String(stats.ino),
          birth: String(stats.birthtimeNs),
        }),
      );

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(await readFile(mine, "utf8")).toBe("mine\n");
    });

    it("keeps a folder of the user's where Deck's was, under a data folder reached through a junction", async () => {
      const { root } = await prepared();
      const parent = path.dirname(fixture.worktrees);
      const moved = path.join(fixture.root, "moved parent");
      await rename(parent, moved);
      await symlink(moved, parent, "junction");
      const held = path.join(moved, "worktrees", path.basename(root));
      await rename(held, `${held}-old`);
      await mkdir(held);
      const mine = path.join(held, "mine.txt");
      await writeFile(mine, "mine\n");

      await clones(fixture.worktrees, async () => []).sweepAtStart();

      expect(await readFile(mine, "utf8")).toBe("mine\n");
    });

    it("keeps a file the user writes in the worktree just before git removes it", async () => {
      const { deck, root } = await prepared();
      const mine = path.join(root, "unsaved.txt");
      const run = Git.prototype.run;
      const spy = vi
        .spyOn(Git.prototype, "run")
        .mockImplementation(async function (this: Git, args, ...rest) {
          if (args.includes("worktree") && args.includes("remove")) {
            await writeFile(mine, "mine\n");
          }
          return run.call(this, args, ...rest);
        });
      try {
        await deck.release(entry().key);
      } finally {
        spy.mockRestore();
      }

      expect(await readFile(mine, "utf8")).toBe("mine\n");
      expect(kept).toEqual(["git_refused"]);
    });

    it("a kept worktree doesn't stop the next ask: it reads a fresh folder", async () => {
      const { deck, root } = await prepared();
      const mine = path.join(root, "unsaved.txt");
      await writeFile(mine, "mine\n");
      await deck.release(entry().key);

      const again = await deck.prepare(entry());

      expect(again.state).toBe("read");
      if (again.state !== "read") return;
      expect(again.root).not.toBe(root);
      expect(path.dirname(again.root)).toBe(path.dirname(root));
      expect(git(again.root, "rev-parse", "HEAD")).toBe(fixture.head);
      expect(await readFile(mine, "utf8")).toBe("mine\n");

      // Its release removes the fresh one, clean, and keeps the user's.
      await deck.release(entry().key);
      expect(await exists(again.root)).toBe(false);
      expect(await readFile(mine, "utf8")).toBe("mine\n");
    });

    it("counts the clone folders it keeps on this computer", async () => {
      const { deck, root } = await prepared();
      expect(await deck.keptFolderCount()).toBe(0);
      await writeFile(path.join(root, "unsaved.txt"), "mine\n");

      await deck.release(entry().key);

      expect(await deck.keptFolderCount()).toBe(1);
      // A worktree in use isn't kept.
      await deck.prepare(entry());
      expect(await deck.keptFolderCount()).toBe(1);
    });
  },
);

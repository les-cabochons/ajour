import { realpathSync } from "node:fs";
import {
  access,
  lstat,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeckClone } from "../../../packages/shared/deck.ts";
import { createDeckClones, type DeckCloneEntry } from "./deck-clones.ts";
import {
  deckCloneFixture,
  type DeckCloneFixture,
} from "./test-support/deck-clone-fixture.ts";
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

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

function clones(
  worktreesFolder = fixture.worktrees,
  liveKeys?: () => Promise<string[]>,
) {
  return createDeckClones({
    ...(liveKeys ? { liveKeys } : {}),
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
      expect(
        path.relative(fixture.worktrees, prepared.root).startsWith(".."),
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
      await clones().releaseExcept(new Set());

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

      await clones(worktrees).releaseExcept(new Set());

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
      const marker = path.join(prepared.root, "still here");
      await writeFile(marker, "");

      // A new API: the cache still holds the entry, so its worktree stays.
      const next = clones(fixture.worktrees, async () => [entry().key]);
      expect(await next.prepare(entry())).toEqual(prepared);
      expect(await exists(marker)).toBe(true);
    });

    it("keeps the worktree of an entry still in the cache", async () => {
      const first = clones();
      await first.choose(
        repository,
        { repositoryIdentity: { cloneUrls: [fixture.host] } },
        fixture.clone,
      );
      const prepared = await first.prepare(entry());
      const next = clones();
      await next.releaseExcept(new Set([entry().key]));
      expect(await next.prepare(entry())).toEqual(prepared);
    });
  },
);

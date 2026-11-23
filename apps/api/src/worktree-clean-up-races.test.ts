import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  cleanUpWorktreeApps,
  localRepository,
  setUp,
  useHermeticGit,
} from "./test-support/handoff-worktree-harness.ts";

/*
 * A hand off that arrives while automatic clean up removes the worktree it
 * would start in (#864). The removal reads git status under the
 * repository's lock, and a hand off takes its hold on a worktree through
 * the same lock. To put the hand off in that exact moment, git runs
 * through a script that is real git with one pause: the status call the
 * test names waits until the test lets it go. Nothing fakes git. One test
 * makes the lookup of `git` on PATH find nothing instead, for a hand off
 * that can't take the repository's lock.
 */
const slowGit = vi.hoisted(() => ({ path: "", missing: false }));
vi.mock("./agent-runner/cli-path.ts", async (actual) => {
  const real = await actual<typeof import("./agent-runner/cli-path.ts")>();
  return {
    ...real,
    findExecutable: (name: string, pathValue: string) =>
      name === "git" && slowGit.missing
        ? Promise.resolve(null)
        : slowGit.path && name === "git"
          ? Promise.resolve(slowGit.path)
          : real.findExecutable(name, pathValue),
  };
});

const DAY = 86_400_000;
let now = 0;

let restoreGit: () => Promise<void>;
beforeAll(async () => {
  restoreGit = await useHermeticGit();
});
afterAll(() => restoreGit());
afterEach(async () => {
  slowGit.path = "";
  slowGit.missing = false;
  await cleanUpWorktreeApps();
});

/**
 * Makes the module's git the pausing script. Its `pauseStatus(n)` makes the
 * n-th `git status` from now wait, `paused()` says it is waiting, and `go()`
 * lets it finish.
 */
async function pausingGit(root: string) {
  const folder = path.join(root, "pausing-git");
  await mkdir(folder);
  const realGit = execFileSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  const script = path.join(folder, "git");
  await writeFile(
    script,
    `#!/bin/sh
here="${folder}"
case " $* " in
  *" status "*)
    if [ -f "$here/pause" ]; then
      n=$(($(cat "$here/count" 2>/dev/null || echo 0) + 1))
      echo "$n" > "$here/count"
      if [ "$n" = "$(cat "$here/pause")" ]; then
        : > "$here/paused"
        while [ ! -f "$here/go" ]; do sleep 0.02; done
      fi
    fi
    ;;
esac
exec "${realGit}" "$@"
`,
  );
  await chmod(script, 0o755);
  slowGit.path = script;
  return {
    pauseStatus: (nth: number) =>
      writeFile(path.join(folder, "pause"), String(nth)),
    paused: () => existsSync(path.join(folder, "paused")),
    go: () => writeFile(path.join(folder, "go"), ""),
  };
}

// The pausing git is a shell script.
it.skipIf(process.platform === "win32")(
  "makes a hand off wait for a removal under way, then refuses it, so no tool starts in a worktree that is being removed",
  async () => {
    now = Date.parse("2026-11-01T09:00:00Z");
    const app = await setUp(
      ({ repo }) => localRepository(repo).then(() => {}),
      {
        handoffClock: () => now,
      },
    );
    const first = await app.handOff("4821", "Week grid");
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const worktree = first.body.worktree!;
    await writeFile(path.join(app.root, "state.txt"), "ready");
    await app.call("POST", `/api/handoffs/${first.body.id}/refresh`);
    const doneAt = now;
    now = doneAt + 5 * DAY;
    const starts = () =>
      app.calls().filter((call) => call.op === "start").length;
    const git = await pausingGit(app.root);
    // A round reads git status twice for a worktree it removes: when it
    // first looks, then under the lock, right before the removal.
    await git.pauseStatus(2);
    const cleaning = app.call("POST", "/api/worktrees/clean-up", {
      trigger: "timer",
      finished: [{ workItemId: "item-4821", finishedAt: doneAt }],
    });
    await vi.waitFor(() => expect(git.paused()).toBe(true), {
      timeout: 10_000,
    });

    // The removal is past its last look. A hand off of the item into that
    // worktree arrives now.
    const starting = app.handOff("4821", "Week grid", {
      startIn: { kind: "worktree", worktreeId: worktree.id },
    });
    // Time for the hand off to reach its claim on the worktree. With the
    // shared lock the outcome is the same whenever it does.
    await new Promise((done) => setTimeout(done, 400));
    expect(starts()).toBe(1);
    await git.go();

    const [cleaned, started] = await Promise.all([cleaning, starting]);
    expect(cleaned.body).toMatchObject({
      removed: [{ worktreeId: worktree.id, rule: "finished" }],
      kept: [],
    });
    expect(existsSync(app.worktreeFolder("aj-4821"))).toBe(false);
    // The hand off waited, found the worktree gone and asked no tool.
    expect(started.status).toBe(409);
    expect(started.body.error).toBe(
      "This worktree is no longer available. Choose another place to start.",
    );
    expect(starts()).toBe(1);
    expect((await app.call("GET", "/api/handoffs")).body).toHaveLength(1);
  },
  // A full hand off and a scripted git: seconds on a loaded machine.
  20_000,
);

/** A server on the test's clock, with item 4821 handed off and its thread Ready. */
async function finishedWork() {
  now = Date.parse("2026-11-01T09:00:00Z");
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}), {
    handoffClock: () => now,
  });
  const first = await app.handOff("4821", "Week grid");
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  await writeFile(path.join(app.root, "state.txt"), "ready");
  await app.call("POST", `/api/handoffs/${first.body.id}/refresh`);
  const starts = () => app.calls().filter((call) => call.op === "start").length;
  return { app, worktree: first.body.worktree!, doneAt: now, starts };
}

// The pausing git is a shell script.
it.skipIf(process.platform === "win32")(
  "removes nothing when the rule is switched off while the removal reads git status for the last time",
  async () => {
    const { app, doneAt } = await finishedWork();
    now = doneAt + 5 * DAY;
    const git = await pausingGit(app.root);
    await git.pauseStatus(2);
    const cleaning = app.call("POST", "/api/worktrees/clean-up", {
      trigger: "timer",
      finished: [{ workItemId: "item-4821", finishedAt: doneAt }],
    });
    await vi.waitFor(() => expect(git.paused()).toBe(true), {
      timeout: 10_000,
    });

    // The user switches the rule off while git reads the worktree's status.
    expect(
      (
        await app.call("POST", "/api/worktrees/settings", {
          cleanUp: { finished: { enabled: false, days: 3 } },
        })
      ).status,
    ).toBe(200);
    await git.go();

    expect((await cleaning).body).toMatchObject({ removed: [], kept: [] });
    expect(
      existsSync(path.join(app.worktreeFolder("aj-4821"), "README.md")),
    ).toBe(true);
    expect((await app.call("GET", "/api/worktrees")).body).toHaveLength(1);
  },
  // A full hand off and a scripted git: seconds on a loaded machine.
  20_000,
);

it("refuses a hand off into a worktree whose repository lock it can't take, and asks no tool", async () => {
  const { app, worktree, starts } = await finishedWork();
  // No git answers: Ajour can't tell which repository lock guards the
  // worktree, so it can't know that no removal is under way.
  slowGit.missing = true;

  const started = await app.handOff("4821", "Week grid", {
    startIn: { kind: "worktree", worktreeId: worktree.id },
  });

  expect(started.status).toBe(409);
  expect(started.body.error).toBe(
    "This worktree is no longer available. Choose another place to start.",
  );
  expect(starts()).toBe(1);
  expect((await app.call("GET", "/api/handoffs")).body).toHaveLength(1);
});

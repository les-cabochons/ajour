// The hand off cases of the release check (#725): the official
// `agent-handoff` plugin hands a backlog item off to T3 Code and follows its
// thread, through the real app API, process broker and sandboxed renderer.
// T3 Code is `fake-t3.cjs`, put first on PATH as an npm install would put
// `t3` there: on Windows a `.cmd` shim, which the broker resolves to node.exe
// and the script without cmd.exe. It answers with T3's recorded outputs, and
// the case moves its thread through T3's statuses between refreshes.
//
// Outside Windows the broker reads PATH from the user's login shell, `$SHELL
// -ilc` (apps/api/src/agent-runner/cli-path.ts), whose profile could reorder
// or drop the fake tool's folder, and caches the first answer. So `prepare`
// runs before the API exists: it puts the folder first on PATH and points
// SHELL at a stand-in that runs the command without a profile, so the PATH
// the broker reads is the check's own on every system.
"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { writeFakeTool } = require("../fake-tool.cjs");
const { eventsHold } = require("../event-values.cjs");

/** The login shell's stand-in: `$SHELL -ilc <command>` runs `<command>`. */
const STAND_IN_SHELL = `#!/bin/sh
exec /bin/sh -c "$2"
`;

const THREAD_ID = "mcp:c1e0d197-f95e-4388-b011-c17ab63ddef3";
const LINK =
  "https://app.t3.codes/threads/48ed0ee0-97a7-4156-8cc9-73e223805014/mcp%3Ac1e0d197-f95e-4388-b011-c17ab63ddef3";
const VERSION = "0.1.10-nightly.20261116.4761";
const PROJECT = "project-payments";
const ITEM = {
  key: "PAY-12",
  title: "Fix login redirect",
  type: "Bug",
  url: "https://payments.example.test/browse/PAY-12",
  description:
    "After signing in, users land on /home instead of the page they asked for.",
};

/**
 * Writes the fake `t3` and puts it first on the PATH the broker reads. Call
 * it before the app API reads any PATH; `run` takes what it returns.
 */
async function prepare({ onCleanup }) {
  // The tool and the repository, outside Ajour's data folder.
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "ajour-handoff-"));
  onCleanup(() => fs.rm(work, { recursive: true, force: true }));
  const bin = path.join(work, "bin");
  await writeFakeTool(
    bin,
    "t3",
    await fs.readFile(path.join(__dirname, "fake-t3.cjs"), "utf8"),
  );
  const before = { PATH: process.env.PATH, SHELL: process.env.SHELL };
  onCleanup(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.PATH = `${bin}${path.delimiter}${before.PATH ?? ""}`;
  if (process.platform !== "win32") {
    const shell = path.join(work, "login-shell");
    await fs.writeFile(shell, STAND_IN_SHELL, { mode: 0o755 });
    process.env.SHELL = shell;
  }
  return { work, bin };
}

async function run({
  tools: { work, bin },
  ok,
  pass,
  assert,
  server,
  addRepositoryFolderForServer,
  sink,
}) {
  const statePath = path.join(bin, "t3-state.json");
  const t3State = async (change) => {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    change(state);
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  };
  const calls = async () =>
    (
      await fs
        .readFile(path.join(bin, "t3-calls.jsonl"), "utf8")
        .catch(() => "")
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  const repository = path.join(work, "payments");
  await fs.mkdir(repository);
  const folder = await addRepositoryFolderForServer(
    server,
    PROJECT,
    repository,
  );
  const realRepository = await fs.realpath(repository);

  // ------------------------------------------------------------ detectTools
  {
    const detected = await ok(
      "POST",
      "/api/plugins/agent-handoff/handoffs/detect",
      {
        projectId: PROJECT,
      },
    );
    assert.deepEqual(detected, {
      tools: [{ id: "t3", available: true, version: VERSION }],
    });
    assert.deepEqual(
      (await calls()).map((call) => call.argv),
      [
        ["--version"],
        ["thread", "show", "ajour-detect", "--json", "--messages", "0"],
      ],
      "detection asks t3 its version, then whether a server answers",
    );
    pass("agent-handoff: detects T3 Code and its version through the broker");
  }

  // ----------------------------------------------------------- startHandoff
  let handoff;
  {
    handoff = await ok("POST", "/api/handoffs", {
      pluginId: "agent-handoff",
      toolId: "t3",
      workItemId: "item-pay-12",
      projectId: PROJECT,
      folderId: folder.id,
      projectName: "Payments",
      item: ITEM,
      settings: {},
    });
    const start = (await calls()).find(
      (call) => call.argv[0] === "thread" && call.argv[1] === "start",
    );
    assert.deepEqual(
      start?.argv,
      [
        "thread",
        "start",
        realRepository,
        "-",
        "--title",
        "[PAY-12] Fix login redirect",
        "--json",
        "--worktree",
        "main",
        "--branch",
        "pay-12-fix-login-redirect",
      ],
      "thread start gets the folder's real path, the title and the worktree branch, each as one argument",
    );
    for (const text of [ITEM.key, ITEM.title, ITEM.url, ITEM.description]) {
      assert.ok(start.stdin.includes(text), "the prompt reaches t3 on stdin");
    }
    assert.equal(handoff.pluginId, "agent-handoff");
    assert.equal(handoff.toolId, "t3");
    assert.equal(handoff.workItemId, "item-pay-12");
    assert.equal(handoff.projectId, PROJECT);
    assert.equal(handoff.folderId, folder.id);
    assert.equal(handoff.threadId, THREAD_ID);
    assert.equal(handoff.link, LINK);
    assert.equal(handoff.title, "[PAY-12] Fix login redirect");
    assert.equal(handoff.branch, "pay-12-fix-login-redirect");
    assert.equal(handoff.state, "working");
    assert.equal(handoff.native.label, "Working");
    assert.equal(handoff.native.status, "preparing");
    pass(
      "agent-handoff: starts a T3 thread with the item's prompt, title and branch, and records its link",
    );
  }

  // ------------------------------------------------------ readHandoffStates
  {
    const refresh = async () => {
      const answer = await ok("POST", `/api/handoffs/${handoff.id}/refresh`);
      assert.deepEqual(answer.failures, []);
      return answer.handoffs.find((entry) => entry.id === handoff.id);
    };
    /** T3's thread, then what Ajour shows for it after a refresh. */
    const steps = [
      [
        "running with a question",
        (state) => {
          state.thread.status = "running";
          state.thread.pendingRequestCount = 1;
        },
        "needs-you",
        "Waiting for you",
      ],
      [
        "completed",
        (state) => {
          state.thread.status = "completed";
          state.thread.pendingRequestCount = 0;
        },
        "ready",
        "Ready for review",
      ],
      [
        "failed",
        (state) => {
          state.thread.status = "failed";
        },
        "failed",
        "Failed",
      ],
      [
        "settled",
        (state) => {
          state.thread.status = "completed";
          state.thread.settled = true;
        },
        "done",
        "Settled",
      ],
      [
        "archived",
        (state) => {
          state.thread.settled = false;
          state.thread.archived = true;
        },
        "done",
        "Archived",
      ],
      [
        "no server",
        (state) => {
          state.server = false;
        },
        "unknown",
        "Unknown",
      ],
      [
        "deleted",
        (state) => {
          state.server = true;
          state.thread.deleted = true;
        },
        "gone",
        "Deleted in T3 Code",
      ],
    ];
    for (const [step, change, expected, label] of steps) {
      await t3State(change);
      const record = await refresh();
      assert.equal(record.state, expected, `${step}: ${expected}`);
      assert.equal(record.native.label, label, `${step}: ${label}`);
      assert.equal(record.threadId, THREAD_ID);
      assert.equal(record.branch, "pay-12-fix-login-redirect");
      if (step === "no server")
        assert.equal(
          record.native.reason,
          "T3 Code isn't running. Start T3 Code, then refresh.",
        );
      else assert.equal(record.native.reason, undefined);
    }
    const record = (await ok("GET", "/api/handoffs")).find(
      (entry) => entry.id === handoff.id,
    );
    assert.deepEqual(
      record.history.map((entry) => entry.state),
      ["needs-you", "ready", "failed", "done", "unknown", "gone"],
      "the history keeps each change of state after the start",
    );
    pass(
      "agent-handoff: maps T3's thread to Working, Needs you, Ready, Failed, Done, Unknown and Gone",
    );
  }

  // ------------------------------------------------ what t3 and events saw
  {
    const all = await calls();
    const declared = [
      (argv) => argv.length === 1 && argv[0] === "--version",
      (argv) => argv[0] === "thread" && argv[1] === "start",
      (argv) =>
        argv.length === 5 &&
        argv.join(" ") === `thread list --project ${realRepository} --json`,
      (argv) =>
        argv.length === 6 &&
        argv[0] === "thread" &&
        argv[1] === "show" &&
        argv.slice(3).join(" ") === "--json --messages 0",
    ];
    assert.ok(
      all.every((call) => declared.some((shape) => shape(call.argv))),
      "t3 ran only the commands agent-handoff declares",
    );
    assert.ok(
      all.every((call) => call.ajour.length === 0),
      "t3 never sees an AJOUR_ variable",
    );
    // Compared value by value: JSON would escape a Windows path's `\`.
    for (const text of [ITEM.title, ITEM.description, realRepository, LINK]) {
      assert.ok(
        !eventsHold(sink.events, text),
        "no event holds the prompt, the title, the folder or the link",
      );
    }
    pass(
      "agent-handoff: t3 runs only declared commands, without AJOUR_ variables, and events hold none of the hand off's content",
    );
  }
}

module.exports = { prepare, run };

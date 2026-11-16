// A stand-in for T3 Code's `t3` command, for the release check's hand off
// case (`handoff-cases.cjs`), which writes it beside an npm shim on PATH. It
// runs under Node as its own process, started by Ajour's process broker, and
// answers the four commands `agent-handoff` declares with outputs recorded
// from t3 v0.1.10-nightly.20261116.4761: the plugin's own test fixtures
// (ajour-plugins, `plugins/agent-handoff/tests/fixtures`, at 508ffbbb).
//
// The thread it starts lives in `t3-state.json` beside it, which the case
// edits to move the thread through T3's statuses, stop the server or delete
// the thread. Each call is appended to `t3-calls.jsonl`: its argv, its
// stdin, its working folder and the names of its AJOUR_ variables.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STATE = path.join(__dirname, "t3-state.json");
const CALLS = path.join(__dirname, "t3-calls.jsonl");

const VERSION = "t3 v0.1.10-nightly.20261116.4761";
const THREAD_ID = "mcp:c1e0d197-f95e-4388-b011-c17ab63ddef3";
const PROJECT_ID = "76f7d14f-f830-4d69-903e-78f1c574d69a";
const RUN_ID =
  "run:thread:mcp%3Ac1e0d197-f95e-4388-b011-c17ab63ddef3:ordinal:1";
const LINK =
  "https://app.t3.codes/threads/48ed0ee0-97a7-4156-8cc9-73e223805014/mcp%3Ac1e0d197-f95e-4388-b011-c17ab63ddef3";
const NO_SERVER =
  "No running T3 Code server uses C:\\Users\\example\\.t3. Start T3 Code, then retry.";

/** `thread show <id> --json --messages 0` (show.json). */
const SHOWN = {
  threadId: THREAD_ID,
  projectId: PROJECT_ID,
  title: "Ajour handoff fixture",
  link: LINK,
  createdBy: "agent",
  creationSource: "mcp",
  status: "preparing",
  latestRunId: RUN_ID,
  activeRunId: RUN_ID,
  providerInstanceId: "claudeAgent",
  model: "claude-opus-5-5",
  runtimeMode: "full-access",
  interactionMode: "default",
  linkedPullRequest: null,
  pullRequestCount: 0,
  titleRegeneration: null,
  lastTitleRegeneration: null,
  branch: "fixture-38",
  worktreePath: null,
  parentThreadId: null,
  relationshipToParent: null,
  runCount: 1,
  itemCount: 2,
  pendingRequestCount: 0,
  archived: false,
  settled: false,
  settledAt: null,
  snoozed: false,
  snoozedUntil: null,
  pinned: false,
  blockedOnThreadWait: false,
  pendingBackgroundTasks: [],
  createdAt: "2026-11-16T13:36:58.496Z",
  updatedAt: "2026-11-16T13:36:58.602Z",
};

/** One thread of `thread list --project <folder> --json` (list.json). */
const LISTED = {
  threadId: THREAD_ID,
  projectId: PROJECT_ID,
  title: "Ajour handoff fixture",
  link: LINK,
  createdBy: "agent",
  creationSource: "mcp",
  status: "preparing",
  latestRunId: RUN_ID,
  providerInstanceId: "claudeAgent",
  model: "claude-opus-5-5",
  runtimeMode: "full-access",
  interactionMode: "default",
  linkedPullRequest: null,
  pullRequests: [],
  pullRequestCount: 0,
  openPullRequestCount: 0,
  settled: false,
  settledAt: null,
  snoozed: false,
  snoozedUntil: null,
  pinned: false,
  blockedOnThreadWait: false,
  pendingBackgroundTasks: [],
  parentThreadId: null,
  relationshipToParent: null,
  itemCount: 2,
  createdAt: "2026-11-16T13:36:58.496Z",
  updatedAt: "2026-11-16T13:36:58.602Z",
};

const argv = process.argv.slice(2);
const has = (...expected) =>
  argv.length === expected.length &&
  expected.every((value, index) => value === null || argv[index] === value);
const state = fs.existsSync(STATE)
  ? JSON.parse(fs.readFileSync(STATE, "utf8"))
  : { server: true, thread: null };
const stdin =
  argv[0] === "thread" && argv[1] === "start"
    ? fs.readFileSync(0, "utf8")
    : undefined;
fs.appendFileSync(
  CALLS,
  `${JSON.stringify({
    argv,
    ...(stdin === undefined ? {} : { stdin }),
    cwd: process.cwd(),
    ajour: Object.keys(process.env).filter((name) => /^ajour_/i.test(name)),
  })}\n`,
);

function fail(line, code = 1) {
  process.stderr.write(`${line}\n`);
  process.exit(code);
}
function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
/** What T3 says of the thread now: the recording, as the case moved it on. */
function thread(recorded) {
  const { status, pendingRequestCount, settled, archived, title, branch } =
    state.thread;
  return {
    ...recorded,
    title,
    branch,
    status,
    settled,
    ...("archived" in recorded || archived ? { archived } : {}),
    ...("pendingRequestCount" in recorded ? { pendingRequestCount } : {}),
  };
}

if (has("--version")) {
  process.stdout.write(`${VERSION}\n`);
} else if (argv[0] === "thread" && argv[1] === "start") {
  // thread start <folder> - --title <title> --json [--worktree <base>
  // --branch <branch>] [--provider <id>] [--model <slug>]
  if (!state.server) fail(NO_SERVER);
  const options = {};
  for (let index = 4; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--json") continue;
    options[name] = argv[++index];
  }
  if (argv[3] !== "-" || !options["--title"] || !argv.includes("--json"))
    fail("Usage: t3 thread start <project> - --title <title> --json", 2);
  state.thread = {
    folder: argv[2],
    title: options["--title"],
    branch: options["--branch"] ?? null,
    status: "preparing",
    pendingRequestCount: 0,
    settled: false,
    archived: false,
    deleted: false,
  };
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  print({ threadId: THREAD_ID, projectId: PROJECT_ID, runId: RUN_ID });
} else if (has("thread", "show", null, "--json", "--messages", "0")) {
  if (!state.server) fail(NO_SERVER);
  if (argv[2] !== THREAD_ID || !state.thread || state.thread.deleted)
    fail(`Thread ${argv[2]} is no longer available.`);
  print({ thread: thread(SHOWN), messages: [] });
} else if (has("thread", "list", "--project", null, "--json")) {
  if (!state.server) fail(NO_SERVER);
  // Archived and deleted threads leave the list.
  const listed =
    state.thread &&
    state.thread.folder === argv[3] &&
    !state.thread.deleted &&
    !state.thread.archived;
  print(listed ? [thread(LISTED)] : []);
} else {
  fail(`Unknown t3 command: ${argv.join(" ")}`, 2);
}

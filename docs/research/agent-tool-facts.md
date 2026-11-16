# Agent tool facts for the handoff adapter

Research for [#707](https://github.com/les-cabochons/ajour/issues/707), part of [#704](https://github.com/les-cabochons/ajour/issues/704). Tested November 15, 2026 in Toronto, November 16 UTC. This is a Windows 11 x64 run, OS build 26200. macOS is unverified for every tool.

Live means a command or protocol exchange ran here. Schema means the installed executable's generated schema or served OpenAPI document. Docs means first-party documentation or source, which may describe a newer build. Desktop sidebars and OS link dispatch were not visually tested. No login was performed. Existing credentials were used by installed tools. Copilot found account authentication despite the probe clearing token environment variables, but its account quota blocked inference.

Only this report changes Ajour. Probe programs and npm packages were placed in a disposable temp prefix. No global npm, nvs, or PATH changes were made. Commands below use logical executable names for readability. Runtime probes used Node spawn with shell:false and argv arrays, except help commands, terminal PTY launches and the first T3 launch run through PowerShell. T3's direct executable route was separately verified.

## Windows executable resolution

| Tool     | Resolved path and kind                                                            | First lines or entry point                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3       | C:/Users/alext/.t3/bin/t3.cmd, batch shim                                         | @echo off; rem Written by T3 Code: runs the desktop app's bundled t3 CLI.; setlocal EnableExtensions DisableDelayedExpansion                                                            |
| Claude   | C:/Users/alext/.local/bin/claude.exe, native PE                                   | Binary, begins MZ. No script lines.                                                                                                                                                     |
| Codex    | C:/Users/alext/AppData/Local/Programs/OpenAI/Codex/bin/codex.exe, native PE       | Binary, begins MZ. No script lines.                                                                                                                                                     |
| VS Code  | C:/Users/alext/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd              | @echo off; setlocal; set VSCODE_DEV=; set ELECTRON_RUN_AS_NODE=1                                                                                                                        |
| OpenCode | <prefix>/node_modules/.bin/opencode.cmd, npm shim; package bin ./bin/opencode.exe | Direct native executable at <prefix>/node_modules/opencode-windows-x64/bin/opencode.exe, begins MZ. Postinstall was not run by npm, so use the platform package directly in this probe. |
| Copilot  | <prefix>/node_modules/.bin/copilot.cmd, npm shim                                  | Package entry npm-loader.js starts #!/usr/bin/env node, then Microsoft copyright comment. Loader spawns <prefix>/node_modules/@github/copilot-win32-x64/copilot.exe, begins MZ.         |

Install command, run only in the disposable prefix:

`npm install --prefix <scratch>/npm opencode-ai @github/copilot --no-audit --no-fund`

Output: added 6 packages in 15s. npm reported the OpenCode postinstall script was not covered by allowScripts. The optional platform package nevertheless contained the executable used here. Resolve reviewed package metadata and known executable paths. Never feed a .cmd file to shell:false or interpret arbitrary batch text as instructions. Shim handling remains #706's responsibility.

## T3 Code

| Property         | Verified contract                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Versions tested  | t3 v0.1.10-nightly.20261116.4761, existing desktop server                                                                                                                                                                                                              |
| OS               | Windows only; macOS unverified                                                                                                                                                                                                                                         |
| Start            | thread start <folder> - --title <title> --json; project must exist, so project add <folder> --title <title> was used first. Worktree variant --worktree master --branch probe-707 succeeded.                                                                           |
| Title            | --title argv; defaults to first prompt line per help.                                                                                                                                                                                                                  |
| Prompt delivery  | Literal - argument reads stdin. PowerShell pipeline added CRLF, visible in the saved user message. Direct Node spawn preserved exact supplied text.                                                                                                                    |
| State            | thread list --project <folder> --json; thread show <id> --json. Live running and completed. Published thread schema also admits idle, preparing, queued, starting, waiting, interrupted, failed, cancelled, rolled_back. These additional states were not forced here. |
| Waiting for user | show.thread.pendingRequestCount > 0. Live value 1 while status remained running. list omits this field. blockedOnThreadWait and pendingBackgroundTasks describe other waits, not a human approval.                                                                     |
| Organization     | Settled and snoozed stay in list with their flags and timestamps. Archived disappears from list, but show still works and says archived:true. These were changed on the probe through T3's organize tool because CLI has no organize subcommand.                       |
| Open/reopen      | Preserve list/show link verbatim. CLI returned an https://app.t3.codes/threads/<server>/<encoded-id> link. Native MCP returned a t3-thread link instead. No CLI open subcommand.                                                                                       |
| Failure          | Empty --base-dir exits 1 with No running T3 Code server uses <dir>. Start T3 Code, then retry. The user's server was not stopped.                                                                                                                                      |
| Cleanup          | project remove <scratch-repo> --force removed the disposable project and both threads. It left the generated worktree, removed separately with git worktree remove.                                                                                                    |

Sources: [CLI implementation](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/cli/thread.ts), [thread sidebar and organization](https://github.com/pingdotgg/t3code/blob/main/docs/user/thread-sidebar.md). The installed help agrees on stdin, --wait, --json, worktree, branch and model/provider flags. --wait documents exit 1 on failure and exit 2 when waiting for an answer. Ordinary start exits after submission, not completion.

### Exact start and full list/show records

PowerShell command, with <repo> equal to C:/Users/alext/AppData/Local/Temp/ajour-agent-facts-707/repo:

`'Reply with OK and do nothing else.' | t3 thread start <repo> - --title 'Ajour 707 probe' --json`

```json
{
  "threadId": "mcp:19a5fc35-dda3-4063-bad0-f80149abf9ef",
  "projectId": "27435588-6270-4198-a0d7-23b38c240862",
  "runId": "run:thread:mcp%3A19a5fc35-dda3-4063-bad0-f80149abf9ef:ordinal:1"
}
```

Full list output immediately after submission, every returned field retained:

```json
[
  {
    "threadId": "mcp:19a5fc35-dda3-4063-bad0-f80149abf9ef",
    "projectId": "27435588-6270-4198-a0d7-23b38c240862",
    "title": "Ajour 707 probe",
    "link": "https://app.t3.codes/threads/48ed0ee0-97a7-4156-8cc9-73e223805014/mcp%3A19a5fc35-dda3-4063-bad0-f80149abf9ef",
    "createdBy": "agent",
    "creationSource": "mcp",
    "status": "running",
    "latestRunId": "run:thread:mcp%3A19a5fc35-dda3-4063-bad0-f80149abf9ef:ordinal:1",
    "providerInstanceId": "claudeAgent",
    "model": "claude-opus-5-5",
    "runtimeMode": "full-access",
    "interactionMode": "default",
    "linkedPullRequest": null,
    "pullRequests": [],
    "pullRequestCount": 0,
    "openPullRequestCount": 0,
    "settled": false,
    "settledAt": null,
    "snoozed": false,
    "snoozedUntil": null,
    "pinned": false,
    "blockedOnThreadWait": false,
    "pendingBackgroundTasks": [],
    "parentThreadId": null,
    "relationshipToParent": null,
    "itemCount": 2,
    "createdAt": "2026-11-16T04:33:10.929Z",
    "updatedAt": "2026-11-16T04:33:11.021Z"
  }
]
```

Full show output after completion, every returned field retained:

```json
{
  "thread": {
    "threadId": "mcp:19a5fc35-dda3-4063-bad0-f80149abf9ef",
    "projectId": "27435588-6270-4198-a0d7-23b38c240862",
    "title": "Ajour 707 probe",
    "link": "https://app.t3.codes/threads/48ed0ee0-97a7-4156-8cc9-73e223805014/mcp%3A19a5fc35-dda3-4063-bad0-f80149abf9ef",
    "createdBy": "agent",
    "creationSource": "mcp",
    "status": "completed",
    "latestRunId": "run:thread:mcp%3A19a5fc35-dda3-4063-bad0-f80149abf9ef:ordinal:1",
    "activeRunId": null,
    "providerInstanceId": "claudeAgent",
    "model": "claude-opus-5-5",
    "runtimeMode": "full-access",
    "interactionMode": "default",
    "linkedPullRequest": null,
    "pullRequests": [],
    "pullRequestCount": 0,
    "openPullRequestCount": 0,
    "titleRegeneration": null,
    "lastTitleRegeneration": null,
    "branch": "master",
    "worktreePath": null,
    "parentThreadId": null,
    "relationshipToParent": null,
    "runCount": 1,
    "itemCount": 4,
    "pendingRequestCount": 0,
    "archived": false,
    "settled": false,
    "settledAt": null,
    "snoozed": false,
    "snoozedUntil": null,
    "pinned": false,
    "blockedOnThreadWait": false,
    "pendingBackgroundTasks": [],
    "createdAt": "2026-11-16T04:33:10.929Z",
    "updatedAt": "2026-11-16T04:33:14.163Z"
  },
  "messages": [
    {
      "role": "user",
      "runId": "run:thread:mcp%3A19a5fc35-dda3-4063-bad0-f80149abf9ef:ordinal:1",
      "text": "Reply with OK and do nothing else.\r\n"
    },
    {
      "role": "assistant",
      "runId": "run:thread:mcp%3A19a5fc35-dda3-4063-bad0-f80149abf9ef:ordinal:1",
      "text": "OK"
    }
  ]
}
```

### Pending request and organization probes

The direct process was the desktop executable, argv [server.asar/apps/server/dist/bin.mjs, thread, start, <repo>, -, --title, Ajour 707 pending probe, --worktree, master, --branch, probe-707, --json]. Environment overrides were ELECTRON_RUN_AS_NODE=1, T3CODE_DESKTOP_CLI_LAUNCHER=1 and T3CODE_HOME=C:/Users/alext/.t3. Stdin asked it to use request_user_input for a red/blue choice. No answer was submitted. The output was:

```json
{
  "threadId": "mcp:58776436-f749-4640-83b6-857ec763ba18",
  "projectId": "27435588-6270-4198-a0d7-23b38c240862",
  "runId": "run:thread:mcp%3A58776436-f749-4640-83b6-857ec763ba18:ordinal:1"
}
```

Full pending show output:

```json
{
  "thread": {
    "threadId": "mcp:58776436-f749-4640-83b6-857ec763ba18",
    "projectId": "27435588-6270-4198-a0d7-23b38c240862",
    "title": "Ajour 707 pending probe",
    "link": "https://app.t3.codes/threads/48ed0ee0-97a7-4156-8cc9-73e223805014/mcp%3A58776436-f749-4640-83b6-857ec763ba18",
    "createdBy": "agent",
    "creationSource": "mcp",
    "status": "running",
    "latestRunId": "run:thread:mcp%3A58776436-f749-4640-83b6-857ec763ba18:ordinal:1",
    "activeRunId": "run:thread:mcp%3A58776436-f749-4640-83b6-857ec763ba18:ordinal:1",
    "providerInstanceId": "claudeAgent",
    "model": "claude-opus-5-5",
    "runtimeMode": "full-access",
    "interactionMode": "default",
    "linkedPullRequest": null,
    "pullRequests": [],
    "pullRequestCount": 0,
    "openPullRequestCount": 0,
    "titleRegeneration": null,
    "lastTitleRegeneration": null,
    "branch": "probe-707",
    "worktreePath": "C:\\Users\\alext\\.t3\\worktrees\\repo\\probe-707-71652ab0f9a468fe",
    "parentThreadId": null,
    "relationshipToParent": null,
    "runCount": 1,
    "itemCount": 5,
    "pendingRequestCount": 1,
    "archived": false,
    "settled": false,
    "settledAt": null,
    "snoozed": false,
    "snoozedUntil": null,
    "pinned": false,
    "blockedOnThreadWait": false,
    "pendingBackgroundTasks": [],
    "createdAt": "2026-11-16T04:36:35.031Z",
    "updatedAt": "2026-11-16T04:36:47.306Z"
  },
  "messages": [
    {
      "role": "user",
      "runId": "run:thread:mcp%3A58776436-f749-4640-83b6-857ec763ba18:ordinal:1",
      "text": "Use request_user_input to ask me to pick red or blue. Do nothing else and wait for my answer."
    }
  ]
}
```

After settle

```json
{
  "status": "completed",
  "settled": true,
  "settledAt": "2026-11-16T04:35:02.523Z",
  "snoozed": false,
  "snoozedUntil": null
}
```

After snooze

```json
{
  "status": "completed",
  "settled": true,
  "settledAt": "2026-11-16T04:35:02.523Z",
  "snoozed": true,
  "snoozedUntil": "2026-11-17T00:00:00.000Z"
}
```

After archive, list was [] and show.thread.archived was true. Therefore absence in list alone cannot mean deleted.

## Claude Code

| Property          | Verified contract                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Versions tested   | 2.1.325, newer than the ticket's generic 2.1.x                                                                                                                                                                                                   |
| OS                | Windows only; macOS unverified                                                                                                                                                                                                                   |
| Interactive start | claude --session-id <uuid> -n <title> opens an interactive terminal session. Tested with PTY, trust prompt accepted for this disposable repo, then /exit.                                                                                        |
| Background start  | claude --bg -n <title>, stdin prompt, succeeds after workspace trust. It prints a short job ID and generates a full session UUID. --session-id is ignored with a warning.                                                                        |
| Title             | -n/--name sets display name; verified in agents JSON.                                                                                                                                                                                            |
| Prompt delivery   | -p with no positional prompt reads stdin and returns a JSON result with --output-format json. --bg also accepted stdin and produced OK. --bg -p is rejected.                                                                                     |
| State             | agents --json --all --cwd <repo>. Interactive process status is busy, waiting, idle. Background state is working, blocked, done, failed, stopped. Live busy/idle and working/done observed. Other values documented, not induced.                |
| Waiting for user  | Background state blocked; live process status waiting plus waitingFor. Documented waitingFor values: permission prompt, input needed, sandbox request, worker request, dialog open. These were not induced.                                      |
| Open/reopen       | claude attach <short-id> for background job. claude --resume <full-session-uuid> after stopping. Resume of the stopped probe returned OK and the same UUID.                                                                                      |
| Desktop           | --desktop --resume <uuid> is documented in 2.1.285+. Desktop and CLI keep separate lists. CLI sessions can be picked with /resume in Desktop. A background job must stop before desktop transfer. Native desktop transfer was not launched here. |
| Cleanup           | stop <short-id>, rm <short-id>, then purge <exact-disposable-folder> --yes. rm preserves the transcript, so purge was needed.                                                                                                                    |

Sources: [CLI reference](https://code.claude.com/docs/en/cli-reference), [agent view](https://code.claude.com/docs/en/agent-view), [desktop transfer](https://code.claude.com/docs/en/desktop#coming-from-the-cli), [2.1.325 changelog](https://code.claude.com/docs/en/changelog). Help explicitly says agents --json does not require a TTY. pid/status may disappear when the process exits; state remains for background jobs with --all. A completed turn is done, not automatically blocked.

### Actual commands and outputs

Stdin print

```json
{
  "argv": [
    "-p",
    "--session-id",
    "6fe46187-8395-47eb-8ca9-fec454f0bea7",
    "-n",
    "Ajour 707 stdin print",
    "--output-format",
    "json",
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    ""
  ],
  "exit": 0,
  "stdout": "{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":\"6fe46187-8395-47eb-8ca9-fec454f0bea7\",\"result\":\"OK\",\"is_error\":false,\"terminal_reason\":\"completed\"}",
  "stderr": ""
}
```

Incompatible flags

```json
{
  "argv": ["--bg", "-p"],
  "exit": 1,
  "stdout": "",
  "stderr": "--bg and --print conflict: --print never starts the interactive session that `claude agents` attaches to, so the job would be unattachable. The prompt is the positional — drop --print: `claude --bg '<task>'`.\n"
}
```

Background stdin

```json
{
  "argv": [
    "--bg",
    "--session-id",
    "6c2c62a4-36cf-471c-8aa4-c60fbdd64843",
    "-n",
    "Ajour 707 stdin background"
  ],
  "exit": 0,
  "stdout": "backgrounded · 69211bf1 · Ajour 707 stdin background\n  claude agents             list sessions\n  claude attach 69211bf1    open in this terminal\n  claude logs 69211bf1      show recent output\n  claude stop 69211bf1      stop this session\n",
  "stderr": "warning: --bg manages the session id; ignoring --session-id (use --resume <id> to continue an existing session)\nStarting background service…\n"
}
```

Resume stopped background

```json
{
  "argv": [
    "--resume",
    "69211bf1-e465-42a9-b002-71280e50a258",
    "-p",
    "--output-format",
    "json",
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    ""
  ],
  "exit": 0,
  "stdout": "{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":\"69211bf1-e465-42a9-b002-71280e50a258\",\"result\":\"OK\",\"is_error\":false,\"terminal_reason\":\"completed\"}",
  "stderr": ""
}
```

Background state just after dispatch:

```json
[
  {
    "id": "69211bf1",
    "cwd": "C:\\Users\\alext\\AppData\\Local\\Temp\\ajour-agent-facts-707\\repo",
    "kind": "background",
    "startedAt": 1794803817277,
    "sessionId": "69211bf1-e465-42a9-b002-71280e50a258",
    "name": "Ajour 707 stdin background",
    "state": "working"
  }
]
```

After OK:

```json
[
  {
    "pid": 52476,
    "id": "69211bf1",
    "cwd": "C:\\Users\\alext\\AppData\\Local\\Temp\\ajour-agent-facts-707\\repo",
    "kind": "background",
    "startedAt": 1794803823798,
    "sessionId": "69211bf1-e465-42a9-b002-71280e50a258",
    "name": "Ajour 707 stdin background",
    "status": "idle",
    "state": "done"
  }
]
```

Initial --bg stdin attempt before trust failed with exit 1:

`Workspace not trusted. Run claude in C:\Users\alext\AppData\Local\Temp\ajour-agent-facts-707\repo once and accept the trust prompt, then retry.`

The successful print invocation included --tools "", --strict-mcp-config, --setting-sources "" to keep the tiny probe scoped. These are probe restrictions, not recommended defaults for a user handoff.

## Codex

| Property              | Verified contract                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Versions tested       | codex-cli 0.169.0; generated v2 JSON-RPC schema                                                                                                                                                                                                                                                                                                                                               |
| OS                    | Windows only; macOS unverified                                                                                                                                                                                                                                                                                                                                                                |
| Start                 | codex app-server over stdio; initialize, initialized, thread/start, thread/name/set, turn/start. Newline-delimited JSON, no shell and no Content-Length framing.                                                                                                                                                                                                                              |
| Title                 | thread/name/set with threadId and name, acknowledged with {}.                                                                                                                                                                                                                                                                                                                                 |
| Prompt delivery       | turn/start input text in JSON written to stdin.                                                                                                                                                                                                                                                                                                                                               |
| State                 | thread/read plus thread/status/changed. Native thread types notLoaded, idle, systemError, active. activeFlags can contain waitingOnApproval, waitingOnUserInput. Live idle, active with [], notLoaded observed. Turn status is separately inProgress, completed, interrupted, failed; live first two.                                                                                         |
| Waiting for user      | activeFlags plus server requests such as item/commandExecution/requestApproval, item/fileChange/requestApproval, item/tool/requestUserInput. No approval/input was induced here. Client must retain requests and reply by RPC id.                                                                                                                                                             |
| Open/reopen           | codex resume <id>, with --all to disable cwd filtering and --include-non-interactive when needed. Documented codex://threads/<id> opens a local chat. OS dispatch and resume picker UI were not tested. Direct codex resume of the archived probe UUID was additionally opened in a PTY. It reached folder trust after Resuming session, so history rendering in that TUI remains unverified. |
| Persistence/discovery | Non-ephemeral thread had a real ~/.codex/sessions/.../rollout-...jsonl path and appeared in thread/list with title and prompt preview. Archive moved it out of active storage. Shared storage makes it resumable; it does not prove the desktop sidebar's filters include it.                                                                                                                 |
| Lifetime              | app-server owns the turn. Keep stdin and process alive through turn/completed, including all approval/input exchanges. Probe finished in 2538 ms. No fixed timeout is safe. Process was closed only after completion and archive acknowledgement. Early-kill behavior was not experimentally forced.                                                                                          |

Sources: [official App Server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md), [thread types](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/thread.rs), [deep link docs](https://learn.chatgpt.com/docs/reference/commands#deep-links). Installed generate-json-schema supplied the actual enum values above. This installation reports originator T3 Code and source vscode despite a custom initialize clientInfo, so desktop visibility must be checked per installation and source filtering. Do not rewrite the user's config or rollout files to change discovery.

### Minimal stdio probe

This is the Node script actually run, with absolute paths from this machine. It archived its own thread after reading it. Production code needs request deadlines, backpressure handling, stderr redaction and reconnection policy.

```javascript
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
const log = fs.createWriteStream(path.join(root, "codex-rpc.jsonl"));
const child = spawn(
  "C:/Users/alext/AppData/Local/Programs/OpenAI/Codex/bin/codex.exe",
  ["app-server"],
  {
    cwd: path.join(root, "repo"),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
child.stderr.on("data", (b) =>
  fs.appendFileSync(path.join(root, "codex-stderr.txt"), b),
);
let n = 0,
  buf = "",
  threadId,
  done;
const pending = new Map();
function send(msg) {
  log.write(JSON.stringify({ send: msg }) + "\n");
  child.stdin.write(JSON.stringify(msg) + "\n");
}
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++n;
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
}
child.stdout.on("data", (b) => {
  buf += b;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try {
      const msg = JSON.parse(line);
      log.write(JSON.stringify({ receive: msg }) + "\n");
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      }
      if (msg.method === "turn/completed") done?.(msg);
    } catch {}
  }
});
(async () => {
  try {
    await rpc("initialize", {
      clientInfo: { name: "ajour_707_probe", version: "0.0.1" },
      capabilities: { experimentalApi: true },
    });
    send({ method: "initialized" });
    const r = await rpc("thread/start", {
      cwd: path.join(root, "repo"),
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    threadId = r.thread.id;
    fs.writeFileSync(path.join(root, "codex-id.txt"), threadId);
    await rpc("thread/name/set", {
      threadId,
      name: "Ajour 707 disposable probe",
    });
    const completion = new Promise((resolve) => (done = resolve));
    await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: "Reply with OK and do nothing else." }],
    });
    await Promise.race([
      completion,
      new Promise((resolve) => setTimeout(resolve, 60000)),
    ]);
    await rpc("thread/read", { threadId, includeTurns: true });
    await rpc("thread/list", { limit: 5, cwd: path.join(root, "repo") });
    await rpc("thread/archive", { threadId });
  } catch (e) {
    log.write(JSON.stringify({ error: e }) + "\n");
  }
  child.stdin.end();
  setTimeout(() => child.kill(), 2000);
})();
setTimeout(() => {
  child.kill();
  log.end();
}, 75000).unref();
```

Selected real messages, large metadata and unrelated startup notifications omitted:

```json
{
  "id": 1,
  "method": "initialize",
  "params": {
    "clientInfo": {
      "name": "ajour_707_probe",
      "version": "0.0.1"
    },
    "capabilities": {
      "experimentalApi": true
    }
  }
}
```

```json
{
  "id": 1,
  "result": {
    "userAgent": "T3 Code/0.169.0 (Windows 10.0.26200; x86_64) dumb (ajour_707_probe; 0.0.1)",
    "codexHome": "C:\\Users\\alext\\.codex",
    "platformFamily": "windows",
    "platformOs": "windows"
  }
}
```

```json
{
  "method": "initialized"
}
```

```json
{
  "id": 2,
  "method": "thread/start",
  "params": {
    "cwd": "C:\\Users\\alext\\AppData\\Local\\Temp\\ajour-agent-facts-707\\repo",
    "approvalPolicy": "never",
    "sandbox": "read-only"
  }
}
```

```json
{
  "id": 3,
  "method": "thread/name/set",
  "params": {
    "threadId": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7",
    "name": "Ajour 707 disposable probe"
  }
}
```

```json
{
  "id": 3,
  "result": {}
}
```

```json
{
  "id": 4,
  "method": "turn/start",
  "params": {
    "threadId": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7",
    "input": [
      {
        "type": "text",
        "text": "Reply with OK and do nothing else."
      }
    ]
  }
}
```

```json
{
  "id": 4,
  "result": {
    "turn": {
      "id": "01a1e2a2-66f4-7241-a13e-07a5c858a86d",
      "rootTurnId": "01a1e2a2-66f4-7241-a13e-07a5c858a86d",
      "items": [],
      "itemsView": "notLoaded",
      "status": "inProgress",
      "error": null,
      "startedAt": null,
      "completedAt": null,
      "durationMs": null
    }
  }
}
```

```json
{
  "method": "thread/status/changed",
  "params": {
    "threadId": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7",
    "status": {
      "type": "active",
      "activeFlags": []
    }
  },
  "emittedAtMs": 1794803656480
}
```

```json
{
  "method": "item/agentMessage/delta",
  "params": {
    "threadId": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7",
    "turnId": "01a1e2a2-66f4-7241-a13e-07a5c858a86d",
    "itemId": "msg_0e750bc58fc3bb70016afa87cabcf887d194b54ea98927f6ff",
    "delta": "OK"
  },
  "emittedAtMs": 1794803658821
}
```

```json
{
  "method": "thread/status/changed",
  "params": {
    "threadId": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7",
    "status": {
      "type": "idle"
    }
  },
  "emittedAtMs": 1794803659023
}
```

```json
{
  "method": "turn/completed",
  "params": {
    "threadId": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7",
    "turn": {
      "id": "01a1e2a2-66f4-7241-a13e-07a5c858a86d",
      "rootTurnId": "01a1e2a2-66f4-7241-a13e-07a5c858a86d",
      "items": [
        {
          "type": "agentMessage",
          "moderation": null,
          "id": "msg_0e750bc58fc3bb70016afa87cabcf887d194b54ea98927f6ff",
          "text": "OK",
          "phase": "final_answer",
          "memoryCitation": null,
          "delivery": null,
          "questions": null,
          "startedAtMs": 1794803658821,
          "completedAtMs": 1794803658954
        }
      ],
      "itemsView": "summary",
      "status": "completed",
      "error": null,
      "startedAt": 1794803656,
      "completedAt": 1794803659,
      "durationMs": 2538
    }
  },
  "emittedAtMs": 1794803659023
}
```

```json
{
  "id": 5,
  "method": "thread/read",
  "params": {
    "threadId": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7",
    "includeTurns": true
  }
}
```

```json
{
  "id": 6,
  "method": "thread/list",
  "params": {
    "limit": 5,
    "cwd": "C:\\Users\\alext\\AppData\\Local\\Temp\\ajour-agent-facts-707\\repo"
  }
}
```

```json
{
  "id": 7,
  "method": "thread/archive",
  "params": {
    "threadId": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7"
  }
}
```

```json
{
  "method": "thread/status/changed",
  "params": {
    "threadId": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7",
    "status": {
      "type": "notLoaded"
    }
  },
  "emittedAtMs": 1794803667464
}
```

```json
{
  "id": 7,
  "result": {}
}
```

thread/read receipt and selected persisted fields:

```json
{
  "thread": {
    "id": "01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7",
    "name": "Ajour 707 disposable probe",
    "path": "C:\\Users\\alext\\.codex\\sessions\\2026\\11\\15\\rollout-2026-11-15T23-34-15-01a1e2a2-62e4-79d0-94c1-63e1ae35a3d7.jsonl",
    "status": {
      "type": "idle"
    },
    "ephemeral": false,
    "originator": "T3 Code",
    "source": "vscode",
    "turnStatus": "completed"
  },
  "readState": {
    "firstUnread": {
      "type": "turn",
      "turnId": "01a1e2a2-66f4-7241-a13e-07a5c858a86d"
    },
    "revision": "981cea11-16e9-4838-ac79-20c0e1086b31"
  }
}
```

## OpenCode

| Property         | Verified contract                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Versions tested  | npm opencode-ai 1.19.5, Windows platform binary; /global/health returns version 1.19.5. /doc OpenAPI version 3.1.0, info.version 1.0.0 is the API schema label, not the CLI package version.                                                                                                                                         |
| OS               | Windows only; macOS unverified                                                                                                                                                                                                                                                                                                       |
| Start            | opencode serve --hostname 127.0.0.1 --port 41977. Both legacy /session and experimental /api/session exist in this released build.                                                                                                                                                                                                   |
| Title            | POST /session with title, PATCH /session/<id> with title both work. Installed /api/session create schema has no title field. Supplying title there returned 200 but ignored it, generating New session - <timestamp>. Rename through v1 worked. Development v2 docs with title do not match 1.19.5.                                  |
| Prompt delivery  | v1 POST /session/<id>/prompt_async with parts:[{type:text,text:...}] returns 204. v2 POST /api/session/<id>/prompt with prompt:{text:...}, resume:false durably admits input without inference and returns data including admittedSeq and id. HTTP body, not process argv.                                                           |
| State            | v1 /session/status map, /event SSE. Native types idle, busy, retry; retry carries attempt, message, next and optional action. Live busy/idle seen in SSE. Idle sessions disappear from map, so {} is normal. v2 /api/session/active is data map of type running, absent means inactive in this process. running is schema-only here. |
| Waiting for user | Separate /permission and /question pending lists, paired permission/question SSE events. Live [] observed. Not inferred from busy alone. v2 exposes /api/permission/request and /api/question/request too.                                                                                                                           |
| Open/reopen      | opencode attach <url> -s <session-id> per installed help; keep the server alive and keep its URL. Actual TUI attach not launched.                                                                                                                                                                                                    |
| Ports            | serve help defaults to 4096; probe used explicit 41977. New development service docs describe 49374 and Windows 28894. Installed CLI has serve and no service command. Do not scan or assume those development ports.                                                                                                                |
| Auth and errors  | No provider login attempted. Deliberately invalid model produced session.error UnknownError then idle. An HTTP 204 is submission, not successful completion.                                                                                                                                                                         |
| Cleanup          | DELETE /session/<id> returned true. Isolated XDG data directories, including the extra empty v2 session, are removed with the scratch directory. Owned server processes terminated.                                                                                                                                                  |

Sources: [v1 server docs](https://opencode.ai/v1/docs/server/), [v1.19.5 session status source](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/session/status.ts), [development protocol](https://github.com/anomalyco/opencode/blob/dev/packages/protocol/src/groups/session.ts), [development service ports](https://github.com/anomalyco/opencode/blob/dev/services/site/src/docs/content/cli/web.mdx), [release history](https://github.com/anomalyco/opencode/releases). Installed /doc takes precedence over dev documentation. Prefer the verified v1 subset initially, and negotiate experimental v2 separately.

### Actual HTTP exchanges

Bodies below are exact except the large OpenAPI document is omitted.

```json
{
  "method": "GET",
  "url": "/global/health",
  "status": 200,
  "body": "{\"healthy\":true,\"version\":\"1.19.5\"}"
}
```

```json
{
  "method": "POST",
  "url": "/session",
  "status": 200,
  "body": "{\"id\":\"ses_e1d5d66c1ffe85OkllB2m2Mx1N\",\"slug\":\"quiet-falcon\",\"projectID\":\"8269b75b0e6be37fe1904295755be2ae3fb54551\",\"directory\":\"C:\\\\Users\\\\alext\\\\AppData\\\\Local\\\\Temp\\\\ajour-agent-facts-707\\\\repo\",\"path\":\"\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}},\"title\":\"Ajour 707 probe\",\"version\":\"1.19.5\",\"time\":{\"created\":1794803669310,\"updated\":1794803669310}}"
}
```

```json
{
  "method": "PATCH",
  "url": "/session/ses_e1d5d66c1ffe85OkllB2m2Mx1N",
  "status": 200,
  "body": "{\"id\":\"ses_e1d5d66c1ffe85OkllB2m2Mx1N\",\"slug\":\"quiet-falcon\",\"projectID\":\"8269b75b0e6be37fe1904295755be2ae3fb54551\",\"directory\":\"C:\\\\Users\\\\alext\\\\AppData\\\\Local\\\\Temp\\\\ajour-agent-facts-707\\\\repo\",\"path\":\"\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}},\"title\":\"Ajour 707 renamed\",\"version\":\"1.19.5\",\"time\":{\"created\":1794803669310,\"updated\":1794803669310}}"
}
```

```json
{
  "method": "GET",
  "url": "/session/status",
  "status": 200,
  "body": "{}"
}
```

```json
{
  "method": "GET",
  "url": "/api/session",
  "status": 200,
  "body": "{\"data\":[{\"id\":\"ses_e1d5d66c1ffe85OkllB2m2Mx1N\",\"projectID\":\"8269b75b0e6be37fe1904295755be2ae3fb54551\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}},\"time\":{\"created\":1794803669310,\"updated\":1794803669310},\"title\":\"Ajour 707 renamed\",\"location\":{\"directory\":\"C:\\\\Users\\\\alext\\\\AppData\\\\Local\\\\Temp\\\\ajour-agent-facts-707\\\\repo\"}}],\"cursor\":{\"previous\":\"eyJhbmNob3IiOnsiaWQiOiJzZXNfZTFkNWQ2NmMxZmZlODVPa2xsQjJtMk14MU4iLCJ0aW1lIjoxNzk0ODAzNjY5MzEwLCJkaXJlY3Rpb24iOiJwcmV2aW91cyJ9fQ\",\"next\":\"eyJhbmNob3IiOnsiaWQiOiJzZXNfZTFkNWQ2NmMxZmZlODVPa2xsQjJtMk14MU4iLCJ0aW1lIjoxNzk0ODAzNjY5MzEwLCJkaXJlY3Rpb24iOiJuZXh0In19\"}}"
}
```

```json
{
  "method": "POST",
  "url": "/session/ses_e1d5d66c1ffe85OkllB2m2Mx1N/prompt_async",
  "status": 204,
  "body": ""
}
```

```json
{
  "method": "GET",
  "url": "/session/status",
  "status": 200,
  "body": "{}"
}
```

```json
{
  "method": "GET",
  "url": "/session/ses_e1d5d66c1ffe85OkllB2m2Mx1N",
  "status": 200,
  "body": "{\"id\":\"ses_e1d5d66c1ffe85OkllB2m2Mx1N\",\"slug\":\"quiet-falcon\",\"projectID\":\"8269b75b0e6be37fe1904295755be2ae3fb54551\",\"directory\":\"C:\\\\Users\\\\alext\\\\AppData\\\\Local\\\\Temp\\\\ajour-agent-facts-707\\\\repo\",\"path\":\"\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}},\"title\":\"Ajour 707 renamed\",\"agent\":\"build\",\"model\":{\"id\":\"missing-model\",\"providerID\":\"missing-provider\",\"variant\":\"default\"},\"version\":\"1.19.5\",\"time\":{\"created\":1794803669310,\"updated\":1794803669656}}"
}
```

```json
{
  "method": "DELETE",
  "url": "/session/ses_e1d5d66c1ffe85OkllB2m2Mx1N",
  "status": 200,
  "body": "true"
}
```

v2 title ignored, admission and active-map probes:

```json
{
  "method": "POST",
  "url": "/api/session",
  "status": 200,
  "body": "{\"data\":{\"id\":\"ses_e1d599c17ffejzlfvfK2wpk8uj\",\"projectID\":\"8269b75b0e6be37fe1904295755be2ae3fb54551\",\"cost\":0,\"tokens\":{\"input\":0,\"output\":0,\"reasoning\":0,\"cache\":{\"read\":0,\"write\":0}},\"time\":{\"created\":1794803918129,\"updated\":1794803918129},\"title\":\"New session - 2026-11-16T04:38:38.129Z\",\"location\":{\"directory\":\"C:\\\\Users\\\\alext\\\\AppData\\\\Local\\\\Temp\\\\ajour-agent-facts-707\\\\repo\"}}}"
}
```

```json
{
  "method": "POST",
  "url": "/api/session/ses_e1d599ab3ffehyqebXY7EPM073/prompt",
  "status": 200,
  "body": "{\"data\":{\"admittedSeq\":2,\"id\":\"msg_1e2a66dc8001DB8mE2D1A3m5vb\",\"sessionID\":\"ses_e1d599ab3ffehyqebXY7EPM073\",\"prompt\":{\"text\":\"Reply with OK and do nothing else.\"},\"delivery\":\"steer\",\"timeCreated\":1794803920329}}"
}
```

```json
{
  "method": "GET",
  "url": "/api/session/active",
  "status": 200,
  "body": "{\"data\":{}}"
}
```

Selected SSE lines, IDs omitted here for readability:

```json
[
  {
    "type": "session.status",
    "properties": {
      "sessionID": "ses_e1d599ab3ffehyqebXY7EPM073",
      "status": {
        "type": "busy"
      }
    }
  },
  {
    "type": "session.error",
    "properties": {
      "sessionID": "ses_e1d599ab3ffehyqebXY7EPM073",
      "error": {
        "name": "UnknownError",
        "data": {
          "message": "Model not found: missing-provider/missing-model."
        }
      }
    }
  },
  {
    "type": "session.status",
    "properties": {
      "sessionID": "ses_e1d599ab3ffehyqebXY7EPM073",
      "status": {
        "type": "idle"
      }
    }
  }
]
```

Startup warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured. The test listener was loopback-only and short-lived. A real adapter must negotiate authentication and coordinate its listener with the broker. Existing broker connectivity was not tested in this research branch; #704 must decide process-to-network policy.

## GitHub Copilot CLI

| Property          | Verified contract                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Versions tested   | @github/copilot 1.0.112, native Windows package; VS Code 1.136.1, commit a44adf7f53e00964ab890f9f8758a334f1fc15bc                                                                                                                                                                                                                                                                                                                        |
| OS                | Windows only; macOS unverified                                                                                                                                                                                                                                                                                                                                                                                                           |
| Interactive start | copilot -n <title> --session-id <new-uuid> is accepted. The pipe-based probe retained UUID in session.start, workspace.yaml and printed Resume command. Because stdin was piped it ran non-interactively; A separate PTY launch also retained UUID 534c51e2-c942-41dc-8f90-c79eab723acb and title Ajour 707 PTY probe in workspace.yaml, displayed a folder trust dialog, accepted the tiny prompt, and reported the same quota failure. |
| Title             | -n/--name on new UUID. Cannot combine name with an already-existing UUID to rename. Live rejection below.                                                                                                                                                                                                                                                                                                                                |
| Prompt delivery   | Piped stdin accepted without -p. -p <text> is explicit non-interactive mode. --output-format json offers JSONL. No need to place free text in argv for initial submission.                                                                                                                                                                                                                                                               |
| State             | No agents-style list/state CLI found in help. Local COPILOT_HOME/session-state/<uuid>/events.jsonl and workspace.yaml, plus session-store.db exist. Observed event types include session.start, session.model_change, instruction.update, user.message, system.message, assistant.turn_start, assistant.turn_end, session.error, session.shutdown. These are events, not a stable current-state enum.                                    |
| Waiting for user  | Not verified. File presence or assistant.turn_end alone cannot distinguish human wait, successful completion and quota failure. No stable polling field established.                                                                                                                                                                                                                                                                     |
| Open/reopen       | --resume=<uuid> or --session-id <existing-id>. Resume without a TTY or prompt fails with No prompt provided; use terminal mode. A separate PTY resume of 534c51e2-c942-41dc-8f90-c79eab723acb restored its previous prompt and quota error before presenting folder trust again.                                                                                                                                                         |
| VS Code link      | Real builder in current VS Code source produces <product-protocol>://agents/agent-host-session/<provider>/<rawSessionId>. Therefore vscode://agents/agent-host-session/copilotcli/<uuid> has a source-backed format. Standalone CLI session adoption is separate and may require VS Code metadata. No successful OS dispatch/adoption tested.                                                                                            |
| Failure/auth      | Existing account quota returned 402 quota_exceeded; no login attempted. Successful inference and blocked/input states remain unverified.                                                                                                                                                                                                                                                                                                 |
| Cleanup           | COPILOT_HOME redirected session storage into scratch. A separate PTY probe used the default home; only its exact UUID directory was removed. No pre-existing user Copilot sessions were deleted or modified.                                                                                                                                                                                                                             |

Sources: [command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [CLI releases](https://github.com/github/copilot-cli/releases), [VS Code URL builder](https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/common/openSessionLink.ts#L117), [VS Code session migration contract](https://github.com/microsoft/vscode/blob/main/src/vs/sessions/contrib/providers/agentHost/AGENT_HOST_SESSIONS_PROVIDER.md). The builder validates the link shape, not the ability to adopt an arbitrary standalone UUID. Prefer terminal resume until that is separately verified against the installed VS Code commit.

### Real outputs and persisted identity

```json
{
  "argv": [
    "--no-auto-update",
    "--session-id",
    "70eccd17-7a72-4a90-b431-13314238b289",
    "-n",
    "Ajour 707 probe"
  ],
  "exit": 1,
  "stdout": "",
  "stderr": "\nYou have exceeded your monthly quota (Request ID: DB20:3DC489:3207DB1:377AC72:6AFA87D5)\n\n\nChanges    +0 -0\nAI Credits 0 (1s)\nResume     copilot --resume=70eccd17-7a72-4a90-b431-13314238b289\n"
}
```

```json
{
  "argv": [
    "--no-auto-update",
    "--session-id",
    "70eccd17-7a72-4a90-b431-13314238b289",
    "-n",
    "Ajour 707 probe",
    "-p",
    "Reply with OK and do nothing else.",
    "--output-format",
    "json"
  ],
  "exit": 1,
  "stdout": "",
  "stderr": "error: option '-n, --name <name>' cannot be used with option '--session-id <id>' when it resolves to an existing or remote session or task.\n--name only names a brand-new session created by --session-id=<new-uuid>; the resolved session was not renamed.\n"
}
```

```json
{
  "argv": ["--no-auto-update", "--resume=70eccd17-7a72-4a90-b431-13314238b289"],
  "exit": 1,
  "stdout": "",
  "stderr": "No prompt provided. Run in an interactive terminal or provide a prompt with -p or via standard in.\n"
}
```

```yaml
id: 70eccd17-7a72-4a90-b431-13314238b289
cwd: C:\Users\alext\AppData\Local\Temp\ajour-agent-facts-707\repo
git_root: C:\Users\alext\AppData\Local\Temp\ajour-agent-facts-707\repo
branch: master
client_name: github/cli
last_client_name: github/cli
name: Ajour 707 probe
user_named: true
summary_count: 0
fork_count: 0
created_at: 2026-11-16T04:34:28.697Z
updated_at: 2026-11-16T04:34:28.846Z
```

Selected actual session events, large usage fields omitted:

```json
[
  {
    "type": "session.start",
    "data": {
      "sessionId": "70eccd17-7a72-4a90-b431-13314238b289",
      "version": 1,
      "producer": "copilot-agent",
      "copilotVersion": "1.0.112",
      "startTime": "2026-11-16T04:34:28.697Z",
      "contextTier": null,
      "context": {
        "cwd": "C:\\Users\\alext\\AppData\\Local\\Temp\\ajour-agent-facts-707\\repo",
        "gitRoot": "C:\\Users\\alext\\AppData\\Local\\Temp\\ajour-agent-facts-707\\repo",
        "branch": "master",
        "headCommit": "8269b75b0e6be37fe1904295755be2ae3fb54551"
      },
      "alreadyInUse": false,
      "remoteSteerable": false
    }
  },
  {
    "type": "assistant.turn_start",
    "data": {
      "turnId": "0",
      "interactionId": "0aad1d77-5027-4a61-a89d-9b32c7c093a5",
      "agentMode": "interactive"
    }
  },
  {
    "type": "assistant.turn_end",
    "data": {
      "turnId": "0"
    }
  },
  {
    "type": "session.error",
    "data": {
      "errorType": "quota",
      "message": "You have exceeded your monthly quota (Request ID: DB20:3DC489:3207DB1:377AC72:6AFA87D5)",
      "statusCode": 402,
      "providerCallId": "DB20:3DC489:3207DB1:377AC72:6AFA87D5",
      "serviceRequestId": "241806cc-a3e6-4182-8e54-a861f2e7366d",
      "errorCode": "quota_exceeded",
      "originatingMessageId": "98dd3a56-cc59-4929-8659-518b906fcae2"
    }
  },
  {
    "type": "session.shutdown",
    "data": {
      "shutdownType": "routine"
    }
  }
]
```

## Recommended adapter design per tool

1. **T3.** Resolve its reviewed launcher to the desktop executable and script, with required environment overrides, or refuse unsupported shims under #706. Send prompt on stdin. Store threadId and projectId immediately; fetch the canonical link next. Batch list by mapped project, but call show to obtain pendingRequestCount. Prioritize that over running. Keep archived, settled and snoozed separate from execution state. Treat a missing server as unavailable, not deleted.
2. **Claude.** Prefer --bg with stdin for unattended handoff after the user trusts the folder. Parse the short job ID, then query agents --json --all to learn full sessionId. Do not promise caller-chosen UUID for --bg. Use state for background lifecycle and status/waitingFor for live process detail. Interactive terminal mode can use --session-id. Reopen background with attach; use stopped transcript resume or explicit desktop transfer when available. Never auto-accept trust on a user's repository.
3. **Codex.** Keep an owned app-server connection alive until turn/completed. Use JSON stdin for title and prompt. Retain pending RPC requests and active flags, and report disconnected state honestly. Persist the thread UUID early and reopen using the documented deep link or terminal resume. Treat desktop sidebar discovery as a separate acceptance test. Do not poll a fresh server and assume its notLoaded means another process has stopped working.
4. **OpenCode.** Initially pin the verified v1 API subset of 1.19.5. Negotiate /global/health and /doc before using experimental v2. Use an explicit loopback port, HTTP bodies for free text, and broker-owned service credentials. Maintain SSE error and pending question/permission information alongside status snapshots. Idle is not evidence of success. Reopen by attach to the same server. Avoid development service-port assumptions and the v2 title field until supported by the detected schema.
5. **Copilot.** Generate UUID before start, use name only on creation, and feed stdin to avoid argv prompt text. Use terminal resume as the first supported reopen route. While a broker owns a process, its output and exit give useful run evidence; externally resumed sessions lack a proven stable state API. Keep filesystem-derived state explicitly best-effort and unknown when ambiguous. Gate the VS Code URI behind an adoption test rather than presenting the format as a completed integration.

For all tools, retain native values alongside any Ajour mapping. needs-you requires positive evidence, ready/done is a product decision, and gone requires stronger evidence than a filtered list omission. Preserve stderr for user-visible diagnostics after credential redaction. Set bounded launch/query deadlines, without treating them as agent completion deadlines. Allow only declared executable paths, reviewed launcher arguments and mapped repository folders. Native titles still use argv in most tools, so the broker must support title values with spaces and Unicode as one argument.

## Verification limits and cleanup

The executed checks were CLI help/version, live T3 start/list/show and organization, direct executable worktree launch with pending input, Claude print/background/stdin/resume, Codex stdio JSON-RPC through completion and archive, OpenCode HTTP/SSE/v2 admission, and Copilot identity/storage/quota failure. This is research, not an Ajour runtime change. No application unit tests or builds were needed. Desktop sidebar inclusion, OS deep-link dispatch, macOS and full Copilot inference remain explicit gaps.

T3 probe project and threads were deleted through project remove --force. Its generated git worktree was removed separately. Claude background was stopped and removed; exact disposable project and worktree data were purged using Claude's purge command. Claude warns old config backups may retain the project entry until normal rotation, and server-owned histories may also retain deleted probe records. Codex probe was archived through thread/archive and its transcript remains in archived storage, as expected for that operation. OpenCode server and sessions used isolated XDG directories; Copilot session storage used an isolated COPILOT_HOME. Scratch repos, npm prefix, logs and probe scripts were deleted after copying evidence into this report. No existing clone was scanned, no server was stopped, and no PR was opened.

Formatting verification: the repository just format command first failed because sh was absent from PATH. With the Git sh path supplied it reached pnpm but failed because this worktree has no node_modules or Prettier. A disposable Prettier installation checked this Markdown successfully through a scratch justfile with default Markdown settings. The Tailwind plugin is irrelevant to this Markdown-only file. git diff --check passed. Repository-wide format-check was not run.

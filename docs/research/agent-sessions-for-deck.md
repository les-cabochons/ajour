# Agent sessions for Deck

Research for [#643](https://github.com/les-cabochons/ajour/issues/643), 2026-11-05.
Context: [#642](https://github.com/les-cabochons/ajour/issues/642), [#597 and its decision comments](https://github.com/les-cabochons/ajour/issues/597), and [map #592](https://github.com/les-cabochons/ajour/issues/592).

## Recommendation

Use a mix. Keep one conversation for the selected pull request, warm while its review page is in use, serving chat and uncached inline asks sequentially. Return cached inline answers immediately. Start cold after eviction or failure, using a saved provider session where supported, otherwise an explicit bounded conversation summary. Do not keep a process for every open tab or start a new conversation for every explanation.

Keep the existing product rule of one agent task at a time as **one active turn globally**, with idle conversations outside that slot. While a timesheet task or another Deck turn runs, disable new asks with the running-task message and Stop link already decided in #597. Do not silently run two turns or preempt a timesheet write. This changes the implementation's current one-process rule and needs to be stated in the spec.

Warmth removes some local initialization, not model inference or network delay. The local probes below still took 1.7 to 2.2 seconds to reach text on warm turns. Therefore "instant" means an immediate response from the UI and cache, followed by streamed text on a miss. No measured CLI meets a subsecond first-text promise here.

## Evidence and limits

Inspected Ajour commit `7bc50d89d8acf939a888e9f4e94579777fe42694`. Official documentation and first-party source were read live. Context7 was unavailable. Claude Code and Codex help and real two-turn sessions were exercised on Windows. OpenCode was absent, so its behavior below is documentation and source evidence, not an executed integration.

This is a research branch. No runner or product behavior changed. The spike sent only `Reply with exactly OK. Do not use tools.` from a new temporary directory, without repository content or Ajour MCP access. It did not test Deck tools, cancellation, a large conversation, or a packaged Electron build. Claims about the proposed design are recommendations, not observed behavior.

## What Ajour does now

| Code at the inspected commit                                                                          | Consequence for Deck                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/agent-runner/runner.ts:337`, `start` refuses while `active` or `starting` exists        | A process waiting for another message would block all other work today.                                                                                   |
| `runner.ts:424`, `createMcpClient`; `runner.ts:432`, `sessions.begin`                                 | Each launch has its own token and Ajour activity session. These are distinct from a provider conversation ID.                                             |
| `runner.ts:461`, prompt construction with `weekOf`; `prompts.ts:6`, timesheet and `end_session` rules | Deck needs a core-task request and prompt, as #597 decided. It must not tell the model to end the conversation after each answer.                         |
| `runner.ts:488`, spawn with ignored stdin                                                             | Further turns and control requests cannot enter the current process.                                                                                      |
| `runner.ts:541`, line parser; `adapter.ts:46`, `RunnerEvent`                                          | Only tool activity, a final summary, failure and MCP startup failure reach the runner. Text deltas and turn IDs are absent.                               |
| `runner.ts:613`, `endRun`; `runner.ts:649`, `cleanUp`                                                 | Process completion ends the activity session, revokes the client and removes the temporary folder. This cannot also mean ordinary turn completion.        |
| `runner.ts:688`, `terminate`; `runner.ts:742`, `tick`                                                 | Stop kills the CLI, and stalled activity eventually kills it too. Neither represents an intentionally idle conversation. Descendant cleanup remains #341. |

Important correction to the ticket premise: there is **no `toolScope` implementation in this checkout**. `mcp-server.ts:254` registers every current data and session tool for each authenticated client. `mcp-server.ts:365` also gates the whole endpoint on global MCP being enabled. A per-run token provides identity and revocation, not a task-tool allowlist or PR boundary. #597's scoped Deck tools and consent exception are decisions still to implement here. Do not claim existing isolation that is absent from the source.

## Claude Code

### Keep it open and send turns

Launch `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`, leave stdin open, and write one newline-delimited user message per requested turn. A minimal message is:

```json
{
  "type": "user",
  "message": { "role": "user", "content": "Explain this selection" },
  "session_id": "",
  "parent_tool_use_id": null
}
```

The spike successfully sent two messages through one process, waiting for each `result` before sending the next. Capture the returned session ID rather than inferring it from the working directory. Cold continuation uses `--resume <id>`; `--continue` selects the latest conversation and is unsuitable for PR isolation. `--no-session-persistence` supports an in-memory session but prevents later resume. These flags are in local 2.1.318 `--help` and the [official CLI reference](https://code.claude.com/docs/en/cli-reference). The [streaming input docs](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) describe persistent input and sequential messages.

### Streaming, tools and cancellation

`stream-json` alone is insufficient for progressive text. With `--include-partial-messages`, consume `stream_event.event` content-block deltas whose delta type is `text_delta`. A later complete assistant block is not additional text to append. The [streaming output docs](https://code.claude.com/docs/en/agent-sdk/streaming-output) specify these events. The [first-party subprocess transport](https://github.com/anthropics/claude-agent-sdk-python/blob/3be907edb9c86269d30d1427a77937dd788d6419/src/claude_agent_sdk/_internal/transport/subprocess_cli.py) constructs the same input/output flags.

Keep the current adapter's explicit `--mcp-config`, `--strict-mcp-config`, disabled built-in tools and isolated instruction/settings discovery. The MCP HTTP authorization header expands the environment token. A dedicated process/config per warm PR avoids sharing another PR's token. Tool permission flags do not constrain the PR IDs a tool can act on, so Ajour must enforce that on every call.

For turn cancellation, send the SDK control request `{"type":"control_request","request_id":"unique-id","request":{"subtype":"interrupt"}}`. Match the control response and drain the interrupted turn before accepting another. The [first-party query implementation](https://github.com/anthropics/claude-agent-sdk-python/blob/3be907edb9c86269d30d1427a77937dd788d6419/src/claude_agent_sdk/_internal/query.py) writes this envelope and implements `interrupt`. The [TypeScript control reference](https://code.claude.com/docs/en/agent-sdk/typescript#sdkcontrolinterruptresponse) also documents queued-message receipts and capability-gated `cancel_queued`. Ajour should keep its own queue empty and send only one turn at a time. Killing the process remains a bounded fallback if cancellation does not settle.

The Claude Code public repository does not expose the full CLI implementation. The SDK source, local help and executed wire exchange are the evidence here, not an assertion that its internals were audited.

## Codex CLI

### Keep it open and send turns

Use `codex --no-daemon app-server` over private stdio. Exchange `initialize` and `initialized`, call `thread/start`, then repeat `turn/start` against the returned `threadId`. This preserves a live conversation without relaunching `exec`. For a cold restart, use `thread/resume` against a persisted ID. An ephemeral thread is intentionally not resumable from disk. The installed app-server help labels the interface experimental, so pin supported versions and verify their generated protocol types. See [official app-server docs](https://learn.chatgpt.com/docs/app-server).

`codex exec resume <id> <prompt> --json` is a valid alternative when each turn may restart the process. Local 0.166.0 help confirms it. It preserves history, not a warm process. Today's adapter starts `exec --ephemeral`, so there is no persisted conversation to resume. Never use `--last` to choose a Deck conversation.

### Streaming, tools and cancellation

App-server emits `item/agentMessage/delta`; route these by thread, turn and item to the correct UI answer. `turn/completed` is the terminal event. The current `exec --json` adapter waits for an `item.completed` agent message and discards earlier updates; it cannot serve Deck's incremental UI as written. The spike received real deltas from app-server.

`thread/start` accepts a `config` object, along with `ephemeral`, `cwd`, sandbox and approval policy, as confirmed in the [first-party generated protocol](https://github.com/openai/codex/blob/194f2662b8b63390416c44ebb7e6a3a35a845e3a/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts). Use a dedicated process/config for the selected PR initially. Pass Ajour's token only in the child environment and reference `bearer_token_env_var` in its MCP configuration. Preserve the adapter's tool and instruction restrictions; do not inherit the user's unrelated servers. [Official MCP configuration](https://developers.openai.com/codex/mcp/) documents token environment variables and enabled/disabled tool lists. These lists still do not authorize a PR resource.

Cancel using `turn/interrupt` with both `threadId` and `turnId`, then wait for `turn/completed` with interrupted status. Do not treat the JSON-RPC acknowledgment alone as a released execution slot. The [app-server protocol documentation](https://learn.chatgpt.com/docs/app-server) describes this lifecycle. Local help and an actual initialize, thread creation and two turns verified the basic protocol on 0.166.0, but cancellation and thread-specific MCP overrides were not exercised.

## OpenCode

### Keep it open and send turns

Run a private `opencode serve` process. Create a session with `POST /session`, keep its ID, and submit further turns with `POST /session/:id/prompt_async`. Subscribe to the server events before submitting so early text is not lost. A cold process can reopen a stored session; the CLI also offers `run --session <id>` and `run --attach <url>` to reuse a server. The [official CLI docs](https://opencode.ai/docs/cli/) explicitly describe attachment as avoiding MCP cold boots.

The [official server reference](https://opencode.ai/docs/server/) documents the HTTP session endpoints, SSE events and `POST /session/:id/abort`. Bind only to loopback and set a generated `OPENCODE_SERVER_PASSWORD` in the environment. Electron's local API should own the connection and credentials, not expose them to the renderer. This is a separate HTTP control server, not the Ajour MCP endpoint.

### Streaming, tools and cancellation

Use the server's incremental events, with session/message/part identifiers, rather than today's `run --format json` adapter. In [v1.18.35 CLI source](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/cli/cmd/run.ts#L720), the `text` output is emitted only when `part.time.end` exists. JSON event output does not imply token-level text output. The server can stream deltas; verify the installed version's event schema before choosing between legacy `message.part.delta` and newer text events. [v1.18.35 event definitions](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/schema/src/session-event.ts#L198) include `session.next.text.delta`.

MCP connections and authorization headers are configured at instance level, not by adding an Ajour token to an individual prompt. The [v1.18.35 MCP implementation](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/mcp/index.ts#L492) uses `InstanceState`, with remote headers on the transport. Give each retained PR its own isolated instance/process and token initially. Do not reconfigure a shared server's single `ajour` token while other sessions exist. [Official MCP docs](https://opencode.ai/docs/mcp-servers/) explain per-agent tool controls. Ajour remains responsible for resource authorization.

For the documented API and v1.18.35, cancel with `POST /session/:id/abort` and confirm the session returns idle. Closing an SSE subscription is not cancellation. The [pinned route definitions](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts#L85) confirm the abort and prompt paths. Current `dev` has reorganized packages and a [session interrupt handler](https://github.com/anomalyco/opencode/blob/504f1ddb269c0f3b5a49f2b60401fbaca35d3d0e/packages/server/src/handlers/session.ts#L607). Do not mix those newer internals with the older public HTTP contract. Fetch the selected binary's `/doc` and verify its API before enabling Deck support. No local OpenCode binary was available to resolve that compatibility boundary or measure latency.

## Local latency and idle-resource spike

Environment: Windows, Python 3.10.11 subprocess controller, installed Claude Code 2.1.318 and codex-cli 0.166.0. One new process and two sequential trivial turns per CLI, with ten seconds idle between turns. These are single observations, not percentiles or a provider comparison. Default models and account paths differ. Codex reported `gpt-6.1-sol`; the Claude probe did not record its resolved default model.

| Measurement                             |             Claude Code |     Codex app-server |
| --------------------------------------- | ----------------------: | -------------------: |
| Launch to first turn completion         |                 2.671 s |              5.078 s |
| First send to first text                |                 2.602 s |              2.940 s |
| First send to completion                |                 2.618 s |              2.976 s |
| Second send to first text               |                 1.738 s |              2.174 s |
| Second send to completion               |                 1.755 s |              2.266 s |
| Protocol initialize response            | Not separately measured | 0.305 s after launch |
| Thread ready                            | Not separately measured | 2.101 s after launch |
| Working set after turn one              |               216.1 MiB |            134.0 MiB |
| Working set after ten idle seconds      |               216.0 MiB |            149.4 MiB |
| Process CPU consumed during idle window |     0.03125 CPU seconds |  0.09375 CPU seconds |

The first send happened after Claude process creation. For Codex it happened after `thread/start` completed, so its first-send figure excludes about 2.1 seconds of initialization. Launch-to-completion includes that setup. "Cold" means a newly launched local process, not an empty OS cache or uncached provider prompt. No MCP server was started in either probe, so actual Deck initialization can cost more.

Resource samples used PowerShell `Get-Process -Id <childPid>`, reading `WorkingSet64` and cumulative `CPU` before and after the idle window. They measure the main process only, not descendants, disk usage, or a browser. No Playwright process is needed for Deck. Both children were killed after the second turn, and the temporary Codex authentication copy was removed in `finally`.

Claude reported cumulative `total_cost_usd` of $0.0126719 after turn one and $0.0164621 after turn two, an increment of $0.0037902. These are CLI accounting estimates, not an invoice or a claim that a subscription incurs that separate cash charge. Its first turn reported 1,541 cache-write and 649 cache-read input tokens; the second reported 381 and 1,831. This also shows that persistent processes do not eliminate context-token accounting. Codex monetary cost was not measured. OpenCode latency and resource use are unmeasured.

### Reproduce the probe

From an empty temporary directory, use the installed executable paths, newline-delimited JSON on stdin/stdout and a monotonic clock. Never run it from the checkout. Launch Claude with:

```text
claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --setting-sources "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools "" --disable-slash-commands --permission-mode dontAsk --no-session-persistence
```

Set `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, and `ENABLE_CLAUDEAI_MCP_SERVERS=false`. Keep stdin open. Send the user envelope shown above with the trivial prompt, record the first text delta and `result`, wait ten seconds, and repeat. The script inherited the existing login. It did not use `--bare`, which [official headless docs](https://code.claude.com/docs/en/headless) say does not read subscription OAuth credentials.

For Codex, use a temporary `CODEX_HOME` containing only a private copy of the existing `auth.json`, never print its content, and delete the copy on completion. Launch:

```text
codex --no-daemon app-server -c project_doc_max_bytes=0 -c features.shell_tool=false -c features.unified_exec=false -c 'web_search="disabled"'
```

Send `initialize` with a client name/version and `experimentalApi:true`, then `initialized`. Call `thread/start` with the empty directory, `ephemeral:true`, `approvalPolicy:"never"`, `sandbox:"read-only"`, and the same disabled shell settings in `config`. Send the same trivial prompt in `turn/start.input` as a text item. Time the first `item/agentMessage/delta` and `turn/completed`, sample the child process, idle ten seconds, then repeat on the same thread. End the process and remove the temporary credential copy. This description records the executed method; it is not an automated benchmark committed to the product.

## Keeping a session warm

For all three, distinguish an idle local process from ongoing agent work. Waiting on input does not itself require a model generation. This is an architectural inference from their input-driven protocols, not a guarantee of zero background network traffic, CPU or provider charges. Do not send model-based keepalive prompts. Timers, plugins and unrelated MCP servers should remain disabled.

Warm processes retain conversation state, auth material in memory, open handles and any MCP subprocesses. The measured resident cost is material enough that one per background PR tab is a poor default. Keep only the selected PR process warm initially. Use a provisional five-minute idle eviction, then validate it with packaged-app measurements. Persisted provider sessions let a later process restore history, with fresh authorization. An evicted ephemeral conversation requires bounded replay or a clearly announced fresh start.

Provider billing depends on the account, selected model, input/output tokens, cached context and tools, rather than Ajour reserving a local process. A warm process does not reserve model capacity or keep a prompt cache alive forever. Larger chat history can raise per-turn cost and latency; cap retrieved content, record usage per turn, and expose reset. Do not claim dollar-per-hour idle savings or equal costs across subscription and API accounts from this spike.

## Runner changes needed

1. **Separate identity and lifetime.** Add a Deck conversation keyed by connection, repository, PR, base/head commits, provider and model configuration. Keep provider conversation ID, Ajour conversation ID and turn ID distinct. Add `open`, `sendTurn`, `cancelTurn`, `close` operations behind adapters. Keep the existing plugin run route working and add the core request union decided in #597. No `weekOf` for Deck.
2. **Make scheduling explicit.** Replace the single `active` process ownership with a global active-turn lease plus the selected PR's idle transport. Timesheet tasks hold the lease for their whole run. A Deck turn holds it until terminal completion or bounded cancellation cleanup. An idle session holds no lease and has no stall deadline. Warm initialization must not start a hidden model turn. Another active task disables uncached asks; cached answers remain readable.
3. **Stream structured turn events.** Add text delta, tool start/result, completed, interrupted and failed events with conversation/turn/item IDs. Carry these over an authenticated local stream to the renderer with sequence numbers and bounded buffering. Subscribe before sending a turn. Batch updates to the answer component, not every diff line, and avoid counting a completed text block twice. Keep partial text marked interrupted or failed, never successful cached content.
4. **Implement resource authorization in Ajour.** Resolve the bearer token to an immutable Deck scope holding repository/connection/PR and base/head revisions plus allowed operations. Filter both `tools/list` and `tools/call`, reject direct calls to absent tools, and check scope again at execution. Bind `read_hunks`, file reads, threads and guide operations to that context; reject foreign IDs, unsafe paths, stale heads and all timesheet tools. Clone access follows #644. Never rely on the model repeating the right PR identifier.
5. **Separate read-only asks from chat writes.** Chat supports #642's writes, with a visible action result and link for each committed write. Inline `explain` and `more detail` should use a read-only turn authorization in the API, even if the retained provider session knows write-tool names. This is a recommended restriction for those actions, not a new global approval prompt. A tool call must hold the current turn's lease; revoke that authorization before releasing a cancelled turn. Already committed external writes are not undone by Stop, and uncertain writes must be reconciled rather than retried blindly.
6. **Keep context current.** Send each selection or concern as an explicit turn attachment with its revision and answer destination. Share the PR conversation sequentially with chat, but do not append inline answers into the visible chat panel. Cache successful inline responses by PR, base/head, selected range or concern/hunk-content hash, guide version where relevant, provider/model, prompt version and ask kind. Invalidate or version thread/guide inputs when those mutable resources change. A head update invalidates in-flight results and closes or explicitly resets the conversation before further writes.
7. **Handle consent and teardown.** Honor the repository/provider consent of #597 and #642 before starting any provider request. Do not require the global timesheet MCP switch for the scoped Deck client. Record the needed ADR 0004 change and agent-write decision when writing the spec. Revoke the token and stop the transport on repository consent revocation, page close, eviction, connection removal or shutdown. Never reuse a stale credential on resume. Preserve the current environment-only token rule and redacted operational logs.

For cancellation, request the provider-specific turn interrupt first, block further turns until its terminal event, then kill only the owned process after a deadline if necessary. Closing a conversation is a different operation and always revokes its token. Track idle eviction separately from active-turn stalls. A process crash may end a conversation without implying that a previously committed code-host write failed.

## Why this mix

| Option                                       | Fit for Deck                                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warm process for every open PR               | Avoids some startup, but multiplies memory and token lifetime, and conflicts with the current process lock unless redesigned anyway.                                    |
| One-shot process for every ask               | Fits today's runner most closely, but repeatedly pays startup and MCP setup. Resume can recover history but cannot remove that startup.                                 |
| Warm selected PR, cached asks, cold fallback | Keeps ordinary follow-ups responsive without retaining processes for inactive PRs. Requires the lifetime split, cancellation and authorization work above. Recommended. |

Before implementation acceptance, run both a realistic selected-code ask and a growing chat with actual scoped MCP tools in the packaged app. Measure launch-ready, submit-to-first-text, completion, idle process-tree memory and CPU over minutes, cancellation settlement and eviction/resume. Verify foreign-PR denial, permission changes, guide submission validation, late deltas after navigation, head changes during a write, and coexistence with a timesheet task. OpenCode needs an installed-binary spike and version-specific API check. These checks remain outstanding; this research does not certify them.

Document verification: scoped Prettier Markdown formatting and whitespace checks passed. `just format-check` could not start because `sh` was unavailable on PATH. The checkout also lacks its formatting plugin dependency, so the scoped check used the existing Prettier binary from the main checkout with `--no-config`, which applies the repository's default Markdown formatting. No application tests were run for this documentation-only change.

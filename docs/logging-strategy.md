# Logging Strategy

Ajour reports what happened with wide events, following
[loggingsucks.com](https://loggingsucks.com/): one context-rich event per unit
of work per runtime, built up while the work runs and emitted once at the end.
The event records what happened to the unit of work, not what the code did
along the way. The spec is #304. Events never hold content (ADR 0011). On desktop the
user can turn on a local log file (ADR 0014); otherwise they go nowhere.

## The model

- **A unit of work** is something that changes state, crosses to another
  runtime or an external system, or takes noticeable time: a store command, a
  local API request, a plugin operation, an IPC call to the main process, a
  background job (a sync, a calendar fetch, a queued write), a route change,
  launch, boot and quit, and every uncaught error. Opening a menu, hovering,
  moving focus or typing is not a unit of work.
- **One event per unit of work per runtime.** The event opens when the unit
  starts, collects fields while it runs, and is emitted once from a
  finally-style completion path. There are no start or progress events.
- **Nested units fold into the outer one.** A unit that starts while another
  unit of the same runtime is active in the same flow emits nothing of its
  own. Its name is added to the outer event's `steps`, and its counts to the
  outer event's `counts`. Its own fields stay out. A sync that runs four store
  commands is one event, and so is an agent tool call that runs a store
  command.
  - A folded unit that ends `refused`, `cancelled`, `timeout` or `error` is
    listed in the outer event's `step_failures`, as
    `{ name, outcome, outcome_reason?, error_type?, error_code? }`: never its
    message or fields. The outer unit's own outcome stays its own, so a sync
    whose store command was refused for a `locked_week` still ends `ok`, and
    says so in `step_failures`.
  - `steps` and `step_failures` keep their first 50 entries.
    `dropped_step_count` counts the names `steps` left out.
  - A unit that ends inside its own scope gives way to the unit that was
    active when it started, so the work after it still folds into the outer
    unit.
- **Two kinds of unit always emit their own event**, as a child span of the
  active unit:
  - a plugin operation, because the worker is its own runtime boundary;
  - detached work, which outlives the unit that starts it, such as an agent
    run a request starts, or an agent session a tool call begins.
- **The active unit** follows the flow. The renderer uses a synchronous scope
  stack, because store commands are synchronous: an async unit leaves the
  stack at its first `await`, and re-enters its scope with `unit.enter()`
  around the store commands it runs after. The local API and the main process
  use Node's async context, so the active unit follows `await`s.
- **Runtimes** are `renderer`, `api` and `main`. On desktop the local API runs
  inside the main process, but it stays its own runtime. A plugin operation's
  event reports its host's runtime.

## Names

- A name is `<subject>.<operation>` in snake_case. The subject is a glossary
  term (`time_entry`, `backlog_item`, `comment`, `agent`), and the operation a
  present-tense verb (`time_entry.update`) or the noun of a lifetime
  (`agent.run`, `agent.session`, `app.launch`). Glossary terms win over code
  identifiers: `backlog_item.settle`, not `work_item.settle`.
- An operation keeps its name in every runtime. The backlog sync is
  `backlog.sync` in the renderer (kind `job`), in the local API (kind
  `request`) and in the plugin host (kind `plugin_operation`).
- Each seam maps its keys to names in a typed table, so a new store command,
  route, IPC channel or plugin method fails to compile until it has a name.
  The local API's routes are `ROUTES` in `apps/api/src/routes.ts`, and its
  plugin methods `PLUGIN_OPERATION_EVENTS` in `apps/api/src/plugin-host.ts`
  (and the schema host's own). The main process's IPC channels are in
  `IPC_CHANNELS` (`apps/desktop/electron/ipc-channels.cjs`), which
  `just typecheck` checks against the catalog. The renderer's local API
  client functions are `APP_API_CLIENT` in `apps/web/src/lib/app-api.ts`.
- A seam may refine the name once it knows the operation, with
  `unit.rename()`: an MCP request becomes `agent_tool.call` once its method is
  read.

## Envelope

Every event carries the envelope, whatever its name:

```ts
type WideEvent = {
  schema: 1;
  name: string; // from the catalog
  kind:
    | "command"
    | "job"
    | "request"
    | "ipc"
    | "plugin_operation"
    | "lifecycle"
    | "navigation"
    | "crash";
  runtime: "renderer" | "api" | "main";
  outcome: "ok" | "noop" | "refused" | "cancelled" | "timeout" | "error";
  outcome_reason?: string; // a closed set per event: "locked_week", "capacity", ...
  started_at: string; // ISO 8601 UTC with milliseconds
  duration_ms: number;
  trace_id: string; // W3C trace context, 32 hex
  span_id: string; // 16 hex
  parent_span_id?: string;
  launch_id: string; // one per app launch, shared by every runtime
  window_id?: string; // renderer only, one per window load
  trigger: "user" | "agent" | "schedule" | "boot" | "system";
  surface?:
    | "button"
    | "popover"
    | "shortcut"
    | "item_key"
    | "palette"
    | "context_menu"
    | "app_menu"
    | "drag"
    | "editor"
    | "dialog"
    | "toast";
  steps?: string[]; // nested units folded into this one, the first 50
  dropped_step_count?: number; // names steps left out
  step_failures?: {
    name: string;
    outcome: string;
    outcome_reason?: string;
    error_type?: string;
    error_code?: string;
  }[];
  counts?: Record<string, number>; // added beyond #304: what count() and folded units counted
  app: {
    version: string;
    channel: "dev" | "nightly" | "stable" | "web";
    commit?: string;
    packaged: boolean;
  };
  device: { platform: string; arch?: string; electron?: string };
  error?: {
    type: string;
    code?: string;
    message?: string;
    retriable?: boolean;
  };
  // plus the event's own nested objects, typed per name in the catalog
};
```

- **No `level`.** Whoever shows or exports an event derives severity from
  `outcome`.
- **Fields are snake_case.** IDs end in `_id`, and units go in the name
  (`_ms`, `_bytes`, `_count`).
- **Domain context lives in nested objects** named for glossary terms and
  seams: `time_entry`, `backlog_item`, `plugin`, `connection`, `agent`,
  `http`, `ipc`, `worker`, `store`.
- **`kind`** names the seam that opened the event. A `command` is a store
  command, or a local API client call a user or agent action started. A `job`
  is wrapped work that can run on its own: a sync, a fetch, a queued send, an
  agent session or run.
- **`trigger`** says who started the unit: the user, an agent through MCP, a
  schedule, the boot, or the system reacting to something else. A local API
  request is `system` unless it knows better, such as an agent's MCP call or
  comment call: the caller's own event, in the same trace, holds the user's
  trigger.
- **`surface`** says where a user action came from. The dispatchers that
  report it own the value. When dispatchers nest, the inner dispatcher of
  equal or higher `SURFACE_PRIORITY` wins.

## Privacy

ADR 0011 is the rule: events never hold content. No notes, titles,
descriptions, comment bodies, names, emails, search text, agent prompts or
tool inputs, file names, paths, URLs, hosts, source tool keys, secrets or
tokens.

- Every field declares a privacy class in the catalog, `operational` or
  `sensitive`, and a field without one fails to compile. The envelope is
  classed the same way (`envelopeFields`).
- Sensitive fields are the days, weeks and durations of time records, and
  every error message. A sink receives them only if the user allows it for
  that sink. The privacy filter (`createPrivacyFilter`) is how a sink
  applies the classes: it reads them from the catalog, never from a list of
  its own (see [Sinks](#sinks)).
- An error message enters an event only through the scrubber. `unit.fail()`
  and a thrown error both pass it, when the event is built, so a dropped event
  costs no scrubbing. It finds, on the original text, the connection's secret
  values (pass them as `fail(error, { secrets })`), URLs, the user data path
  and the home directory, the paths only where a path segment ends. Ranges
  that overlap are replaced once, by the mark of the widest: `[secret]`,
  `[url]`, `[user data]` or `~`. So a secret inside a URL or a path can't keep
  the rest of it in the message. Then the message is cut at 512 characters. A
  scrubbed message is still sensitive.
- A request body that isn't JSON fails with a fixed error, type `SyntaxError`
  and code `invalid_json`: the parser's message can quote the body.

## The package

`packages/wide-events` owns the model. It runs in the browser and in Node, and
its entry points are:

| Entry point           | What it holds                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `index.ts`            | `createEmitter`, the envelope types and the synchronous scope                                               |
| `catalog.ts`          | Ajour's catalog of event names, `defineCatalog`, `operational`, `sensitive` and `envelopeFields`            |
| `sinks.ts`            | `nowhere`, `createRecordingSink`, `createConsoleSink`, `sinkFromSwitch`, `fanOut` and `createPrivacyFilter` |
| `local-log-file.ts`   | `createLocalLogFile`, the desktop main process's local log file, for Node only                              |
| `trace-context.ts`    | `encodeTraceparent` and `decodeTraceparent`                                                                 |
| `scrub.ts`            | `scrubErrorMessage`                                                                                         |
| `secret-redaction.ts` | the secret redaction the scrubber and the local API's plugin errors share                                   |
| `node.ts`             | `asyncContextScope`, for Node runtimes only                                                                 |

Each runtime creates one emitter at start, with its runtime context and a
sink:

- `start(name, init)` opens a unit. `init` gives its `kind` (one the catalog
  allows for the name), `trigger` and `surface`, and `detached` or a `parent`
  span.
- A unit has `set(fields)`, `count(counter, n)`, `fail(error, options)`,
  `refuse(reason)`, `cancel(reason)` and `end(outcome?)`. The outcome
  defaults to the one recorded, or `ok`. `end` emits once; anything after it
  changes nothing. A unit also has `enter(fn)`, `rename(name)` and
  `traceparent()`.
- `run(name, init, fn)` runs a sync or async function as a unit, active while
  it runs, and ends it in every path. A thrown error ends it as an `error`,
  unless the work recorded its outcome first. A sync function stays sync.
- `current()` returns the active unit, so the code doing the work can add to
  it.

The local API creates its emitter in `apps/api/src/events.ts`, the
desktop main process in `apps/desktop/electron/main-events.cjs`, and the
renderer in `apps/web/src/lib/wide-events.ts`.

## Sinks

A sink has `emit(event)`, and may have `accepting()`. A sink that throws
never changes what the work does. While `accepting()` answers false, the
emitter doesn't build the event at all, as with `nowhere`, so a sink the
user turned off costs nothing.

- `nowhere` is the default, and drops everything. With it an event is never
  built: it costs object writes only, with no serialization, no I/O and no
  timers.
- `recording` is for tests.
- `console` prints one JSON line per event. `AJOUR_WIDE_EVENTS=console` turns
  it on in the terminal, for the local API and the main process.
  It is never on by default, and the local API prints nothing on stdout
  without it. In the renderer, the same variable at dev or build time prints
  the events in the devtools console. Run on its own (`just api-start`,
  through `apps/api/src/standalone.ts`), the API says where it listens on
  stderr, so stdout stays a clean stream of events.
- `fanOut(...sinks)` hands each event to every sink that accepts it. One
  that throws stops none of the others. It accepts while any of them does.
- The **local log file** (`createLocalLogFile`, ADR 0014) is the first
  exporter, built into the desktop main process.

### The local log file

The desktop main process writes events to a file on the user's computer,
once the user turns it on. Settings › Diagnostics will show it (#441).

- **Off by default.** Nothing is written, and no file or folder is created,
  until the user turns it on. While it is off, `accepting()` is false, so no
  event is built for it.
- **One stream.** Main's events and the local API's go through one sink,
  which main makes with `loadMainSink` (`apps/desktop/electron/main-events.cjs`)
  and passes to its emitter and to `startAppApiServer`'s `eventSink`. It is
  `fanOut(console, file)`: the console only when `AJOUR_WIDE_EVENTS=console`,
  and the file always, writing only while it is on. So the developer switch
  keeps working for both runtimes whether logging is on or off, and turning
  logging on doesn't need it. The console prints every event as the emitter
  built it; the file writes what its privacy filter keeps. The renderer's
  events will reach the same sink in batches over IPC (#440).
- **Privacy filter.** Before a line is written, `createPrivacyFilter` keeps
  each field only where the catalog declares it, for the event's name or in
  the envelope. A `sensitive` field (the days, weeks and durations of time
  records, and `error.message`) is kept only when the user allowed
  sensitive fields for this sink (`include_sensitive`). A field the catalog
  doesn't declare is dropped either way, so a batch from another runtime
  can't carry more than its entry. It also checks what a declared field
  holds: a string, number, boolean or null, or a list of them, unless the
  catalog gives the field a shape (`FieldShape`). `steps` is a list of
  strings, `counts` and `local_state.record_counts` hold numbers only, and
  a `step_failures` entry keeps only a step failure's own keys, with
  scalar values. An object or a function where a value belongs is dropped,
  never passed through. The envelope's `counts` keeps only the keys the
  catalog declares as counters; any other key is dropped. `record_counts` is
  the exception: its keys are dynamic collection names, so the filter checks
  its values only, not its keys. The renderer's sink runs the same walk.
- **Files.** One file per UTC day, `userData/logs/events/YYYY-MM-DD.ndjson`,
  for the day the event was emitted. Each line is one event: a JSON object
  with the envelope and its fields, as [Envelope](#envelope) describes,
  after the filter. Lines are only appended; a file is never rewritten.
  Nothing else belongs in the folder, and the sweep and the status ignore
  any other name.
- **Writes.** `emit` filters and serializes the event, queues the line and
  returns. The queue is written every 250 ms, in one append per day file,
  and holds at most 10,000 lines, not a number of bytes: past that, events
  are dropped until it is written, and counted in `dropped_event_count`
  (in `logs.status` and `logs.sweep`, since launch). Quitting waits for it,
  within the quit's 10 seconds. On a normal quit `endQuit` runs before that
  wait, so the quit's own event is already in the last flush. Only the events
  that end after it need the last write: the update-install path ends its
  event at `will-quit`, and the timed-out stop calls `app.exit`, which skips
  `will-quit`. Both write synchronously (`drainSync`), the timed-out path
  just before `app.exit`. It writes the batch still being appended first, then
  the queue, so the file keeps the emit order and the async write doesn't
  repeat them. It writes at most 2 MiB, keeping the newest lines, only while
  the file is on and has no warning, and it never throws. Lines over the
  2 MiB are lost, and not counted: nothing reports after the exit.
- **Failure.** A write that fails stops writing: the queue is dropped and the
  file keeps a `warning` with a closed reason, `disk_full` (ENOSPC, EDQUOT),
  `no_permission` (EACCES, EPERM, EROFS) or `write_failed`. The work never
  sees it. Saving the settings, as turning logging back on does, clears it
  and writing resumes. So does the next launch.
- **Retention.** A sweep runs at launch, every hour and when a limit
  changes, each its own `logs.sweep` job. It first deletes every day whose
  last moment is more than the retention ago (1, 7, 30 or 90 days), then the
  oldest days until the folder is under its size limit (100, 250 or 1,000
  MiB). It never deletes today's file, nor a day still waiting to be
  written, so today's file can pass the size limit until the day ends. A
  missing folder, or a path that isn't a folder, has nothing to sweep.
- **Settings.** Main stores
  `{ enabled, retention_days, size_limit_mb, include_sensitive }` in
  `userData/local-log-settings.json` (`local-log-settings.cjs`): off, 7,
  250 and false by default. A value outside its closed set takes its
  default. The IPC channels `ajour:get-logs-status` (`logs.status`),
  `ajour:configure-logs` (`logs.configure`, whose settings left out stay)
  and `ajour:delete-all-logs` (`logs.delete_all`) go through the IPC
  wrapper to `local-logs.cjs`. Each answers the settings, the state (`off`,
  `on` or `warning`) and its reason, and the folder's bytes, file count and
  oldest day. Delete all logs removes every day file, and what was waiting
  to be written, then the folder when nothing else is in it; a file that
  isn't a day file stays, and `deleted_file_count` and `deleted_bytes` count
  exactly the day files removed.
- **Saving settings.** Only the stored file is read leniently: a value in it
  outside its closed set takes its default. `logs.configure` refuses a value
  outside its closed set (`retention_days` 1, 7, 30 or 90; `size_limit_mb`
  100, 250 or 1000; `enabled` and `include_sensitive` true or false), or
  settings that aren't an object. The call throws, the event is `refused`
  with `invalid_settings`, and nothing changes: no setting, no file, no
  sweep.
- **One writer.** Only the process that holds the single instance lock opens
  the file. The one that lost the lock has no file sink, so its
  `app.lock_refused` goes to the console sink alone.

Remote exporters, such as Grafana and Application Insights, will be more
sinks behind the same contract, each with its own sensitive fields setting.

## Traces

Every event is a W3C span, so a future exporter can send it to a trace
backend unchanged. A unit started with a `parent` (an incoming `traceparent`
header) is that span's child: the local API makes each request the child of
the `traceparent` it carries. `unit.traceparent()` gives the header for an
outgoing call; a folded unit sends its outer unit's span. A delayed
consequence of an action, such as a source write after the Undo window,
starts its own trace and joins its cause through the domain ID that links
them.

The trace crosses every boundary (#310):

- every local API call from the renderer sends the active unit's
  `traceparent`, which the local API allows across origins;
- every call through the desktop bridge passes `{ traceparent }` last, which
  the preload passes on and the main process's IPC wrapper takes off;
- the local API sends each tool call's `traceparent` to the renderer in the
  bridge's `tool-call` message, and the renderer's run of the call is its
  child.

The bridge's own stream is an EventSource, which can't send a header, so the
renderer's `mcp_bridge.connection` and the local API's request for it are two
traces.

## Where events come from today

The local API emits these (#305, #306):

| Event                                 | Where                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| one `request` per HTTP request        | `serveWithEvent` in `apps/api/src/routes.ts`, named from `ROUTES`                                  |
| `mcp.request`, `agent_tool.call`      | `handleMcpRequest` in `apps/api/src/mcp-server.ts`, on the request's event                         |
| `mcp_bridge.connection`               | the bridge route's request, which ends when the stream closes                                      |
| one `plugin_operation` per worker run | `PluginWorkerLifetime`, for the plugin host and the schema host                                    |
| `plugin.request`                      | `CredentialBroker` in `apps/api/src/credential-broker.ts`, for each request of an API 4 plugin     |
| `api.start`, `api.stop`               | `startAppApiServer` and `stopAppApiServer` in `apps/api/src/server.ts`                             |
| `storage.load`                        | `AppApiStorage`, for each load of the state file; one it can't read, at any depth, is `unreadable` |
| `app.error`                           | `watchProcessCrashes` in `apps/api/src/events.ts`, which `apps/api/src/standalone.ts` turns on     |
| `agent.session`                       | `AgentSessions`, from begin to end                                                                 |
| `agent.run`                           | `AgentRunner`, from the start's first launch step to its one finalizer                             |

### Requests

- **One event per request.** The request seam opens it before any check, as
  `api.request`, and renames it from the route table once the request is
  routed. Every route in `ROUTES` has a name and a handler, so a route
  without either fails to compile. A route that serves several operations,
  such as the code host's, names each from its own table (`CODE_HOST_EVENTS`,
  `COMMENT_EVENTS`, `CALENDAR_EVENTS` in `apps/api/src/operation-events.ts`),
  which the plugin host's table shares.
- **Every request records** its method, its route's pattern (never its
  values), its status, its origin (`app`, `none` or `refused`) on every path,
  and its request and response sizes. The seam counts the bytes at the
  boundary, as the request's stream receives them and as the response
  writes them, so a chunked body, a stream and a refusal are counted too.
- **A request that never reaches a route** stays `api.request`, refused
  with `stopping`, `host_refused`, `origin_refused` (also an `/api` request
  with no Origin), `token_refused` (an `/api` request without the window token) or `no_route`, or
  `unknown_operation` for an operation a route's table doesn't have.
- **A request Ajour can't read** is refused with `invalid_request`: a body
  that isn't JSON or is too large, a malformed path segment, or a value the
  route's schema or Ajour's own checks refuse. Each is an
  `InvalidRequestError` (`apps/api/src/event-errors.ts`), and its event
  holds the error's type and code, never the message that could quote the
  caller's text. Any other error a route throws ends it as an `error`.
- **Each refusal says why.** A route refused because the plugin system, the
  plugin or the capability is off says which (`system_off`, `plugin_off`,
  `capability_off`), and a plugin held for the user's consent says
  `needs_consent`, as do a missing connection (`connection_not_found`), a
  feature the plugin doesn't declare (`not_supported`), and the agent
  routes' own reasons, such as `not_running`. An outcome the handler didn't
  record follows the status: a 4xx is `refused`, a 5xx an `error`.
- **Handlers add their catalog fields** to the event, such as a sync's
  counts or a connection's field count. A failed plugin call goes through
  `recordPluginFailure`, so the request ends with the same outcome and
  reason as its plugin operation: a refusal or a cancellation with its
  reason, a `timeout`, a worker failure (`plugin_error`, `exited_early`,
  `result_too_large`) with the plugin's message scrubbed of the
  connection's secrets, or `invalid_result` by its type and code. It is
  typed against the catalog, so a route's event that lacks one of these
  reasons fails to compile.
- **The event ends once**, by the seam, when the handler has settled and the
  response has flushed or closed: `end()` only starts the flush. A handler
  that weighs outcomes itself, such as MCP's for a batch, returns how the
  request ends instead of ending it, so the status and sizes still land.
- **A client that leaves** before its response flushed, while its body still
  arrived or the work still ran, ends the request `cancelled` with
  `client_closed`, without a status or response bytes nobody received, and
  without the error its leaving caused: an error from the request's own body
  stream, such as `ECONNRESET`. An outcome the route had recorded, such as a
  plugin's timeout, stands. So does any other error, even after the client
  left, whatever its code: it is recorded as the failure it is. A request
  whose connection the API's stop closed ends `cancelled` with `stopping`;
  a client that hangs up on its own while the API stops is still
  `client_closed`. A body Node's HTTP parser can't read, which Node answers
  with its own 400, is `refused` with `invalid_request` and the parser's
  code, such as `HPE_INVALID_CHUNK_SIZE`. A route
  whose response is a stream calls `stream()` on its context: the bridge's
  `mcp_bridge.connection` lasts until its client closes it, and that close
  is its normal end.
- **A body over the limit** (16 MB) is answered with a 400 as soon as it
  crosses it, with `Connection: close`: Ajour stops reading it, and the
  connection closes within a second of the limit being crossed, whether or
  not the answer could go out. The request is refused with
  `invalid_request`, and its error has the code `body_too_large`.
- **Validation messages stay out.** An error a validator throws lists the
  values it received, whether a caller's text, a plugin's result or a
  spreadsheet's headings. `withoutContent` gives every event such an error
  as its type and code, with no message.

### Plugin operations

Each worker run in the plugin host and the schema host emits one
`plugin_operation` event, named from the host's table of plugin methods, as
a child span of the request that started it, with its trigger. It carries
the plugin's ID, version, source and API version, the connection, the method
and its capability, the host's other operations at admission, the
preparation and worker durations, the timeout and the result's size. What
the method requires of the plugin, such as its capability, is checked inside
the operation, so a refusal there has its event too. It ends with its own
reason:

- refused: `capacity`, a gate's `system_off`, `plugin_off`,
  `needs_consent` or `capability_off`, `host_stopping`, `package_change`, `not_installed`,
  `runs_no_code`, `not_supported` for a capability or feature the plugin
  doesn't declare, `invalid_request` for an import whose rows break the
  plugin's definition, `agent_access` for a comment call the user
  doesn't allow, and `access_off` for an operation the connection's access
  choices don't include, such as a write on a connection that reads only;
- cancelled: `system_off`, `plugin_off`, `capability_off`, `uninstalled`,
  `shutdown`, or `access_off` when a save turns off the choice it needs;
- `timeout`;
- errors: `result_too_large`, `invalid_result` (with the error's type and
  code only), `exited_early` and `plugin_error`, scrubbed of the
  connection's secrets.

### Plugin requests

Each request an API 4 plugin sends through the broker, through one of its
connections or as a public fetch, emits one `plugin.request` event, kind
`job`, as detached work: a child span of the plugin operation that sent it,
whose span the plugin host hands the broker, so a renderer runtime's calls
over IPC land under it too. It carries the plugin, the connection (absent
for a public fetch and for one not saved yet, which `broker.pending` marks),
the method, the host kind (`base`, `derived`, `secret_address` or `public`),
the manifest's endpoint pattern the path matched (never the path itself),
the status, the redirects followed, the sizes, whether the connection is
on-premises, how long the request waited for a slot, and, unless it is
on-premises, how far the address that answered could be judged
(`broker.answer_address`: `checked`, `proxy` when a system proxy answered,
or `unknown` when the network stack named none, so only the check before
the request held). It never holds a header, a body, a query or an address.
It ends with its own reason: refused for the policy (`connection_not_found`,
`not_allowed`, `header_refused`, `access_off`, `private_address`,
`invalid_address`, `redirect_refused`, `invalid_request`), a paused
connection (`secret_unavailable`), an inactive plugin or capability,
`no_transport` outside the desktop app, or a limit (`request_too_large`,
`response_too_large`, `unchecked_response` for an answer the redaction
couldn't check within its budgets, `rate_limited`, `too_many_queued`);
cancelled for `aborted` or `operation_ended`; `timeout`; or an error for
`network`, whose message is the broker's own.

Plugin discovery skips an invalid package without a log line: the active
event counts it in `counts.invalid_plugin`, as it counts a bundled archive
that fails to install and a leftover backup it can't clear.

### MCP

An MCP request is `agent_tool.call` once its body is a tool call, named with
the tool (one of Ajour's, or `other`), never its arguments. Every MCP request
that didn't succeed ends with an outcome other than `ok`, and no diagnostic
text or argument enters its event:

- The request keeps, for each of its calls, how far it got in its handler.
  A call that never reached the handler ends `refused` with `invalid_call`:
  an unknown tool, invalid arguments, no `params`, or a call sent as a
  notification, which gets no reply.
- A handler that throws ends `error` with the error's type, and an output the
  SDK rejects after the handler returned ends `error` with `output_mismatch`.
- A call that the Ajour window ran but the tool declined, with a sentence for
  the agent, ends `refused` with `tool_refused`. That is the tool working as
  designed, not a bug.
- A call from an agent task run's client to a data tool its task doesn't
  declare (plugin API 4, #396) ends `refused` with `tool_not_declared`, and
  never reaches the window. The event names the tool and its `access`, and the
  refusal reaches the agent as an error result that names the tool. The tool
  is not registered for that client, so `tools/list` doesn't show it either.
- A JSON-RPC error reply records its code only.
- A request the transport rejects before any reply, such as one with the
  wrong `jsonrpc` version, ends by its HTTP status: `refused` for a 4xx and
  `error` for a 5xx, both with `protocol_error`.
- Any other request is `mcp.request` with `mcp.method`. A batch has the
  method `batch` and counts its tool calls in `mcp.call_count`. Each call in
  it folds into the batch's event, so a failed call is in `step_failures`. The
  batch ends with the worst outcome among its own and its calls', in this
  order: `error`, `timeout`, `refused`, `cancelled`. An outcome already
  recorded, such as a JSON-RPC error for an unknown method, is never
  downgraded.
- A batch in which two requests share an id is refused before any of it
  runs, with `duplicate_id`, and the agent gets a JSON-RPC error. This check
  runs before the SDK transport's own header and protocol checks, which sit
  inside its request handling where Ajour can't step in: a duplicate-id
  batch that the transport would also reject is recorded as `duplicate_id`,
  not `protocol_error`.

The order of outcomes is the package's: `worstOutcome()` and
`OUTCOME_SEVERITY` in `index.ts`, which later seams reuse.

A session the runner began takes the run's trigger, `user`.

### The renderer (#307)

The renderer creates its emitter at its first use. On desktop it reports the
launch the main process hands over in `window.ajourDesktop.runtime.launch`
(`LaunchContext`: `launch_id`, `app` and `device`), so every runtime reports
one launch. Each field is checked and falls back on its own: the web build,
or a main process that hands none over, makes its own launch ID, and the web
build reports the `web` channel. Each window load gets its own window ID.
The renderer knows neither the home folder nor the user data folder, so its
events keep an error's type and code but leave its message out. Its sink
also passes on only the fields the catalog declares for each event, so a
field without a privacy class never leaves the renderer, whatever set it,
and a field holds only what the shared privacy filter allows it (see
[The local log file](#the-local-log-file)): an object or a function where a
value belongs is dropped, and counted in `dropped_field_count`.

- **Store commands.** `STORE_COMMANDS` in `apps/web/src/lib/local-store.ts`
  names every command of the local store but its reads, so a new command
  without a name fails to compile. A name may be picked from the arguments,
  as a pull request change is by its type, with a fallback name for a call
  it can't read. An entry may also read the command's own fields: `fields`
  from its arguments, before it runs, so a refused command keeps them, and
  `resultFields` from its result. Each is the catalog's field tree for the
  command's name with a function in place of each field, so a field the
  catalog doesn't declare fails to compile. Fields that need the state
  before and after come from `lib/store-command-fields.ts`.
  `lib/store-command-events.ts` runs each call as one `command` event:
  - the write path counts `store_write_count` and `store_write_bytes`, sets
    `store.revision_changed` when another window wrote since this one read,
    and records `refused` with `locked_week` or `stale_window` before the
    error leaves the command, so before it reaches the toast;
  - the Undo capture counts the records changed per local state list
    (`changed_project_count`, `changed_time_entry_count` and so on) and sets
    `store.undo_offered`;
  - a command that writes nothing ends `noop`, and one that writes twice
    counts two writes on its one event. Only the writes made while a command
    runs count as its own;
  - a revision hint that could not be saved counts
    `store_revision_hint_failure_count`.
  - Writes, bytes and records changed are counters, so a command that folds
    into another unit, such as a sync, adds them to that unit's event.
  - The same command inside an open one joins it instead of folding. The
    code around a command adds what only it knows with
    `runStoreCommandWith(key, args, extend)`, which runs the command it names
    by its key, so the fields can't land on another command's event: the
    settle's behaviour and comment length, the entry form's host, and
    whether Submit week showed the pace warning.
  - A workflow that awaits before its command opens the event first with
    `startStoreCommandFor(key)` and runs the command inside its `enter`, so
    another command's write meanwhile isn't counted as its own. A failure
    it attaches keeps a refusal already recorded. A move cancelled in its
    subitem or source state dialog ends `cancelled`; a connection's delete
    is one `connection.delete` with what it removed per kind, and `ok` once
    the local API deleted it.
  - `runWithUndo`, which only agent tools run their writes in, has the
    trigger `agent`. It takes the name of the outermost command running
    inside it when it first writes, and counts its change once.
  - A command that finds nothing to change, such as one on a record that
    doesn't exist, writes nothing and ends `noop`: a state whose values and
    lists hold the same records is not a write.
- **Folding across `await`.** Store commands are synchronous, so they fold
  into the unit on top of the scope stack. An async unit leaves the stack at
  its first `await`, and runs the store commands after it inside
  `unit.enter()`; a store command's own workflow uses the `enter` of
  `startStoreCommandFor`, which also counts its writes. A store command run
  outside it emits its own event.
- **`app.boot`** (`lib/app-boot.ts`) runs from loading the local state to
  the first render: the load path, the migrations applied, the desktop
  recovery's decision, reason and what a submitted week left out, the
  state's size and its records per collection. The recovery's writes count
  on it. A load that throws, or a first render that fails, ends it with the
  error.
- **`undo.restore`** is the Undo store command. A refused Undo says why:
  `expired`, `changed_since`, `two_running_entries` or `would_lock_week`.
- **`local_state.reload`** is another window's write, read from browser
  storage.
- **`preferences.update`** names the keys that changed, with their values
  when they are enums, numbers or booleans: user preferences through the
  store, and device UI settings through `lib/preference-events.ts`. A drag
  of the sidebar or a side panel records one change when it ends.
- **`app.error`** comes from `features/feedback/app-error-handler.ts`, the
  window's one handler for uncaught errors and unhandled rejections. That
  handler also shows a refused write as a toast, and the event then says
  `handled_by: toast` (else `none`). It names the store command that threw.
  An error event without an error, such as a ResizeObserver warning, is
  noise and emits nothing.

- **Local API calls** (#310). Every client function in `lib/app-api.ts`
  names its event in `APP_API_CLIENT`: the request event of the route it
  calls, so a new one fails to compile until it has a name. A call sends the
  active unit's `traceparent`, and adds to that unit's counters:
  `api_call_count`, `api_attempt_count` (retries included), `api_call_ms`
  and `api_failed_call_count`, which also counts a call whose answer failed
  its schema, not only one the API refused or never answered. A call made while no unit is active is its
  own unit, a `command` (or a `job` for a name only a job opens), with its
  method and status in `http`. A poll, such as the scheduler's tick, runs
  its calls in `asPoll` and records nothing. The active unit is the one on
  top of the scope when the call starts, so a job runs its calls inside its
  own `enter`, and a workflow that awaits captures its unit with
  `reentry()` and runs its later calls in it.
- **Background jobs** (#310). Each is one `job` event per run, `detached`,
  so one another unit started is its child span and still emits its own:
  - `backlog.sync`, `pull_request.sync` and `team.sync`, in the client
    functions that run them, whoever calls them: the user from Settings,
    the scheduler (`schedule`), or a time entry saved on a synced item
    (`system`). The store commands that apply the answer fold into the job.
    A manual and a scheduled call of the same connection share one run.
    The scheduler's 30-second tick records nothing.
  - `calendar.fetch`, for each fetch of `CalendarEventCache`: forced by
    Refresh (`user`) or not. A load the cache answers records nothing, by
    decision: the 30-second refresh would emit an event each time, so there
    is no fresh-from-cache field, which the #305 note on #310 had listed.
  - `backlog.write_source`, each item's pending write, with the settle ID
    that joins it to the settle, how long after the Undo window it went,
    and its result: `sent`, `failed`, `deferred` while its Undo window is
    open, or `superseded` by a newer write.
  - `comment.delete`, with Ajour's item ID and how long it waited. The
    comment's ID in its source stays out (ADR 0011).
  - The comment calls the user makes from the item page, which are their own
    `command` when no unit is active: `comment.list`, `comment.post`,
    `comment.edit`, `comment.react` and `mention.search` carry Ajour's item
    ID as `backlog_item.id`, never the item's ID in its source (ADR 0011).
    A call inside another unit, such as an agent's, leaves that unit's
    fields alone. A thread the cache answers is a `comment.list` command
    with `comment.cache_hit` true and no request, once per cached page even
    under React's StrictMode, which runs the effect twice in development. A
    load, of the newest page or an earlier one, has it false.
  - `settle_comment.send`, one per comment once its settle stands, and
    `agent_comment.send`, one per agent comment after its Undo window: the
    comment's length, never its text, and whether it was posted or kept as
    a draft, and why.
  - `agent_tool.call`, each tool call the bridge runs, a child of the local
    API's tool call span: how long it waited behind earlier calls, and
    whether its write left an Undo. Its writes fold into it, also those
    after an `await`, which the tools run through `reentry()`.
  - `mcp_bridge.connection`, each bridge stream from open to close, with the
    calls it carried and its reconnects. A stream the local API closed for
    good ends `disconnected`.
  - `pending_writes.flush`, the launch flush of what a session that quit
    during an Undo window left: how many of each kind. A launch that finds
    nothing ends it `noop`. Each send is its own job, a child span of the
    flush.
- **`route.change`** (`lib/route-events.ts`, through the router's events):
  one per navigation, from its start until its page rendered and its code
  loaded. It names the routes it left and reached by their IDs, which are
  patterns, never a parameter's value, with the app section, whether
  another navigation took over before the page rendered, as a redirect
  does, and the resolve, render and code chunk durations. A search or hash
  change records nothing. The first navigation is the `boot`'s.
- **The renderer's console calls are gone**, as are the local API's and
  the main process's. A failure they logged is on the event of the unit
  that failed, and the code standards' consistency checks, which CI runs,
  find any `console.` call left in runtime code.

### The desktop main process

The main process (#308) makes the launch context at launch, with
`createLaunchContext` in `apps/desktop/electron/main-events.cjs`: a new
`launch_id`, the version, the channel (`dev` unpackaged, else `nightly` or
`stable` from the version), the commit and the device. Its shape is the
package's `LaunchContext`. It hands it over twice:

- to the local API, through `startAppApiServer`'s `launch` option
  (`apiLaunchOf`);
- to the renderer, as `window.ajourDesktop.runtime.launch`, through the
  runtime info the preload asks for.

The packaged build's commit comes from electron-builder, which writes
`buildCommit` into the packaged `package.json`: `AJOUR_BUILD_COMMIT`, or the
checked-out commit. An unpackaged run reports none.

The main process loads the package the way it loads the local API: it
imports its TypeScript entry points, from the repository or from the
packaged internal API runtime. That import is asynchronous, so `events` is a
stand-in from main.cjs's first lines: it records units with their own times
and replays them on the real emitter once the package loads, in the order
things happened. The active unit lives in one AsyncLocalStorage from before
the load to after, so `current()` finds it and a unit started inside another
folds into it either side of the load. `events.ready` resolves once the
package loaded or failed to: every exit path waits for it within the quit's
10 seconds (the refused lock, `before-quit`, and update preparation, since
the installer's quit skips `before-quit`'s wait). The scrubber replaces the
home directory and the user data path in every error message.

Units that are never part of the work that happens to be active, such as
`app.quit`, crashes, `window.load`, `window.navigate` and the update jobs,
start `detached`: a menu Quit is its own event, not a step of the menu
item's.

| Event                                                                                                     | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every IPC channel's event                                                                                 | `createIpcListeners` in `ipc-listeners.cjs`, named from `IPC_CHANNELS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `app.launch`                                                                                              | from the process start until the window has loaded, with each phase's duration, why the local API could not start, and the load's outcome. Packaged builds add the version the previous launch ran, from `last-launch.json` in user data, which they write once the window has loaded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `app.quit`                                                                                                | `before-quit`, with the updater and the local API stop, ended before the process exits. Its trigger: the last window closed, the menu's Quit (the app menu's item calls `quitFromMenu`, and the title bar clicks it), `os` (a Windows session end, recorded then since `before-quit` never comes; a macOS or Linux shutdown through `powerMonitor`), an update install (cancelled if it does not install), a recovery dialog or a failed start. Anything else is `other`, by the `system`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `app.second_launch`, `app.lock_refused`                                                                   | `second-instance`, and the second process just before it quits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `window.load`, `window.unresponsive`, `process.gone` (renderer)                                           | `watchWindow` in `window-recovery.cjs`: a unit that leads to a dialog ends with its answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `process.gone` (GPU, utility)                                                                             | `child-process-gone`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `plugin_renderer.open`, `plugin_renderer.blocked`, `plugin_sandbox.off`, `process.gone` (plugin renderer) | `plugin-renderer-runtime.cjs`: a plugin renderer opening, until its process passed the sandbox check; each way out its sandbox closed, by its kind only, never where it led; plugins turned off on this computer, by cause; a plugin renderer that ended, with its plugin. `plugin_renderer.call` is the event of its page's one IPC channel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `app.error`                                                                                               | an uncaught exception (`uncaughtExceptionMonitor`), an unhandled rejection, which keeps Node's warning, or a startup that failed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `window.navigate`                                                                                         | `will-navigate` and the window open handler: the scheme only, never the URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `catalog.refresh`                                                                                         | each refresh, at launch, on its interval or asked for. The refresh never rejects, so `plugin-catalog.cjs` records its outcome on it: counts of the plugin sources read, cached, unreachable, signed, unsigned and blocked, never a source\'s address                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `update.check`, `update.install`                                                                          | `automatic-update.cjs`, on the IPC event that asked, or as its own job. One install is one event: an updater error lands on it, where the install was. After the handoff it stays open until the app quits for the installer (`will-quit`), or for the quit's 10 seconds, since electron-updater reports an installer that fails to start later. `update.handoff` says which: `app_quit`, `installer_failed`, or `timed_out`, which ends the event as a `timeout`. It records only the offered release's version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `plugin.install`, `plugin.uninstall`, `catalog.configure`, `dev_plugins.configure`                        | their IPC handlers in main.cjs. An install's result comes from `pluginInstallResultOf` in `plugin-install.cjs`, from the error's code only: the local API's installer marks every archive-validation error `invalid_archive` (bad tar or gzip, a missing or unparseable manifest, a failed schema, a missing entrypoint, the size and entry limits; `INVALID_PLUGIN_ARCHIVE` in `apps/api/src/plugin-package.ts`), picking an archive here marks one too, the catalog marks `not_available`, an unsigned install while unsigned installs are off is `unsigned_not_allowed` (`confirmUnsignedInstall` in main.cjs, which also records `plugin.signed`), and the plugin host marks an install it refuses while plugin operations run `busy` (`PLUGIN_HOST_BUSY` in `apps/api/src/plugin-host.ts`). A Node system error is the archive's fault only on a path inside the extraction folder (a manifest or entrypoint the archive lacks, an entry tar cannot write); opening the staged archive, reaching the extraction folder itself, and a full, locked or busy disk anywhere are `failed`, as is anything else |
| `context_menu.show`                                                                                       | the picked id only when it is one of the renderer's object actions (`OBJECT_ACTION_IDS` in `context-menu.cjs`), else `other`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `logs.status`, `logs.configure`, `logs.delete_all`, `logs.sweep`                                          | `local-logs.cjs`: the local log file's IPC channels, with its state, the settings saved and what a deletion removed; and each retention sweep, at launch, hourly or when a limit changes, with what it deleted and what is left. Never a path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `local_state.recover`                                                                                     | counts only the persisted collections `RECORD_COLLECTIONS` names, never a key the file chose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Every IPC channel registers through one wrapper, `createIpcListeners`, with
`handle` for `invoke`, `onMessage` for one-way messages and `answerSync` for
`sendSync`. Each call is one `ipc` event with the channel, its mode and
whether the sender was accepted. A call from a window other than the active
one throws `refusedSender(…)`, and its event ends `refused` with
`foreign_sender`, not `error`. The renderer may pass `{ traceparent }` as a
call's last argument; the wrapper takes it off and the event joins the
renderer's trace. The listener adds its own fields through
`events.current()`. A channel missing from `IPC_CHANNELS`, or registered the
wrong way, fails `just typecheck`: the wrapper's methods take only the
table's channels of their mode, and the desktop typecheck checks main.cjs.
It also throws when it registers.

The local API's stop, split into the agent runner and the plugins with the
operations still running, is the local API's own `api.stop` (#306), not
`app.quit`'s.

## The catalog

Every event of the catalog (`packages/wide-events/lib/ajour-catalog.ts`,
with the renderer's entries from `renderer-catalog.ts`), the kinds it
allows, and what emits it:

- a **route** of the local API (`ROUTES`);
- a **plugin method**, whose worker run is named from the plugin host's or
  the schema host's table;
- an **IPC channel** of the main process (`IPC_CHANNELS`);
- a renderer **store command** (`STORE_COMMANDS`);
- a **client call** the renderer makes when no unit is active
  (`APP_API_CLIENT`);
- the **local API**, the **main process** or the **renderer**, which start
  the unit by its name: a job, a lifecycle unit, a crash or a navigation.

The catalog audit (`apps/web/src/lib/wide-events-audit.test.ts`) builds this
table from the code and fails when a row differs. It also checks that each
table names catalog events its seam may open, that every entry is emitted
and asserted by a test, and it runs every store command, route and IPC
channel to read the event each emits.

| Event                                | Kinds                              | Emitted by                                       |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------ |
| `agent.run`                          | job                                | local API                                        |
| `agent.session`                      | job                                | local API                                        |
| `agent_client.create`                | command, request                   | route, client call                               |
| `agent_client.revoke`                | command, request                   | route, client call                               |
| `agent_comment.send`                 | job                                | renderer                                         |
| `agent_run.start`                    | command, request                   | route, client call                               |
| `agent_run.status`                   | request                            | route                                            |
| `agent_run.stop`                     | command, request                   | route, client call                               |
| `agent_runner.configure`             | command, request                   | route, client call                               |
| `agent_runner.status`                | command, request                   | route, client call                               |
| `agent_session.dismiss`              | command, request                   | route, client call                               |
| `agent_session.mark_seen`            | command, request                   | route, client call                               |
| `agent_task.configure`               | command, request                   | route, client call                               |
| `agent_tool.call`                    | request, job                       | local API, renderer                              |
| `api.health`                         | request                            | route                                            |
| `api.request`                        | request                            | local API                                        |
| `api.start`                          | lifecycle                          | local API                                        |
| `api.stop`                           | lifecycle                          | local API                                        |
| `app.boot`                           | lifecycle                          | renderer                                         |
| `app.error`                          | crash                              | local API, main process, renderer                |
| `app.launch`                         | lifecycle                          | main process                                     |
| `app.lock_refused`                   | lifecycle                          | main process                                     |
| `app.menu_model`                     | ipc                                | IPC channel                                      |
| `app.quit`                           | lifecycle                          | main process                                     |
| `app.runtime_info`                   | ipc                                | IPC channel                                      |
| `app.second_launch`                  | lifecycle                          | main process                                     |
| `backlog.apply_updates`              | command                            | store command                                    |
| `backlog.archive_done`               | command                            | store command                                    |
| `backlog.sort`                       | command                            | store command                                    |
| `backlog.sync`                       | job, request, plugin_operation     | route, plugin method, client call, renderer      |
| `backlog.write_source`               | job, request, plugin_operation     | route, plugin method, client call, renderer      |
| `backlog_import.commit`              | command, request                   | route, store command, client call                |
| `backlog_import.dismiss`             | command, request                   | route, client call                               |
| `backlog_import.list`                | command, request                   | route, client call                               |
| `backlog_import.restore`             | command, request                   | route, client call                               |
| `backlog_import.select`              | command, request                   | route, client call                               |
| `backlog_import.stage`               | command, request                   | route                                            |
| `backlog_item.apply_timelog`         | command                            | store command                                    |
| `backlog_item.archive`               | command                            | store command                                    |
| `backlog_item.change_source_state`   | command                            | store command                                    |
| `backlog_item.complete_source_write` | command                            | store command                                    |
| `backlog_item.create`                | command                            | store command                                    |
| `backlog_item.delete`                | command                            | store command                                    |
| `backlog_item.fail_source_write`     | command                            | store command                                    |
| `backlog_item.hold_edit`             | command                            | store command                                    |
| `backlog_item.move`                  | command                            | store command                                    |
| `backlog_item.open`                  | command                            | store command                                    |
| `backlog_item.pin`                   | command                            | store command                                    |
| `backlog_item.reorder`               | command                            | store command                                    |
| `backlog_item.resolve_description`   | command                            | store command                                    |
| `backlog_item.resolve_estimate`      | command                            | store command                                    |
| `backlog_item.restore`               | command                            | store command                                    |
| `backlog_item.return`                | command                            | store command                                    |
| `backlog_item.review_held_edit`      | command                            | store command                                    |
| `backlog_item.save_description`      | command                            | store command                                    |
| `backlog_item.settle`                | command                            | store command                                    |
| `backlog_item.snooze`                | command                            | store command                                    |
| `backlog_item.unpin`                 | command                            | store command                                    |
| `backlog_item.unsettle`              | command                            | store command                                    |
| `backlog_item.unsnooze`              | command                            | store command                                    |
| `backlog_item.update`                | command                            | store command                                    |
| `calendar.fetch`                     | job, request, plugin_operation     | route, plugin method, client call, renderer      |
| `catalog.add_source`                 | command, ipc                       | IPC channel                                      |
| `catalog.configure`                  | command, ipc                       | IPC channel                                      |
| `catalog.get`                        | ipc                                | IPC channel                                      |
| `catalog.get_settings`               | ipc                                | IPC channel                                      |
| `catalog.inspect_source`             | ipc                                | IPC channel                                      |
| `catalog.refresh`                    | job                                | main process                                     |
| `catalog.remove_source`              | command, ipc                       | IPC channel                                      |
| `comment.delete`                     | job, request, plugin_operation     | route, plugin method, client call, renderer      |
| `comment.edit`                       | command, request, plugin_operation | route, plugin method, client call                |
| `comment.list`                       | command, request, plugin_operation | route, plugin method, client call, renderer      |
| `comment.post`                       | command, request, plugin_operation | route, plugin method, client call                |
| `comment.react`                      | command, request, plugin_operation | route, plugin method, client call                |
| `connection.delete`                  | command, request                   | route, store command, client call                |
| `connection.remove_secrets`          | command, request                   | route, client call                               |
| `connection.save`                    | command, request, plugin_operation | route, plugin method, client call                |
| `context_menu.show`                  | ipc                                | IPC channel                                      |
| `description.read`                   | command, request, plugin_operation | route, plugin method, client call                |
| `description.write`                  | command, request, plugin_operation | route, plugin method, client call                |
| `dev_plugins.configure`              | command, ipc                       | IPC channel                                      |
| `dev_plugins.get_settings`           | ipc                                | IPC channel                                      |
| `edit.run`                           | ipc                                | IPC channel                                      |
| `event_rule.forget`                  | command                            | store command                                    |
| `event_rule.hide`                    | command                            | store command                                    |
| `local_state.recover`                | ipc                                | IPC channel                                      |
| `local_state.reload`                 | job                                | renderer                                         |
| `logs.configure`                     | command, ipc                       | IPC channel                                      |
| `logs.delete_all`                    | command, ipc                       | IPC channel                                      |
| `logs.status`                        | ipc                                | IPC channel                                      |
| `logs.sweep`                         | job                                | main process                                     |
| `mcp.configure`                      | command, request                   | route, client call                               |
| `mcp.request`                        | request                            | local API                                        |
| `mcp.status`                         | command, request                   | route, client call                               |
| `mcp_bridge.connection`              | job, request                       | route, renderer                                  |
| `mcp_bridge.result`                  | command, request                   | route, client call                               |
| `mention.search`                     | command, request, plugin_operation | route, plugin method, client call                |
| `menu.run_item`                      | ipc                                | IPC channel                                      |
| `pending_writes.flush`               | job                                | renderer                                         |
| `plugin.activate`                    | command, request                   | route, client call                               |
| `plugin.install`                     | command, ipc                       | IPC channel                                      |
| `plugin.list`                        | command, request                   | route, client call                               |
| `plugin.remove_data`                 | command, request                   | route, client call                               |
| `plugin.request`                     | job                                | local API                                        |
| `plugin.uninstall`                   | command, ipc                       | IPC channel                                      |
| `plugin_renderer.blocked`            | navigation                         | main process                                     |
| `plugin_renderer.call`               | ipc                                | IPC channel                                      |
| `plugin_renderer.open`               | lifecycle                          | main process                                     |
| `plugin_sandbox.off`                 | lifecycle                          | main process                                     |
| `plugin_system.toggle`               | command, request                   | route, client call                               |
| `preferences.update`                 | command                            | store command, renderer                          |
| `process.gone`                       | crash                              | main process                                     |
| `project.archive`                    | command                            | store command                                    |
| `project.create`                     | command                            | store command                                    |
| `project.export`                     | command, request, plugin_operation | route, plugin method, client call                |
| `project.favorite`                   | command                            | store command                                    |
| `project.import`                     | command, request, plugin_operation | route, plugin method, store command, client call |
| `project.reorder`                    | command                            | store command                                    |
| `project.restore`                    | command                            | store command                                    |
| `project.share`                      | command                            | store command                                    |
| `project.unshare`                    | command                            | store command                                    |
| `project.update`                     | command                            | store command                                    |
| `pull_request.apply_sync`            | command                            | store command                                    |
| `pull_request.browse`                | command, request, plugin_operation | route, plugin method                             |
| `pull_request.change`                | command                            | store command                                    |
| `pull_request.comment`               | command, request, plugin_operation | route, plugin method                             |
| `pull_request.load`                  | command, request, plugin_operation | route, plugin method                             |
| `pull_request.load_conversation`     | command, request, plugin_operation | route, plugin method                             |
| `pull_request.load_file`             | command, request, plugin_operation | route, plugin method                             |
| `pull_request.mark_file_viewed`      | command, request, plugin_operation | route, plugin method                             |
| `pull_request.merge`                 | command, request, plugin_operation | route, plugin method                             |
| `pull_request.open`                  | command                            | store command                                    |
| `pull_request.reply`                 | command, request, plugin_operation | route, plugin method                             |
| `pull_request.resolve_thread`        | command, request, plugin_operation | route, plugin method                             |
| `pull_request.settle`                | command                            | store command                                    |
| `pull_request.snooze`                | command                            | store command                                    |
| `pull_request.submit_review`         | command, request, plugin_operation | route, plugin method                             |
| `pull_request.sync`                  | job, request, plugin_operation     | route, plugin method, client call, renderer      |
| `pull_request.unsettle`              | command                            | store command                                    |
| `pull_request.unsnooze`              | command                            | store command                                    |
| `pull_request.update`                | command, request, plugin_operation | route, plugin method                             |
| `question.answer`                    | command, request                   | route, client call                               |
| `route.change`                       | navigation                         | renderer                                         |
| `schema.list`                        | command, request                   | route, client call                               |
| `settle_comment.send`                | job                                | renderer                                         |
| `settle_rule.set`                    | command                            | store command                                    |
| `source_state.list`                  | command, request, plugin_operation | route, plugin method, client call                |
| `source_state.update`                | command, request                   | route, client call                               |
| `storage.load`                       | lifecycle                          | local API                                        |
| `suggestion.add`                     | command                            | store command                                    |
| `suggestion.dismiss`                 | command                            | store command                                    |
| `task.archive`                       | command                            | store command                                    |
| `task.create`                        | command                            | store command                                    |
| `task.favorite`                      | command                            | store command                                    |
| `task.import`                        | command                            | store command                                    |
| `task.pin`                           | command                            | store command                                    |
| `task.reorder`                       | command                            | store command                                    |
| `task.restore`                       | command                            | store command                                    |
| `task.update`                        | command                            | store command                                    |
| `team.apply_sync`                    | command                            | store command                                    |
| `team.create`                        | command, request, plugin_operation | route, plugin method, store command, client call |
| `team.resolve_arrival`               | command                            | store command                                    |
| `team.sync`                          | job, request, plugin_operation     | route, plugin method, client call, renderer      |
| `time_entry.commit`                  | command                            | store command                                    |
| `time_entry.continue`                | command                            | store command                                    |
| `time_entry.create`                  | command                            | store command                                    |
| `time_entry.delete`                  | command                            | store command                                    |
| `time_entry.discard`                 | command                            | store command                                    |
| `time_entry.drop`                    | command                            | store command                                    |
| `time_entry.duplicate`               | command                            | store command                                    |
| `time_entry.move`                    | command                            | store command                                    |
| `time_entry.paste`                   | command                            | store command                                    |
| `time_entry.reorder`                 | command                            | store command                                    |
| `time_entry.start`                   | command                            | store command                                    |
| `time_entry.stop`                    | command                            | store command                                    |
| `time_entry.uncommit`                | command                            | store command                                    |
| `time_entry.update`                  | command                            | store command                                    |
| `timeline.commit`                    | command                            | store command                                    |
| `timeline.dismiss`                   | command                            | store command                                    |
| `timeline.import`                    | command                            | store command                                    |
| `timeline.save_rule`                 | command                            | store command                                    |
| `timeline.update`                    | command                            | store command                                    |
| `timesheet_import.commit`            | command                            | store command                                    |
| `timesheet_import.dismiss`           | command                            | store command                                    |
| `timesheet_import.stage`             | command                            | store command                                    |
| `undo.expire`                        | command                            | store command                                    |
| `undo.group`                         | command                            | store command                                    |
| `undo.restore`                       | command                            | store command                                    |
| `unsigned_plugins.toggle`            | command, request                   | route, client call                               |
| `update.check`                       | command, job, ipc                  | IPC channel, main process                        |
| `update.get_state`                   | ipc                                | IPC channel                                      |
| `update.install`                     | command, ipc, job                  | IPC channel, main process                        |
| `update.open_release`                | command, ipc                       | IPC channel                                      |
| `vault.retry`                        | command, request                   | route, client call                               |
| `week.prompt_commit`                 | command                            | store command                                    |
| `week.reopen`                        | command                            | store command                                    |
| `week.submit`                        | command                            | store command                                    |
| `window.load`                        | lifecycle                          | main process                                     |
| `window.navigate`                    | navigation                         | main process                                     |
| `window.set_theme`                   | ipc                                | IPC channel                                      |
| `window.unresponsive`                | crash                              | main process                                     |
| `workflow_state.auto_map`            | command                            | store command                                    |
| `workflow_state.create`              | command                            | store command                                    |
| `workflow_state.delete`              | command                            | store command                                    |
| `workflow_state.map`                 | command                            | store command                                    |
| `workflow_state.move`                | command                            | store command                                    |
| `workflow_state.set_write_rule`      | command                            | store command                                    |
| `workflow_state.update`              | command                            | store command                                    |

## Performance

- No event on a high-frequency path: store reads and subscribers, the running
  clock, the scheduler tick itself, polling, keystrokes, pointer moves, hover,
  focus moves, retries (counted as `attempts` instead) and progress updates.
- With the `nowhere` sink, 100,000 syncs that each fold a store command take
  about 80 ms on a laptop. The package's performance test guards it.
- A change that touches the renderer runs `just ui-perf` before and after, as
  `docs/agents/code-standards.md` requires.

## Testing

A good test drives a unit of work through its public entry and asserts the
recorded event: its name, kind, outcome, reason and the fields that matter.
It never asserts the emitter's internals or field order. The package's own
tests cover nesting and folding, every outcome path, trace context, the
scrubber, field classes and the sinks. The local API's tests start the server
with a recording sink (`eventSink`).

Two tests hold the whole app to the model (#311):

- **The privacy canary** (`apps/web/src/lib/wide-events-canary.test.ts`)
  puts one marker in every kind of content, from the user, from a source
  tool and from an agent, and runs time entries, backlog items with their
  descriptions and comments, calendar suggestions, pull requests (a sync,
  then every code host operation, with marked repositories, paths, review
  and comment bodies), a team (create and sync), a connection with a
  secret, an agent's tool calls and plugin errors through the renderer and
  the real local API. The marker may stay in one place, named in
  `MARKER_ALLOWED_IN`: an error's `message`. ADR 0011 makes it a sensitive
  field that keeps what a plugin echoes, such as `Issue KEY-1 not found`,
  and the name of a file once its folder is replaced. Any other field or
  key holding the marker fails the test. Even in a message, no secret, URL,
  home folder or user data folder may remain. The main process's part is in
  `apps/desktop/main-process-errors.test.ts`: IPC messages, URLs the window
  opens, an installed archive, a catalog download, an uninstall, a
  development plugin folder and an update release link, under the same rule.
- **The catalog audit** (`apps/web/src/lib/wide-events-audit.test.ts`)
  checks [the catalog](#the-catalog) against the code.

## Anti-patterns

- `console.log("something happened")` as a record of an operation.
- Several partial events for one unit of work, or start and finish events.
- An event on every render, poll or keystroke.
- Content in a field, or an error message that skipped the scrubber.
- A field added outside the catalog, or a name that is not in it.

# Logging Strategy

Ajour reports what happened with wide events, following
[loggingsucks.com](https://loggingsucks.com/): one context-rich event per unit
of work per runtime, built up while the work runs and emitted once at the end.
The event records what happened to the unit of work, not what the code did
along the way. The spec is #304. Events never hold content (ADR 0011), and for
now they are exported nowhere.

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
  `just typecheck` checks against the catalog.
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
    | "shortcut"
    | "item_key"
    | "palette"
    | "context_menu"
    | "app_menu"
    | "drag"
    | "editor"
    | "dialog"
    | "toast"
    | "link";
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
  already know set it.

## Privacy

ADR 0011 is the rule: events never hold content. No notes, titles,
descriptions, comment bodies, names, emails, search text, agent prompts or
tool inputs, file names, paths, URLs, hosts, source tool keys, secrets or
tokens.

- Every field declares a privacy class in the catalog, `operational` or
  `sensitive`, and a field without one fails to compile. The envelope is
  classed the same way (`envelopeFields`).
- Sensitive fields are the days, weeks and durations of time records, and
  every error message. A future sink receives them only if the user allows it
  for that sink.
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

| Entry point           | What it holds                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `index.ts`            | `createEmitter`, the envelope types and the synchronous scope                                    |
| `catalog.ts`          | Ajour's catalog of event names, `defineCatalog`, `operational`, `sensitive` and `envelopeFields` |
| `sinks.ts`            | `nowhere`, `createRecordingSink`, `createConsoleSink` and `sinkFromSwitch`                       |
| `trace-context.ts`    | `encodeTraceparent` and `decodeTraceparent`                                                      |
| `scrub.ts`            | `scrubErrorMessage`                                                                              |
| `secret-redaction.ts` | the secret redaction the scrubber and the local API's plugin errors share                        |
| `node.ts`             | `asyncContextScope`, for Node runtimes only                                                      |

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

A sink has one method, `emit(event)`. A sink that throws never changes what
the work does.

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

Logging plugins will later replace the sink without changing any event.

## Traces

Every event is a W3C span, so a future exporter can send it to a trace
backend unchanged. A unit started with a `parent` (an incoming `traceparent`
header) is that span's child: the local API makes each request the child of
the `traceparent` it carries. `unit.traceparent()` gives the header for an
outgoing call; a folded unit sends its outer unit's span. A delayed
consequence of an action, such as a source write after the Undo window,
starts its own trace and joins its cause through the domain ID that links
them.

## Where events come from today

The local API emits these (#305, #306):

| Event                                 | Where                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| one `request` per HTTP request        | `serveWithEvent` in `apps/api/src/routes.ts`, named from `ROUTES`                                  |
| `mcp.request`, `agent_tool.call`      | `handleMcpRequest` in `apps/api/src/mcp-server.ts`, on the request's event                         |
| `mcp_bridge.connection`               | the bridge route's request, which ends when the stream closes                                      |
| one `plugin_operation` per worker run | `PluginWorkerLifetime`, for the plugin host and the schema host                                    |
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
  with `stopping`, `host_refused`, `origin_refused` or `no_route`, or
  `unknown_operation` for an operation a route's table doesn't have.
- **A request Ajour can't read** is refused with `invalid_request`: a body
  that isn't JSON or is too large, a malformed path segment, or a value the
  route's schema or Ajour's own checks refuse. Each is an
  `InvalidRequestError` (`apps/api/src/event-errors.ts`), and its event
  holds the error's type and code, never the message that could quote the
  caller's text. Any other error a route throws ends it as an `error`.
- **Each refusal says why.** A route refused because the plugin system, the
  plugin or the capability is off says which (`system_off`, `plugin_off`,
  `capability_off`), as do a missing connection (`connection_not_found`), a
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

- refused: `capacity`, a gate's `system_off`, `plugin_off` or
  `capability_off`, `host_stopping`, `package_change`, `not_installed`,
  `runs_no_code`, `not_supported` for a capability or feature the plugin
  doesn't declare, `invalid_request` for an import whose rows break the
  plugin's definition, and `agent_access` for a comment call the user
  doesn't allow;
- cancelled: `system_off`, `plugin_off`, `capability_off`, `uninstalled` or
  `shutdown`;
- `timeout`;
- errors: `result_too_large`, `invalid_result` (with the error's type and
  code only), `exited_early` and `plugin_error`, scrubbed of the
  connection's secrets.

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
and a field holds only strings, numbers, booleans, null and lists of them:
an object or a function where a value belongs is dropped, and counted in
`dropped_field_count`.

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
  window's one handler for uncaught errors and unhandled rejections, which
  also shows a refused write as a toast, reported as `handled_by: toast`
  (else `none`). It names the store command that threw. An error event without an error, such as a ResizeObserver warning,
  is noise and emits nothing.

The seams of #304 add the rest: `trigger` and `surface` (#309), and renderer
jobs and navigation (#310).

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

| Event                                                                              | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every IPC channel's event                                                          | `createIpcListeners` in `ipc-listeners.cjs`, named from `IPC_CHANNELS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `app.launch`                                                                       | from the process start until the window has loaded, with each phase's duration, why the local API could not start, and the load's outcome. Packaged builds add the version the previous launch ran, from `last-launch.json` in user data, which they write once the window has loaded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `app.quit`                                                                         | `before-quit`, with the updater and the local API stop, ended before the process exits. Its trigger: the last window closed, the menu's Quit (the app menu's item calls `quitFromMenu`, and the title bar clicks it), `os` (a Windows session end, recorded then since `before-quit` never comes; a macOS or Linux shutdown through `powerMonitor`), an update install (cancelled if it does not install), a recovery dialog or a failed start. Anything else is `other`, by the `system`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `app.second_launch`, `app.lock_refused`                                            | `second-instance`, and the second process just before it quits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `window.load`, `window.unresponsive`, `process.gone` (renderer)                    | `watchWindow` in `window-recovery.cjs`: a unit that leads to a dialog ends with its answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `process.gone` (GPU, utility)                                                      | `child-process-gone`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `app.error`                                                                        | an uncaught exception (`uncaughtExceptionMonitor`), an unhandled rejection, which keeps Node's warning, or a startup that failed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `window.navigate`                                                                  | `will-navigate` and the window open handler: the scheme only, never the URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `catalog.refresh`                                                                  | each refresh, at launch, on its interval or asked for. The refresh never rejects, so `plugin-catalog.cjs` records its outcome on it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `update.check`, `update.install`                                                   | `automatic-update.cjs`, on the IPC event that asked, or as its own job. One install is one event: an updater error lands on it, where the install was. After the handoff it stays open until the app quits for the installer (`will-quit`), or for the quit's 10 seconds, since electron-updater reports an installer that fails to start later. `update.handoff` says which: `app_quit`, `installer_failed`, or `timed_out`, which ends the event as a `timeout`. It records only the offered release's version                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `plugin.install`, `plugin.uninstall`, `catalog.configure`, `dev_plugins.configure` | their IPC handlers in main.cjs. An install's result comes from `pluginInstallResultOf` in `plugin-install.cjs`, from the error's code only: the local API's installer marks every archive-validation error `invalid_archive` (bad tar or gzip, a missing or unparseable manifest, a failed schema, a missing entrypoint, the size and entry limits; `INVALID_PLUGIN_ARCHIVE` in `apps/api/src/plugin-package.ts`), picking an archive here marks one too, the catalog marks `not_available`, and the plugin host marks an install it refuses while plugin operations run `busy` (`PLUGIN_HOST_BUSY` in `apps/api/src/plugin-host.ts`). A Node system error is the archive's fault only on a path inside the extraction folder (a manifest or entrypoint the archive lacks, an entry tar cannot write); opening the staged archive, reaching the extraction folder itself, and a full, locked or busy disk anywhere are `failed`, as is anything else |
| `context_menu.show`                                                                | the picked id only when it is one of the renderer's object actions (`OBJECT_ACTION_IDS` in `context-menu.cjs`), else `other`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `local_state.recover`                                                              | counts only the persisted collections `RECORD_COLLECTIONS` names, never a key the file chose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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

## Anti-patterns

- `console.log("something happened")` as a record of an operation.
- Several partial events for one unit of work, or start and finish events.
- An event on every render, poll or keystroke.
- Content in a field, or an error message that skipped the scrubber.
- A field added outside the catalog, or a name that is not in it.

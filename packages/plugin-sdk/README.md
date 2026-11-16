# @ajour/plugin-sdk

Types and a test fake for [Ajour](https://github.com/les-cabochons/ajour) plugins on plugin API 4.

On plugin API 4, a plugin runs in its own sandboxed renderer. Its code can't reach the network, the disk or other plugins. Its one way out is the `ajour` global, whose requests Ajour's broker sends for it. The broker holds every credential, so the plugin never sees a token.

This package provides:

- the manifest and contract types: `PluginManifest`, `PluginModule`, `PluginConnection`, and each operation's request and result;
- the types of the `ajour` global: `ajour.http`, `ajour.publicFetch` and `ajour.log`;
- `createFakeAjour`, which answers `ajour.http` from fixtures in tests and records every request.

> **Status.** Ajour runs plugin API 4 only, in every build. An API 3 package stays installed and inactive with "This plugin needs an update". The package isn't on npm yet: see [Publishing](#publishing).

## Install

Until the SDK is published, vendor the packed package in your plugin repo:

```sh
pnpm add -D file:vendor/ajour-plugin-sdk-0.2.0.tgz
```

Once it's published, swap the file dependency for a version range.

## The manifest

`plugin.json` declares everything the broker enforces and the plugin's Access section shows. Type it with `PluginManifest`:

```json
{
  "id": "ajc-jira",
  "version": "4.0.0",
  "apiVersion": 4,
  "displayName": "Jira",
  "iconSvg": "<svg viewBox='0 0 16 16'>…</svg>",
  "entrypoint": "dist/index.js",
  "connectionFields": [
    { "id": "baseUrl", "label": "Site URL", "type": "url", "required": true },
    { "id": "email", "label": "Email", "type": "text", "required": true },
    {
      "id": "apiToken",
      "label": "API token",
      "type": "password",
      "required": true,
      "secret": true
    }
  ],
  "capabilities": { "connector": { "settle": true } },
  "network": {
    "auth": {
      "scheme": "basic",
      "userField": "email",
      "secretField": "apiToken"
    },
    "baseAddress": { "field": "baseUrl", "allowOnPremises": true },
    "endpoints": [
      { "method": "GET", "path": "/rest/api/3/myself" },
      { "method": "POST", "path": "/rest/api/3/search/jql" },
      { "method": "PUT", "path": "/rest/api/3/issue/*" }
    ],
    "requestHeaders": ["Accept", "Content-Type"]
  },
  "runtime": { "start": "whenNeeded" }
}
```

Unknown keys are refused, so a misspelt key fails at install instead of being ignored.

### Secret fields

A field with `"secret": true` belongs to Ajour. Ajour keeps its value in the vault, never passes it to the plugin and never accepts one back. A secret field can't set `"passToPlugin": true`. The plugin learns nothing about a secret but whether its requests succeed.

### Auth schemes

`network.auth` tells the broker how to attach the credential:

| Scheme           | What the broker sends                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `bearer`         | `Authorization: Bearer <secretField>`                                                             |
| `basic`          | `Authorization: Basic` with `<userField>:<secretField>`                                           |
| `patBasic`       | `Authorization: Basic` with an empty user and `<secretField>`, as Azure DevOps tokens             |
| `headerTemplate` | `header`, built from `template`, which holds `{secret}` exactly once                              |
| `secretAddress`  | nothing: the secret is the connection's whole address, as an ICS feed. Request it with `path: ""` |

Leave `auth` out when the requests carry no credential. Generated secrets, the body-field scheme and sign-in are reserved for a later release, and a manifest that declares them is refused.

### Hosts and endpoints

- **The base address** is the url field named by `network.baseAddress.field`. Every request is relative to it, and may not climb above its path, such as `/tfs/DefaultCollection`. With `allowOnPremises`, the user may mark a connection as on-premises, which lets it reach private addresses.
- **Endpoints** list each method and path the plugin may call. `*` matches one segment and `**`, last, matches the rest. Paths are relative: an absolute URL is refused. A request path matches nothing when a segment is empty, is `.` or `..` once decoded (`%2e%2e` too), or holds a `;`, a control character such as `%00`, or an encoded slash or backslash. It also matches nothing when a segment still holds a `%` after two decodes (so a literal `%` can't be declared or requested), or when Unicode compatibility folding (NFKC) turns a segment into one of the above, as the fullwidth full stop (U+FF0E). A path ending in a slash has an empty last segment, so a trailing-slash path can't be declared or requested: `/graphql/` is not `/graphql`. Query strings and bodies aren't restricted.
- **Derived hosts** are hosts the broker builds from the base address, each with its own endpoints. Each has forms, tried in order: `whenHost` picks the base hosts a form applies to, `host` builds the host, with `{host}` for the base host and `{match}` for the label `*` matched, and `pathPrefix` comes before every path. A form without `whenHost` applies to any base host and must be last. A derived host stays within the address the user saved: it ends with `{host}`, or stays within the registrable domain `whenHost` names, and under a `*.` rule it holds `{match}` once. `whenHost` may not be a public suffix where anyone can register a name, such as `github.io`, `co.uk` or `workers.dev` (the [Public Suffix List](https://publicsuffix.org/), private section included), and no host is an IP address. A fixed host, in a derived host or in `publicHosts`, may not end in a name reserved for local use or that never resolves publicly: `.localhost`, `.local`, `.internal`, `.test`, `.invalid`, `.example`, `.home.arpa` or `.lan`. Wildcard DNS such as nip.io isn't judged by name: the broker checks the addresses a host resolves to.

GitHub's API is on `api.github.com` for github.com, and under `/api/v3` and `/api/graphql` on GitHub Enterprise:

```json
"derivedHosts": [
  {
    "id": "rest",
    "forms": [
      { "whenHost": "github.com", "host": "api.github.com" },
      { "host": "{host}", "pathPrefix": "/api/v3" }
    ],
    "endpoints": [{ "method": "GET", "path": "/repos/*/*/activity" }]
  },
  {
    "id": "graphql",
    "forms": [
      { "whenHost": "github.com", "host": "api.github.com" },
      { "host": "{host}", "pathPrefix": "/api" }
    ],
    "endpoints": [{ "method": "POST", "path": "/graphql" }]
  }
]
```

Azure DevOps people search is `vssps.{host}` for `dev.azure.com`, and `{match}.vssps.visualstudio.com` with `"keepBasePath": false` for `*.visualstudio.com`.

### Headers and public hosts

- **`requestHeaders`** lists the headers the plugin may set. A fixed denylist always wins: `Authorization`, `Cookie`, `Host`, `Forwarded`, the method overrides `X-HTTP-Method-Override`, `X-HTTP-Method` and `X-Method-Override`, the path and host rewrites `X-Original-URL`, `X-Rewrite-URL`, `X-Original-Host` and `X-Host`, `X-Real-IP`, the hop-by-hop and framing headers `Content-Length`, `Transfer-Encoding`, `Connection`, `TE`, `Upgrade`, `Keep-Alive`, `Trailer` and `Expect`, every `Proxy-*` and `X-Forwarded-*` header, and any header the auth scheme sets.
- **`publicHosts`** lists the hosts `ajour.publicFetch` may reach, over https and without credentials, such as `avatars.githubusercontent.com`.

### Connection access

`connectionAccess` lists choices each connection makes, such as Azure DevOps's "Edit work items". Every choice starts off. An endpoint with `"access": "<choice id>"` is open only while that choice is on, and a choice lists the `operations` it unlocks and the `tokenScope` it needs. `"always": true` marks a choice that can't be turned off, listed to name its scope.

### Start mode and memory

`runtime.start` is `whenNeeded` ("Load when needed", the default), or `alwaysReady`, which starts the plugin with Ajour. `runtime.memoryCeilingMb` sets a default memory ceiling from 64 to 2048 MB. The user may change both.

### Agent tasks and project data shapes

Each agent task lists the Ajour MCP `tools` its run may use, and gets only those. Ajour refuses a call to any other tool. A project data shape is the `projectDataShape` capability: `importProjects` reads the imported file's sheets, and the optional datasets of data shape API 1 lay out its export.

### Project sources

A project source brings the user's projects, tasks, assignments and budgets from the system that holds them, read only: Ajour never writes to it. Declare `"projectSource": {}` and export `syncProjects(connection, { cursor, trigger })`. Answer `{ snapshot, cursor }`, or `{ unchanged: true }` when nothing changed since the cursor Ajour sent. The cursor is yours, such as an ETag: Ajour keeps the last one per connection and hands it back on the next sync, and sends none on the first. `trigger` is `manual` when the user asked for the sync, such as Sync now or opening a managed project's page, and `auto` for the 15-minute sync: a plugin that answers from a cache should read the source on a manual one. Older Ajour versions send no trigger.

The snapshot is `ProjectSourceSnapshot`. Nothing in it names a product: `source.label` is what Ajour calls the source, such as in "From Planner", and the project `url`s are where "Open in Planner" goes. `asOf` is when the source's hours are from, so Ajour can tell lag from a conflict. `me.hoursAvailable` says whether `myHours` can be known for the user, and `hoursNote` is your sentence on why not, such as how to link their account. `me.hoursSince` is the first day `myHours` cover, when they cover a period such as the current month. A project has a `code`, by which Ajour links an existing local project without asking, and a `complete` flag, which archives it. A task has a `group`, such as a phase, `assigned`, and the user's `myHours`. A budget's `unit` is hours or money; `remaining` may be negative, and `status` is `ok`, `warning`, `over` or `unknown`. A budget's `since` is the first day `consumed` covers. URLs are absolute https addresses. A snapshot holds at most 200 projects and 10,000 tasks.

### Time syncs

A time sync keeps the user's time entries in step with your system, both ways. Declare `"timeSync": {}` beside `"projectSource": {}`: only entries on projects the same connection manages take part. Its switch, Time entries, starts off. Turning it on calls `validateConnection` with `timeSync` among `context.capabilities`, so throw there, with a sentence the user reads, when the token can't write time entries.

Export `syncTimeEntries(connection, request)`. Each call is one round: apply `request.changes` in order, at most 20, then list your entries from `request.from` to `request.to`, local dates in `request.timeZone`. Send each change's `syncKey` as your client reference, and adopt the entry you already hold under it, so a retry never duplicates. `agreed` holds the values both sides last agreed on, so you can keep what Ajour doesn't own, such as a real start time. Answer one result per change, `synced` with the entry as you stored it (none for a delete), `refused` with a sentence when your system won't take it, or `failed` with a sentence to retry next round, and the `entries` in the window, each with `clientRef` when Ajour created it and `updatedAt`. Minutes are whole. A running entry has `countingSince`, the instant its count would have started from zero. Ajour never sends a note. See [the time sync API](https://docs.ajour.day/developers/time-sync-api).

### What needs the user's consent again

An update installs inactive, until the user allows it, when it adds a capability, an auth scheme, a host, a derived host or one of its forms, an endpoint, a public host or an MCP tool, changes an agent task's prompt, marks an access choice `always` on, adds an operation to an access choice, or switches to `alwaysReady`. Nothing else does.

## Plugin code

Plugin code targets the browser. It may use web APIs such as `URL`, `TextDecoder`, Web Crypto, `setTimeout` and `structuredClone`. It may not use Node built-ins or `Buffer`, and it has no `node_modules`: a dependency is a file of the plugin's own package, vendored as source or bundled to JavaScript. `fetch` to the network is blocked.

The entrypoint is a module, loaded with `import()`, so the files it imports load from the plugin's own package. It may be JavaScript (`.js` or `.mjs`) or TypeScript source (`.ts` or `.mts`).

### TypeScript source

A plugin may ship its TypeScript as written, with no build step. Ajour strips the types of each `.ts` and `.mts` file as the plugin loads it, with Node's type stripping: types are erased, nothing is compiled. The files stay as installed, so the package's hashes and signature are the source's. Five rules follow:

- **Erasable TypeScript only.** Types, interfaces, `as`, `satisfies`, `import type` and `declare` are erased. Syntax that needs code generated is refused: enums, namespaces and parameter properties (`constructor(private x: number)`). Set `"erasableSyntaxOnly": true` in `tsconfig.json` to catch it as you write. A file Ajour can't strip fails the run with a reason that names it, such as `src/status.ts uses TypeScript that Ajour can't strip: TypeScript enum is not supported in strip-only mode.`, and no module of the plugin runs. JSX isn't supported.
- **Explicit `.ts` extensions on relative imports.** Write `import { parse } from "./parse.ts"`, not `"./parse"`: there is no resolver to try extensions. `"allowImportingTsExtensions": true` and `"noEmit": true` let `tsc` check such imports.
- **At most 2 MB per file.** Stripping runs in Ajour's main process, so a `.ts` or `.mts` file over 2 MB (2,097,152 bytes) is refused like one that can't be stripped: the run fails with a reason that names the file, such as `src/data.ts is over 2 MB, the most Ajour strips in a TypeScript file.`, and no module of the plugin runs. Ship a large file as JavaScript, or as data in a `.json` file.
- **No bare imports.** `import { z } from "zod"` fails, because nothing resolves a package name. Import only files of the plugin's own package, by relative path: vendor a dependency as a file of the package, or bundle it into the plugin's JavaScript. Type-only imports, such as `import type {} from "@ajour/plugin-sdk/globals"`, are erased, so they're fine.
- **The runtime surface is the `ajour` global.** Ajour provides nothing else at runtime. Import the SDK with `import type` only: its code, such as `createFakeAjour`, is for tests.

The entrypoint exports one function per operation, typed by `PluginModule`. Each receives the connection without its secrets, and `config` holds only the fields that aren't secret.

```ts
import type {} from "@ajour/plugin-sdk/globals";
import type { PluginModule } from "@ajour/plugin-sdk";

export const validateConnection: PluginModule["validateConnection"] = async (
  connection,
) => {
  const response = await ajour.http({
    connectionId: connection.id,
    method: "GET",
    path: "/rest/api/3/myself",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) throw new Error("The token was rejected.");
  const me = await response.json<{ displayName: string }>();
  return {
    normalizedConfig: connection.config,
    connectionSummary: { user: me.displayName },
  };
};
```

- **`ajour.http({ connectionId, host?, method, path, query?, headers?, body?, signal? })`** sends a request through one of the plugin's own connections. `host` names a derived host. The response has `status`, `ok`, lowercase `headers`, `text()` and `json()`. An `AbortSignal` cancels the request.
- **`ajour.publicFetch(url, { method?, headers?, signal? })`** fetches an https URL on a declared public host, on its default port, with `GET` or `HEAD`. Its headers follow the rules of `ajour.http`: the denylist, then `requestHeaders`.
- **`ajour.log(level, message, fields?)`** writes to Ajour's log. Fields hold ids and counts, never content or secrets.

A refused request rejects with an `AjourRequestError` whose `code` is `refused`, `limit`, `timeout` or `network`. An aborted one rejects with an `AbortError`, as `fetch` does.

Redirects: the broker follows same-origin redirects with the credential, up to 3. A cross-origin redirect comes back as the 3xx with its `Location`, without auth: request the new address only through a connection or public host the manifest allows. For a secret address, the broker follows https redirects to any host, up to 3, and never returns the final address: a fourth redirect, or one away from https, is refused rather than handed back. Request a secret address with `GET`, `path: ""` and no query.

What comes back: the broker removes `Set-Cookie`, `WWW-Authenticate` and any header that echoes a secret, and replaces every secret of the connection in the body with `[secret]`, also in the forms a service may echo it in, such as URL-encoded, JSON-escaped or base64. The body comes back decoded and whole, up to 8 MB. A request body may hold up to 4 MB, a request takes at most 20 s, and a plugin may have 6 requests in flight and send about 10 a second, with bursts of 60.

## Testing

`createFakeAjour` answers `ajour.http` and `ajour.publicFetch` from routes, and records every request, so a test can assert the exact method, path, headers and body each operation sends. Given the manifest, it also refuses what the broker would: an endpoint, derived host, header or public host the manifest doesn't declare.

```ts
import { afterEach, expect, it, vi } from "vitest";
import type { PluginManifest } from "@ajour/plugin-sdk";
import { createFakeAjour } from "@ajour/plugin-sdk/testing";
import manifest from "../plugin.json";
import { validateConnection } from "../src/index";

afterEach(() => vi.unstubAllGlobals());

it("reads the user", async () => {
  const ajour = createFakeAjour({
    manifest: manifest as PluginManifest,
    routes: [
      {
        method: "GET",
        path: "/rest/api/3/myself",
        respond: { json: { displayName: "Ada" } },
      },
    ],
  });
  vi.stubGlobal("ajour", ajour);

  // `connection` is a PluginConnection fixture.
  const result = await validateConnection!(connection, { capabilities: [] });

  expect(result.connectionSummary).toEqual({ user: "Ada" });
  expect(ajour.requests).toMatchObject([
    { method: "GET", path: "/rest/api/3/myself" },
  ]);
});
```

A route may name a `connectionId` and a `host`, use `*` and `**` in its path, and answer with `{ status, headers, body }`, `{ json }`, or a function of the recorded request. A request no route answers fails, naming the request.

With the manifest, an endpoint behind an access choice answers only for a connection that turned the choice on. Pass the choices each connection turned on as `access`, such as `access: { c1: ["editWorkItems"] }`. A choice marked `always` is on for every connection.

## Limits

Plugin API 4 isolates credentials for plugins without process access. A plugin with
process access can reach every plugin's credentials, not only its own, because
its commands run as the user outside the sandbox. Within what a manifest declares, two limits remain, and Ajour never claims to prevent them:

- **GraphQL reaches everything the token allows.** An endpoint such as GitHub's `POST /graphql` is allowed as a whole: the broker doesn't read queries, so a plugin that may call it may run any query or mutation the token's scopes allow. The token's scopes are the limit there.
- **A DNS-rebinding window remains through a system proxy.** Unless the connection is on-premises, the broker resolves a host, refuses private addresses, and connects only to the addresses it checked, so a host whose DNS answer changes can't move a direct request. Through a system proxy the proxy connects, and when a PAC file falls back to a direct connection, a host whose DNS answer changes between the check and the connection could reach a private address: the broker then refuses only the answer. Credentials still attach only to hosts the user configured. The same goes for a public-looking name that only the proxy can resolve, such as `127.0.0.1.nip.io` when this computer's DNS can't: the broker can't judge an address it can't see, and the proxy connects to wherever it resolves the name. That can happen for a redirect from a service the user chose, and the proxy's own rules still apply.

## Publishing

For Ajour's maintainers. The package is built ready for npm but not published yet.

1. After changing a shared schema the contract uses, regenerate the types: `corepack pnpm --filter @ajour/plugin-sdk generate`. The SDK's tests fail while `lib/contract.ts` is stale.
2. Set `version` in `package.json`.
3. Pack it: `npm pack` in `packages/plugin-sdk` builds `dist` and writes `ajour-plugin-sdk-<version>.tgz`. Plugin repos vendor that file until publication.
4. Publish it: `npm publish --access public` from `packages/plugin-sdk`, with an npm account that owns the `@ajour` scope.

## Declaring commands and app schemes

API 4 manifests may declare a `processes` block. Ajour doesn't run declared
commands yet; the process broker (#713) will.

```json
"processes": {
  "executables": { "t3": { "names": ["t3"] } },
  "commands": [{
    "id": "thread-start",
    "executable": "t3",
    "args": ["thread", "start", "{folder:folder}", "-", "--title", "{title:text}", "--json",
      {"if": "branch", "args": ["--worktree", "{base:ref}", "--branch", "{branch:ref}"]}],
    "stdin": "text",
    "mode": "capture",
    "timeoutSeconds": 60
  }],
  "openSchemes": ["codex"]
}
```

Executable keys identify declarations. Their `names` are bare names to look up
on PATH, never paths or command lines. Shells and script hosts are refused,
including cmd, PowerShell, Unix shells, wsl and Windows script hosts, regardless
of case or .exe/.cmd/.bat/.com suffix. Interpreters such as node and python are
allowed, but Access marks them "runs code it is given: as wide as Accept everything". Commands reference a declared key and have
unique IDs. Each argument is one argv element. Strings are literals unless the
whole string is a slot such as `{title:text}`. Slot kinds are `text`, `id`, `ref`,
`number`, `https-url` and `folder`. An enum is an object such as
`{"kind":"enum","name":"format","values":["json","text"]}`. Values use `[A-Za-z0-9_./:=+@-]`, cannot start with `-` and cannot repeat.
For a literal containing braces, use `{"kind":"literal","value":"{literal}"}`.

Slot names are unique within a command. A conditional group includes its whole
`args` list only when its `if` slot is supplied, and must contain that slot.
Groups cannot nest. Free text belongs on stdin; `stdin: "text"` declares that
input. Omit `stdin` for no input. Modes are `capture`, `detached` and `terminal`.
`capture` and `detached` accept `stdin`; `terminal` refuses it. Only `capture`
accepts `timeoutSeconds`. The optional timeout is an
integer between 1 and 600. Literals and enum values refuse lone surrogates.
A parsed command is limited to 12 KB of UTF-8 JSON, leaving room for executable
names in its 16 KB Access policy. A processes block is limited to 256 KB of
UTF-8 JSON, 256 executables and 256 commands. Access argv and policy strings
are each limited to 16,384 characters. Runtime argument
checks and default timeouts belong to the broker, not manifest parsing.
The host resolves a `folder` slot from a repository folder ID, never a plugin path.
`DeclaredCommand` exports the parsed host contract with typed slots and groups.

Schemes must be lowercase RFC 3986 names without a colon. Ajour refuses `http`,
`https`, `file`, `javascript`, `data`, `vbscript`, `about`, `blob`, `ajour`,
`ajour-plugin` and `app`, any `ms-*` scheme, and `search`, `search-ms`, `shell`,
`view-source`, `devtools`, `filesystem`, `chrome`, `chrome-extension`, `edge`,
`res`, `its`, `mk`, `ftp`, `smb`, `nfs`, `jar`, `ldap`, `telnet` and `ssh`.
HTTPS opening is separate from these declarations.

Access review lists each command as its argv shape and each scheme. Turning the
plugin on approves that access. Added schemes and added or changed commands need
approval again. Removals do not. Command comparison includes executable names,
slot kinds, enum choices, conditional groups, stdin, mode and timeout. It treats
all command policy changes conservatively as needing review, even a restriction.

These commands and links run as you, outside the sandbox. A plugin that starts processes
is outside G1. A process can read your files and access every plugin's credentials, not only its own.
Ajour's sandbox network policy does not restrict external processes or apps.

## Declared processes

Declare commands in the manifest's `processes` block, then call:

```ts
const result = await ajour.process.run({
  command: "thread-start",
  args: { folder: repositoryFolderId, title: "Fix login" },
  stdin: prompt,
});
```

`command` is a declared command id. `args` maps slot names to values, with numbers
accepted for number slots. Each filled slot stays one argument. A folder value is
a repository folder id the host resolves, never a path. Put multiline text on
stdin, which requires `stdin: "text"` in the declaration. Conditional groups run
when their controlling slot is present, and then require all their slots.

`capture` returns `{ exitCode, stdout, stderr }`, including
nonzero exit codes. Output is limited to 1 MB per stream. The declared timeout
defaults to 60 seconds. Four calls may run at once per plugin. Ending the plugin
operation cancels its capture children. Refusals reject with `AjourProcessError` and a
`code` such as `invalid_request`, `undeclared`, `concurrency`,
`output_limit`, `timeout` or `operation_ended`. The test fake accepts a
`processRun` responder and otherwise refuses process requests. Given the
manifest, it refuses with `undeclared` a command id the manifest doesn't
declare and an `{ executable, argv }` request from a manifest without
`processes.undeclaredCommands: true`.

The user must turn the plugin on and approve its declared commands. Undeclared
commands are refused. Detached and terminal commands follow the launch contract below. A process runs as
the user outside the plugin sandbox and can reach the user's files and
credentials. See ADR 0019 in Ajour's repository.

## Handoff tools

An API 4 plugin declares `capabilities.handoff.tools`, each with `id`, `label`,
`iconSvg` and `settings`. The host treats handoff like the other switchable
capabilities. Each tool id is unique. Settings cannot contain secrets.

The plugin exports `detectTools()`, `startHandoff(request)` and
`readHandoffStates(request)`, typed by `PluginModule`. Detection returns
`{ tools: [{ id, available, version?, reason? }] }`. A start receives the tool,
folder id and name, prompt, title, optional branch, item key and URL, and
settings. It returns `{ threadId, link?, resume?, native }`. Throw an error to
refuse a start; Ajour returns the reason and records no handoff.

`native` is an opaque JSON object, up to 4 KB serialized as UTF-8, for the tool's own status and
label. `resume`, when present, is `{ command, args }` for a declared command.
The host keeps it for the later Open workflow; this capability does not run it.

A state read receives `{ tool, handoffs: [{ id, threadId, folderId, native }] }`.
Return exactly one answer for each id with `state` and `native`, plus optional
`title`, `branch` and `pullRequests`. Pull requests have `url` and optional
`title`. Common states are `working`, `needs-you`, `ready`, `done`, `failed`,
`gone` and `unknown`. A new handoff starts in `working`. Reads batch within one
project, and process folder slots can resolve only that project's saved folders.
Prompts and settings are not stored in handoff records or events.

## License

MIT

### Handoff prompt defaults

A handoff manifest may set `capabilities.handoff.promptTemplate`, at most 16 KiB of UTF-8. Users edit prompt, title and branch templates on the plugin page. Ajour fills them before calling `startHandoff`; plugins still receive finished `prompt`, `title` and `branch` strings.

Slots are `{{item.key}}`, `{{item.title}}`, `{{item.description}}`, `{{item.url}}`, `{{item.type}}`, `{{item.parent.key}}`, `{{item.parent.title}}`, `{{project.name}}` and `{{repo.name}}`. Add `|slug`, for example `{{item.title|slug}}`, for a lowercase ASCII branch segment of at most 60 characters. Unknown slots or filters fail saving. Descriptions omit frontmatter and have a 32 KiB UTF-8 limit. Missing optional values become empty text.

### Undeclared commands

A plugin must declare `processes.undeclaredCommands: true` to request a command outside its declared commands. Without this flag every mode refuses it with `undeclared`. Adding the flag widens access and requires consent again.

```ts
const result = await ajour.process.run({
  executable: "git",
  argv: ["status", "--short"],
  cwdFolder: folder.id,
});
```

Use a bare executable name, never a path, shell or script host. Each argv element remains one text argument. Unicode controls, format, default-ignorable, surrogate and unassigned characters and line or paragraph separators are refused; a leading dash is allowed. `cwdFolder` is a host-owned repository folder id. Without it the command runs at the system root, never Ajour's data or installation folder.

The user's command mode controls undeclared commands after all process gates pass. Always ask requests permission. Auto runs unless review marks the command risky. Accept everything runs without asking. An ask shows the resolved executable, plugin id, signature status and folder name and path. Allow once and Always have a 600 ms input delay. Deny all from this plugin refuses its queued asks. At most two asks per plugin may be pending; overflow refuses with `ask_queue_full`. An ask holds the operation until Allow once, Always or Deny, and denies after two minutes or when no window is connected. Always remembers only the exact executable, arguments and folder id for this package. The Access tab lists and removes these approvals. Package or version changes, lost signatures and changed development directories invalidate them. No rule reviewer is installed by this feature.

## Launching commands and opening links

`ajour.process.run({ command, args })` uses the declared command's mode.
Capture returns `{ exitCode, stdout, stderr }`. Detached and terminal modes return
`{ started: true }` once the OS accepts the launch, or, for a command given
stdin, once the process has read its input. Narrow the result with
`result.started === true` before reading capture output. Ajour does not own or
stop launched processes, except while it delivers stdin. Launch modes need a
repository folder slot and use the first resolved folder as cwd. A detached
command that declares `stdin: "text"` takes up to 1 MB of input, such as a
prompt with line breaks that would not fit on a command line. Ajour writes all
of it and closes stdin before it returns `{ started: true }`, so the call
returns only once the process has read the input (on Windows, all of it, even
a small one). Read stdin as the process starts. If the process stops reading,
or hasn't read the input within 10 seconds, the call rejects with
`stdin_failed` and Ajour stops the process and everything it started; if the
operation ends first, it rejects with `operation_ended`. The process's stdout
and stderr are discarded.
Terminal commands refuse stdin. Terminal uses the user's choice
in Settings > General > Terminal. Windows Terminal refuses semicolons in values.

`await ajour.open(url)` opens HTTPS while the plugin is enabled. Custom schemes
must appear in `processes.openSchemes` and pass command consent and unsigned
plugin gates. File, script and undeclared schemes are refused. The host opens
links through main. Events contain only the scheme.

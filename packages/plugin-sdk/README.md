# @ajour/plugin-sdk

Types and a test fake for [Ajour](https://github.com/les-cabochons/ajour) plugins on plugin API 4.

On plugin API 4, a plugin runs in its own sandboxed renderer. Its code can't reach the network, the disk or other plugins. Its one way out is the `ajour` global, whose requests Ajour's broker sends for it. The broker holds every credential, so the plugin never sees a token.

This package provides:

- the manifest and contract types: `PluginManifest`, `PluginModule`, `PluginConnection`, and each operation's request and result;
- the types of the `ajour` global: `ajour.http`, `ajour.publicFetch` and `ajour.log`;
- `createFakeAjour`, which answers `ajour.http` from fixtures in tests and records every request.

> **Status.** Ajour admits API 4 packages only in development builds until the release that switches every plugin to API 4. Packaged builds still run API 3 plugins. The package isn't on npm yet: see [Publishing](#publishing).

## Install

Until the SDK is published, vendor the packed package in your plugin repo:

```sh
pnpm add -D file:vendor/ajour-plugin-sdk-0.1.0.tgz
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

Plugin API 4 is built so that no plugin can obtain a credential, its own or another plugin's. Within what a manifest declares, two limits remain, and Ajour never claims to prevent them:

- **GraphQL reaches everything the token allows.** An endpoint such as GitHub's `POST /graphql` is allowed as a whole: the broker doesn't read queries, so a plugin that may call it may run any query or mutation the token's scopes allow. The token's scopes are the limit there.
- **A DNS-rebinding window remains through a system proxy.** Unless the connection is on-premises, the broker resolves a host, refuses private addresses, and connects only to the addresses it checked, so a host whose DNS answer changes can't move a direct request. Through a system proxy the proxy connects, and when a PAC file falls back to a direct connection, a host whose DNS answer changes between the check and the connection could reach a private address: the broker then refuses only the answer. Credentials still attach only to hosts the user configured. The same goes for a public-looking name that only the proxy can resolve, such as `127.0.0.1.nip.io` when this computer's DNS can't: the broker can't judge an address it can't see, and the proxy connects to wherever it resolves the name. That can happen for a redirect from a service the user chose, and the proxy's own rules still apply.

## Publishing

For Ajour's maintainers. The package is built ready for npm but not published yet.

1. After changing a shared schema the contract uses, regenerate the types: `corepack pnpm --filter @ajour/plugin-sdk generate`. The SDK's tests fail while `lib/contract.ts` is stale.
2. Set `version` in `package.json`.
3. Pack it: `npm pack` in `packages/plugin-sdk` builds `dist` and writes `ajour-plugin-sdk-<version>.tgz`. Plugin repos vendor that file until publication.
4. Publish it: `npm publish --access public` from `packages/plugin-sdk`, with an npm account that owns the `@ajour` scope.

## License

MIT

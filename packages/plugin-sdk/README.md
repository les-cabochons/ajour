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
- **Endpoints** list each method and path the plugin may call. `*` matches one segment and `**`, last, matches the rest. Paths are relative: an absolute URL is refused. Query strings and bodies aren't restricted.
- **Derived hosts** are hosts the broker builds from the base address, each with its own endpoints. Each has forms, tried in order: `whenHost` picks the base hosts a form applies to, `host` builds the host, with `{host}` for the base host and `{match}` for the label `*` matched, and `pathPrefix` comes before every path. A form without `whenHost` applies to any base host and must be last. A derived host stays within the address the user saved: it ends with `{host}`, or stays within the domain `whenHost` names.

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

- **`requestHeaders`** lists the headers the plugin may set. A fixed denylist always wins: `Authorization`, `Cookie`, `Host`, `Forwarded`, every `Proxy-*` and `X-Forwarded-*` header, and any header the auth scheme sets.
- **`publicHosts`** lists the hosts `ajour.publicFetch` may reach, over https and without credentials, such as `avatars.githubusercontent.com`.

### Connection access

`connectionAccess` lists choices each connection makes, such as Azure DevOps's "Edit work items". Every choice starts off. An endpoint with `"access": "<choice id>"` is open only while that choice is on, and a choice lists the `operations` it unlocks and the `tokenScope` it needs. `"always": true` marks a choice that can't be turned off, listed to name its scope.

### Start mode and memory

`runtime.start` is `whenNeeded` ("Load when needed", the default), or `alwaysReady`, which starts the plugin with Ajour. `runtime.memoryCeilingMb` sets a default memory ceiling from 64 to 2048 MB. The user may change both.

### Agent tasks and project data shapes

Each agent task lists the Ajour MCP `tools` its run may use, and gets only those. A project data shape is the `projectDataShape` capability, with data shape API 1's datasets.

### What needs the user's consent again

An update installs inactive, until the user allows it, when it adds a capability, an auth scheme, a host, a derived host or one of its forms, an endpoint, a public host or an MCP tool, changes an agent task's prompt, or switches to `alwaysReady`. Nothing else does.

## Plugin code

Plugin code targets the browser. It may use web APIs such as `URL`, `TextDecoder`, Web Crypto, `setTimeout` and `structuredClone`. It may not use Node built-ins or `Buffer`, and it bundles its dependencies for the browser. `fetch` to the network is blocked.

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
- **`ajour.publicFetch(url, { method?, headers?, signal? })`** fetches an https URL on a declared public host.
- **`ajour.log(level, message, fields?)`** writes to Ajour's log. Fields hold ids and counts, never content or secrets.

A refused request rejects with an `AjourRequestError` whose `code` is `refused`, `limit`, `timeout` or `network`. An aborted one rejects with an `AbortError`, as `fetch` does.

Redirects: the broker follows same-origin redirects with the credential, up to 3. A cross-origin redirect comes back as the 3xx with its `Location`, without auth: request the new address only through a connection or public host the manifest allows. For a secret address, the broker follows https redirects to any host, up to 3, and never returns the final address.

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

## Limits

Plugin API 4 is built so that no plugin can obtain a credential, its own or another plugin's. Within what a manifest declares, two limits remain, and Ajour never claims to prevent them:

- **GraphQL reaches everything the token allows.** An endpoint such as GitHub's `POST /graphql` is allowed as a whole: the broker doesn't read queries, so a plugin that may call it may run any query or mutation the token's scopes allow. The token's scopes are the limit there.
- **A DNS-rebinding window remains.** The broker resolves a host and refuses private addresses before a request, unless the connection is on-premises, and checks the address that answered after the response. Between those two checks, a host whose DNS answer changes could reach a private address. Credentials still attach only to hosts the user configured.

## Publishing

For Ajour's maintainers. The package is built ready for npm but not published yet.

1. After changing a shared schema the contract uses, regenerate the types: `corepack pnpm --filter @ajour/plugin-sdk generate`. The SDK's tests fail while `lib/contract.ts` is stale.
2. Set `version` in `package.json`.
3. Pack it: `npm pack` in `packages/plugin-sdk` builds `dist` and writes `ajour-plugin-sdk-<version>.tgz`. Plugin repos vendor that file until publication.
4. Publish it: `npm publish --access public` from `packages/plugin-sdk`, with an npm account that owns the `@ajour` scope.

## License

MIT

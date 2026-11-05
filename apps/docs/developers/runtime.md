# Runtime

Ajour runs plugin API 4 only, in development and packaged desktop builds.
There is no worker-thread runtime and no other: every plugin runs in the
sandbox below. API 3 packages stay installed and inactive with "This plugin
needs an update". Their connections and non-secret settings remain. The paused team capability
has no API 4 port. The standalone API runs no plugin code and reports
"Plugins need the desktop app".

## Execution and requests

Each plugin has a hidden Electron renderer under Chromium's OS sandbox,
with its own origin and in-memory partition. Ajour's host page creates a
dedicated module worker for each operation. Plugin code has no Node,
filesystem access, direct networking, or access to another plugin's identity.
The host derives identity from the registered IPC sender.

`validateConnection(connection, context)` receives a connection whose `config`
contains only non-secret fields. Use `ajour.http` with its connection ID,
method and relative path. Ajour's broker checks the manifest's hosts,
endpoints, headers and the connection's access choices, attaches credentials,
and scrubs secrets from responses. `ajour.publicFetch` is limited to declared
public hosts. Never use `fetch`, import Node modules or ask for a token value.

Declare `network`, `connectionAccess` and `runtime` in `plugin.json` where
applicable. Use `packages/plugin-sdk` for the contract and request fake.
Agent tasks declare their MCP `tools`; they run no plugin code. A schema
declares `capabilities.projectDataShape.apiVersion: 1` inside a plugin API 4
package. That dataset version does not change with the plugin runtime API.

## Limits and residual risk

Ajour admits four calls per plugin, with a 30 second timeout and an 8 MiB
result limit. A renderer defaults to a 256 MB memory ceiling. Three crashes,
timeouts or memory kills in ten minutes suspend it. Load when needed closes
the idle renderer after two minutes. Always ready keeps it open. Quit drains
for five seconds before closing renderers. Unsupported or unsandboxed
environments fail closed.

Two guarantees stay apart. **G1** is hard and tested: no plugin can obtain a
credential, its own or another plugin's, by any path. **G2** is best effort: a
plugin can misuse the access it was given. Endpoint allowlists, connection
access choices, the Access section and least-privilege tokens reduce that risk.
They cannot prevent all misuse, and Ajour never claims they do. These are the
G2 limits:

- A plugin may send what it read to any endpoint its manifest allows.
- A GraphQL endpoint, such as GitHub's `POST /graphql`, is allowed as a whole.
  The broker doesn't read queries, so the token's scopes are the limit.
- The broker pins a direct request to the addresses it checked, but a request
  through a system proxy, or to an address literal, is judged by the address
  that answered, after it was sent. A DNS-rebinding window remains there, and
  credentials still attach only to hosts the user configured. See ADR 0010.
- Same-user native programs and administrators are outside the plugin
  sandbox's threat model. The OS keychain protects secrets from other users, not
  from other apps of the same user, and release builds keep the Electron
  `runAsNode` fuse on until the agent runner stops needing it, so anyone who can
  start Ajour's binary can run Node code as Ajour.

## Upgrading saved connections

A connection saved on API 3 keeps working after its plugin moves to API 4, with
no action from the user. Ajour changes a saved value only when API 4 can't
express it. The official GitHub plugin's saved addresses on `github.com` or
`www.github.com`, in any scheme, case, port or path, become `https://github.com`
once. See the [manifest reference](/developers/manifest#saved-connections-upgrade-with-the-plugin).

G1 release claims require the packaged malicious-plugin and lifecycle suites
to pass on Windows and macOS. A source inspection or unit run is not that
evidence. The official source owner releases the signed `ajour.json` and the
six plugin ports together with Ajour. Do not publish a combination whose
packages are unavailable.

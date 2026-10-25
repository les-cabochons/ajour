# Plugins are untrusted and run in sandboxed renderers

Ajour treats every plugin as possibly malicious, including its own. Today a plugin runs in a worker thread inside the Electron main process, with the user's permissions, and can read any other plugin's credentials from the state file. Instead, each plugin runs in its own hidden Electron renderer under the Chromium OS sandbox, with its own `ajour-plugin://<id>` origin and partition, context isolation and no Node. Its preload exposes one function that calls the host, and the host knows which plugin is calling from the IPC sender, never from anything the plugin sends. The full model is on #229.

Note (#231, built in #390): the plugin's code runs in a dedicated worker inside Ajour's host page, never in the page itself. Ajour's own page script owns the renderer, starts the worker from Ajour's bootstrap, and relays the worker's calls to the one preload function. The worker has no DOM, so DNS prefetch, frames, popups, navigation, printing, file pickers and `RTCPeerConnection` are gone at the source.

Two guarantees stay separate in code, tests and docs:

- **G1, hard and tested.** No plugin can obtain another plugin's credentials, storage or identity by any path: the API, the filesystem, forged IPC, the network, logs or errors. No plugin's code holds any credential, not even its own (ADR 0010).
- **G2, best effort.** A plugin can still misuse the access it was given, for example by writing what it read to an endpoint it may call. Endpoint allowlists, deny-by-default egress, least-privilege tokens and audit logs reduce this. Nothing in Ajour claims to prevent it.

## Considered options

- **Keep worker threads and encrypt the secrets.** Rejected. A worker runs inside Ajour's process as the user, so it can read Ajour's files and call the same OS decryption Ajour uses.
- **Utility processes or workers under Node's permission model.** Rejected. Node's documentation says the permission model "does not protect against malicious code", and a utility process still has Node.
- **An isolated V8 runtime or workerd.** Rejected. It is a second runtime to maintain, and it lacks Chromium's OS sandbox.
- **A full-access class for plugins that need a native addon.** Rejected once every sign-in protocol, WAM included, moved into Ajour's core (ADR 0010).

## Consequences

- There is no full-access class. If the sandbox cannot be applied, third-party plugins do not run.
- Measured on Windows (#230) and macOS (#260):
  - Each plugin costs about 21 to 31 MB of its own memory.
  - A warm call takes under 0.2 ms.
  - No plugin process outlived Ajour after a quit, a forced kill of the main process or a renderer crash.

  Shutdown and orphan handling remain an acceptance test, because Ajour's first process-based plugin host left processes behind.

- Plugins stay stateless, as ADR 0005 requires. The host may recycle a renderer at any time, and a renderer keeps nothing on disk until a store broker exists.
- These limits are stated, not hidden:
  - Ajour itself holds access tokens while it makes a call.
  - On Windows, DPAPI protects secrets from other users, not from other apps of the same user. The sandbox is what protects them from a compromised plugin.
  - An attacker who already runs code as the user, or has admin rights, is out of scope.
  - Release builds keep the Electron run-as-node fuse on, because the agent runner starts Playwright MCP through it. Anyone who can start Ajour's binary can run Node code as Ajour until #415 moves that to HTTP.
- Plugin API 4 drops compatibility with API 3. Ajour ports its own plugins.

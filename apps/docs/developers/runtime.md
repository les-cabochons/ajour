# Runtime and limits

This page explains where a plugin runs, what it can use, and the limits Ajour enforces.

## Where plugins run

The desktop app runs a local API inside its main process, on `127.0.0.1:8787`. The window talks to it over HTTP. When the API needs your plugin, it starts a Node worker thread, imports your entry point, calls one function, and ends the worker.

- **Node version.** The desktop app is built on Electron 44, with Node 24, and the official plugins build and test on Node 24. Target ES2022.
- **One call per worker.** Module-level variables, caches and timers do not survive the call. Ajour gives you everything you need as arguments.
- **No background work.** Your plugin runs only when Ajour calls it. Work that outlives the call is lost when the worker ends.

## What you can use

- `fetch`, to call any HTTP API.
- Node built-ins, such as `Buffer`, `crypto` or `URL`.
- Any code you bundle into the package.

## What you cannot use

| Not available                    | Why                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Ajour's data                     | The window owns the workspace. A plugin gets only what each call passes.           |
| Environment variables            | `process.env` is empty in the worker.                                              |
| Logs                             | `console` output is discarded. Throw errors with clear messages instead.           |
| UI                               | Ajour draws every screen. Describe fields in the manifest.                         |
| Packages outside your folder     | The packaging script archives `plugin.json` and `dist/` only. Bundle dependencies. |
| Capabilities beyond the manifest | Ajour only calls the functions your capabilities declare.                          |

## Limits

| Limit                                 | Value                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Time per call                         | 30 seconds, for the whole call, every request included.                          |
| Calls running at once                 | 4 per host. A fifth fails with "Too many plugin operations are already running." |
| Result size                           | 8 MiB. Results must be plain data that can be cloned.                            |
| Memory                                | 128 MB of old-generation heap, 32 MB young generation.                           |
| Error message                         | 1,000 characters, after secret connection values are replaced with `[secret]`.   |
| Items Ajour sends to `syncConnection` | 1,000.                                                                           |
| Package archive                       | 25 MiB, 2,000 entries, 100 MiB once extracted.                                   |

When a call times out, Ajour ends the worker and reports `Plugin "<id>" timed out while handling <function>.` Page through large result sets within the time budget, and prefer one search to many single-item requests.

## Security model

Worker threads keep plugins apart from Ajour's code and from each other, but they are not a security sandbox. A plugin runs with the user's permissions: it can read files and reach the network. Ajour's protections are about how plugins get in, not what they do once running:

- Plugins install only through the desktop app, from a file or a plugin source. The local API has no install route.
- The local API listens on loopback only, and checks the `Host` and `Origin` of every request.
- Archives cannot hold symlinks, absolute paths or `..` entries.
- A plugin from a source installs only the files its `ajour.json` lists, at the commit it names, each checked against its SHA-256. A signed source must stay signed with the key the person approved.
- An unsigned plugin installs only when the person allowed unsigned plugins, after a warning each time, and **Deactivate unsigned plugins** stops every one of them.

As a plugin author:

- Talk only to the tool your plugin is for. Check that URLs built from user input or synced data point at the connection's site before sending credentials.
- Ask for the smallest token permissions that work, and say which in your README.
- Never put secrets in `connectionSummary`, error messages or item fields. Ajour shows those in the UI. Ajour replaces secret connection values with `[secret]` in error messages, field sync messages and the connection summary, and treats a `normalizedConfig` key the manifest doesn't declare as secret, but do not rely on it.
- Mark every credential field `secret: true`. Ajour keeps secret values encrypted by the operating system, decrypts them only to run your plugin, and refuses to save one where it can't encrypt it. It stores the other connection values unencrypted in a file only the user can read.

## API versions

Ajour accepts a plugin only if its `apiVersion` equals Ajour's plugin API version, today `3`. There is no range. Schema plugins have their own version, `1`, checked the same way. When the version changes:

- Installed plugins with another version stay installed but show as unavailable, with the reason. Their connections and items stay.
- Ajour offers an update once the plugin's source lists a version for the new API.
- Installing an archive with another version fails.

Watch Ajour's releases, and publish a new version of your plugin when the API version changes.

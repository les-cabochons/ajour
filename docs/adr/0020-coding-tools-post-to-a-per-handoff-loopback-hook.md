# Coding tools post to a per-handoff loopback hook, and a post only asks for a refresh

Ajour learns a handoff's state by asking its plugin (`readHandoffStates`) every 30 seconds while the window is visible and every 2 minutes while hidden. A thread that stops to ask the user something waits that long before its item says Needs you. Claude Code and Codex can run hooks when a thread stops, needs the user or ends, and Claude Code's hooks can post to a URL. So Ajour gives each handoff a URL a tool's hook posts to, and refreshes that handoff when it does (#726).

This opens the local API to a new caller. Until now only Ajour's window (`/api`, with the window token, ADR 0004) and agent clients (`/mcp/ajour`, with a bearer token each) could call it. A hook's configuration carries only a URL, so the URL is the credential.

**The route.** `POST /hooks/handoff/:id?token=…` on the API's loopback address and port.

- **One token per handoff.** 32 random bytes, made when the handoff starts and given only to that start, in its `hook.url`. The plugin's code receives that URL, so it sees the token in plaintext and could keep it, in the handoff's `native` for example. That falls under ADR 0010's exception for plugins that start processes, which already run commands as the user. Ajour itself keeps only the token's SHA-256 hash in the API state. Removing the handoff revokes it. Once the handoff has been done or gone for 24 hours, when automatic refresh stops too, the token is revoked in effect: no post is accepted, and its hash is removed on the next post or on Remove. A revoked token never comes back.
- **A post is only a nudge.** It schedules one refresh of that handoff, through the plugin, as Refresh does. The body is never parsed, never trusted as the state and never logged; it is read only to be discarded, up to 1 MB.
- **Nothing to probe.** A wrong, missing or revoked token gets the 404 an unknown id gets, after a constant-time comparison of hashes that runs even for an unknown id.
- **Floods cost nothing.** Every post counts toward a global limit before its token is checked, and a valid one toward its handoff's own limit. Over either, the post gets 429 and schedules nothing. Valid posts within a second make one refresh, and a post during a refresh makes one more after it. Counting before the check is deliberate: past the limit, a flood without a valid token causes no lookup and no refresh work. The price is that a flood of bad tokens switches off every handoff's hooks (see Consequences).
- **The loopback rules the other routes follow.** The Host must be `127.0.0.1`, `localhost` or `[::1]`, which stops DNS rebinding. Any Origin header is refused with 403, as MCP refuses one: a tool is no browser, so no web page reaches the route, and it sends no CORS headers. It needs no window token, which a tool never has.

**How a tool gets the URL.** The host builds it from the port the API listens on and puts it in `startHandoff`'s request. A plugin can't hand a tool a URL of its choosing through a declared command: the new `hook-url` argument kind is filled by the host, like `connection-url`, only during `startHandoff`, and a value the plugin passes for it is refused. Its optional `template` is a manifest literal with `{url}` where the URL goes, such as Claude Code's per-start settings:

```json
{
  "kind": "hook-url",
  "name": "hook",
  "template": "{\"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"http\",\"url\":\"{url}\"}]}]}}"
}
```

The template is the plugin author's text, approved in Access review like any literal, and Access review shows it. The host fills only the URL, whose characters (loopback host, port, a UUID and base64url) need no escaping in JSON or TOML, and checks that shape again before filling. The tool's own configuration files are never edited.

## Considered options

- **A `text` argument for the settings JSON.** Rejected. The plugin would write the whole JSON at run time, and Claude Code's settings can declare `command` hooks, which run anything. A template keeps the JSON fixed and approved, and lets the host write only the URL.
- **Trust the body as the state.** Rejected. Any program running as the user, or a tool's model, could then set a handoff's state. The plugin's answer stays the only source of state.
- **The window token, or one token for all hooks.** Rejected. The window token reaches every `/api` route. A shared hook token would let one thread's tool nudge every handoff, and couldn't be revoked per handoff.
- **Rotate the token on Open.** Not now. Ajour keeps only the hash, so a resumed thread can't be given the URL again; its state still arrives by polling.

## Consequences

- **Who can read the token.** It sits in the tool's command line while the tool runs, so other programs can read it from the process list. On Windows and macOS, that means programs running as the same user, which could already read Ajour's data on disk (ADR 0004's boundary). On Linux, `/proc/<pid>/cmdline` is readable by every local user unless `/proc` is mounted with `hidepid`, so other users on the computer could read it too. Plugins are off on Linux today (ADR 0007), so no handoff and no token exists there yet; when plugins turn on (#626), the token's readers grow from the user's own programs to every account on the computer. Whoever holds the token gains only what a post gives: an early refresh of that one handoff, within the limits. It reads nothing and sets no state.
- **A flood of bad tokens switches off every handoff's hooks.** Any local process, without a token, can send 120 posts a minute to the route. The global limit then answers every post with 429, genuine hooks included, and handoffs fall back to polling at the usual cadence until the flood stops. This is the trade-off for counting before the token check: no flood of unauthenticated posts ever causes refresh work.
- **Port squatting.** The API's port is fixed (8787 by default, `AJOUR_APP_API_PORT` in `apps/desktop/electron/main.cjs`), and a detached thread outlives Ajour. While Ajour is closed, a local process that binds `127.0.0.1:8787` receives the hook's posts: the token, and the payload the tool sends. For Claude Code that payload includes `session_id`, `transcript_path`, `cwd` and `last_assistant_message`. The token is worth little to that process, but the payload can be the last thing the thread said. Agent clients' MCP bearer tokens share the port risk, since a client would send its token to whoever holds the port, but hooks are what make a tool send its own payload there. A hook that sends nothing worth taking would close most of this: a future template could post an empty body, for example through a `command` hook that runs Ajour's CLI, which discards the tool's input and posts only to the URL. That is future work, not built here.
- The plugin's code sees each token in plaintext when it starts the handoff, and can keep it (ADR 0010's exception for plugins that start processes). Ajour stores only the hash.
- A tool whose hook fails or isn't configured loses nothing: polling still runs at its cadence.
- `handoff.hook` events record the outcome (`accepted`, `rate_limited` or `unknown`) and the tool, never the id, token, URL or body (ADR 0011).
- Windows Terminal's strict argument allowlist refuses the braces and quotes of a JSON template, so a `terminal` command can't carry one there; a `detached` start can.

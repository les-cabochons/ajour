# Test and debug

Plugin API 4 runs in the desktop sandbox. See [Runtime](/developers/runtime) for the broker, credential rules and G2 limits.

Most of a plugin's logic is mapping: the tool's data to Ajour's types and back. Test that with unit tests, then check the whole flow in a development build of Ajour.

## Unit tests

Your plugin's functions take plain data and return plain data, so call them directly. Stand in for the `ajour` global with the SDK's `createFakeAjour`, which answers `ajour.http` from routes, records each request, and refuses what the broker would refuse. The official plugins use Vitest:

```ts
import { afterEach, expect, it, vi } from "vitest";
import type { PluginManifest } from "@ajour/plugin-sdk";
import { createFakeAjour } from "@ajour/plugin-sdk/testing";
import manifest from "../plugin.json";
import { validateConnection } from "../src/plugin.js";

afterEach(() => vi.unstubAllGlobals());

it("rejects a token GitHub refuses", async () => {
  vi.stubGlobal(
    "ajour",
    createFakeAjour({
      manifest: manifest as PluginManifest,
      routes: [
        {
          method: "GET",
          host: "rest",
          path: "/user",
          respond: { status: 401, body: "Bad credentials" },
        },
      ],
    }),
  );

  await expect(validateConnection(connection)).rejects.toThrow(
    "GitHub refused the token",
  );
});
```

Cover at least:

- **Mapping.** One real API response per item type, turned into the item you expect.
- **Done items.** A tracked item that left your query and closed comes back with `stateDone: true`.
- **Estimates.** Each row of the [estimate table](/developers/backlog-api#estimates): noop, push, pull, conflict, and a failed write.
- **Priorities.** Each level both ways, and a value that maps to no level.
- **Limits.** A title over 240 characters, a `note` (the item's description) over 4,000. Ajour refuses the whole result if one item breaks a limit.
- **The manifest.** The official plugins run `scripts/connector-manifest.mjs`, a copy of Ajour's manifest rules, in a test, so a bad `plugin.json` fails CI instead of the install.

## Run in a development build

A development build of Ajour loads plugins from folders, without packaging. Clone [Ajour](https://github.com/les-cabochons/ajour), then:

```sh
just install
AJOUR_DEV_PLUGIN_DIRS=/absolute/path/to/your-plugin just desktop-start
```

Separate several folders with `:` on macOS, or `;` on Windows. Instead of the variable, you can choose a folder in **Settings › Debug › Development plugin directory**. The setting stays for later development launches. The variable wins when both are set.

- Keep `pnpm dev`, or your build in watch mode, running in your plugin's folder. Ajour loads your compiled output but does not build it.
- Each call loads your code in a new worker inside the plugin's sandboxed renderer, so a rebuild applies at the next call.
- Restart Ajour after you change `plugin.json`.
- A development plugin replaces an installed plugin with the same `id`.
- Production builds ignore development folders.

If your plugin does not show up, check the terminal that runs `just desktop-start`. Ajour logs `Skipping invalid development plugin "<folder>"` with the reason, such as a wrong `apiVersion`.

## Read errors

`ajour.log` lines go to Ajour's own log and hold only ids and counts. Errors are what you see:

- **Saving a connection** shows the error from `validateConnection` in the form.
- **A sync** shows it on the connection's row in **Settings › Plugins**, and in a toast for automatic syncs.
- **A settle write** shows it in a toast that stays until dismissed.
- **A comment call** shows it with the comments, in the editor, or in a toast.
- **A calendar** shows it on the connection's row and in the Time view.

While you debug, put what you need into the error message, then take it out before you release. Never put a token in a message.

## Test the package

Before a release, build the archive and install it in a production build of Ajour, the way users will:

```sh
pnpm package
```

Then **Settings › Plugins › Install from file**. This catches a dependency that was in `node_modules` during development but is not in `dist/`.

## Official plugin release check

This check is for Ajour's maintainers. It proves, in a packaged build, what each plugin's own tests can't: those tests use a hand-written stand-in for the broker, and this one goes through Ajour's real broker and renderer runtime.

Build the test-only packaged executable with `just plugin-release-package`. It has its own entrypoint and output directory, and is never distributed as Ajour. Set `AJOUR_PLUGINS_CHECKOUT` to a checkout of `ajour-plugins`, `AJOUR_PLUGINS_COMMIT` to a commit or ref (default `HEAD`), and `AJOUR_PLUGIN_RELEASE_EXECUTABLE` to the packaged executable. Then run `just plugin-release-check`.

The runner archives the resolved commit into a temporary folder, so local uncommitted changes can't affect the result, and refuses a plugin whose manifest is not API 4. It also extracts the API 3 packages that commit's `ajour.json` still lists, and starts the app from the data folder of that release: those packages installed, a version 7 state file with their connections and every secret in plain text. Ajour upgrades it on the first request, and the check reads the result before it installs anything. Then the packaged app installs the six official plugins (Jira, GitHub, Azure DevOps, ICS, Workday agent and Workday project data) as a user would, turns them on, and drives them through the app's API against fixture services that answer to virtual host names. No external coding agent is started: the agent task package is checked through its declarations.

Besides each plugin's normal flow, it covers:

- **ICS:** a secret feed address reached through 1, 2 and 3 HTTPS redirects, one to another host, syncs. An unsafe redirect target is refused. Neither the address nor a redirect address reaches the plugin, the logs or the UI.
- **Azure DevOps:** connections saved with the organization URL and with a project URL still sync, refresh, settle and comment, with their tracked ids kept.
- **GitHub:** a connection saved with each legacy address form (`www.github.com`, `http://github.com`, `http://www.github.com`, a port and path on either host) is rewritten once to `https://github.com` and still validates and syncs.
- **API 3:** connections made on API 3 stay with their non-secret settings, on a plugin that shows "This plugin needs an update".

The check runs on Windows today. The macOS package and a CI job for the check are not wired yet. It doesn't release plugins, change the signed source catalog or publish Ajour. No G1 release claim is justified until the packaged malicious-plugin, lifecycle and official-plugin checks pass on both Windows and macOS.

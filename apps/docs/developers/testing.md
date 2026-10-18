# Test and debug

Most of a plugin's logic is mapping: the tool's data to Ajour's types and back. Test that with unit tests, then check the whole flow in a development build of Ajour.

## Unit tests

Your plugin's functions take plain data and return plain data, so call them directly. Stub `fetch` to play the tool's API. The official plugins use Vitest:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { validateConnection } from "../src/plugin.js";

afterEach(() => vi.unstubAllGlobals());

it("rejects a token GitHub refuses", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("Bad credentials", { status: 401 })),
  );

  await expect(validateConnection({ token: "expired" })).rejects.toThrow(
    "GitHub request failed (401)",
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
- Each call loads your code in a new worker, so a rebuild applies at the next call.
- Restart Ajour after you change `plugin.json`.
- A development plugin replaces an installed plugin with the same `id`.
- Production builds ignore development folders.

If your plugin does not show up, check the terminal that runs `just desktop-start`. Ajour logs `Skipping invalid development plugin "<folder>"` with the reason, such as a wrong `apiVersion`.

## Read errors

Your plugin's logs are discarded. Errors are what you see:

- **Saving a connection** shows the error from `validateConnection` in the form.
- **A sync** shows it on the connection's row in **Settings › Plugins**, and in a toast for automatic syncs.
- **A settle write** shows it in a toast that stays until dismissed.

While you debug, put what you need into the error message, then take it out before you release. Never put a token in a message.

## Test the package

Before a release, build the archive and install it in a production build of Ajour, the way users will:

```sh
pnpm package
```

Then **Settings › Plugins › Install from file**. This catches a dependency that was in `node_modules` during development but is not in `dist/`.

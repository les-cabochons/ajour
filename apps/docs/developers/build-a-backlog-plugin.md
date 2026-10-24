# Build a backlog plugin

This tutorial builds a backlog plugin for GitHub Issues. It syncs the open issues assigned to you into Ajour's backlog, and closes an issue when you settle it in Ajour. It takes about an hour.

You need Node.js 22 or later, pnpm through Corepack, and a clone of the [Ajour repository](https://github.com/les-cabochons/ajour) to run a development build.

## 1. Create the project

```sh
mkdir ajc-github-issues && cd ajc-github-issues
corepack enable
pnpm init
pnpm add -D typescript @types/node vitest tar
```

Set up `package.json`. The scripts match the official plugins, so you can copy their CI later.

```json
{
  "name": "ajc-github-issues",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\" && tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "package": "pnpm build && node scripts/package-connector.mjs",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

Add `tsconfig.json`. Ajour loads plain ES modules, so compile to ES2022 and keep `rootDir` and `outDir` apart.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

::: warning Bundle your dependencies
Ajour loads `dist/plugin.js` and whatever it imports from inside the plugin folder. The packaging script archives `plugin.json` and `dist/` only, so a runtime dependency in `node_modules` is missing once installed. Use Node built-ins and `fetch`, or bundle dependencies into `dist/` with a bundler such as esbuild.
:::

## 2. Write the manifest

Create `plugin.json` at the root. It tells Ajour who the plugin is, which API it speaks, what it can do, and which fields to ask the user for.

```json
{
  "id": "github_issues",
  "version": "0.1.0",
  "apiVersion": 3,
  "displayName": "GitHub Issues",
  "description": "Sync the GitHub issues assigned to you into Ajour's backlog.",
  "iconSvg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"9\" fill=\"none\" stroke=\"#1f883d\" stroke-width=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"2.5\" fill=\"#1f883d\"/></svg>",
  "entrypoint": "dist/plugin.js",
  "capabilities": { "connector": { "settle": true } },
  "connectionFields": [
    {
      "id": "label",
      "label": "Connection label",
      "type": "text",
      "required": true,
      "placeholder": "Work"
    },
    {
      "id": "tenantLabel",
      "label": "Account",
      "type": "text",
      "required": true,
      "placeholder": "Acme on GitHub"
    },
    {
      "id": "token",
      "label": "Personal access token",
      "type": "password",
      "required": true,
      "secret": true,
      "helpText": "A fine-grained token with Issues: read and write."
    },
    {
      "id": "autoSync",
      "label": "Auto sync to backlog",
      "type": "checkbox",
      "defaultValue": false
    },
    {
      "id": "autoSyncIntervalMinutes",
      "label": "Auto sync interval (minutes)",
      "type": "number",
      "defaultValue": 15,
      "min": 1,
      "max": 1440
    }
  ]
}
```

- `id` becomes the `source` of every item the plugin syncs. Never change it after release.
- `label`, `tenantLabel`, `autoSync` and `autoSyncIntervalMinutes` are reserved fields. Ajour handles them itself. Declare them anyway, so the form shows them with your labels.
- `secret: true` keeps the token out of the form once saved.
- The backlog capability is declared under the `connector` key until plugin API 4.
- `settle: true` tells Ajour the plugin can write states back.

See the [Manifest reference](/developers/manifest) for every field.

## 3. Add the contract types

Ajour has no SDK package. Each plugin keeps a copy of the types it uses, so it never depends on Ajour's code at runtime. Copy the types block from the [Backlog API reference](/developers/backlog-api#types) into `src/contract.ts`.

## 4. Validate the connection

`validateConnection` runs when the user saves a connection. Check the credentials, then return the settings to store. Whatever you return in `normalizedConfig` is what Ajour saves, so return every field you need later.

Create `src/plugin.ts`:

```ts
import type {
  PluginFieldValues,
  BacklogImportCandidateInput,
  PluginConnection,
  BacklogPluginSyncResult,
  BacklogSettleStatesResult,
  BacklogSettleWriteRequest,
  BacklogSettleWriteResult,
  BacklogSyncWorkItem,
} from "./contract.js";

const API = "https://api.github.com";

interface GitHubIssue {
  url: string;
  html_url: string;
  repository_url: string;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  pull_request?: unknown;
}

function readToken(config: PluginFieldValues): string {
  const token = config.token;
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("Enter a personal access token.");
  }
  return token.trim();
}

/** Calls the GitHub REST API, and turns a failure into a message for the user. */
async function github<T>(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub request failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

export async function validateConnection(config: PluginFieldValues) {
  const token = readToken(config);
  const user = await github<{ login: string }>(token, `${API}/user`);
  return {
    normalizedConfig: { token },
    // Shown on the connection's row. Never put a secret here.
    connectionSummary: { account: user.login },
  };
}
```

## 5. Sync items

`syncConnection` returns the items to show in Ajour. Ajour passes the connection, and the items it already tracks for that connection.

```ts
/** Only GitHub issue API URLs, so the token never goes anywhere else. */
function assertIssueUrl(url: string) {
  if (
    !/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(url)
  ) {
    throw new Error(`Not a GitHub issue: ${url}`);
  }
}

function toItem(
  connection: PluginConnection,
  issue: GitHubIssue,
): BacklogImportCandidateInput {
  const closed = issue.state === "closed";
  return {
    source: "github_issues",
    connectionId: connection.id,
    connectionLabel: connection.label,
    tenantLabel: connection.tenantLabel,
    // A stable, unique ID. Ajour sends it back on every later call.
    sourceId: issue.url,
    externalId: `#${issue.number}`,
    sourceUrl: issue.html_url,
    title: issue.title.slice(0, 240),
    note: issue.body ? issue.body.slice(0, 4000) : undefined,
    projectName: issue.repository_url.split("/repos/")[1].slice(0, 120),
    workItemType: "Issue",
    state: closed ? "Closed" : "Open",
    stateCategory: closed ? "Closed" : "Open",
    stateDone: closed,
    depth: 0,
    selectable: true,
    childCount: 0,
  };
}

export async function syncConnection(
  connection: PluginConnection,
  workItems: BacklogSyncWorkItem[],
): Promise<BacklogPluginSyncResult> {
  const token = readToken(connection.config);
  const open = await github<GitHubIssue[]>(
    token,
    `${API}/issues?filter=assigned&state=open&per_page=100`,
  );
  // The issues endpoint also returns pull requests.
  const items = open
    .filter((issue) => !issue.pull_request)
    .map((issue) => toItem(connection, issue));

  // Tracked issues that left the open list may have closed. Report them with
  // stateDone, so Ajour archives them instead of keeping them open.
  const returned = new Set(items.map((item) => item.sourceId));
  for (const tracked of workItems) {
    if (returned.has(tracked.sourceId)) continue;
    assertIssueUrl(tracked.sourceId);
    const issue = await github<GitHubIssue>(token, tracked.sourceId);
    if (issue.state === "closed") items.push(toItem(connection, issue));
  }

  return { items };
}
```

A few rules this code follows, which every backlog plugin should:

- `source` equals the manifest `id`.
- `sourceId` never changes for an item. Ajour keys everything on it.
- Done items come back with `stateDone: true`, even when your query no longer returns them. Otherwise Ajour keeps them open.
- Strings respect Ajour's limits: 240 characters for a title, 120 for a project name, and 4,000 for the `note`, which Ajour takes as the item's description when it first arrives.

## 6. Write back on settle

With `settle: true`, Ajour calls two more functions. `listSettleStates` fills the settle dialog. `writeSettle` writes the user's choice once the Undo toast closes.

```ts
export async function listSettleStates(): Promise<BacklogSettleStatesResult> {
  return {
    states: [
      { name: "Open", category: "Open", done: false },
      { name: "Closed", category: "Closed", done: true },
    ],
  };
}

export async function writeSettle(
  connection: PluginConnection,
  request: BacklogSettleWriteRequest,
): Promise<BacklogSettleWriteResult> {
  if (request.priority) {
    throw new Error(
      "GitHub issues have no priority. Keep the priority as it is.",
    );
  }
  if (!request.state) return {};

  assertIssueUrl(request.sourceId);
  const issue = await github<GitHubIssue>(
    readToken(connection.config),
    request.sourceId,
    {
      method: "PATCH",
      body: JSON.stringify({
        state: request.state === "Closed" ? "closed" : "open",
      }),
    },
  );
  const closed = issue.state === "closed";
  // The values in GitHub after the write. Ajour stores them.
  return {
    state: closed ? "Closed" : "Open",
    stateCategory: closed ? "Closed" : "Open",
    stateDone: closed,
  };
}
```

The error message reaches the user in a toast, with secret connection values replaced by `[secret]` and cut at 1,000 characters. Write it as an instruction, with the useful part first.

## 7. Run it in Ajour

Build in watch mode:

```sh
pnpm dev
```

In another terminal, start a development build of Ajour with your plugin folder:

```sh
cd path/to/ajour
just install
AJOUR_DEV_PLUGIN_DIRS=/absolute/path/to/ajc-github-issues just desktop-start
```

Or open **Settings › Debug › Development plugin directory** in the development build and choose the folder. Ajour remembers it.

Then:

1. Open **Settings › Plugins**. **GitHub Issues** shows as installed.
2. Open it, press **Add a connection**, paste a token and press **Add connection**. `validateConnection` runs.
3. Press **Sync**. Your issues show in **Settings › Sync review**. Import a few.
4. Settle one with <kbd>Shift</kbd> <kbd>E</kbd> and pick **Closed**. When the Undo toast closes, the issue closes on GitHub.

Each call loads your plugin in a fresh worker, so a rebuild applies at the next call. Restart Ajour after you change `plugin.json`.

## 8. Test it

Test the exported functions directly, with `fetch` stubbed. This is how the official plugins test.

```ts
// tests/plugin.test.ts
import { afterEach, expect, it, vi } from "vitest";
import { syncConnection } from "../src/plugin.js";

const connection = {
  id: "c1",
  pluginId: "github_issues",
  label: "Work",
  tenantLabel: "Acme",
  autoSync: false,
  autoSyncIntervalMinutes: 15,
  connectedAt: 1,
  config: { token: "t" },
};

afterEach(() => vi.unstubAllGlobals());

it("skips pull requests", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValueOnce(
      Response.json([
        {
          url: "https://api.github.com/repos/acme/api/issues/1",
          html_url: "https://github.com/acme/api/issues/1",
          repository_url: "https://api.github.com/repos/acme/api",
          number: 1,
          title: "Bug",
          body: null,
          state: "open",
        },
        {
          url: "https://api.github.com/repos/acme/api/issues/2",
          html_url: "https://github.com/acme/api/pull/2",
          repository_url: "https://api.github.com/repos/acme/api",
          number: 2,
          title: "PR",
          body: null,
          state: "open",
          pull_request: {},
        },
      ]),
    ),
  );

  const result = await syncConnection(connection, []);

  expect(result.items.map((item) => item.externalId)).toEqual(["#1"]);
});
```

See [Test and debug](/developers/testing).

## 9. Package and install

Copy `scripts/package-connector.mjs` and `scripts/connector-manifest.mjs` from [the Jira plugin](https://github.com/les-cabochons/ajour-plugins/tree/main/plugins/jira/scripts). The first checks the manifest and writes the archive. Then:

```sh
pnpm package
# package/github_issues-0.1.0.ajour-connector
```

In the installed Ajour app, open **Settings › Plugins**, press **Install from file** and choose the archive.

To share it, see [Publish a plugin](/developers/publish).

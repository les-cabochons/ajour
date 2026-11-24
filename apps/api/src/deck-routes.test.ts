import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDiff,
  parseDiff,
  type FileContents,
} from "../../../packages/review-deck/diff.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { apiRequest, startLocalApi } from "./test-support/local-api.ts";

/*
 * Deck's service in the local API (#779): opening a pull request fetches both
 * versions of each changed file through the code host plugin and builds the
 * diff with Review Deck's vendored `buildDiff`, never with the host's patch.
 * The pull request on screen is kept in memory. The code host here is a fake
 * GitHub plugin, run in process, whose files are below.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

const lines = (count: number, label = "line") =>
  Array.from({ length: count }, (_, index) => `${label} ${index + 1}\n`).join(
    "",
  );

/** One hunk as a patch of its file: the file's header, the `@@` line, its lines. */
const patch = (header: string[], hunk: string, body: string[]) =>
  [...header, hunk, ...body, ""].join("\n");

/** The file versions the fake code host holds: `sha:path`. */
const API_BASE = lines(20);
const API_HEAD = API_BASE.replace("line 2\n", "line two\n").replace(
  "line 18\n",
  "line eighteen\n",
);
const FILES: Record<string, string | "binary"> = {
  "base:src/api.ts": API_BASE,
  "head:src/api.ts": API_HEAD,
  "head:src/new.ts": "export const a = 1;\n",
  "base:src/old.ts": "export const b = 2;\n",
  "base:src/before.ts": "export const c = 3;\n",
  "head:src/moved.ts": "export const c = 3;\n",
  "base:assets/logo.png": "binary",
  "head:assets/logo.png": "binary",
  "base:src/broken.ts": "x\n",
};

/** The pull request's files, in the order the host lists them, which is not path order. */
const CHANGED_FILES = [
  { path: "src/new.ts", status: "added" },
  { path: "src/api.ts", status: "modified" },
  { path: "src/old.ts", status: "removed" },
  { path: "assets/logo.png", status: "modified", binary: true },
  { path: "src/moved.ts", previousPath: "src/before.ts", status: "renamed" },
];

const pluginSource = `
const FILES = ${JSON.stringify(FILES)};
const CHANGED_FILES = ${JSON.stringify(CHANGED_FILES)};
export async function validateConnection({ config }) {
  return { normalizedConfig: config, connectionSummary: {} };
}
export async function getPullRequestContent(connection, request) {
  if (request.number === 404) throw new Error("GitHub request failed (404): Not Found.");
  if (request.number === 12) {
    globalThis.deckListGate.started += 1;
    await globalThis.deckListGate.opened;
  }
  const files =
    request.number === 12 ? [{ path: "src/new.ts", status: "added" }]
    : request.number === 13
      ? [{ path: "slow/a.ts", status: "added" }, { path: "slow/b.ts", status: "added" }]
    : request.number === 9 ? [{ path: "src/broken.ts", status: "modified" }]
    : request.number === 8 ? [{ path: "src/new.ts", status: "added" }]
    : request.number === 11 ? [{ path: "src/gone.ts", status: "modified" }]
    : request.number === 10
      ? Array.from({ length: 20 }, (_, index) => ({ path: "slow/" + index + ".ts", status: "added" }))
    : CHANGED_FILES;
  return {
    headSha: "head",
    baseSha: "base",
    // The host's patch is never used: this one would cut other hunks.
    files: files.map((file) => ({ additions: 1, deletions: 1, binary: false, patch: "@@ -1 +1 @@\\n-nothing\\n+like this", ...file })),
  };
}
export async function getFileContent(connection, request) {
  if (request.path === "src/broken.ts") throw new Error("GitHub request failed (500).");
  if (request.path.startsWith("slow/")) {
    await globalThis.deckTestGate;
    return { kind: "text", content: "slow\\n" };
  }
  const content = FILES[request.sha + ":" + request.path];
  if (content === undefined) return { kind: "missing" };
  if (content === "binary") return { kind: "binary" };
  return { kind: "text", content };
}
`;

async function createCodeHostPlugin(parent: string, source = pluginSource) {
  const directory = path.join(parent, "github");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "github",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "GitHub",
      description: "Test code host.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      capabilities: { codeHost: {} },
      connectionFields: [
        {
          id: "label",
          label: "Connection label",
          type: "text",
          required: true,
        },
        { id: "tenantLabel", label: "Account", type: "text", required: true },
        { id: "baseUrl", label: "GitHub URL", type: "url", required: true },
      ],
    }),
    "utf8",
  );
  await writeFile(path.join(directory, "plugin.mjs"), source, "utf8");
  return directory;
}

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function startDeck(source?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-"));
  stops.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const api = await startLocalApi({
    pluginRuntime: new InProcessPluginRuntime(),
    vault: new MemorySecretVault(),
    allowDevelopmentPlugins: true,
    developmentPluginDirectories: [await createCodeHostPlugin(root, source)],
  });
  stops.unshift(api.stop);
  const created = await apiRequest(
    api.baseUrl,
    "/api/plugins/github/connections",
    {
      values: {
        label: "Work",
        tenantLabel: "acme",
        autoSync: true,
        autoSyncIntervalMinutes: 5,
        baseUrl: "https://github.com",
      },
    },
  );
  expect(created.status).toBe(200);
  const connectionId = created.body.connection.id as string;
  const open = (number = 7) =>
    apiRequest(
      api.baseUrl,
      `/api/deck/github/connections/${connectionId}/open`,
      { repository: "acme/api", number },
    );
  const fileReads = () =>
    api.events.filter(
      (event) =>
        event.name === "pull_request.load_file" &&
        event.kind === "plugin_operation",
    ).length;
  return { api, connectionId, open, fileReads };
}

/** Holds the file reads of the `slow/` files until `release` runs. */
function holdSlowReads() {
  let release!: () => void;
  (globalThis as { deckTestGate?: Promise<void> }).deckTestGate = new Promise(
    (resolve) => {
      release = resolve;
    },
  );
  stops.push(async () => {
    release();
    delete (globalThis as { deckTestGate?: Promise<void> }).deckTestGate;
  });
  return release;
}

/** Holds pull request 12's file list until `release` runs, counting the lists started. */
function holdListing() {
  let release!: () => void;
  const gate = {
    started: 0,
    opened: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  (globalThis as { deckListGate?: typeof gate }).deckListGate = gate;
  stops.push(async () => {
    release();
    delete (globalThis as { deckListGate?: typeof gate }).deckListGate;
  });
  return { release, started: () => gate.started };
}

/** The file reads the plugin host ran that ended with `outcome`. */
const readsOf = (
  events: { name: string; kind: string; outcome?: string }[],
  outcome: string,
) =>
  events.filter(
    (event) =>
      event.name === "pull_request.load_file" &&
      event.kind === "plugin_operation" &&
      event.outcome === outcome,
  ).length;

describe("opening a pull request in Deck", () => {
  it("returns every file in path order, with the hunks Review Deck cuts from both versions", async () => {
    const { open } = await startDeck();

    const opened = await open();

    expect(opened.body.error).toBeUndefined();
    expect(opened.status).toBe(200);
    expect(opened.body).toEqual({
      headSha: "head",
      baseSha: "base",
      files: [
        {
          path: "assets/logo.png",
          status: "modified",
          binary: true,
          hunks: [
            expect.objectContaining({ id: "assets/logo.png#0", header: "" }),
          ],
        },
        {
          path: "src/api.ts",
          status: "modified",
          binary: false,
          hunks: [
            {
              id: "src/api.ts#0",
              header: "@@ -1,5 +1,5 @@",
              oldStart: 1,
              oldLines: 5,
              newStart: 1,
              newLines: 5,
              patch: patch(
                [
                  "diff --git a/src/api.ts b/src/api.ts",
                  "--- a/src/api.ts",
                  "+++ b/src/api.ts",
                ],
                "@@ -1,5 +1,5 @@",
                [
                  " line 1",
                  "-line 2",
                  "+line two",
                  " line 3",
                  " line 4",
                  " line 5",
                ],
              ),
            },
            {
              id: "src/api.ts#1",
              header: "@@ -15,6 +15,6 @@",
              oldStart: 15,
              oldLines: 6,
              newStart: 15,
              newLines: 6,
              patch: patch(
                [
                  "diff --git a/src/api.ts b/src/api.ts",
                  "--- a/src/api.ts",
                  "+++ b/src/api.ts",
                ],
                "@@ -15,6 +15,6 @@",
                [
                  " line 15",
                  " line 16",
                  " line 17",
                  "-line 18",
                  "+line eighteen",
                  " line 19",
                  " line 20",
                ],
              ),
            },
          ],
        },
        {
          path: "src/moved.ts",
          previousPath: "src/before.ts",
          status: "renamed",
          binary: false,
          hunks: [
            expect.objectContaining({ id: "src/moved.ts#0", header: "" }),
          ],
        },
        {
          path: "src/new.ts",
          status: "added",
          binary: false,
          hunks: [
            expect.objectContaining({
              id: "src/new.ts#0",
              header: "@@ -1,0 +1,1 @@",
              patch: patch(
                [
                  "diff --git a/src/new.ts b/src/new.ts",
                  "new file mode 100644",
                  "--- /dev/null",
                  "+++ b/src/new.ts",
                ],
                "@@ -1,0 +1,1 @@",
                ["+export const a = 1;"],
              ),
            }),
          ],
        },
        {
          path: "src/old.ts",
          status: "deleted",
          binary: false,
          hunks: [
            expect.objectContaining({
              id: "src/old.ts#0",
              header: "@@ -1,1 +1,0 @@",
              patch: patch(
                [
                  "diff --git a/src/old.ts b/src/old.ts",
                  "deleted file mode 100644",
                  "--- a/src/old.ts",
                  "+++ /dev/null",
                ],
                "@@ -1,1 +1,0 @@",
                ["-export const b = 2;"],
              ),
            }),
          ],
        },
      ],
    });
  });

  it("gives the hunk ids and headers buildDiff gives for the same contents", async () => {
    const { open } = await startDeck();
    const text = (key: string) => {
      const content = FILES[key];
      return content === undefined || content === "binary" ? null : content;
    };
    const changes = [
      { path: "src/api.ts", changeType: "edit" as const },
      { path: "src/new.ts", changeType: "add" as const },
      { path: "src/old.ts", changeType: "delete" as const },
      {
        path: "src/moved.ts",
        originalPath: "src/before.ts",
        changeType: "rename" as const,
      },
      { path: "assets/logo.png", changeType: "edit" as const },
    ];
    const contents = new Map<string, FileContents>(
      changes.map((change) => [
        change.path,
        {
          old: text(
            `base:${"originalPath" in change ? change.originalPath : change.path}`,
          ),
          new: text(`head:${change.path}`),
          binary: change.path === "assets/logo.png",
          tooLarge: false,
        },
      ]),
    );
    const expected = parseDiff(buildDiff(changes, contents)).flatMap((file) =>
      file.hunks.map((hunk) => [hunk.id, hunk.header]),
    );

    const opened = await open();

    const served = (
      opened.body.files as { hunks: { id: string; header: string }[] }[]
    ).flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk.header]));
    expect(served.sort()).toEqual(expected.sort());
  });

  it("keeps the pull request on screen in memory, and reads its files again once another one opened", async () => {
    const { open, fileReads } = await startDeck();

    await open();
    // Both versions of the modified, binary and renamed files, one of the
    // added and deleted ones.
    expect(fileReads()).toBe(8);

    expect((await open()).status).toBe(200);
    expect(fileReads()).toBe(8);

    expect((await open(8)).status).toBe(200);
    expect(fileReads()).toBe(9);
    await open();
    expect(fileReads()).toBe(17);
  });

  it("answers the plugin's error when a file can't be read, and names it on the event", async () => {
    const { api, open } = await startDeck();

    const opened = await open(9);

    expect(opened).toEqual({
      status: 502,
      body: { error: "GitHub request failed (500)." },
    });
    expect(
      api.events.find(
        (event) => event.name === "deck.open" && event.kind === "request",
      ),
    ).toMatchObject({ outcome: "error" });
  });

  it("answers the plugin's error when the pull request can't be read", async () => {
    const { open } = await startDeck();

    await expect(open(404)).resolves.toEqual({
      status: 502,
      body: { error: "GitHub request failed (404): Not Found." },
    });
  });

  it("counts the files and hunks on the event, never a path", async () => {
    const { api, open } = await startDeck();

    await open();
    await open();

    const opens = api.events.filter(
      (event) => event.name === "deck.open" && event.kind === "request",
    );
    expect(opens).toHaveLength(2);
    expect(opens[0]).toMatchObject({
      outcome: "ok",
      deck: { file_count: 5, hunk_count: 6, file_read_count: 8, kept: false },
    });
    expect(opens[1]).toMatchObject({
      deck: { file_count: 5, hunk_count: 6, file_read_count: 0, kept: true },
    });
    expect(JSON.stringify(opens)).not.toContain("src/api.ts");
  });

  it("stops building a pull request's diff once another one opens, and answers that it was replaced", async () => {
    const { api, open } = await startDeck();
    const fileLists = () =>
      api.events.filter(
        (event) =>
          event.name === "pull_request.load" &&
          event.kind === "plugin_operation",
      ).length;
    let release!: () => void;
    (globalThis as { deckTestGate?: Promise<void> }).deckTestGate = new Promise(
      (resolve) => {
        release = resolve;
      },
    );
    try {
      // Pull request 10's 20 files are read 3 at a time, and the first
      // three wait. Pull request 7 opens while they do.
      const slow = open(10);
      await expect.poll(fileLists).toBe(1);
      const fast = open(7);
      await expect.poll(fileLists).toBe(2);
      release();

      await expect(slow).resolves.toEqual({
        status: 409,
        body: { error: "Another pull request opened in Deck." },
      });
      expect((await fast).status).toBe(200);
      // The three reads already running finished; none of the other 17 started.
      expect(readsOf(api.events, "ok")).toBe(3 + 8);
      expect(
        api.events.find(
          (event) =>
            event.name === "deck.open" &&
            event.kind === "request" &&
            (event as { outcome_reason?: string }).outcome_reason ===
              "replaced",
        ),
      ).toMatchObject({ outcome: "refused" });
    } finally {
      release();
      delete (globalThis as { deckTestGate?: Promise<void> }).deckTestGate;
    }
  });

  it("answers the pull request opened last, even when an earlier one's file list comes back after it", async () => {
    const { api, open } = await startDeck();
    const fileLists = () =>
      api.events.filter(
        (event) =>
          event.name === "pull_request.load" &&
          event.kind === "plugin_operation",
      ).length;
    const releaseReads = holdSlowReads();
    const listing = holdListing();

    // Pull request 12's file list waits. Pull request 10 opens meanwhile,
    // lists its files and starts reading them.
    const earlier = open(12);
    await expect.poll(listing.started).toBe(1);
    const later = open(10);
    await expect.poll(fileLists).toBe(1);
    listing.release();

    await expect(earlier).resolves.toEqual({
      status: 409,
      body: { error: "Another pull request opened in Deck." },
    });
    releaseReads();
    expect((await later).status).toBe(200);
  });

  it("answers that it was replaced when another pull request opens during its last file reads", async () => {
    const { api, open } = await startDeck();
    const fileLists = () =>
      api.events.filter(
        (event) =>
          event.name === "pull_request.load" &&
          event.kind === "plugin_operation",
      ).length;
    const release = holdSlowReads();

    // Pull request 13's two files are read in one batch, and both wait.
    const replaced = open(13);
    await expect.poll(fileLists).toBe(1);
    const next = open(8);
    await expect.poll(fileLists).toBe(2);
    release();

    await expect(replaced).resolves.toEqual({
      status: 409,
      body: { error: "Another pull request opened in Deck." },
    });
    expect((await next).status).toBe(200);
  });

  it("waits to list the files while the plugin runs as many operations as it may", async () => {
    const { open } = await startDeck();
    const listing = holdListing();

    // Four file lists of pull request 12 take the plugin's four slots.
    const held = [open(12), open(12), open(12), open(12)];
    await expect.poll(listing.started).toBe(4);
    const next = open(7);
    await new Promise((resolve) => setTimeout(resolve, 100));
    listing.release();

    expect((await next).status).toBe(200);
    for (const opened of await Promise.all(held)) {
      expect(opened.status).toBe(409);
    }
  });

  it("fails rather than show a file added in full when a version the file list names is missing", async () => {
    const { open } = await startDeck();

    await expect(open(11)).resolves.toEqual({
      status: 502,
      body: {
        error:
          "The code host has no version of a changed file at a commit the pull request names.",
      },
    });
  });

  it("says the code host doesn't show changes yet when its plugin doesn't read them", async () => {
    const { api, open } = await startDeck(
      pluginSource.replace(/export async function getFileContent[\s\S]*$/, ""),
    );

    await expect(open()).resolves.toEqual({
      status: 404,
      body: {
        error: "GitHub doesn't show a pull request's changes yet.",
        reason: "not_supported",
      },
    });
    expect(
      api.events.find(
        (event) => event.name === "deck.open" && event.kind === "request",
      ),
    ).toMatchObject({ outcome: "refused", outcome_reason: "not_supported" });
  });

  it("refuses a pull request of a connection that does not exist", async () => {
    const { api } = await startDeck();

    const opened = await apiRequest(
      api.baseUrl,
      "/api/deck/github/connections/missing/open",
      { repository: "acme/api", number: 7 },
    );

    expect(opened).toEqual({
      status: 404,
      body: { error: "Connection not found." },
    });
  });
});

describe("the checks of a pull request in Deck", () => {
  const withChecks = `${pluginSource}
export async function getChecks(connection, request) {
  return {
    checks: [
      { name: "build", state: "success", url: "https://ci.example.test/build" },
      { name: "test", state: "pending" },
    ],
  };
}
`;
  const readChecks = (baseUrl: string, connectionId: string) =>
    apiRequest(
      baseUrl,
      `/api/code-hosts/github/connections/${connectionId}/getChecks`,
      { repository: "acme/api", number: 7 },
    );

  it("reads each check's name, state and url through the code host plugin", async () => {
    const { api, connectionId } = await startDeck(withChecks);

    await expect(readChecks(api.baseUrl, connectionId)).resolves.toEqual({
      status: 200,
      body: {
        checks: [
          {
            name: "build",
            state: "success",
            url: "https://ci.example.test/build",
          },
          { name: "test", state: "pending" },
        ],
      },
    });
    expect(
      api.events.find(
        (event) =>
          event.name === "pull_request.load_checks" && event.kind === "request",
      ),
    ).toMatchObject({ outcome: "ok", pull_request: { check_count: 2 } });
  });

  it("says the plugin doesn't offer them when it has no getChecks", async () => {
    const { api, connectionId } = await startDeck();

    await expect(readChecks(api.baseUrl, connectionId)).resolves.toEqual({
      status: 404,
      body: {
        error: "GitHub doesn't offer this yet.",
        reason: "not_supported",
      },
    });
    expect(
      api.events.find(
        (event) =>
          event.name === "pull_request.load_checks" && event.kind === "request",
      ),
    ).toMatchObject({ outcome: "refused", outcome_reason: "not_supported" });
  });
});

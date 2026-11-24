import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDiff,
  parseDiff,
  type FileContents,
} from "../../../packages/review-deck/diff.ts";
import type { GuideJobConcern } from "../../../packages/review-deck/guide-job.ts";
import type { DeckGuideRuntime } from "./deck-guide-builds.ts";
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
    : request.number >= 20 && request.number < 30
      ? [{ path: "pr" + request.number + "/a.ts", status: "added" }]
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
  if (request.path.startsWith("pr")) {
    return { kind: "text", content: "export const value = 1;\\n" };
  }
  const content = FILES[request.sha + ":" + request.path];
  if (content === undefined) return { kind: "missing" };
  if (content === "binary") return { kind: "binary" };
  return { kind: "text", content };
}
`;

/** The code host a test plugin stands for: its id, its name, its address field and a repository of it. */
interface TestCodeHost {
  id: string;
  displayName: string;
  urlField: string;
  url: string;
  repository: string;
}

const GITHUB: TestCodeHost = {
  id: "github",
  displayName: "GitHub",
  urlField: "baseUrl",
  url: "https://github.com",
  repository: "acme/api",
};

async function createCodeHostPlugin(
  parent: string,
  source = pluginSource,
  host = GITHUB,
) {
  const directory = path.join(parent, host.id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: host.id,
      version: "1.0.0",
      apiVersion: 4,
      displayName: host.displayName,
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
        {
          id: host.urlField,
          label: `${host.displayName} URL`,
          type: "url",
          required: true,
        },
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

async function startDeck(
  source?: string,
  deckGuideRuntime?: DeckGuideRuntime,
  deckGuideTimeoutMs?: number,
  host = GITHUB,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-"));
  stops.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const api = await startLocalApi({
    pluginRuntime: new InProcessPluginRuntime(),
    vault: new MemorySecretVault(),
    allowDevelopmentPlugins: true,
    developmentPluginDirectories: [
      await createCodeHostPlugin(root, source, host),
    ],
    deckGuideRuntime,
    deckGuideTimeoutMs,
  });
  stops.unshift(api.stop);
  const created = await apiRequest(
    api.baseUrl,
    `/api/plugins/${host.id}/connections`,
    {
      values: {
        label: "Work",
        tenantLabel: "acme",
        autoSync: true,
        autoSyncIntervalMinutes: 5,
        [host.urlField]: host.url,
      },
    },
  );
  expect(created.status).toBe(200);
  const connectionId = created.body.connection.id as string;
  const open = (number = 7) =>
    apiRequest(
      api.baseUrl,
      `/api/deck/${host.id}/connections/${connectionId}/open`,
      { repository: host.repository, number },
    );
  const fileReads = () =>
    api.events.filter(
      (event) =>
        event.name === "pull_request.load_file" &&
        event.kind === "plugin_operation",
    ).length;
  const fileLists = () =>
    api.events.filter(
      (event) =>
        event.name === "pull_request.load" && event.kind === "plugin_operation",
    ).length;
  const preload = (...numbers: number[]) =>
    apiRequest(
      api.baseUrl,
      `/api/deck/${host.id}/connections/${connectionId}/preload`,
      {
        pullRequests: numbers.map((number) => ({
          repository: host.repository,
          number,
        })),
      },
    );
  return { api, connectionId, open, preload, fileReads, fileLists };
}

/**
 * Builds guides in process instead of the worker thread: one concern per
 * pull request, titled with its folder, such as `pr20`. `hold` keeps a
 * pull request's build running until its release is called. `started` and
 * `built` list the builds in the order they started and ended.
 */
function heldGuides() {
  const started: string[] = [];
  const built: string[] = [];
  const holds = new Map<string, Promise<void>>();
  const runtime: DeckGuideRuntime = {
    async build(input, signal) {
      const name = [...input.new.keys(), ...input.old.keys()][0]!.split(
        "/",
      )[0]!;
      started.push(name);
      await Promise.race([
        holds.get(name),
        new Promise((_, reject) =>
          signal.addEventListener("abort", () =>
            reject(new Error("Cancelled.")),
          ),
        ),
      ]);
      built.push(name);
      return [
        {
          id: "g1",
          title: name,
          rationale: "",
          hunkIds: parseDiff(input.diff).flatMap((file) =>
            file.hunks.map((hunk) => hunk.id),
          ),
        },
      ];
    },
    close: async () => {},
  };
  const hold = (name: string) => {
    let release!: () => void;
    holds.set(
      name,
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    stops.push(async () => release());
    return release;
  };
  return { runtime, hold, started, built };
}

/**
 * Review Deck's pipeline, loaded at run time: importing it by name would
 * type-check the vendored code with the API's stricter settings
 * (packages/review-deck/VENDORED.md).
 */
type Pipeline = {
  runPipeline(
    input: {
      title: string;
      description: string;
      diff: string;
      files: { get(path: string, side: "old" | "new"): Promise<string | null> };
    },
    config: unknown,
    deps: unknown,
  ): Promise<{ groups: GuideJobConcern[] }>;
  mergeConfig(): unknown;
  createPipelineDeps(): Promise<unknown>;
};
const pipelineEntry = "../../../packages/review-deck/pipeline.ts";
const loadPipeline = () =>
  import(new URL(pipelineEntry, import.meta.url).href) as Promise<Pipeline>;

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
      // The guide's own tests are below.
      guide: expect.objectContaining({ madeWith: "code" }),
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

/*
 * An Azure DevOps pull request (#780). The fake plugin answers what the Azure
 * DevOps plugin 2.3.0 answers for the changes below
 * (les-cabochons/ajour-plugins, plugins/azure-devops): the latest iteration's
 * changes against its common commit, and each file read by commit and path.
 * Review Deck reads the same changes in the Azure DevOps web page, and each
 * file by its blob id. Both must cut the same hunks.
 */

const AZURE_DEVOPS: TestCodeHost = {
  id: "azure_devops",
  displayName: "Azure DevOps",
  urlField: "organizationUrl",
  url: "https://dev.azure.com/contoso",
  repository: "Mercury/api",
};

/** The latest iteration's head, and the common commit it is compared with. */
const AZURE_HEAD = "9f1c2e7b4a0d3c5e8f6a1b2c3d4e5f60718293a4";
const AZURE_BASE = "2b7e151628aed2a6abf7158809cf4f3c762e7160";

const AZURE_LIMITS = lines(40);
const AZURE_BLOBS: Record<string, string> = {
  "4b825dc642cb6eb9a060e54bf8d69288fbee4904": AZURE_LIMITS,
  "8ab686eafeb1f44702738c8b0f24f2567c36da6d": AZURE_LIMITS.replace(
    "line 2\n",
    "line two\n",
  ).replace("line 39\n", "line thirty-nine\n"),
  e69de29bb2d1d6434b8b29ae775ad8c2e48c5391: "export const added = true;\n",
  "3b18e512dba79e4c8300dd08aeb37f8e728b8dad": "export const removed = true;\n",
  d670460b4b4aece5915caf5c68d12f560a9fe3e4:
    "export const moved = 1;\nexport const kept = 2;\n",
  "1f7391f92b6a3792204e07e99f71f643cc35e7e1":
    "export const moved = 3;\nexport const kept = 2;\n",
  f572d396fae9206628714fb2ce00f72e94f2258f: "# Read me\n",
  "5d308e1d060b0c387d452cf4747f89ecb9935851":
    "\u0089PNG\r\n\u001a\n\u0000\u0000",
  a8a940627d132695a9769df883f85992f0ff4a43: "\u0089PNG\r\n\u001a\n\u0000\u0001",
};

/** As `iterations/3/changes?$compareTo=0` lists them: `changeType` is a list of flags. */
const AZURE_CHANGES = [
  {
    changeTrackingId: 1,
    item: { gitObjectType: "tree", path: "/src", isFolder: true },
    changeType: "edit",
  },
  {
    changeTrackingId: 2,
    item: {
      objectId: "8ab686eafeb1f44702738c8b0f24f2567c36da6d",
      originalObjectId: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      gitObjectType: "blob",
      path: "/src/limits.ts",
    },
    changeType: "edit",
  },
  {
    changeTrackingId: 3,
    item: {
      objectId: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
      gitObjectType: "blob",
      path: "/src/new.ts",
    },
    changeType: "add",
  },
  {
    changeTrackingId: 4,
    item: {
      originalObjectId: "3b18e512dba79e4c8300dd08aeb37f8e728b8dad",
      gitObjectType: "blob",
      path: "/src/old.ts",
    },
    changeType: "delete",
  },
  {
    changeTrackingId: 5,
    item: {
      objectId: "1f7391f92b6a3792204e07e99f71f643cc35e7e1",
      originalObjectId: "d670460b4b4aece5915caf5c68d12f560a9fe3e4",
      gitObjectType: "blob",
      path: "/src/after.ts",
    },
    changeType: "edit, rename",
    originalPath: "/src/before.ts",
  },
  {
    changeTrackingId: 6,
    item: {
      objectId: "f572d396fae9206628714fb2ce00f72e94f2258f",
      originalObjectId: "f572d396fae9206628714fb2ce00f72e94f2258f",
      gitObjectType: "blob",
      path: "/docs/guide.md",
    },
    changeType: "rename",
    originalPath: "/docs/read me.md",
  },
  {
    changeTrackingId: 7,
    item: {
      objectId: "a8a940627d132695a9769df883f85992f0ff4a43",
      originalObjectId: "5d308e1d060b0c387d452cf4747f89ecb9935851",
      gitObjectType: "blob",
      path: "/assets/logo.png",
    },
    changeType: "edit",
  },
];

/** What the plugin answers for those changes: no folder, no line counted, nothing guessed binary. */
const AZURE_CONTENT = {
  headSha: AZURE_HEAD,
  baseSha: AZURE_BASE,
  files: [
    { path: "src/limits.ts", status: "modified" },
    { path: "src/new.ts", status: "added" },
    { path: "src/old.ts", status: "removed" },
    { path: "src/after.ts", previousPath: "src/before.ts", status: "renamed" },
    {
      path: "docs/guide.md",
      previousPath: "docs/read me.md",
      status: "renamed",
    },
    { path: "assets/logo.png", status: "modified" },
  ].map((file) => ({ ...file, additions: 0, deletions: 0, binary: false })),
};

/** The files the plugin reads through items, by `commit:path`: each change's blobs where they are. */
const AZURE_FILES = Object.fromEntries(
  AZURE_CHANGES.flatMap((change) => {
    const { objectId, originalObjectId } = change.item as {
      objectId?: string;
      originalObjectId?: string;
    };
    const path = change.item.path.slice(1);
    const basePath = change.originalPath?.slice(1) ?? path;
    return [
      ...(originalObjectId
        ? [[`${AZURE_BASE}:${basePath}`, AZURE_BLOBS[originalObjectId]!]]
        : []),
      ...(objectId ? [[`${AZURE_HEAD}:${path}`, AZURE_BLOBS[objectId]!]] : []),
    ];
  }),
);

const azureDevOpsSource = `
const CONTENT = ${JSON.stringify(AZURE_CONTENT)};
const FILES = ${JSON.stringify(AZURE_FILES)};
export async function validateConnection({ config }) {
  return { normalizedConfig: config, connectionSummary: {} };
}
export async function getPullRequestContent(connection, request) {
  if (request.repository !== "Mercury/api" || request.number !== 12) throw new Error("Azure DevOps could not find the pull request.");
  return CONTENT;
}
export async function getFileContent(connection, request) {
  const text = FILES[request.sha + ":" + request.path];
  if (text === undefined) return { kind: "missing" };
  if (text.includes("\\u0000")) return { kind: "binary" };
  return { kind: "text", content: text };
}
`;

/**
 * The hunks Review Deck cuts from the same changes in the Azure DevOps web
 * page (review-deck `extension/src/data/adoSource.ts` and
 * `review/engine.ts`): folders left out, an addition or deletion first,
 * then a rename, else an edit; each side read by its blob id, and a file
 * with a NUL on either side binary.
 */
function reviewDeckHunks() {
  const ADD = 1;
  const RENAME = 8;
  const DELETE = 16;
  const FLAGS: Record<string, number> = {
    add: ADD,
    edit: 2,
    rename: RENAME,
    delete: DELETE,
  };
  const changes = AZURE_CHANGES.filter((change) => !change.item.isFolder).map(
    (change) => {
      const flags = change.changeType
        .split(", ")
        .reduce((all, flag) => all | FLAGS[flag]!, 0);
      const changeType =
        flags & ADD
          ? ("add" as const)
          : flags & DELETE
            ? ("delete" as const)
            : flags & RENAME
              ? ("rename" as const)
              : ("edit" as const);
      const item = change.item as {
        objectId?: string;
        originalObjectId?: string;
      };
      return {
        path: change.item.path.replace(/^\//, ""),
        originalPath: change.originalPath?.replace(/^\//, ""),
        changeType,
        oldObjectId: changeType === "add" ? undefined : item.originalObjectId,
        newObjectId: changeType === "delete" ? undefined : item.objectId,
      };
    },
  );
  const contents = new Map<string, FileContents>(
    changes.map((change) => {
      const old = change.oldObjectId ? AZURE_BLOBS[change.oldObjectId]! : null;
      const next = change.newObjectId ? AZURE_BLOBS[change.newObjectId]! : null;
      const binary = [old, next].some((text) => text?.includes("\u0000"));
      return [change.path, { old, new: next, binary, tooLarge: false }];
    }),
  );
  return parseDiff(buildDiff(changes, contents)).flatMap((file) =>
    file.hunks.map((hunk) => [hunk.id, hunk.header]),
  );
}

describe("opening an Azure DevOps pull request in Deck", () => {
  it("gives the hunk ids Review Deck gives for the same iteration pair", async () => {
    const { open } = await startDeck(
      azureDevOpsSource,
      undefined,
      undefined,
      AZURE_DEVOPS,
    );

    const opened = await open(12);

    expect(opened.status).toBe(200);
    const served = (
      opened.body.files as { hunks: { id: string; header: string }[] }[]
    ).flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk.header]));
    expect(served.sort()).toEqual(reviewDeckHunks().sort());
    // A binary file and a file renamed without changes keep one hunk, with no header.
    expect(served.sort()).toEqual([
      ["assets/logo.png#0", ""],
      ["docs/guide.md#0", ""],
      ["src/after.ts#0", "@@ -1,2 +1,2 @@"],
      ["src/limits.ts#0", "@@ -1,5 +1,5 @@"],
      ["src/limits.ts#1", "@@ -36,5 +36,5 @@"],
      ["src/new.ts#0", "@@ -1,0 +1,1 @@"],
      ["src/old.ts#0", "@@ -1,1 +1,0 @@"],
    ]);
  });

  it("shows every file in path order, a rename at its previous path and a binary file without its lines", async () => {
    const { open, fileReads } = await startDeck(
      azureDevOpsSource,
      undefined,
      undefined,
      AZURE_DEVOPS,
    );

    const opened = await open(12);

    expect(opened.body).toMatchObject({
      headSha: AZURE_HEAD,
      baseSha: AZURE_BASE,
    });
    expect(
      (
        opened.body.files as {
          path: string;
          previousPath?: string;
          status: string;
          binary: boolean;
          hunks: unknown[];
        }[]
      ).map((file) => [
        file.path,
        file.previousPath ?? null,
        file.status,
        file.binary,
        file.hunks.length,
      ]),
    ).toEqual([
      ["assets/logo.png", null, "modified", true, 1],
      ["docs/guide.md", "docs/read me.md", "renamed", false, 1],
      ["src/after.ts", "src/before.ts", "renamed", false, 1],
      ["src/limits.ts", null, "modified", false, 2],
      ["src/new.ts", null, "added", false, 1],
      ["src/old.ts", null, "deleted", false, 1],
    ]);
    // Both versions of the edited, renamed and binary files, one of the added and deleted ones.
    expect(fileReads()).toBe(10);
  });
});

describe("the guide of a pull request opened in Deck", () => {
  it("is built by Review Deck's pipeline from the same diff, its concerns in reading order", async () => {
    const { api, open } = await startDeck();
    const text = (key: string) => {
      const content = FILES[key];
      return content === undefined || content === "binary" ? null : content;
    };
    const changes = [
      { path: "assets/logo.png", changeType: "edit" as const },
      { path: "src/api.ts", changeType: "edit" as const },
      {
        path: "src/moved.ts",
        originalPath: "src/before.ts",
        changeType: "rename" as const,
      },
      { path: "src/new.ts", changeType: "add" as const },
      { path: "src/old.ts", changeType: "delete" as const },
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
    const versions = (side: "base" | "head") =>
      new Map(
        Object.entries(FILES).flatMap(([key, content]) =>
          key.startsWith(`${side}:`) && content !== "binary"
            ? [[key.slice(side.length + 1), content] as const]
            : [],
        ),
      );
    const [old, head] = [versions("base"), versions("head")];
    const { runPipeline, mergeConfig, createPipelineDeps } =
      await loadPipeline();
    const expected = await runPipeline(
      {
        title: "",
        description: "",
        diff: buildDiff(changes, contents),
        files: {
          get: async (file, side) =>
            (side === "old" ? old : head).get(file) ?? null,
        },
      },
      mergeConfig(),
      await createPipelineDeps(),
    );

    const opened = await open();

    expect(opened.status).toBe(200);
    expect(opened.body.guide).toEqual({
      madeWith: "code",
      concerns: expected.groups.map((group) => ({
        id: group.id,
        title: group.title,
        rationale: group.rationale,
        hunkIds: group.hunkIds,
      })),
    });
    // Every hunk is in one concern.
    const hunkIds = (opened.body.files as { hunks: { id: string }[] }[])
      .flatMap((file) => file.hunks.map((hunk) => hunk.id))
      .sort();
    expect(
      (opened.body.guide.concerns as { hunkIds: string[] }[])
        .flatMap((concern) => concern.hunkIds)
        .sort(),
    ).toEqual(hunkIds);
    expect(
      api.events.find((event) => event.name === "deck.guide_build"),
    ).toMatchObject({
      kind: "job",
      outcome: "ok",
      deck: { priority: "open", concern_count: expected.groups.length },
    });
    expect(
      api.events.find(
        (event) => event.name === "deck.open" && event.kind === "request",
      ),
    ).toMatchObject({
      deck: { concern_count: expected.groups.length, guide_built: true },
    });
    // The guide's titles and paths are content: no event carries them.
    expect(JSON.stringify(api.events)).not.toContain("api.ts");
  });

  it("builds an opened pull request before the preloads, stopping the one running, which runs again after", async () => {
    const guides = heldGuides();
    const { api, open, preload } = await startDeck(undefined, guides.runtime);
    const releasePreload = guides.hold("pr20");

    // Pull request 20's build runs and holds; 21 and 22 wait behind it.
    await expect(preload(20, 21, 22)).resolves.toEqual({
      status: 202,
      body: { queued: 3 },
    });
    expect(guides.started).toEqual(["pr20"]);

    const answer = await open(23);

    expect(answer.status).toBe(200);
    expect(answer.body.guide.concerns[0].title).toBe("pr23");
    expect(guides.built).toEqual(["pr23"]);
    releasePreload();
    await expect.poll(() => guides.built.length).toBe(4);
    expect(guides.started).toEqual(["pr20", "pr23", "pr20", "pr21", "pr22"]);
    expect(guides.built).toEqual(["pr23", "pr20", "pr21", "pr22"]);
    expect(
      api.events
        .filter((event) => event.name === "deck.guide_build")
        .map((event) => ({
          outcome: event.outcome,
          reason: (event as { outcome_reason?: string }).outcome_reason,
          priority: (event as { deck?: { priority?: string } }).deck?.priority,
        })),
    ).toEqual([
      { outcome: "cancelled", reason: "preempted", priority: "preload" },
      { outcome: "ok", reason: undefined, priority: "open" },
      { outcome: "ok", reason: undefined, priority: "preload" },
      { outcome: "ok", reason: undefined, priority: "preload" },
      { outcome: "ok", reason: undefined, priority: "preload" },
    ]);
    expect(
      api.events.find(
        (event) => event.name === "deck.preload" && event.kind === "request",
      ),
    ).toMatchObject({
      outcome: "ok",
      deck: {
        pull_request_count: 3,
        queued_count: 3,
        file_read_count: 3,
        failed_count: 0,
      },
    });
  });

  it("moves a preloaded pull request's waiting build ahead when it opens, and reads none of its files again", async () => {
    const guides = heldGuides();
    const { api, open, preload, fileReads } = await startDeck(
      undefined,
      guides.runtime,
    );
    const releasePreload = guides.hold("pr20");
    await preload(20, 21, 22);
    expect(fileReads()).toBe(3);

    const answer = await open(22);

    expect(answer.status).toBe(200);
    expect(answer.body.guide.concerns[0].title).toBe("pr22");
    expect(fileReads()).toBe(3);
    releasePreload();
    await expect.poll(() => guides.built.length).toBe(3);
    expect(guides.built).toEqual(["pr22", "pr20", "pr21"]);
    expect(
      api.events.find(
        (event) => event.name === "deck.open" && event.kind === "request",
      ),
    ).toMatchObject({ deck: { preloaded: true, file_read_count: 0 } });
  });

  it("skips a pull request a preload can't read, and fails only when none could be read", async () => {
    const guides = heldGuides();
    const { api, preload } = await startDeck(undefined, guides.runtime);

    await expect(preload(404, 20)).resolves.toEqual({
      status: 202,
      body: { queued: 1 },
    });
    await expect(preload(404)).resolves.toEqual({
      status: 502,
      body: { error: "GitHub request failed (404): Not Found." },
    });
    expect(
      api.events.find(
        (event) => event.name === "deck.preload" && event.kind === "request",
      ),
    ).toMatchObject({ deck: { queued_count: 1, failed_count: 1 } });
  });

  it("shows the diff without a guide when the build takes too long, and builds it again on the next open", async () => {
    let calls = 0;
    const { api, open, fileReads } = await startDeck(
      undefined,
      {
        build: (input, signal) => {
          calls += 1;
          if (calls > 1) {
            return Promise.resolve([
              {
                id: "g1",
                title: "Built",
                rationale: "",
                hunkIds: parseDiff(input.diff).flatMap((file) =>
                  file.hunks.map((hunk) => hunk.id),
                ),
              },
            ]);
          }
          return new Promise((_, reject) =>
            signal.addEventListener("abort", () =>
              reject(new Error("Stopped.")),
            ),
          );
        },
        close: async () => {},
      },
      100,
    );

    const first = await open(20);
    expect(first.status).toBe(200);
    expect(first.body.guide).toBeNull();
    expect(
      api.events.find((event) => event.name === "deck.guide_build"),
    ).toMatchObject({ outcome: "timeout" });

    // A failed guide isn't kept: the next open reads and builds it again.
    const second = await open(20);
    expect(second.body.guide.concerns[0].title).toBe("Built");
    expect(fileReads()).toBe(2);
  });

  it("cuts a title or rationale longer than the guide allows, keeping the guide", async () => {
    const { open } = await startDeck(undefined, {
      build: async (input) => [
        {
          id: "g1",
          title: "t".repeat(600),
          rationale: "r".repeat(2_500),
          hunkIds: parseDiff(input.diff).flatMap((file) =>
            file.hunks.map((hunk) => hunk.id),
          ),
        },
      ],
      close: async () => {},
    });

    const opened = await open(20);

    expect(opened.body.guide.concerns[0].title).toHaveLength(500);
    expect(opened.body.guide.concerns[0].rationale).toHaveLength(2_000);
  });

  it("doesn't read a pull request kept at its head again, on screen or preloaded", async () => {
    const guides = heldGuides();
    const { open, preload, fileReads } = await startDeck(
      undefined,
      guides.runtime,
    );
    await open(20);
    await preload(21);
    expect(fileReads()).toBe(2);

    await expect(preload(20, 21)).resolves.toEqual({
      status: 202,
      body: { queued: 0 },
    });
    expect(fileReads()).toBe(2);
  });

  it("still answers the diff when the pipeline fails, without a guide", async () => {
    const { api, open } = await startDeck(undefined, {
      build: async () => {
        throw new Error("The pipeline broke.");
      },
      close: async () => {},
    });

    const opened = await open();

    expect(opened.status).toBe(200);
    expect(opened.body.files).toHaveLength(5);
    expect(opened.body.guide).toBeNull();
    expect(
      api.events.find((event) => event.name === "deck.guide_build"),
    ).toMatchObject({ outcome: "error" });
    expect(
      api.events.find(
        (event) => event.name === "deck.open" && event.kind === "request",
      ),
    ).toMatchObject({ outcome: "ok", deck: { guide_built: false } });
  });

  it("stops the guide build of a pull request replaced on screen", async () => {
    const guides = heldGuides();
    const { api, open } = await startDeck(undefined, guides.runtime);
    guides.hold("pr20");

    const first = open(20);
    await expect.poll(() => guides.started).toEqual(["pr20"]);
    const second = await open(21);

    await expect(first).resolves.toEqual({
      status: 409,
      body: { error: "Another pull request opened in Deck." },
    });
    expect(second.status).toBe(200);
    expect(guides.built).toEqual(["pr21"]);
    expect(
      api.events.find((event) => event.name === "deck.guide_build"),
    ).toMatchObject({ outcome: "cancelled", outcome_reason: "replaced" });
  });
});

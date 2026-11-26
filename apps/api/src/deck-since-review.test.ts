import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { parseDiff } from "../../../packages/review-deck/diff.ts";
import type { DeckGuideRuntime } from "./deck-guide-builds.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { apiRequest, startLocalApi } from "./test-support/local-api.ts";

/*
 * Changes since your review (#787): the Deck service compares the diff at
 * the head the user last reviewed with the diff on screen, and marks each
 * hunk on screen changed in the version it last changed in, or unchanged.
 * A hunk is unchanged when its added and removed lines are the same bytes,
 * wherever a rebase moved it. The code host is a fake GitHub plugin with
 * three pushes: v1, which the user reviewed, v2, and v3, a rebase onto a
 * base with five more lines at the top of the file.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`);
const text = (rows: string[]) => `${rows.join("\n")}\n`;
/** `rows` with row `at` (from 1) replaced. */
const change = (rows: string[], at: number, row: string) =>
  rows.map((value, index) => (index === at - 1 ? row : value));

const BASE_1 = lines(35);
// The target branch moved: five lines at the top push every hunk down.
const BASE_2 = [...["one", "two", "three", "four", "five"], ...BASE_1];
/** The pull request's changes A at line 5, B at line 15 and C at line 27 of the first base. */
const withChanges = (
  base: string[],
  shift: number,
  { b = "B", c }: { b?: string; c?: string },
) => {
  let rows = change(base, 5 + shift, "A");
  rows = change(rows, 15 + shift, b);
  return c ? change(rows, 27 + shift, c) : rows;
};

/** The file versions the fake code host holds: `sha:path`. */
const FILES: Record<string, string> = {
  "b1:src/app.ts": text(BASE_1),
  "h1:src/app.ts": text(withChanges(BASE_1, 0, {})),
  "h2:src/app.ts": text(withChanges(BASE_1, 0, { c: "C" })),
  "b2:src/app.ts": text(BASE_2),
  // Rebased: A moved five lines down, B changed, C moved.
  "h3:src/app.ts": text(withChanges(BASE_2, 5, { b: "B again", c: "C" })),
  "b1:src/other.ts": "export const a = 1;\n",
  "h1:src/other.ts": "export const a = 2;\n",
  "h2:src/other.ts": "export const a = 2;\n",
  "b2:src/other.ts": "export const a = 1;\n",
  "h3:src/other.ts": "export const a = 2;\n",
  "h3:src/new.ts": "export const fresh = true;\n",
  // The same line twice in the file: v1 changed the first, v3 the second too.
  ...Object.fromEntries(
    ["b1", "h1", "h2", "b2", "h3"].map((sha) => {
      let rows = change(change(lines(30), 5, "dup"), 25, "dup");
      if (sha.startsWith("h")) rows = change(rows, 5, "X");
      if (sha === "h3") rows = change(rows, 25, "X");
      return [`${sha}:src/twice.ts`, text(rows)];
    }),
  ),
};

const VERSIONS = [
  { number: 1, headSha: "h1", baseSha: "b1", pushedAt: 1_000, commits: [] },
  { number: 2, headSha: "h2", baseSha: "b1", pushedAt: 2_000, commits: [] },
  {
    number: 3,
    headSha: "h3",
    baseSha: "b2",
    pushedAt: 3_000,
    forced: true,
    commits: [],
  },
];

const pluginSource = `
const FILES = ${JSON.stringify(FILES)};
const VERSIONS = ${JSON.stringify(VERSIONS)};
export async function validateConnection({ config }) {
  return { normalizedConfig: config, connectionSummary: {} };
}
export async function getPullRequestContent() {
  return globalThis.deckContent ?? {
    headSha: "h3",
    baseSha: "b2",
    files: [
      { path: "src/app.ts", status: "modified", additions: 3, deletions: 3, binary: false },
      { path: "src/new.ts", status: "added", additions: 1, deletions: 0, binary: false },
      { path: "src/other.ts", status: "modified", additions: 1, deletions: 1, binary: false },
      { path: "src/twice.ts", status: "modified", additions: 2, deletions: 2, binary: false },
    ],
  };
}
export async function getPullRequestVersions() {
  return { versions: globalThis.deckVersions ?? VERSIONS };
}
export async function getFileContent(connection, request) {
  const content = (globalThis.deckFiles ?? FILES)[request.sha + ":" + request.path];
  return content === undefined ? { kind: "missing" } : { kind: "text", content };
}
`;

/** One concern holding every hunk, built in process instead of the worker thread. */
const oneConcern: DeckGuideRuntime = {
  async build(input) {
    return [
      {
        id: "g1",
        title: "Everything",
        rationale: "",
        hunkIds: parseDiff(input.diff).flatMap((file) =>
          file.hunks.map((hunk) => hunk.id),
        ),
      },
    ];
  },
  close: async () => {},
};

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  const fixtures = globalThis as {
    deckVersions?: unknown;
    deckFiles?: unknown;
    deckContent?: unknown;
  };
  delete fixtures.deckVersions;
  delete fixtures.deckFiles;
  delete fixtures.deckContent;
});

async function startDeck(source = pluginSource) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-since-"));
  stops.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const directory = path.join(root, "github");
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
  const launch = async () => {
    const started = await startLocalApi({
      pluginRuntime: new InProcessPluginRuntime(),
      vault: new MemorySecretVault(),
      allowDevelopmentPlugins: true,
      developmentPluginDirectories: [directory],
      deckGuideRuntime: oneConcern,
      statePath: path.join(root, "state.json"),
    });
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      await started.stop();
    };
    stops.unshift(stop);
    return { ...started, stop };
  };
  let api = await launch();
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
  const route = (name: string) =>
    `/api/deck/github/connections/${connectionId}/${name}`;
  const operations = (name: string) =>
    api.events.filter(
      (event) => event.name === name && event.kind === "plugin_operation",
    ).length;
  return {
    get api() {
      return api;
    },
    open: () =>
      apiRequest(api.baseUrl, route("open"), {
        repository: "acme/api",
        number: 7,
      }),
    sinceReview: (reviewedHead: string, head = "h3") =>
      apiRequest(api.baseUrl, route("since-review"), {
        repository: "acme/api",
        number: 7,
        head,
        reviewedHead,
      }),
    fileReads: () => operations("pull_request.load_file"),
    versionReads: () => operations("pull_request.load_versions"),
    async restart() {
      await api.stop();
      api = await launch();
    },
  };
}

describe("changes since your review in Deck", () => {
  it("marks each hunk changed in the version it last changed in, and leaves the hunks a rebase only moved unmarked", async () => {
    const deck = await startDeck();
    const opened = await deck.open();
    expect(opened.status).toBe(200);
    // The hunks on screen, at v3 against the new base.
    expect(
      opened.body.files.flatMap((file: { hunks: { id: string }[] }) =>
        file.hunks.map((hunk) => hunk.id),
      ),
    ).toEqual([
      "src/app.ts#0",
      "src/app.ts#1",
      "src/app.ts#2",
      "src/new.ts#0",
      "src/other.ts#0",
      "src/twice.ts#0",
      "src/twice.ts#1",
    ]);

    await expect(deck.sinceReview("h1")).resolves.toEqual({
      status: 200,
      body: {
        head: "h3",
        reviewedHead: "h1",
        version: 3,
        reviewedVersion: 1,
        changed: [
          // B changed in the rebase.
          { hunkId: "src/app.ts#1", version: 3 },
          // C came in v2, and the rebase only moved it.
          { hunkId: "src/app.ts#2", version: 2 },
          { hunkId: "src/new.ts#0", version: 3 },
          // The same change as the first copy, but new in v3.
          { hunkId: "src/twice.ts#1", version: 3 },
        ],
      },
    });
    expect(
      deck.api.events.find(
        (event) =>
          event.name === "deck.since_review" && event.kind === "request",
      ),
    ).toMatchObject({
      outcome: "ok",
      deck: { changed_count: 4, hunk_count: 7, cached: false },
    });
  });

  it("caches the answer per version pair, across a restart, and reads nothing again", async () => {
    const deck = await startDeck();
    await deck.open();
    const first = await deck.sinceReview("h1");
    const reads = deck.fileReads();
    expect(reads).toBeGreaterThan(0);

    await deck.restart();
    await deck.open();
    const readsAfterOpen = deck.fileReads();
    const versionReads = deck.versionReads();
    await expect(deck.sinceReview("h1")).resolves.toEqual(first);
    expect(deck.fileReads()).toBe(readsAfterOpen);
    expect(deck.versionReads()).toBe(versionReads);
    expect(
      deck.api.events.find(
        (event) =>
          event.name === "deck.since_review" && event.kind === "request",
      ),
    ).toMatchObject({ outcome: "ok", deck: { cached: true } });
  });

  it("compares another reviewed version as its own pair", async () => {
    const deck = await startDeck();
    await deck.open();
    await deck.sinceReview("h1");

    await expect(deck.sinceReview("h2")).resolves.toMatchObject({
      status: 200,
      body: {
        reviewedVersion: 2,
        changed: [
          { hunkId: "src/app.ts#1", version: 3 },
          { hunkId: "src/new.ts#0", version: 3 },
          { hunkId: "src/twice.ts#1", version: 3 },
        ],
      },
    });
  });

  it("says nothing changed when the version reviewed is the one on screen", async () => {
    const deck = await startDeck();
    await deck.open();
    const reads = deck.fileReads();

    await expect(deck.sinceReview("h3")).resolves.toMatchObject({
      status: 200,
      body: { version: 3, reviewedVersion: 3, changed: [] },
    });
    expect(deck.fileReads()).toBe(reads);
  });

  it("refuses a head it doesn't hold, and a reviewed head that is none of the versions", async () => {
    const deck = await startDeck();
    await expect(deck.sinceReview("h1")).resolves.toMatchObject({
      status: 409,
      body: { reason: "not_open" },
    });

    await deck.open();
    await expect(deck.sinceReview("gone")).resolves.toMatchObject({
      status: 409,
      body: { reason: "unknown_version" },
    });
  });

  it("says the code host doesn't offer versions when its plugin has none", async () => {
    const deck = await startDeck(
      pluginSource.replace(
        "export async function getPullRequestVersions",
        "async function notExported",
      ),
    );
    await deck.open();

    await expect(deck.sinceReview("h1")).resolves.toMatchObject({
      status: 404,
      body: { reason: "not_supported" },
    });
  });

  it("marks a file deleted since the review changed, though the version reviewed was never opened", async () => {
    // v1, which the user reviewed and never opened, changed the file; v2
    // deleted it. The diff on screen shows its deletion.
    Object.assign(globalThis, {
      deckFiles: {
        "b1:src/gone.ts": "export const a = 1;\n",
        "h1:src/gone.ts": "export const a = 2;\n",
      },
      deckVersions: [
        {
          number: 1,
          headSha: "h1",
          baseSha: "b1",
          pushedAt: 1_000,
          commits: [],
        },
        {
          number: 2,
          headSha: "h2",
          baseSha: "b1",
          pushedAt: 2_000,
          commits: [],
        },
      ],
      deckContent: {
        headSha: "h2",
        baseSha: "b1",
        files: [
          {
            path: "src/gone.ts",
            status: "removed",
            additions: 0,
            deletions: 1,
            binary: false,
          },
        ],
      },
    });
    const deck = await startDeck();
    expect((await deck.open()).status).toBe(200);

    await expect(deck.sinceReview("h1", "h2")).resolves.toMatchObject({
      status: 200,
      body: {
        version: 2,
        reviewedVersion: 1,
        changed: [{ hunkId: "src/gone.ts#0", version: 2 }],
      },
    });
  });

  it("marks a line changed when only its line ending or the file's final newline changed", async () => {
    // v1 ended each file's new line with a newline; v2 ends one with CRLF
    // and the other with no final newline.
    Object.assign(globalThis, {
      deckFiles: {
        "b1:src/crlf.ts": "old\n",
        "h1:src/crlf.ts": "new\n",
        "h2:src/crlf.ts": "new\r\n",
        "b1:src/eof.ts": "old\n",
        "h1:src/eof.ts": "new\n",
        "h2:src/eof.ts": "new",
        "b1:src/same.ts": "old\r\n",
        "h1:src/same.ts": "new\r\n",
        "h2:src/same.ts": "new\r\n",
      },
      deckVersions: [
        {
          number: 1,
          headSha: "h1",
          baseSha: "b1",
          pushedAt: 1_000,
          commits: [],
        },
        {
          number: 2,
          headSha: "h2",
          baseSha: "b1",
          pushedAt: 2_000,
          commits: [],
        },
      ],
      deckContent: {
        headSha: "h2",
        baseSha: "b1",
        files: ["src/crlf.ts", "src/eof.ts", "src/same.ts"].map((path) => ({
          path,
          status: "modified",
          additions: 1,
          deletions: 1,
          binary: false,
        })),
      },
    });
    const deck = await startDeck();
    expect((await deck.open()).status).toBe(200);

    await expect(deck.sinceReview("h1", "h2")).resolves.toMatchObject({
      status: 200,
      body: {
        changed: [
          { hunkId: "src/crlf.ts#0", version: 2 },
          { hunkId: "src/eof.ts#0", version: 2 },
        ],
      },
    });
  });
});

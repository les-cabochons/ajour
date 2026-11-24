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
  const files =
    request.number === 9 ? [{ path: "src/broken.ts", status: "modified" }]
    : request.number === 8 ? [{ path: "src/new.ts", status: "added" }]
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
              lines: [
                " line 1",
                "-line 2",
                "+line two",
                " line 3",
                " line 4",
                " line 5",
              ],
            },
            {
              id: "src/api.ts#1",
              header: "@@ -15,6 +15,6 @@",
              oldStart: 15,
              oldLines: 6,
              newStart: 15,
              newLines: 6,
              lines: [
                " line 15",
                " line 16",
                " line 17",
                "-line 18",
                "+line eighteen",
                " line 19",
                " line 20",
              ],
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
              lines: ["+export const a = 1;"],
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
              lines: ["-export const b = 2;"],
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

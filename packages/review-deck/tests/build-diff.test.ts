import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  buildDiff,
  createPipelineDeps,
  type FileChange,
  type FileContents,
  type FileProvider,
  mergeConfig,
  runPipeline,
} from "../pipeline.ts";

// Two files of Review Deck's fixture pull request `pr1` (upstream
// fixtures/sample-repo and fixtures/prs/pr1/files). The expected hunks are
// the ones `git diff` cut for upstream fixtures/prs/pr1/diff.patch, with
// git's default of 3 lines of context, and the ids are upstream hunks.json's.
const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/build-diff/${name}.txt`, import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");

const modified = (path: string, name: string): [FileChange, FileContents] => [
  { path, changeType: "edit" },
  {
    old: fixture(`${name}.base`),
    new: fixture(`${name}.head`),
    binary: false,
    tooLarge: false,
  },
];

const changes = [
  modified("src/config/index.ts", "config"),
  modified("src/http/client.ts", "client"),
];

function files(contents: Map<string, FileContents>): FileProvider {
  return {
    async get(path, side) {
      const entry = contents.get(path);
      return (side === "old" ? entry?.old : entry?.new) ?? null;
    },
  };
}

test("Given both versions of each changed file, then buildDiff cuts the hunks git cuts with 3 lines of context", () => {
  const contents = new Map(
    changes.map(([change, content]) => [change.path, content]),
  );
  const diff = buildDiff(
    changes.map(([change]) => change),
    contents,
  );

  expect(
    diff
      .split("\n")
      .filter((line) => line.startsWith("diff --git") || line.startsWith("@@")),
  ).toEqual([
    "diff --git a/src/config/index.ts b/src/config/index.ts",
    "@@ -3,6 +3,10 @@",
    "@@ -27,6 +31,7 @@",
    "diff --git a/src/http/client.ts b/src/http/client.ts",
    "@@ -1,5 +1,6 @@",
    "@@ -33,7 +34,15 @@",
    "@@ -59,3 +68,7 @@",
  ]);
});

test("Given a built diff, then the pipeline names its hunks path#index, as Review Deck does", async () => {
  const contents = new Map(
    changes.map(([change, content]) => [change.path, content]),
  );
  const diff = buildDiff(
    changes.map(([change]) => change),
    contents,
  );

  const result = await runPipeline(
    {
      title: "Add retry support to HttpClient",
      description: "",
      diff,
      files: files(contents),
    },
    mergeConfig(),
    await createPipelineDeps(),
  );

  expect([...result.hunks.keys()]).toEqual([
    "src/config/index.ts#0",
    "src/config/index.ts#1",
    "src/http/client.ts#0",
    "src/http/client.ts#1",
    "src/http/client.ts#2",
  ]);
  expect(result.groups.flatMap((group) => group.hunkIds).sort()).toEqual(
    [...result.hunks.keys()].sort(),
  );
});

test("Given an added, a deleted and a renamed file, then each gets the header Review Deck's diff parser reads", () => {
  const diff = buildDiff(
    [
      { path: "src/new.ts", changeType: "add" },
      { path: "src/old.ts", changeType: "delete" },
      {
        path: "src/moved.ts",
        originalPath: "src/before.ts",
        changeType: "rename",
      },
      { path: "assets/logo.png", changeType: "edit" },
    ],
    new Map<string, FileContents>([
      [
        "src/new.ts",
        {
          old: null,
          new: "export const a = 1;\n",
          binary: false,
          tooLarge: false,
        },
      ],
      [
        "src/old.ts",
        {
          old: "export const b = 2;\n",
          new: null,
          binary: false,
          tooLarge: false,
        },
      ],
      [
        "src/moved.ts",
        {
          old: "export const c = 3;\n",
          new: "export const c = 3;\n",
          binary: false,
          tooLarge: false,
        },
      ],
      [
        "assets/logo.png",
        { old: null, new: null, binary: true, tooLarge: false },
      ],
    ]),
  );

  expect(diff).toBe(
    [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -1,0 +1,1 @@",
      "+export const a = 1;",
      "diff --git a/src/old.ts b/src/old.ts",
      "deleted file mode 100644",
      "--- a/src/old.ts",
      "+++ /dev/null",
      "@@ -1,1 +1,0 @@",
      "-export const b = 2;",
      "diff --git a/src/before.ts b/src/moved.ts",
      "similarity index 100%",
      "rename from src/before.ts",
      "rename to src/moved.ts",
      "diff --git a/assets/logo.png b/assets/logo.png",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
      "",
    ].join("\n"),
  );
});

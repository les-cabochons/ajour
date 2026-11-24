import { describe, expect, it } from "vitest";
import {
  buildDiff,
  parseDiff,
  type FileChange,
  type FileContents,
} from "../../../packages/review-deck/diff.ts";
import type { CodeHostLinkedTicket } from "../../../packages/shared/code-host.ts";
import { summarizeGuide, type BuiltConcern } from "./deck-summary.ts";

/*
 * The summary's rules (#789), on diffs built the way Deck builds them: both
 * versions of each file through Review Deck's `buildDiff`.
 */

type Version = string | null;

/** A diff of `files`, each path with its base and head versions, in path order as Deck lists them. */
function diffOf(files: Record<string, [base: Version, head: Version]>) {
  const changes: FileChange[] = [];
  const contents = new Map<string, FileContents>();
  const sorted = Object.entries(files).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [path, [base, head]] of sorted) {
    changes.push({
      path,
      changeType: base === null ? "add" : head === null ? "delete" : "edit",
    });
    contents.set(path, {
      old: base,
      new: head,
      binary: false,
      tooLarge: false,
    });
  }
  return parseDiff(buildDiff(changes, contents));
}

/** One concern per file, in path order, or the concerns given by their paths. */
function concernsOf(
  files: ReturnType<typeof diffOf>,
  groups?: Record<string, string[]>,
): BuiltConcern[] {
  const byPath = (paths: string[]) =>
    files
      .filter((file) => paths.includes(file.path))
      .flatMap((file) => file.hunks.map((hunk) => hunk.id));
  if (groups) {
    return Object.entries(groups).map(([id, paths]) => ({
      id,
      title: id,
      rationale: "",
      hunkIds: byPath(paths),
    }));
  }
  return files.map((file, index) => ({
    id: `g${index + 1}`,
    title: file.path,
    rationale: "",
    hunkIds: file.hunks.map((hunk) => hunk.id),
  }));
}

const lines = (...text: string[]) => text.map((line) => `${line}\n`).join("");

const ticket: CodeHostLinkedTicket = {
  number: 482,
  repository: "acme/api",
  title: "Retries never stop on 410",
  body: "They should stop.",
  url: "https://github.com/acme/api/issues/482",
  state: "Open",
};

describe("the summary's problem", () => {
  const files = diffOf({ "src/retry.ts": ["a\n", "b\n"] });

  it("is the first linked ticket's title, and lists every ticket without its text", () => {
    const second = { ...ticket, number: 12, title: "Log the retries" };
    const { summary } = summarizeGuide(concernsOf(files), files, [
      ticket,
      second,
    ]);
    expect(summary.problem).toEqual({
      text: "Retries never stop on 410",
      source: "ticket",
      ticket: {
        number: 482,
        repository: "acme/api",
        title: "Retries never stop on 410",
        url: "https://github.com/acme/api/issues/482",
        state: "Open",
      },
    });
    expect(summary.tickets?.map((linked) => linked.number)).toEqual([482, 12]);
    expect(JSON.stringify(summary)).not.toContain("They should stop.");
  });

  it("is empty with no linked ticket, and says when the tickets couldn't be read", () => {
    expect(summarizeGuide(concernsOf(files), files, []).summary).toMatchObject({
      problem: null,
      tickets: [],
    });
    expect(
      summarizeGuide(concernsOf(files), files, null).summary,
    ).toMatchObject({ problem: null, tickets: null });
  });
});

describe("the kinds of change", () => {
  it("names tests, docs, dependencies and build on each concern, and their union on the summary", () => {
    const files = diffOf({
      "README.md": ["# Api\n", "# Api\n\nRetries stop.\n"],
      "pnpm-lock.yaml": ["a: 1\n", "a: 2\n"],
      ".github/workflows/ci.yml": ["on: push\n", "on: [push]\n"],
      "src/retry.ts": ["a\n", "b\n"],
      "tests/retry.test.ts": ["it(1)\n", "it(2)\n"],
    });
    const guide = summarizeGuide(
      concernsOf(files, {
        g1: ["src/retry.ts", "tests/retry.test.ts"],
        g2: ["README.md"],
        mechanical: ["pnpm-lock.yaml", ".github/workflows/ci.yml"],
      }),
      files,
      [],
    );
    expect(guide.concerns.map((concern) => concern.kinds)).toEqual([
      ["tests"],
      ["docs"],
      ["dependencies", "build"],
    ]);
    expect(guide.summary.kinds).toEqual([
      "tests",
      "docs",
      "dependencies",
      "build",
    ]);
  });

  it("reads a manifest hunk as dependencies when it changes a version, and as build otherwise", () => {
    const base = lines(
      "{",
      '  "name": "api",',
      '  "scripts": { "test": "vitest" },',
      ...Array.from({ length: 10 }, (_, index) => `  "k${index}": ${index},`),
      '  "dependencies": {',
      '    "zod": "^3.0.0"',
      "  }",
      "}",
    );
    const head = base
      .replace('"test": "vitest"', '"test": "vitest run"')
      .replace('"zod": "^3.0.0"', '"zod": "^4.0.0"');
    const files = diffOf({ "package.json": [base, head] });
    expect(files[0]!.hunks).toHaveLength(2);
    const guide = summarizeGuide(
      files[0]!.hunks.map((hunk) => ({
        id: hunk.id,
        title: "",
        rationale: "",
        hunkIds: [hunk.id],
      })),
      files,
      [],
    );
    expect(guide.concerns.map((concern) => concern.kinds)).toEqual([
      ["build"],
      ["dependencies"],
    ]);
  });

  it("leaves the code's own kinds to the agent", () => {
    const files = diffOf({ "src/retry.ts": ["a\n", "b\n"] });
    const guide = summarizeGuide(concernsOf(files), files, []);
    expect(guide.concerns[0]!.kinds).toEqual([]);
    expect(guide.summary.kinds).toEqual([]);
    expect(guide.summary.breaking).toEqual([]);
  });
});

describe("the risky areas", () => {
  it("names each area once, with its files and the hunks in it, from paths and added lines", () => {
    const files = diffOf({
      "db/migrations/0042_users.sql": [null, "CREATE TABLE users (id int);\n"],
      "src/authService.ts": ["a\n", "b\n"],
      "src/session/tokens.ts": ["a\n", "b\n"],
      "src/cleanup.ts": ["a\n", 'db.query("DELETE FROM jobs");\n'],
      "src/queue.ts": ["a\n", "const lock = new Mutex();\n"],
      "src/plain.ts": ["a\n", "b\n"],
      "pnpm-lock.yaml": ["a: 1\n", "a: 2\n"],
      "docs/security.md": ["a\n", "b\n"],
      "tests/auth.test.ts": ["a\n", "b\n"],
    });
    const { summary } = summarizeGuide(concernsOf(files), files, []);
    expect(summary.risks).toEqual([
      {
        id: "risk:migrations",
        text: "Migrations: db/migrations/0042_users.sql",
        hunkIds: ["db/migrations/0042_users.sql#0"],
      },
      {
        id: "risk:auth",
        text: "Auth and security: src/authService.ts and src/session/tokens.ts",
        hunkIds: ["src/authService.ts#0", "src/session/tokens.ts#0"],
      },
      {
        id: "risk:deletion",
        text: "Deletion: src/cleanup.ts",
        hunkIds: ["src/cleanup.ts#0"],
      },
      {
        id: "risk:concurrency",
        text: "Locking and concurrency: src/queue.ts",
        hunkIds: ["src/queue.ts#0"],
      },
    ]);
  });

  it("names three files, then counts the rest", () => {
    const files = diffOf(
      Object.fromEntries(
        Array.from({ length: 5 }, (_, index) => [
          `src/auth/${index}.ts`,
          ["a\n", "b\n"],
        ]),
      ),
    );
    const { summary } = summarizeGuide(concernsOf(files), files, []);
    expect(summary.risks.map((risk) => risk.text)).toEqual([
      "Auth and security: src/auth/0.ts, src/auth/1.ts, src/auth/2.ts and 2 more files",
    ]);
    expect(summary.risks[0]!.hunkIds).toHaveLength(5);
  });
});

describe("the test coverage", () => {
  it("names each concern's test files, and the code of a concern no test in the pull request covers", () => {
    const files = diffOf({
      "src/retry.ts": ["a\n", "b\n"],
      "src/retry.test.ts": ["a\n", "b\n"],
      "src/limits.ts": ["a\n", "b\n"],
      "tests/limits.test.ts": ["a\n", "b\n"],
      "src/billing.ts": ["a\n", "b\n"],
      "src/invoice.ts": ["a\n", "b\n"],
      "README.md": ["a\n", "b\n"],
    });
    const { summary } = summarizeGuide(
      concernsOf(files, {
        g1: ["src/retry.ts", "src/retry.test.ts"],
        // Its test is in another concern, under the module's name.
        g2: ["src/limits.ts"],
        g3: ["tests/limits.test.ts"],
        g4: ["src/billing.ts", "src/invoice.ts"],
        g5: ["README.md"],
      }),
      files,
      [],
    );
    expect(summary.tests).toEqual([
      {
        id: "tests:g1",
        text: "Tested in src/retry.test.ts",
        hunkIds: ["src/retry.test.ts#0"],
        concernId: "g1",
      },
      {
        id: "tests:g3",
        text: "Tested in tests/limits.test.ts",
        hunkIds: ["tests/limits.test.ts#0"],
        concernId: "g3",
      },
    ]);
    expect(summary.untested).toEqual([
      {
        id: "untested:g4",
        text: "No test for src/billing.ts and src/invoice.ts",
        hunkIds: ["src/billing.ts#0", "src/invoice.ts#0"],
        concernId: "g4",
      },
    ]);
  });
});

describe("the leftovers", () => {
  it("lists each TODO, FIXME, debug output, commented-out code and skipped test the pull request adds", () => {
    const files = diffOf({
      "src/retry.ts": [
        lines("export function retry() {", "  return 1;", "}"),
        lines(
          "export function retry() {",
          "  // TODO: stop on 410",
          "  console.log(attempt);",
          "  // const backoff = 2 ** attempt;",
          "  // sleep(backoff);",
          "  // Retries stop when the server says the resource is gone.",
          "  return 1;",
          "}",
        ),
      ],
      "app/limits.py": [
        "def limit():\n    return 1\n",
        "def limit():\n    # FIXME use the tenant\n    breakpoint()\n    return 1\n",
      ],
      "src/retry.test.ts": [
        lines('it("retries", () => {});'),
        lines('it("retries", () => {});', 'it.skip("stops on 410", () => {});'),
      ],
      "docs/retries.md": [
        "# Retries\n",
        "# Retries\n\nTODO: explain backoff.\n",
      ],
      "src/strings.ts": ["a\n", 'const label = "TODO list";\n'],
    });
    const { summary } = summarizeGuide(concernsOf(files), files, []);
    expect(summary.leftovers.map((leftover) => leftover.text)).toEqual([
      "FIXME in app/limits.py:2: # FIXME use the tenant",
      "Debug output in app/limits.py:3: breakpoint()",
      "TODO in docs/retries.md:3: TODO: explain backoff.",
      'Skipped test in src/retry.test.ts:2: it.skip("stops on 410", () => {});',
      "TODO in src/retry.ts:2: // TODO: stop on 410",
      "Debug output in src/retry.ts:3: console.log(attempt);",
      "Commented-out code in src/retry.ts:4: // const backoff = 2 ** attempt;",
    ]);
    expect(summary.leftovers[4]).toEqual({
      id: "leftover:4",
      text: "TODO in src/retry.ts:2: // TODO: stop on 410",
      hunkIds: ["src/retry.ts#0"],
    });
  });

  it("doesn't count a line the pull request only moves", () => {
    const files = diffOf({
      "src/a.ts": [
        "// TODO: stop on 410\nexport const a = 1;\n",
        "export const a = 1;\n",
      ],
      "src/b.ts": [
        "export const b = 1;\n",
        "// TODO: stop on 410\nexport const b = 1;\n",
      ],
    });
    const { summary } = summarizeGuide(concernsOf(files), files, []);
    expect(summary.leftovers).toEqual([]);
  });

  it("lists 50, then counts the rest on one line with their hunks", () => {
    const files = diffOf({
      "src/many.ts": [
        null,
        Array.from({ length: 60 }, (_, index) => `// TODO ${index}\n`).join(""),
      ],
    });
    const { summary } = summarizeGuide(concernsOf(files), files, []);
    expect(summary.leftovers).toHaveLength(51);
    expect(summary.leftovers.at(-1)).toEqual({
      id: "leftover:more",
      text: "10 more leftovers",
      hunkIds: ["src/many.ts#0"],
    });
  });
});

it("finds nothing in a pull request without any of it", () => {
  const files = diffOf({ "src/retry.ts": ["a\n", "b\n"] });
  const { summary } = summarizeGuide([], files, []);
  expect(summary).toEqual({
    problem: null,
    tickets: [],
    kinds: [],
    breaking: [],
    risks: [],
    tests: [],
    untested: [],
    leftovers: [],
  });
});

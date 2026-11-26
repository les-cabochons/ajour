import { describe, expect, it } from "vitest";
import {
  buildDiff,
  parseDiff,
  type FileChange,
  type FileContents,
} from "../diff.ts";
import { summarizeRules, type GroupedConcern } from "../summary.ts";

/*
 * Ajour's summary rules (les-cabochons/ajour#789), on diffs built the way
 * Deck builds them: both versions of each file through `buildDiff`, the
 * files in path order.
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
): GroupedConcern[] {
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

describe("the kinds of change", () => {
  it("names tests, docs, dependencies and build on each concern, and their union on the summary", () => {
    const files = diffOf({
      "README.md": ["# Api\n", "# Api\n\nRetries stop.\n"],
      "pnpm-lock.yaml": ["a: 1\n", "a: 2\n"],
      ".github/workflows/ci.yml": ["on: push\n", "on: [push]\n"],
      "src/retry.ts": ["a\n", "b\n"],
      "tests/retry.test.ts": ["it(1)\n", "it(2)\n"],
    });
    const guide = summarizeRules(
      files,
      concernsOf(files, {
        g1: ["src/retry.ts", "tests/retry.test.ts"],
        g2: ["README.md"],
        mechanical: ["pnpm-lock.yaml", ".github/workflows/ci.yml"],
      }),
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
    const guide = summarizeRules(
      files,
      files[0]!.hunks.map((hunk) => ({
        id: hunk.id,
        title: "",
        rationale: "",
        hunkIds: [hunk.id],
      })),
    );
    expect(guide.concerns.map((concern) => concern.kinds)).toEqual([
      ["build"],
      ["dependencies"],
    ]);
  });

  it("leaves the code's own kinds to the agent", () => {
    const files = diffOf({ "src/retry.ts": ["a\n", "b\n"] });
    const guide = summarizeRules(files, concernsOf(files));
    expect(guide.concerns[0]!.kinds).toEqual([]);
    expect(guide.summary.kinds).toEqual([]);
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
    const { summary } = summarizeRules(files, concernsOf(files));
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
    const { summary } = summarizeRules(files, concernsOf(files));
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
    const { summary } = summarizeRules(
      files,
      concernsOf(files, {
        g1: ["src/retry.ts", "src/retry.test.ts"],
        // Its test is in another concern, under the module's name.
        g2: ["src/limits.ts"],
        g3: ["tests/limits.test.ts"],
        g4: ["src/billing.ts", "src/invoice.ts"],
        g5: ["README.md"],
      }),
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
    const { summary } = summarizeRules(files, concernsOf(files));
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
    const { summary } = summarizeRules(files, concernsOf(files));
    expect(summary.leftovers).toEqual([]);
  });

  it("lists 50, then counts the rest on one line with their hunks", () => {
    const files = diffOf({
      "src/many.ts": [
        null,
        Array.from({ length: 60 }, (_, index) => `// TODO ${index}\n`).join(""),
      ],
    });
    const { summary } = summarizeRules(files, concernsOf(files));
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
  const { summary } = summarizeRules(files, []);
  expect(summary).toEqual({
    kinds: [],
    risks: [],
    tests: [],
    untested: [],
    leftovers: [],
  });
});

describe("what isn't a summary line", () => {
  it("doesn't take comment threads, agent sessions or design tokens for risky areas", () => {
    const files = diffOf({
      "src/review-threads.ts": ["a\n", "b\n"],
      "src/agent-sessions.ts": ["a\n", "b\n"],
      "src/styles/tokens.css": ["a\n", "b\n"],
      "assets/delete-icon.svg": ["<svg/>\n", "<svg />\n"],
      "db/migrations/0042_users.sql": [null, "CREATE TABLE users (id int);\n"],
    });
    const { summary } = summarizeRules(files, concernsOf(files));
    // A migration is risky whatever its kind of file.
    expect(summary.risks.map((risk) => risk.id)).toEqual(["risk:migrations"]);
  });

  it("doesn't take prose that names a TODO for one, in docs", () => {
    const files = diffOf({
      "docs/leftovers.md": [
        "# Leftovers\n",
        "# Leftovers\n\nThe summary lists TODO and FIXME lines.\n\n- TODO: say which.\n<!-- FIXME the link -->\n",
      ],
    });
    const { summary } = summarizeRules(files, concernsOf(files));
    expect(summary.leftovers.map((leftover) => leftover.text)).toEqual([
      "TODO in docs/leftovers.md:5: - TODO: say which.",
      "FIXME in docs/leftovers.md:6: <!-- FIXME the link -->",
    ]);
  });

  it("finds commented-out Python, which ends without a semicolon", () => {
    const files = diffOf({
      "app/limits.py": [
        "def limit():\n    return 1\n",
        "def limit():\n    # limit = tenant.limit()\n    # log(limit)\n    # Limits come from the tenant.\n    return 1\n",
      ],
    });
    const { summary } = summarizeRules(files, concernsOf(files));
    expect(summary.leftovers.map((leftover) => leftover.text)).toEqual([
      "Commented-out code in app/limits.py:2: # limit = tenant.limit()",
    ]);
  });
});

describe("the review findings on the rules (les-cabochons/ajour#919)", () => {
  const leftoverTexts = (files: ReturnType<typeof diffOf>) =>
    summarizeRules(files, concernsOf(files)).summary.leftovers.map(
      (leftover) => leftover.text,
    );

  it("finds code commented out in a block comment, on one line or inside the block", () => {
    const files = diffOf({
      "src/legacy.ts": [
        "export const a = 1;\n",
        lines(
          "export const a = 1;",
          "/* const obsolete = 1; */",
          "/* The value the server sent. */",
          "/**",
          " * Retries stop on 410.",
          " * @param attempt the attempt",
          " */",
          "/*",
          " * oldCall(attempt);",
          " */",
        ),
      ],
    });
    expect(leftoverTexts(files)).toEqual([
      "Commented-out code in src/legacy.ts:2: /* const obsolete = 1; */",
      "Commented-out code in src/legacy.ts:9: * oldCall(attempt);",
    ]);
  });

  it("finds commented-out Go, Kotlin and Swift, which end without a semicolon", () => {
    const files = diffOf({
      "cmd/retry.go": [
        "package main\n",
        lines(
          "package main",
          "// oldCall()",
          "",
          "// x := compute(y)",
          "",
          "// Retry stops on 410 (the resource is gone).",
          "// let me explain the backoff",
        ),
      ],
      "app/Limits.kt": [
        "package app\n",
        lines(
          "package app",
          "// val oldValue = 1",
          "",
          "// fun limit(tenant: Tenant) {",
          "",
          "// Limits come from the tenant.",
        ),
      ],
      "app/Limits.swift": [
        "import Foundation\n",
        lines(
          "import Foundation",
          "// let limit: Int = 3",
          "",
          "// var total = limit * 2",
        ),
      ],
    });
    expect(leftoverTexts(files)).toEqual([
      "Commented-out code in app/Limits.kt:2: // val oldValue = 1",
      "Commented-out code in app/Limits.kt:4: // fun limit(tenant: Tenant) {",
      "Commented-out code in app/Limits.swift:2: // let limit: Int = 3",
      "Commented-out code in app/Limits.swift:4: // var total = limit * 2",
      "Commented-out code in cmd/retry.go:2: // oldCall()",
      "Commented-out code in cmd/retry.go:4: // x := compute(y)",
    ]);
  });

  it.each([
    [
      "pytest",
      "tests/test_limits.py",
      '@pytest.mark.skipif(True, reason="disabled")',
    ],
    ["pytest", "tests/test_limits.py", "@pytest.mark.skip"],
    [
      "pytest",
      "tests/test_limits.py",
      '@pytest.mark.xfail(run=False, reason="hangs")',
    ],
    [
      "unittest",
      "tests/test_limits.py",
      '@unittest.skipIf(sys.platform == "win32", "posix")',
    ],
    ["Jest and Vitest", "src/limits.test.ts", 'it.skip("stops", () => {});'],
    [
      "Jest and Vitest",
      "src/limits.test.ts",
      'describe.skip("limits", () => {});',
    ],
    ["Jest and Vitest", "src/limits.test.ts", 'test.skip("stops", () => {});'],
    ["Jest and Vitest", "src/limits.test.ts", 'xit("stops", () => {});'],
    ["Jest and Vitest", "src/limits.test.ts", 'xdescribe("limits", () => {});'],
    [
      "Vitest",
      "src/limits.test.ts",
      'test.skipIf(isWindows)("stops", () => {});',
    ],
    [
      "JUnit",
      "src/test/java/app/LimitsTest.java",
      '@Disabled("until the tenant API ships")',
    ],
    ["JUnit", "src/test/java/app/LimitsTest.java", "@Ignore"],
    ["Go", "app/limits_test.go", '  t.Skip("needs a database")'],
  ])("finds a %s skipped test: %s, %s", (_framework, path, skipped) => {
    const files = diffOf({ [path]: [lines("a"), lines("a", skipped)] });
    expect(leftoverTexts(files)).toEqual([
      `Skipped test in ${path}:2: ${skipped.trim()}`,
    ]);
  });

  it("finds deletion and locking in an SQL file", () => {
    const files = diffOf({
      "db/cleanup.sql": [null, lines("DELETE FROM users;")],
      "db/reports.sql": [null, lines("SELECT * FROM jobs FOR UPDATE;")],
      "db/views.sql": [null, lines("SELECT * FROM users;")],
    });
    const { summary } = summarizeRules(files, concernsOf(files));
    expect(summary.risks).toEqual([
      {
        id: "risk:deletion",
        text: "Deletion: db/cleanup.sql",
        hunkIds: ["db/cleanup.sql#0"],
      },
      {
        id: "risk:concurrency",
        text: "Locking and concurrency: db/reports.sql",
        hunkIds: ["db/reports.sql#0"],
      },
    ]);
  });

  it("doesn't take debug output quoted in a string for debug output", () => {
    const files = diffOf({
      "src/example.ts": [
        lines("export const a = 1;"),
        lines(
          "export const a = 1;",
          'const example = "console.log(value)";',
          "const other = 'debugger';",
          "const template = `print_r(${value})`;",
          'console.log("value");',
        ),
      ],
    });
    expect(leftoverTexts(files)).toEqual([
      'Debug output in src/example.ts:5: console.log("value");',
    ]);
  });

  it("doesn't take a semicolon-free statement in a comment for code in a language that ends with semicolons", () => {
    const files = diffOf({
      "src/retry.ts": [
        "export const a = 1;\n",
        lines("export const a = 1;", "// retry()", "", "// val is the value"),
      ],
    });
    expect(leftoverTexts(files)).toEqual([]);
  });

  it("doesn't take a line that starts with `*` outside a block comment for a comment", () => {
    const files = diffOf({
      "src/swap.rs": [
        lines("fn main() {}"),
        lines(
          "fn main() {}",
          "fn set(value: &mut i32, next: i32) {",
          "    *value = next;",
          "}",
        ),
      ],
    });
    expect(leftoverTexts(files)).toEqual([]);
  });

  it("finds debug output in a template literal's interpolation", () => {
    const files = diffOf({
      "src/example.ts": [
        lines("export const a = 1;"),
        lines(
          "export const a = 1;",
          "const text = `value: ${console.log(value)}`;",
        ),
      ],
    });
    expect(leftoverTexts(files)).toEqual([
      "Debug output in src/example.ts:2: const text = `value: ${console.log(value)}`;",
    ]);
  });

  it("doesn't take an escaped interpolation, or debug output quoted inside one, for debug output", () => {
    const files = diffOf({
      "src/example.ts": [
        lines("export const a = 1;"),
        lines(
          "export const a = 1;",
          "const text = `literal \\${console.log(value)}`;",
          'const other = `value ${render("console.log(value)")}`;',
        ),
      ],
    });
    expect(leftoverTexts(files)).toEqual([]);
  });

  it("finds commented-out Lua, whose comments start with --", () => {
    const files = diffOf({
      "src/retry.lua": [
        lines("local M = {}"),
        lines("local M = {}", "-- oldCall()", "", "-- Retries stop on 410."),
      ],
    });
    expect(leftoverTexts(files)).toEqual([
      "Commented-out code in src/retry.lua:2: -- oldCall()",
    ]);
  });

  it("doesn't take an SQL comment for a risky line, but finds a down migration's drop", () => {
    const files = diffOf({
      "db/report.sql": [
        null,
        lines(
          "-- DELETE FROM users is intentionally forbidden.",
          "/*",
          "  DELETE FROM users is forbidden here too.",
          "*/",
          "/* DELETE FROM users; */ SELECT * FROM users;",
        ),
      ],
      "db/migrations/0002_users.down.sql": [
        null,
        lines("-- Undo 0002.", "DROP TABLE users;"),
      ],
    });
    const { summary } = summarizeRules(files, concernsOf(files));
    expect(summary.risks).toEqual([
      {
        id: "risk:migrations",
        text: "Migrations: db/migrations/0002_users.down.sql",
        hunkIds: ["db/migrations/0002_users.down.sql#0"],
      },
      {
        id: "risk:deletion",
        text: "Deletion: db/migrations/0002_users.down.sql",
        hunkIds: ["db/migrations/0002_users.down.sql#0"],
      },
    ]);
  });

  it("doesn't take a pytest xfail that still runs for a skipped test", () => {
    const files = diffOf({
      "tests/test_limits.py": [
        lines("a"),
        lines("a", '@pytest.mark.xfail(reason="known bug")'),
      ],
    });
    expect(leftoverTexts(files)).toEqual([]);
  });
});

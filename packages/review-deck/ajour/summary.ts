import { isTestPath, logicalModule } from "../core/paths.ts";
import type { DiffLine, FileDiff, Hunk } from "../core/types.ts";

/*
 * Ajour's summary rules (les-cabochons/ajour#789, from #662), run in the
 * guide worker right after the pipeline groups the hunks: the kinds of
 * change rules can tell (tests, docs, dependencies, build) on each concern,
 * risky areas, test coverage per concern and the leftovers the pull request
 * adds. Every line names the hunks it is about. They read only the diff's
 * changed lines and paths, and never guess: a line they can't place stays
 * out. The local API adds the linked tickets, and the agent's guide run the
 * other kinds and the breaking changes (#794), in the same fields.
 */

/** The kinds of change the rules find, in the order Deck lists every kind. */
export type RuleKind = "tests" | "docs" | "dependencies" | "build";
const RULE_KINDS: readonly RuleKind[] = [
  "tests",
  "docs",
  "dependencies",
  "build",
];

/** One line of the summary. Its id is stable for one diff, so a later ask can anchor to it. */
export interface RuleLine {
  id: string;
  text: string;
  /** In the diff's order. */
  hunkIds: string[];
  /** The concern a test coverage line is about. */
  concernId?: string;
}

/** A concern as the pipeline grouped it. */
export interface GroupedConcern {
  id: string;
  title: string;
  rationale: string;
  hunkIds: string[];
}

/** A concern with the kinds the rules found in its hunks. */
export interface RuleConcern extends GroupedConcern {
  kinds: RuleKind[];
}

/** The summary's lines the rules write. */
export interface RuleSummary {
  /** The union of the concerns' kinds. */
  kinds: RuleKind[];
  risks: RuleLine[];
  tests: RuleLine[];
  untested: RuleLine[];
  leftovers: RuleLine[];
}

/** The most paths a line names before "and n more". */
const PATHS_NAMED = 3;
/** The most leftovers listed one by one; the rest share one last line. */
const LEFTOVERS_LISTED = 50;
/** The longest piece of a line a leftover quotes. */
const QUOTE_MAX = 120;
const TEXT_MAX = 500;

/** What a changed file is, for its concern's kinds and the test coverage. */
type FileClass = "dependencies" | "build" | "tests" | "docs" | "code" | "other";

const basenameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const extensionOf = (path: string) => {
  const name = basenameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "cargo.lock",
  "go.sum",
  "go.mod",
  "gemfile",
  "gemfile.lock",
  "poetry.lock",
  "pipfile",
  "pipfile.lock",
  "uv.lock",
  "composer.lock",
  "packages.lock.json",
  "packages.config",
  "directory.packages.props",
  "gradle.lockfile",
  "mix.lock",
  "pubspec.lock",
  "podfile",
  "podfile.lock",
  "flake.lock",
]);
const REQUIREMENTS = /^(requirements|constraints)([-_.][\w.-]+)?\.(txt|in)$/;

/**
 * Manifests that hold both dependencies and build settings: a hunk that
 * changes a dependency's line is about dependencies, any other about the build.
 */
const MIXED_MANIFESTS = new Set([
  "package.json",
  "composer.json",
  "cargo.toml",
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);
const MIXED_MANIFEST_EXTENSIONS = new Set(["csproj", "fsproj", "vbproj"]);

/** A changed line of a manifest that names a dependency and its version. */
const DEPENDENCY_LINES = [
  // package.json, composer.json: "name": "^1.2.3", "workspace:*", "npm:…".
  /^\s*"(?!version"|name"|description"|main"|module"|types"|type"|license"|packageManager")[^"]+"\s*:\s*"(?:[~^<>=]|\d|\*|workspace:|npm:|file:|link:|git|https?:|latest)/,
  // Cargo.toml, pyproject.toml: name = "1.2" or name = { version = … }.
  /^\s*(?!version\b|name\b|edition\b|description\b)[\w.-]+\s*=\s*(?:\{|"[~^<>=*\d])/,
  // pyproject.toml lists: "requests>=2".
  /^\s*"[A-Za-z0-9_.[\]-]+\s*(?:[<>=!~]=?|@)/,
  /<(?:PackageReference|PackageVersion|dependency)\b/,
  /<(?:artifactId|groupId)>/,
  /^\s*(?:implementation|api|compileOnly|runtimeOnly|testImplementation|kapt|ksp)\b/,
];

const BUILD_NAMES = new Set([
  "dockerfile",
  ".dockerignore",
  "makefile",
  "justfile",
  "cmakelists.txt",
  "meson.build",
  "build",
  "build.bazel",
  "workspace",
  "jenkinsfile",
  ".gitlab-ci.yml",
  ".travis.yml",
  "appveyor.yml",
  "bitbucket-pipelines.yml",
  "turbo.json",
  "nx.json",
  "lerna.json",
  "rush.json",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".tool-versions",
  "global.json",
  "directory.build.props",
  "directory.build.targets",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
  "setup.cfg",
  "tox.ini",
  "build.rs",
]);
const BUILD_PATHS = [
  /(^|\/)\.github\/(workflows|actions)\//,
  /(^|\/)\.(circleci|buildkite)\//,
  /(^|\/)gradle\/wrapper\//,
  /(^|\/)azure-pipelines[^/]*\.ya?ml$/,
  /(^|\/)(docker-)?compose[^/]*\.ya?ml$/,
  /(^|\/)[^/]*\.dockerfile$/,
  /(^|\/)dockerfile\.[^/]+$/,
  /(^|\/)(tsconfig|jsconfig)[^/]*\.json$/,
  /(^|\/)(vite|vitest|webpack|rollup|esbuild|tsup|babel|electron-builder|playwright|jest|eslint|prettier|postcss|tailwind)\.config\.[^/]+$/,
  /(^|\/)\.(babelrc|eslintrc|prettierrc)[^/]*$/,
  /\.(mk|cmake|bzl|sln)$/,
];

const DOC_EXTENSIONS = new Set([
  "md",
  "mdx",
  "markdown",
  "rst",
  "adoc",
  "asciidoc",
  "txt",
]);
const DOC_NAMES =
  /^(readme|changelog|changes|history|license|licence|contributing|authors|notice|security|code_of_conduct)(\.|$)/;

/** Extensions of the files rules read as code: the pipeline's languages and a few more. */
const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "pyi",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "swift",
  "cs",
  "fs",
  "vb",
  "rb",
  "php",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hh",
  "hpp",
  "hxx",
  "m",
  "mm",
  "dart",
  "ex",
  "exs",
  "erl",
  "clj",
  "lua",
  "vue",
  "svelte",
  "sh",
  "bash",
  "zsh",
  "ps1",
]);
const HASH_COMMENTS = new Set([
  "py",
  "pyi",
  "rb",
  "ex",
  "exs",
  "sh",
  "bash",
  "zsh",
  "ps1",
]);

function classify(file: FileDiff): FileClass {
  const path = file.path;
  const name = basenameOf(path).toLowerCase();
  const lower = path.toLowerCase();
  if (LOCKFILES.has(name) || REQUIREMENTS.test(name)) return "dependencies";
  if (BUILD_NAMES.has(name) || BUILD_PATHS.some((rule) => rule.test(lower))) {
    return "build";
  }
  if (isTestPath(path)) return "tests";
  if (DOC_EXTENSIONS.has(extensionOf(path)) || DOC_NAMES.test(name)) {
    return "docs";
  }
  if (path.endsWith(".d.ts") || /\.min\.[cm]?js$/.test(lower)) return "other";
  if (CODE_EXTENSIONS.has(extensionOf(path))) return "code";
  return "other";
}

const isMixedManifest = (path: string) =>
  MIXED_MANIFESTS.has(basenameOf(path).toLowerCase()) ||
  MIXED_MANIFEST_EXTENSIONS.has(extensionOf(path));

const changedLines = (hunk: Hunk) =>
  hunk.lines.filter((line) => line.kind !== "ctx");

/** A hunk's kind of change from its path, and for a mixed manifest from its lines. */
function hunkKind(
  file: FileDiff,
  fileClass: FileClass,
  hunk: Hunk,
): RuleKind | undefined {
  if (fileClass === "dependencies" || fileClass === "tests") return fileClass;
  if (isMixedManifest(file.path)) {
    return changedLines(hunk).some((changed) =>
      DEPENDENCY_LINES.some((rule) => rule.test(changed.text)),
    )
      ? "dependencies"
      : "build";
  }
  if (fileClass === "build" || fileClass === "docs") return fileClass;
  return undefined;
}

/**
 * Risky areas are in the code and its build: never in tests, docs, lockfiles
 * or assets. A migration may be any file, such as a `.sql` one, and an
 * SQL file's lines may also be about deletion or locking.
 */
const MAY_BE_RISKY: ReadonlySet<FileClass> = new Set(["code", "build"]);

/* Risky areas. A hunk is in one when its path's words name it, or one of its added lines does. */

/** A path's words, in lower case: `src/authService.ts` gives src, auth, service, ts. */
function pathWords(path: string) {
  return path
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

interface RiskRule {
  id: string;
  label: string;
  words?: ReadonlySet<string>;
  path?: RegExp;
  /** Added lines that put a hunk in the area, whatever its path. */
  lines?: RegExp;
  /** It applies to a file of any kind but tests, docs and lockfiles. */
  anyFile?: boolean;
  /** It applies to an SQL file, which is no code file. */
  sql?: boolean;
}

const RISKS: readonly RiskRule[] = [
  {
    id: "migrations",
    label: "Migrations",
    words: new Set([
      "migration",
      "migrations",
      "migrate",
      "alembic",
      "flyway",
      "liquibase",
    ]),
    path: /(^|\/)(schema\.prisma|schema\.rb|structure\.sql)$/,
    anyFile: true,
    lines: /^\s*(?:ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX))\b/i,
  },
  {
    id: "auth",
    label: "Auth and security",
    words: new Set([
      "auth",
      "authn",
      "authz",
      "authentication",
      "authorization",
      "authorize",
      "oauth",
      "oauth2",
      "oidc",
      "saml",
      "sso",
      "login",
      "logout",
      "signin",
      "password",
      "passwords",
      "passwd",
      "credential",
      "credentials",
      "secret",
      "secrets",
      "token",
      "tokens",
      "jwt",
      "crypto",
      "encrypt",
      "encryption",
      "decrypt",
      "security",
      "permission",
      "permissions",
      "acl",
      "rbac",
      "csrf",
      "xss",
      "cors",
      "sanitize",
      "sanitizer",
      "keychain",
      "vault",
      "certificate",
      "certificates",
      "tls",
      "ssl",
    ]),
    lines:
      /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\s*\(|\bnew\s+Function\s*\(|\bchild_process\b|\bshell\s*:\s*true\b|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|\bverify\s*=\s*False\b/,
  },
  {
    id: "deletion",
    label: "Deletion",
    sql: true,
    words: new Set([
      "delete",
      "deletion",
      "deletions",
      "purge",
      "prune",
      "erase",
      "wipe",
      "destroy",
      "retention",
      "evict",
      "eviction",
      "trash",
    ]),
    lines:
      /\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|COLUMN|DATABASE|SCHEMA|INDEX)\b|\bTRUNCATE\s+(?:TABLE\s+)?\w|\brm\s+-[a-z]*(?:rf|fr)\b|\b(?:rmSync|rmdirSync|unlinkSync|rimraf)\b|\bfs(?:\.promises)?\.(?:rm|rmdir|unlink)\s*\(|\bshutil\.rmtree\s*\(|\bos\.remove\s*\(|\.deleteMany\s*\(|\b(?:File|Directory)\.Delete\s*\(/,
  },
  {
    id: "concurrency",
    label: "Locking and concurrency",
    sql: true,
    words: new Set([
      "lock",
      "locks",
      "locking",
      "mutex",
      "semaphore",
      "concurrency",
      "concurrent",
      "parallel",
      "worker",
      "workers",
      "scheduler",
      "atomic",
    ]),
    lines:
      /\b(?:Mutex|RwLock|RWMutex|Semaphore|ReentrantLock|synchronized|Atomics\.\w+|AtomicInteger|AtomicReference|SharedArrayBuffer|worker_threads|navigator\.locks|asyncio\.Lock|threading\.Lock)\b|\bFOR\s+UPDATE\b|\bLOCK\s+TABLE\b|\bnew\s+Worker\s*\(|\bflock\s*\(/,
  },
];

/* Leftovers: what an added line leaves behind. */

type LeftoverKind = "todo" | "debug" | "commented" | "skipped";

const COMMENT_MARK = /(?:\/\/|\/\*|^\s*\*|#|<!--|^\s*--)\s*(TODO|FIXME)\b/;
/** In docs, a line that is a TODO or FIXME, or a comment that starts with one. */
const DOC_TODO =
  /^\s*(?:[-*+]\s+(?:\[ \]\s+)?|\d+[.)]\s+|>\s*|<!--\s*)?(TODO|FIXME)\b/;
const DEBUG_LINES =
  /\bconsole\.(?:log|debug|trace|dir|table)\s*\(|^\s*debugger\s*;?\s*$|^\s*(?:breakpoint\(\)|import\s+i?pdb\b|i?pdb\.set_trace\(\))|\bbinding\.(?:pry|irb)\b|^\s*byebug\b|\b(?:var_dump|print_r)\s*\(|^\s*dd\s*\(|\bdbg!\s*\(|\.printStackTrace\s*\(\s*\)|\bSystem\.(?:out|err)\.print(?:ln)?\s*\(|\bDebug\.WriteLine\s*\(/;
const SKIPPED_LINES =
  /\b(?:it|test|describe|context|suite)\.(?:skip(?:If)?|todo|fixme)\s*\(|\b(?:xit|xtest|xdescribe|xcontext)\s*\(|@pytest\.mark\.(?:skip(?:if)?|xfail)\b|@unittest\.skip|\bpytest\.skip\s*\(|@Disabled\b|@Ignore\b|\[Ignore\b|\[Fact\s*\(\s*Skip\s*=|\bt\.Skip(?:Now|f)?\s*\(|#\[ignore\]|^\s*skip\s*\(?\s*["']/;
/** Comments that are tool directives or prose, never code. */
const DIRECTIVES =
  /^(?:eslint|@ts-|prettier-|biome-|istanbul|c8\b|type:|noqa|pragma|region|endregion|#|!|-\*-|TODO|FIXME|NOTE|HACK|XXX)/i;
/** A comment's text that reads as a line of code. */
const CODE_TEXT = [
  /^(?:const|let|var)\s+[\w${[\]}, ]+\s*=/,
  /^(?:import|export)\s.+(?:\sfrom\s|=|[{;]$)/,
  /^(?:return|await|throw)\b.*[;)]$/,
  /^[\w$]+(?:\.[\w$]+|\[[^\]]*\])*\s*\(.*\)\s*;$/,
  /^[\w$]+(?:\.[\w$]+)*\s*(?:[+\-*/]?=)\s*[^=].*;$/,
  /^(?:if|for|while|switch)\s*\(.*\)\s*\{?$/,
  /^(?:def|class|fn|func|function)\s+\w+\s*\(.*\)\s*[:{]?$/,
  /^\}\s*(?:else\b.*)?$/,
  /^(?:public|private|protected|static)\s.*[;{]$/,
];
/** A `#` comment's text that reads as a line of Python, Ruby or shell, which end without `;`. */
const HASH_CODE_TEXT = [
  /^(?:import\s+[\w.]+|from\s+[\w.]+\s+import\s+\S)/,
  /^(?:return|yield|raise)\s+\S/,
  /^[\w.]+(?:\[[^\]]*\])?\s*(?:[+\-*/]?=)\s*[^=\s].*$/,
  /^[\w.]+\(.*\)$/,
  /^(?:if|elif|else|for|while|with|try|except|def|class)\b.*:$/,
];

/**
 * Languages whose statements end without `;`. Their comment's text reads as
 * code when it is a call, a declaration or an assignment on its own.
 */
const NO_SEMICOLONS = new Set(["go", "kt", "kts", "scala", "swift", "lua"]);
const NO_SEMICOLON_CODE_TEXT = [
  /^[\w$]+(?:\.[\w$]+)*\s*\(.*\)$/,
  /^(?:val|var|let|const|func|fun|def)\s+[\w$]+\s*[:=(<]/,
  /^[\w$]+(?:\.[\w$]+|\[[^\]]*\])*\s*(?:[+\-*/]?=|:=)\s*[^=\s].*$/,
];

/**
 * The text of a comment on its own line: a line comment, a block comment
 * opened and closed on the line, or a line inside a block that starts with
 * `*`; in hash languages, a `#` comment.
 */
function commentText(extension: string, trimmed: string) {
  if (HASH_COMMENTS.has(extension)) return /^#\s?(.*)$/.exec(trimmed)?.[1];
  return (
    /^\/\/\s?(.*)$/.exec(trimmed)?.[1] ??
    /^\/\*+\s?(.*?)\s*\*\/$/.exec(trimmed)?.[1] ??
    /^\*(?!\/)\s?(.*)$/.exec(trimmed)?.[1]
  );
}

function readsAsCode(extension: string, body: string) {
  if (HASH_COMMENTS.has(extension)) {
    return HASH_CODE_TEXT.some((rule) => rule.test(body));
  }
  return (
    CODE_TEXT.some((rule) => rule.test(body)) ||
    (NO_SEMICOLONS.has(extension) &&
      NO_SEMICOLON_CODE_TEXT.some((rule) => rule.test(body)))
  );
}

/** A line with its single, double and backtick quoted strings emptied, so quoted code isn't read as code. */
const withoutStrings = (text: string) =>
  text.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');

/** How a leftover is named; a TODO or FIXME is named by its own word. */
const LEFTOVER_LABELS: Record<Exclude<LeftoverKind, "todo">, string> = {
  debug: "Debug output",
  commented: "Commented-out code",
  skipped: "Skipped test",
};

function leftoverOf(
  fileClass: FileClass,
  extension: string,
  text: string,
): { kind: LeftoverKind; label: string } | undefined {
  const isCode =
    fileClass === "code" ||
    (fileClass === "tests" && CODE_EXTENSIONS.has(extension));
  if (isCode) {
    const todo = COMMENT_MARK.exec(text);
    if (todo) return { kind: "todo", label: todo[1]! };
  } else if (fileClass === "docs") {
    const todo = DOC_TODO.exec(text);
    return todo ? { kind: "todo", label: todo[1]! } : undefined;
  } else {
    return undefined;
  }
  const trimmed = text.trim();
  const comment = commentText(extension, trimmed);
  if (comment !== undefined) {
    const body = comment.trim();
    if (!DIRECTIVES.test(body) && readsAsCode(extension, body)) {
      return { kind: "commented", label: LEFTOVER_LABELS.commented };
    }
    return undefined;
  }
  if (SKIPPED_LINES.test(text)) {
    return { kind: "skipped", label: LEFTOVER_LABELS.skipped };
  }
  if (DEBUG_LINES.test(withoutStrings(text))) {
    return { kind: "debug", label: LEFTOVER_LABELS.debug };
  }
  return undefined;
}

/* Writing the lines. */

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** `a, b and c`, or `a, b, c and 4 more files`. */
function namePaths(paths: readonly string[]) {
  const named = paths.slice(0, PATHS_NAMED);
  const rest = paths.length - named.length;
  if (rest > 0)
    return `${named.join(", ")} and ${rest} more ${rest === 1 ? "file" : "files"}`;
  if (named.length === 1) return named[0]!;
  return `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}

const line = (
  id: string,
  text: string,
  hunkIds: readonly string[],
  concernId?: string,
): RuleLine => ({
  id,
  text: clip(text, TEXT_MAX),
  hunkIds: [...new Set(hunkIds)],
  ...(concernId ? { concernId } : {}),
});

const unique = <T>(values: Iterable<T>) => [...new Set(values)];

/** A changed hunk with what the rules need of it. */
interface ReadHunk {
  hunk: Hunk;
  file: FileDiff;
  fileClass: FileClass;
  kind: RuleKind | undefined;
}

/**
 * Each concern's kinds and the summary's lines, from the diff's files and
 * the concerns the pipeline grouped them into, in reading order.
 */
export function summarizeRules(
  files: readonly FileDiff[],
  concerns: readonly GroupedConcern[],
): { concerns: RuleConcern[]; summary: RuleSummary } {
  const hunks = new Map<string, ReadHunk>();
  for (const file of files) {
    const fileClass = classify(file);
    for (const hunk of file.hunks) {
      hunks.set(hunk.id, {
        hunk,
        file,
        fileClass,
        kind: hunkKind(file, fileClass, hunk),
      });
    }
  }

  const kindsOf = (hunkIds: readonly string[]) => {
    const found = new Set(hunkIds.map((id) => hunks.get(id)?.kind));
    return RULE_KINDS.filter((kind) => found.has(kind));
  };

  // Test coverage. A code file counts as tested by a test file in the pull
  // request that has its module's name, anywhere in the guide.
  const testedModules = new Set<string>();
  for (const { file, fileClass } of hunks.values()) {
    if (fileClass !== "tests") continue;
    testedModules.add(logicalModule(file.path));
    testedModules.add(moduleName(file.path));
  }
  const tests: RuleLine[] = [];
  const untested: RuleLine[] = [];
  for (const concern of concerns) {
    const own = concern.hunkIds.flatMap((id) => {
      const read = hunks.get(id);
      return read ? [read] : [];
    });
    const testHunks = own.filter((read) => read.fileClass === "tests");
    if (testHunks.length) {
      tests.push(
        line(
          `tests:${concern.id}`,
          `Tested in ${namePaths(unique(testHunks.map((read) => read.file.path)))}`,
          testHunks.map((read) => read.hunk.id),
          concern.id,
        ),
      );
      continue;
    }
    const bare = own.filter(
      (read) =>
        read.fileClass === "code" &&
        !testedModules.has(logicalModule(read.file.path)) &&
        !testedModules.has(moduleName(read.file.path)),
    );
    if (bare.length) {
      untested.push(
        line(
          `untested:${concern.id}`,
          `No test for ${namePaths(unique(bare.map((read) => read.file.path)))}`,
          bare.map((read) => read.hunk.id),
          concern.id,
        ),
      );
    }
  }

  // Lines the pull request moves aren't new: an added line also removed
  // elsewhere in the diff is no leftover.
  const removed = new Set<string>();
  for (const { hunk } of hunks.values()) {
    for (const diffLine of hunk.lines) {
      if (diffLine.kind === "del") removed.add(diffLine.text.trim());
    }
  }

  const areas = new Map<string, ReadHunk[]>();
  const leftovers: { read: ReadHunk; at: DiffLine; label: string }[] = [];
  for (const read of hunks.values()) {
    const { file, fileClass, hunk } = read;
    const words = pathWords(file.path);
    const lowerPath = file.path.toLowerCase();
    const added = hunk.lines.filter((diffLine) => diffLine.kind === "add");
    const mayBeRisky = MAY_BE_RISKY.has(fileClass);
    const anyFile = fileClass === "other";
    const sql = anyFile && extensionOf(file.path) === "sql";
    for (const rule of RISKS) {
      const applies =
        mayBeRisky || (anyFile && rule.anyFile) || (sql && rule.sql);
      if (!applies) continue;
      const byPath =
        words.some((word) => rule.words?.has(word)) ||
        (rule.path?.test(lowerPath) ?? false);
      const byLine =
        !byPath &&
        rule.lines !== undefined &&
        added.some((diffLine) => rule.lines!.test(diffLine.text));
      if (byPath || byLine) {
        const list = areas.get(rule.id) ?? [];
        list.push(read);
        areas.set(rule.id, list);
      }
    }
    const extension = extensionOf(file.path);
    let commenting = false;
    for (const diffLine of hunk.lines) {
      if (diffLine.kind !== "add") {
        commenting = false;
        continue;
      }
      const found = removed.has(diffLine.text.trim())
        ? undefined
        : leftoverOf(fileClass, extension, diffLine.text);
      // A run of commented-out lines is one leftover, at its first line.
      if (found?.kind === "commented" && commenting) continue;
      commenting = found?.kind === "commented";
      if (found) leftovers.push({ read, at: diffLine, label: found.label });
    }
  }

  const risks = RISKS.flatMap((rule) => {
    const found = areas.get(rule.id);
    if (!found) return [];
    return [
      line(
        `risk:${rule.id}`,
        `${rule.label}: ${namePaths(unique(found.map((read) => read.file.path)))}`,
        found.map((read) => read.hunk.id),
      ),
    ];
  });

  const listed = leftovers.slice(0, LEFTOVERS_LISTED);
  const leftoverLines = listed.map(({ read, at, label }, index) =>
    line(
      `leftover:${index}`,
      `${label} in ${read.file.path}:${at.newLine ?? read.hunk.newStart}: ${clip(at.text.trim(), QUOTE_MAX)}`,
      [read.hunk.id],
    ),
  );
  const rest = leftovers.slice(LEFTOVERS_LISTED);
  if (rest.length) {
    leftoverLines.push(
      line(
        "leftover:more",
        `${rest.length} more ${rest.length === 1 ? "leftover" : "leftovers"}`,
        rest.map(({ read }) => read.hunk.id),
      ),
    );
  }

  const withKinds = concerns.map((concern) => ({
    ...concern,
    kinds: kindsOf(concern.hunkIds),
  }));
  const kinds = RULE_KINDS.filter((kind) =>
    withKinds.some((concern) => concern.kinds.includes(kind)),
  );
  return {
    concerns: withKinds,
    summary: { kinds, risks, tests, untested, leftovers: leftoverLines },
  };
}

/** A file's module by its own name, so `src/retry.ts` and `tests/retry.test.ts` match from any folder. */
function moduleName(path: string) {
  return basenameOf(logicalModule(path));
}

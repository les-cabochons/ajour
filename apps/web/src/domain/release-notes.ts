/**
 * Ajour's release notes as What's new shows them. A GitHub release's body is
 * GitHub's generated list of merged pull requests, one per line, each titled
 * as a conventional commit: `feat(backlog): …`. Each title becomes a change
 * with a kind, the area of the app it touches and a summary. Work users
 * never see, such as docs, tests and tooling, is left out.
 */

const REPOSITORY_PULL_URL = "https://github.com/les-cabochons/ajour/pull/";

/** What a change did: added something, fixed it, made it faster or other. */
export type ReleaseChangeKind = "new" | "fix" | "improved" | "change";

export interface ReleaseChange {
  kind: ReleaseChangeKind;
  /** The part of the app, from the title's scope: `Backlog`. */
  area: string | null;
  summary: string;
  pullNumber: number | null;
  /** The pull request on GitHub; only this repository's are linked. */
  pullUrl: string | null;
}

const KIND_BY_TYPE: Record<string, ReleaseChangeKind | null> = {
  feat: "new",
  fix: "fix",
  perf: "improved",
  build: null,
  chore: null,
  ci: null,
  docs: null,
  refactor: null,
  revert: null,
  style: null,
  test: null,
};

/** Scope words the app spells in capitals. */
const ACRONYMS = new Set([
  "ado",
  "api",
  "cli",
  "ics",
  "mcp",
  "pr",
  "ui",
  "wsl",
]);

const LIST_ITEM = /^\s*[*-]\s+(.+?)\s*$/;
const GENERATED_SUFFIX = /\s+by\s+@[\w.-]+\s+in\s+(\S+)$/;
const TRAILING_PULL = /\s+\(#(\d+)\)$/;
const CONVENTIONAL_TITLE = /^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/;
const FIRST_CONTRIBUTION = /\smade their first contribution in\s/;

/** The changes a release body lists, in its order. */
export function parseReleaseChanges(body: string): ReleaseChange[] {
  const changes: ReleaseChange[] = [];
  for (const line of body.split(/\r?\n/)) {
    const change = parseLine(line);
    if (change) changes.push(change);
  }
  return changes;
}

function parseLine(line: string): ReleaseChange | null {
  const item = LIST_ITEM.exec(line);
  if (!item || FIRST_CONTRIBUTION.test(item[1]!)) return null;

  let title = item[1]!;
  let pullNumber: number | null = null;
  const generated = GENERATED_SUFFIX.exec(title);
  if (generated) {
    const number = pullNumberOf(generated[1]!);
    if (number !== null) {
      pullNumber = number;
      title = title.slice(0, generated.index);
    }
  }
  const trailing = TRAILING_PULL.exec(title);
  if (trailing) {
    pullNumber ??= Number(trailing[1]);
    title = title.slice(0, trailing.index);
  }

  const conventional = CONVENTIONAL_TITLE.exec(title);
  let kind: ReleaseChangeKind = "change";
  let area: string | null = null;
  if (conventional && conventional[1]! in KIND_BY_TYPE) {
    const mapped = KIND_BY_TYPE[conventional[1]!];
    if (!mapped) return null;
    kind = mapped;
    area = conventional[2] ? areaOf(conventional[2]) : null;
    title = conventional[3]!;
  }

  return {
    kind,
    area,
    summary: capitalize(title.trim()),
    pullNumber,
    pullUrl: pullNumber === null ? null : `${REPOSITORY_PULL_URL}${pullNumber}`,
  };
}

function pullNumberOf(url: string): number | null {
  if (!url.startsWith(REPOSITORY_PULL_URL)) return null;
  const number = url.slice(REPOSITORY_PULL_URL.length);
  return /^[1-9]\d*$/.test(number) ? Number(number) : null;
}

function areaOf(scope: string) {
  return scope
    .split(",")
    .map((part) =>
      part
        .trim()
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((word) =>
          ACRONYMS.has(word.toLowerCase())
            ? word.toUpperCase()
            : capitalize(word),
        )
        .join(" "),
    )
    .filter(Boolean)
    .join(", ");
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const NIGHTLY_VERSION = /^\d+\.\d+\.\d+-nightly[.-]\d{8}[.-](\d+)$/;

/** A release's short name: `Nightly 377` for a nightly build, else its version. */
export function releaseLabel(packageVersion: string) {
  const nightly = NIGHTLY_VERSION.exec(packageVersion);
  return nightly ? `Nightly ${Number(nightly[1])}` : packageVersion;
}

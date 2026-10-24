// Runs the consistency checks of docs/agents/code-standards.md, which should
// find nothing. The doc stays the one list: this script reads its `rg`
// commands and runs each with the same pattern, paths and globs, over the
// files git tracks or would track, so it needs no ripgrep and runs the same
// on Windows and macOS. `just standards-check` and CI run it. A match is a
// boundary violation, and the script exits 1 after listing every match.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const STANDARDS = "docs/agents/code-standards.md";
const INTRO = "These consistency checks should find nothing.";

/** Splits a shell line into words, honouring single and double quotes. */
function shellWords(line) {
  const words = [];
  let word = "";
  let quote = null;
  let started = false;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) throw new Error(`Unclosed quote in: ${line}`);
  if (started) words.push(word);
  return words;
}

/**
 * One `rg` command as a check: its pattern, the paths it searches and its
 * globs. Only `-n`, `-P` and `-g`/`--glob` are understood, so a command the script
 * can't run the way ripgrep would fails loudly instead of passing.
 */
export function parseCheck(line) {
  const [command, ...args] = shellWords(line);
  if (command !== "rg") throw new Error(`Not an rg command: ${line}`);
  const positional = [];
  const globs = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    // -P is PCRE2, which lookaheads need; JavaScript reads the same syntax.
    if (arg === "-n" || arg === "-P") continue;
    if (arg === "-g" || arg === "--glob") {
      const glob = args[(index += 1)];
      if (glob === undefined) throw new Error(`A glob is missing: ${line}`);
      globs.push(glob);
    } else if (arg.startsWith("-")) {
      throw new Error(`The check runner doesn't know ${arg}: ${line}`);
    } else {
      positional.push(arg);
    }
  }
  const [pattern, ...paths] = positional;
  if (!pattern || paths.length === 0) {
    throw new Error(`A check needs a pattern and a path: ${line}`);
  }
  return { line, pattern: new RegExp(pattern), paths, globs };
}

/** The checks the code standards list, in order. */
export function readChecks(markdown) {
  const start = markdown.indexOf(INTRO);
  if (start === -1) throw new Error(`${STANDARDS} lost "${INTRO}"`);
  const block = /```sh\r?\n([\s\S]*?)```/.exec(markdown.slice(start));
  if (!block) throw new Error(`${STANDARDS} has no sh block after the intro`);
  return block[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCheck);
}

/** A glob as a regular expression: `**` crosses folders, `*` and `?` don't. */
function globPattern(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      index += 1;
      if (glob[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/**
 * Whether `file`, relative to the repository and with forward slashes,
 * matches `glob` as ripgrep reads it: a glob without a slash matches a file
 * or folder name at any depth, one with a slash the whole path.
 */
export function matchesGlob(file, glob) {
  const pattern = globPattern(glob.replace(/^\//, ""));
  if (glob.includes("/")) return pattern.test(file);
  return file.split("/").some((segment) => pattern.test(segment));
}

/** Whether a check searches `file`: under one of its paths, and kept by its globs. */
function searches(check, file) {
  const under = check.paths.some((searched) => {
    const folder = searched.replace(/\\/g, "/").replace(/\/+$/, "");
    return file === folder || file.startsWith(`${folder}/`);
  });
  if (!under) return false;
  const includes = check.globs.filter((glob) => !glob.startsWith("!"));
  const excludes = check.globs
    .filter((glob) => glob.startsWith("!"))
    .map((glob) => glob.slice(1));
  if (includes.length > 0 && !includes.some((glob) => matchesGlob(file, glob)))
    return false;
  return !excludes.some((glob) => matchesGlob(file, glob));
}

/** The files git tracks, or would: ripgrep likewise skips what .gitignore ignores. */
function repositoryFiles(root) {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);
}

/**
 * Runs every check over `files`, read from `root`. Returns each check with
 * the lines it matched, as `path:line:text`.
 */
export function runChecks(root, checks, files = repositoryFiles(root)) {
  return checks.map((check) => {
    const matches = [];
    for (const file of files) {
      if (!searches(check, file)) continue;
      let text;
      try {
        text = readFileSync(path.join(root, file), "utf8");
      } catch {
        // Deleted in the working tree, or not a readable file.
        continue;
      }
      text.split(/\r?\n/).forEach((content, index) => {
        if (check.pattern.test(content)) {
          matches.push(`${file}:${index + 1}:${content.trim()}`);
        }
      });
    }
    return { check: check.line, matches };
  });
}

function main() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const checks = readChecks(readFileSync(path.join(root, STANDARDS), "utf8"));
  const results = runChecks(root, checks);
  const failed = results.filter((result) => result.matches.length > 0);
  for (const { check, matches } of failed) {
    console.error(`\n${check}`);
    for (const match of matches) console.error(`  ${match}`);
  }
  if (failed.length > 0) {
    console.error(
      `\n${failed.length} of ${results.length} consistency checks in ${STANDARDS} found something.`,
    );
    process.exit(1);
  }
  console.error(
    `All ${results.length} consistency checks in ${STANDARDS} found nothing.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

// Entry point: a pull request's diff as Review Deck cuts it. `buildDiff` writes a `git diff -M` style patch from
// both versions of each changed file, and `parseDiff` reads it into files and hunks with Review Deck's `path#index`
// ids. It loads no parser and no grammar, so a caller that needs only the hunks leaves the pipeline unloaded.
export type { DiffLine, FileDiff, Hunk } from "./core/types.ts";
export { parseDiff } from "./diff/parse.ts";
export {
  buildDiff,
  type ChangeType,
  type FileChange,
  type FileContents,
} from "./review/analysis.ts";

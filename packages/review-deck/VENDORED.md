# Vendored from Review Deck

This package is a copy of Review Deck's grouping pipeline, so Ajour builds diffs
and guides with the same hunk ids Review Deck uses (#595, #775).

- Upstream: [`les-cabochons/review-deck`](https://github.com/les-cabochons/review-deck), MIT.
  Its licence is copied, unchanged, as [`LICENSE`](LICENSE).
- Commit: `les-cabochons/review-deck@c4243e9`
  (`c4243e98d0d1c418a4ccafb70c2fb6aa2207eb70`, 2026-11-04).

## Layout

The package root stands for upstream `src/`, so the copied files keep their
relative imports.

| Here                                                                             | Upstream                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------- |
| `analyze/`, `cluster/`, `core/`, `diff/`, `order/`, `parse/`, `score/`, `title/` | `src/<same>/`, every file                           |
| `stack/stacks.ts`, `stack/branches.ts`                                           | `src/stack/`, without `restack.ts`                  |
| `pipeline.ts`                                                                    | `src/pipeline.ts`                                   |
| `review/saved.ts`                                                                | `extension/src/review/saved.ts`                     |
| `review/analysis.ts`                                                             | `buildDiff` from `extension/src/review/analysis.ts` |
| `tests/saved.test.ts`, `tests/stack.test.ts`, `tests/languages.test.ts`          | `extension/tests/<same>`                            |
| `tests/description.test.ts`                                                      | `extension/tests/description.test.ts`, rewritten    |

Not copied: `src/node/` (CLI, embedder, CLI titler), `src/render/`,
`src/eval/`, `src/example/`, `src/stack/restack.ts`, the rest of
`extension/` and `backend/`. No embedder ships, so the semantic signal stays
off.

Ajour's own files are the entry points `saved.ts`, `stack.ts` and `diff.ts`, the block
at the end of `pipeline.ts`, `ajour/deps.ts`, and the tests
`build-diff.test.ts`, `deps-grammar.test.ts`, `deps-init.test.ts`,
`description.test.ts` and `languages.test.ts`, which Ajour rewrote. The
copied files keep upstream's formatting, so `.prettierignore` lists them.

## Entry points

- `pipeline.ts`: `runPipeline` and `buildDiff`, the config, the result types,
  and `createPipelineDeps`, Ajour's side of `PipelineDeps`.
- `diff.ts`: `buildDiff` and `parseDiff`, which cut a pull request's hunks
  with Review Deck's `path#index` ids, and their types. It loads no parser,
  so Deck's service in the local API builds a diff without the pipeline
  (#779).
- `saved.ts`: the `saved-reviews` format 4.
- `stack.ts`: stack detection among open pull requests, and trunk patterns.

## Local changes

1. **Import specifiers end in `.ts`, not `.js`.** The local API runs
   TypeScript with Node's type stripping, which loads only the file named.
   It is the only change to the files of `analyze/`, `cluster/`, `core/`,
   `diff/`, `order/`, `score/`, `stack/` and `title/`, and of `parse/` except
   `treesitter.ts`. To sync, copy and run
   `sed -E 's#(from "\.{1,2}/[^"]*)\.js"#\1.ts"#g'`.
2. **`parse/treesitter.ts`.**
   - The constructor's parameter property is a plain field, because Ajour's
     packages compile with `erasableSyntaxOnly`.
   - A grammar that fails to load goes to an optional `onLoadError` callback,
     the third argument of `SyntaxParsers.create`, instead of a warning on
     the console, which Ajour's runtime code never writes to.
3. **`pipeline.ts`** ends with a block of re-exports (the config, the types,
   `GRAMMARS`, `buildDiff`, `createPipelineDeps`), so it is the package's
   entry point. The upstream part is unchanged.
4. **`review/saved.ts`** imports `../core/types.ts` and `../diff/parse.ts`
   instead of `../../../src/...`. Nothing else changed.
5. **`review/analysis.ts`** keeps only `buildDiff`, `fileDiff` and
   `FileContents`. The worker job, progress and Azure DevOps backend stay
   upstream. `FileChange` and `ChangeType` come from upstream
   `extension/src/data/model.ts`, without the Azure DevOps object ids.
6. **`ajour/deps.ts`** is new. `createPipelineDeps` gives the parsers, with
   each grammar's wasm resolved from its npm package in this package's install
   folder, the heuristic titler and no embedder. The parsers are made once per
   process, because a second `Parser.init` replaces web-tree-sitter's runtime,
   so only the first caller's `onGrammarError` is used. A rejected init is not
   kept, and the next call tries again. A grammar package that does not
   resolve gives a path `Language.load` rejects, so the error reaches
   `onLoadError` and its files fall back to path-only grouping.
   File contents are not a dependency: they come with each pull request, as
   `PrInput.files`, a `FileProvider` the content cache (#596) implements.
7. **Tests** run on Vitest instead of `node:test`, with `node:assert` kept,
   and import only the entry points.
   - `stack.test.ts` keeps the trunk pattern and stack tests, without the
     restack and hook tests.
   - `languages.test.ts` gets the parsers from `createPipelineDeps`. Its
     manifest test becomes a test that every grammar in `GRAMMARS` loads
     from the install folder. Its language and test-file tests read
     `language` and `isTest` off the hunks `runPipeline` returns, instead of
     calling `languageForPath` and `isTestPath`.
   - `description.test.ts` tests the same cases through `runPipeline`: the
     steps show as the description signal on hunk pairs, and as group titles.
8. **`tsconfig.json`** turns `noUncheckedIndexedAccess` off, which the
   upstream code was written without.

## Syncing

1. Clone upstream at the new commit.
2. Copy the folders and files in the table and `LICENSE`, then apply local
   change 1.
3. Diff against this package and carry changes 2 to 7 over.
4. Run `just test`, `just typecheck` and `just lint-boundaries`.
5. Update the commit above and this list.

// Ajour's side of the pipeline's seam, PipelineDeps (VENDORED.md): grammars found in this package's install
// folder, the heuristic titler and no embedder. File contents come with each pull request, as PrInput.files.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { type GrammarLoadError, SyntaxParsers } from "../parse/treesitter.ts";
import { HeuristicTitler } from "../title/heuristic.ts";
import type { Titler } from "../title/types.ts";

export interface PipelineDepsOptions {
  /** Hears about a grammar that fails to load. Grammars load once per process, so only the first call's is used. */
  onGrammarError?: GrammarLoadError;
}

/** What Ajour passes as PipelineDeps. */
export interface AjourPipelineDeps {
  parsers: SyntaxParsers;
  titler: Titler;
  embedder: null;
}

const require = createRequire(import.meta.url);

// web-tree-sitter keeps one runtime per process, and a second Parser.init replaces it under parsers already made.
let parsers: Promise<SyntaxParsers> | null = null;

export async function createPipelineDeps(
  options: PipelineDepsOptions = {},
): Promise<AjourPipelineDeps> {
  parsers ??= SyntaxParsers.create(
    (grammar) =>
      join(
        dirname(require.resolve(`${grammar.package}/package.json`)),
        grammar.file,
      ),
    undefined,
    options.onGrammarError,
  );
  return {
    parsers: await parsers,
    titler: new HeuristicTitler(),
    embedder: null,
  };
}

// Ajour's side of the pipeline's seam, PipelineDeps (VENDORED.md): grammars found in this package's install
// folder, the heuristic titler and no embedder. File contents come with each pull request, as PrInput.files.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Grammar } from "../parse/grammars.ts";
import { type GrammarLoadError, SyntaxParsers } from "../parse/treesitter.ts";
import { HeuristicTitler } from "../title/heuristic.ts";
import type { Titler } from "../title/types.ts";

export interface PipelineDepsOptions {
  /**
   * Hears about a grammar that fails to load. The parsers are made once per process, so only the handler of
   * the first call that succeeds is used; later calls' handlers are ignored.
   */
  onGrammarError?: GrammarLoadError;
}

/** What Ajour passes as PipelineDeps. */
export interface AjourPipelineDeps {
  parsers: SyntaxParsers;
  titler: Titler;
  embedder: null;
}

const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The grammar's wasm in its npm package. A package that does not resolve gives the path it would have under
 * this package, so Language.load rejects it and the grammar's files fall back to path-only grouping, instead
 * of the throw failing the whole review.
 */
function locateGrammar(grammar: Grammar): string {
  let folder: string;
  try {
    folder = dirname(require.resolve(`${grammar.package}/package.json`));
  } catch {
    folder = join(packageRoot, "node_modules", grammar.package);
  }
  return join(folder, grammar.file);
}

// web-tree-sitter keeps one runtime per process, and a second Parser.init replaces it under parsers already made.
// A rejected init is not kept, so the next call tries again.
let parsers: Promise<SyntaxParsers> | null = null;

export async function createPipelineDeps(
  options: PipelineDepsOptions = {},
): Promise<AjourPipelineDeps> {
  parsers ??= SyntaxParsers.create(
    locateGrammar,
    undefined,
    options.onGrammarError,
  ).catch((error: unknown) => {
    parsers = null;
    throw error;
  });
  return {
    parsers: await parsers,
    titler: new HeuristicTitler(),
    embedder: null,
  };
}

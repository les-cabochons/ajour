// Entry point: Review Deck's path rules, which tell a test file from the code it tests. It loads no parser, so
// Deck's summary rules in the local API (#789) use the same rules as the pipeline's test pairing.
export { isTestPath, logicalModule } from "./core/paths.ts";

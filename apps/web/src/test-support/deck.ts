import type { DeckSummary } from "@ajour/shared/deck";

/** The summary of a pull request no rule has a line for, with no linked ticket. */
export const NO_DECK_SUMMARY: DeckSummary = {
  problem: null,
  tickets: [],
  kinds: [],
  breaking: [],
  risks: [],
  tests: [],
  untested: [],
  leftovers: [],
};

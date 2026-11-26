// Entry point: Ajour's summary rules (#789). From a diff's files and the concerns the pipeline grouped them into,
// they find each concern's kinds of change, the risky areas, the test coverage and the leftovers. The guide worker
// runs them in the same build. They load no parser.
export {
  type GroupedConcern,
  type RuleConcern,
  type RuleKind,
  type RuleLine,
  type RuleSummary,
  summarizeRules,
} from "./ajour/summary.ts";

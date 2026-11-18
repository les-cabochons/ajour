// Entry point: stack detection among open pull requests, and the trunk branches where stacks end.
export {
  DEFAULT_TRUNK_PATTERNS,
  invalidTrunkPattern,
  isTrunk,
  parseTrunkPatterns,
  shortBranch,
} from "./stack/branches.ts";
export {
  type StackPosition,
  type StackPr,
  stackFor,
  stackIndex,
} from "./stack/stacks.ts";

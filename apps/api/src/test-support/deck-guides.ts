import { parseDiff } from "../../../../packages/review-deck/diff.ts";
import type { GuideJobBuilt } from "../../../../packages/review-deck/guide-job.ts";
import {
  summarizeRules,
  type GroupedConcern,
} from "../../../../packages/review-deck/summary.ts";
import type { GuideBuildInput } from "../deck-guide-builds.ts";

/**
 * What the guide worker answers for these concerns of `input`'s diff: the
 * concerns with their kinds and the summary's lines, from the same rules,
 * in process.
 */
export function builtFrom(
  input: GuideBuildInput,
  concerns: GroupedConcern[],
): GuideJobBuilt {
  return summarizeRules(parseDiff(input.diff), concerns);
}

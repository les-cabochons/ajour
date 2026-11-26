import { parseDiff } from "../../../../packages/review-deck/diff.ts";
import type { GuideJobBuilt } from "../../../../packages/review-deck/guide-job.ts";
import {
  summarizeRules,
  type GroupedConcern,
} from "../../../../packages/review-deck/summary.ts";
import type { GuideBuildInput } from "../deck-guide-builds.ts";
import type { DeckCodeHost } from "../deck-service.ts";

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

/** A code host whose pull requests each add one file, `a.ts`, at these commits. */
export function addedFileCodeHost(headSha: string, baseSha: string) {
  const codeHost: DeckCodeHost = {
    async run(operation) {
      if (operation === "getPullRequestContent") {
        return {
          headSha,
          baseSha,
          files: [
            {
              path: "a.ts",
              status: "added",
              additions: 1,
              deletions: 0,
              binary: false,
            },
          ],
        } as never;
      }
      return { kind: "text", content: "export const a = 1;\n" } as never;
    },
  };
  return codeHost;
}

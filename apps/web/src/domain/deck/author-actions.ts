import type {
  CodeHostMergeMethod,
  CodeHostPullRequestFacts,
  CodeHostVersionsResult,
} from "@ajour/shared";
import { versionNames } from "./versions";

/*
 * The author's actions on a review page (#786, ADR 0002): edit the title,
 * toggle draft and ready, and merge. Each goes to the code host at once;
 * merge alone asks first, since it can't be undone, and offers only the
 * methods the repository allows. These are the rules the page follows, in
 * each code host's words.
 */

/** Only the author of an open pull request sees the actions. */
export function authorActions(
  facts: Pick<CodeHostPullRequestFacts, "viewerIsAuthor" | "state">,
) {
  return facts.viewerIsAuthor && facts.state === "open";
}

const azure = (pluginId: string) => pluginId === "azure_devops";

/** Each merge method's name on the pull request's code host. */
export function mergeMethodLabels(
  pluginId: string,
): Record<CodeHostMergeMethod, string> {
  return azure(pluginId)
    ? {
        merge: "Merge (no fast forward)",
        squash: "Squash commit",
        rebase: "Rebase and fast-forward",
      }
    : {
        merge: "Create a merge commit",
        squash: "Squash and merge",
        rebase: "Rebase and merge",
      };
}

/** The button that turns a draft ready, or a ready pull request into a draft. */
export function draftActionLabel(pluginId: string, draft: boolean) {
  if (azure(pluginId)) return draft ? "Publish" : "Mark as draft";
  return draft ? "Ready for review" : "Convert to draft";
}

/** A failed draft action's toast, in the code host's words. */
export function draftActionFailure(pluginId: string, toDraft: boolean) {
  if (azure(pluginId))
    return toDraft ? "Couldn't mark it as a draft" : "Couldn't publish it";
  return toDraft
    ? "Couldn't convert it to a draft"
    : "Couldn't mark it ready for review";
}

/**
 * The merge commit's title the dialog starts with, as the code host would
 * write it. None for a rebase, which makes no merge commit.
 */
export function defaultCommitTitle(
  pluginId: string,
  method: CodeHostMergeMethod,
  facts: Pick<CodeHostPullRequestFacts, "title" | "number">,
) {
  if (method === "rebase") return undefined;
  return azure(pluginId)
    ? `Merged PR ${facts.number}: ${facts.title}`
    : `${facts.title} (#${facts.number})`;
}

/**
 * Why the pull request can't merge from Deck now, or undefined when it can:
 * a push came in after the head on screen, so the user hasn't read what
 * would land; it's a draft; or the repository allows no method Deck offers.
 */
export function mergeBlocker(
  host: { pluginId: string; pluginName: string },
  state: {
    draft: boolean;
    /** Pushes after the head on screen. */
    pushes: number;
    methods: readonly CodeHostMergeMethod[];
    versionName?: CodeHostVersionsResult["versionName"];
  },
) {
  if (state.pushes > 0) {
    const names = versionNames(state.versionName);
    const what = (state.pushes === 1 ? names.one : names.plural).toLowerCase();
    return `${state.pushes} new ${what} since you opened this pull request. Refresh to review ${state.pushes === 1 ? "it" : "them"} before merging.`;
  }
  if (state.draft)
    return `This pull request is a draft. ${azure(host.pluginId) ? "Publish it" : "Mark it ready for review"} to merge it.`;
  if (!state.methods.length)
    return `This repository allows no merge method Deck offers. Merge it on ${host.pluginName}.`;
  return undefined;
}

/**
 * Where a merge the code host took but is still completing stands, read
 * from the pull request's facts and whether the sync the merge started has
 * finished. Merged or closed ends it, and conflicting branches fail it. The
 * facts can't tell a merge still running from one a policy stopped, so once
 * that sync finishes with the pull request still open, it ends too: Merge
 * asks again, and the plugin answers with the completion it's still making
 * or why it stopped. The facts' activity time is no sign either way, since
 * a code host needn't change it when a merge goes on or stops.
 */
export function pendingMerge(
  facts: Pick<CodeHostPullRequestFacts, "state" | "mergeability">,
  merge: { synced: boolean },
): "completing" | "ended" | "conflicting" {
  if (facts.state !== "open") return "ended";
  if (facts.mergeability === "conflicting") return "conflicting";
  return merge.synced ? "ended" : "completing";
}

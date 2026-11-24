import type {
  CodeHostReviewFact,
  CodeHostVersion,
  CodeHostVersionsResult,
} from "@ajour/shared";
import type { DeckSinceReview } from "@ajour/shared/deck";
import type { ReviewSection } from "./guide";

/*
 * Versions and changes since your review (#787). A version is a push on
 * GitHub or an iteration on Azure DevOps. The version the user reviewed is
 * the one in effect when they last submitted a review on the code host, or
 * the one remembered on this computer, whichever came later. The
 * since-review filter keeps only the hunks changed since that version, and
 * folds the concerns it left untouched into one line.
 */

/** A version the user reviewed, remembered with the pull request in local state. */
export interface RememberedReview {
  headSha: string;
  /** When it was reviewed. */
  at: number;
}

const sameLogin = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/** The version in effect at `at`: the last one pushed by then. */
function versionAt(versions: readonly CodeHostVersion[], at: number) {
  let found: CodeHostVersion | undefined;
  for (const version of versions) {
    if (version.pushedAt <= at && (!found || version.number > found.number))
      found = version;
  }
  return found;
}

/**
 * The version the user last reviewed: the one in effect at their latest
 * review on the code host, or the one remembered here, whichever is later.
 * A dismissed review doesn't count. Undefined when they haven't reviewed
 * any version.
 */
export function reviewedVersion(
  versions: readonly CodeHostVersion[],
  options: {
    viewerLogin: string;
    reviews: readonly CodeHostReviewFact[];
    remembered?: RememberedReview;
  },
): { version: CodeHostVersion; at: number } | undefined {
  const latest = options.reviews
    .filter(
      (review) =>
        review.verdict !== "dismissed" &&
        sameLogin(review.author.login, options.viewerLogin),
    )
    .reduce<CodeHostReviewFact | undefined>(
      (found, review) =>
        !found || review.submittedAt > found.submittedAt ? review : found,
      undefined,
    );
  const fromReview = latest && versionAt(versions, latest.submittedAt);
  const reviewed = fromReview && {
    version: fromReview,
    at: latest.submittedAt,
  };
  const remembered = options.remembered;
  const kept =
    remembered &&
    versions.find((version) => version.headSha === remembered.headSha);
  if (kept && (!reviewed || remembered.at > reviewed.at))
    return { version: kept, at: remembered.at };
  return reviewed;
}

/** The hunks changed since the review, by id, with the version each last changed in. */
export function changedHunks(
  changed: DeckSinceReview["changed"],
): ReadonlyMap<string, number> {
  return new Map(changed.map((entry) => [entry.hunkId, entry.version]));
}

/**
 * The sections under the since-review filter: each with only its changed
 * hunks, and `of` its hunk count when it shows only some, in the same
 * order and with the same numbers. The sections with none are `folded`.
 */
export function sinceReviewSections(
  sections: readonly ReviewSection[],
  changed: ReadonlyMap<string, number>,
): { sections: ReviewSection[]; folded: ReviewSection[] } {
  const kept: ReviewSection[] = [];
  const folded: ReviewSection[] = [];
  for (const section of sections) {
    const hunks = section.hunks.filter((entry) => changed.has(entry.hunk.id));
    if (!hunks.length) folded.push(section);
    else if (hunks.length === section.hunks.length) kept.push(section);
    else kept.push({ ...section, hunks, of: section.hunks.length });
  }
  return { sections: kept, folded };
}

/** What the versions bar calls a version. */
export function versionNames(name: CodeHostVersionsResult["versionName"]) {
  return name === "iteration"
    ? { plural: "Iterations", one: "Iteration" }
    : { plural: "Pushes", one: "Push" };
}

/** The bar's second row: what the diff compares. */
export function scopeLine(baseRef: string | undefined) {
  return `Changes in this pull request, against ${baseRef ?? "its base branch"}`;
}

/**
 * How many pushes came after the head on screen: the versions after it, or
 * one when a sync since the page opened saw a head the versions don't list
 * yet. The page shows a banner, and the diff stays as it is until the user
 * refreshes.
 */
export function pushesSince(
  versions: readonly CodeHostVersion[] | undefined,
  shownHead: string,
  heads: {
    /** The head the last sync saw. */
    synced: string;
    /** The head the last sync had seen when the page read the diff. */
    syncedAtOpen: string;
  },
): number {
  const shown = versions?.find((version) => version.headSha === shownHead);
  const after = shown
    ? versions!.filter((version) => version.number > shown.number).length
    : 0;
  const syncKnowsMore =
    heads.synced !== heads.syncedAtOpen &&
    heads.synced !== shownHead &&
    !versions?.some((version) => version.headSha === heads.synced);
  return Math.max(after, syncKnowsMore ? 1 : 0);
}

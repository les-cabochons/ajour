import type {
  CodeHostApproval,
  CodeHostCheck,
  CodeHostPullRequestFacts,
} from "@ajour/shared";
import {
  approvalsSummary,
  checksSummary,
  personName,
  rollupSummary,
} from "@/domain/deck/review-status";

/*
 * What stands between a pull request and its merge, as Deck's dock and
 * its Status view read it: the draft state, conflicts with the base
 * branch, the checks, the reviewers' votes and, for a layer of a stack,
 * the layer below. Ajour reads these from the code host but not the rules
 * its branch policies apply, so each requirement says what it found, and
 * the merge itself stays the code host's to allow.
 */

export type RequirementState = "met" | "pending" | "failed";

export interface MergeRequirement {
  key: "draft" | "conflicts" | "checks" | "reviews" | "stack";
  state: RequirementState;
  text: string;
}

export type MergeReadinessState =
  "merged" | "closed" | "blocked" | "waiting" | "ready";

export interface MergeReadiness {
  state: MergeReadinessState;
  /** "Merge blocked", "Waiting", "Ready to merge", "Merged" or "Closed". */
  label: string;
  requirements: MergeRequirement[];
  /** The requirements not met yet. */
  left: number;
}

const labels: Record<MergeReadinessState, string> = {
  merged: "Merged",
  closed: "Closed",
  blocked: "Merge blocked",
  waiting: "Waiting",
  ready: "Ready to merge",
};

const names = (approvals: readonly CodeHostApproval[]) =>
  approvals.map((approval) => personName(approval.reviewer)).join(", ");

function reviewsRequirement(
  approvals: readonly CodeHostApproval[],
): MergeRequirement {
  const against = approvals.filter(
    (approval) =>
      approval.vote === "changes_requested" || approval.vote === "rejected",
  );
  if (against.length)
    return {
      key: "reviews",
      state: "failed",
      text: `Changes requested by ${names(against)}`,
    };
  const waiting = approvals.filter(
    (approval) => approval.required && approval.vote !== "approved",
  );
  if (waiting.length)
    return {
      key: "reviews",
      state: "pending",
      text: `Waiting for ${names(waiting)}`,
    };
  const approved = approvals.some((approval) => approval.vote === "approved");
  return {
    key: "reviews",
    state: approved ? "met" : "pending",
    text: approvalsSummary(approvals),
  };
}

export function mergeReadiness({
  facts,
  checks,
  approvals,
  mergesAfter,
}: {
  facts: CodeHostPullRequestFacts;
  /** Each check on the head, once read; the synced rollup until then. */
  checks: readonly CodeHostCheck[] | undefined;
  approvals: readonly CodeHostApproval[];
  /** The layer below in its stack, which merges first. */
  mergesAfter?: number;
}): MergeReadiness {
  const base = facts.baseRef ?? "its base branch";
  const requirements: MergeRequirement[] = [];
  if (facts.state === "open" && facts.draft)
    requirements.push({ key: "draft", state: "failed", text: "Draft" });
  requirements.push(
    facts.mergeability === "conflicting"
      ? { key: "conflicts", state: "failed", text: `Conflicts with ${base}` }
      : facts.mergeability === "mergeable"
        ? { key: "conflicts", state: "met", text: `No conflicts with ${base}` }
        : {
            key: "conflicts",
            state: "pending",
            text: "Conflicts not checked yet",
          },
  );
  const summary = checks ? checksSummary(checks) : rollupSummary(facts.checks);
  const failedChecks = checks
    ? checks.some((check) => check.state === "failure")
    : facts.checks === "failure";
  requirements.push({
    key: "checks",
    state: failedChecks
      ? "failed"
      : summary.tone === "warning"
        ? "pending"
        : "met",
    text: summary.text,
  });
  requirements.push(reviewsRequirement(approvals));
  if (mergesAfter !== undefined)
    requirements.push({
      key: "stack",
      state: "pending",
      text: `Merges after #${mergesAfter}`,
    });
  const left = requirements.filter((entry) => entry.state !== "met").length;
  const state: MergeReadinessState =
    facts.state === "merged"
      ? "merged"
      : facts.state === "closed"
        ? "closed"
        : requirements.some((entry) => entry.state === "failed")
          ? "blocked"
          : left
            ? "waiting"
            : "ready";
  return { state, label: labels[state], requirements, left };
}

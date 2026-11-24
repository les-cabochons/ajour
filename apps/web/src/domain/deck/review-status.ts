import type {
  CodeHostApproval,
  CodeHostCheck,
  CodeHostCheckRunState,
  CodeHostCheckState,
  CodeHostPullRequestFacts,
} from "@ajour/shared";

/*
 * The review page's status line: the pull request's state, its checks and
 * its approvals, as `Open · 2 checks pending · 1 approval`. Pending checks
 * read in the warning tone and passed ones in the success tone; nothing
 * else is colored.
 */

/** A summary's color: only pending and passed checks have one. */
export type StatusTone = "warning" | "success";

export interface StatusSummary {
  text: string;
  tone?: StatusTone;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export function pullRequestStateLabel(facts: CodeHostPullRequestFacts) {
  if (facts.state === "merged") return "Merged";
  if (facts.state === "closed") return "Closed";
  return facts.draft ? "Draft" : "Open";
}

/** The checks on the head, a failure first, then what's pending, then what passed. */
export function checksSummary(checks: readonly CodeHostCheck[]): StatusSummary {
  if (checks.length === 0) return { text: "No checks" };
  const count = (state: CodeHostCheckRunState) =>
    checks.filter((check) => check.state === state).length;
  const failed = count("failure");
  if (failed) return { text: `${plural(failed, "check")} failed` };
  const pending = count("pending");
  if (pending)
    return { text: `${plural(pending, "check")} pending`, tone: "warning" };
  const passed = count("success");
  if (passed)
    return { text: `${plural(passed, "check")} passed`, tone: "success" };
  return { text: `${plural(count("skipped"), "check")} skipped` };
}

/** The synced rollup of the checks, shown until the page reads each check. */
export function rollupSummary(state: CodeHostCheckState): StatusSummary {
  switch (state) {
    case "pending":
      return { text: "Checks pending", tone: "warning" };
    case "success":
      return { text: "Checks passed", tone: "success" };
    case "failure":
      return { text: "Checks failed" };
    default:
      return { text: "No checks" };
  }
}

export const checkStateLabels: Record<CodeHostCheckRunState, string> = {
  pending: "Pending",
  success: "Passed",
  failure: "Failed",
  skipped: "Skipped",
};

export const voteLabels: Record<CodeHostApproval["vote"], string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  none: "No vote yet",
};

/**
 * Each reviewer's vote: the plugin's, or, from a plugin that doesn't send
 * them, each author's latest approval or change request, then each person
 * asked who hasn't given one.
 */
export function approvalsOf(
  facts: CodeHostPullRequestFacts,
): readonly CodeHostApproval[] {
  if (facts.approvals) return facts.approvals;
  const latest = new Map<string, CodeHostApproval & { at: number }>();
  for (const review of facts.reviews) {
    if (review.verdict !== "approved" && review.verdict !== "changes_requested")
      continue;
    const key = review.author.login.toLowerCase();
    const known = latest.get(key);
    if (known && known.at > review.submittedAt) continue;
    latest.set(key, {
      reviewer: review.author,
      vote: review.verdict,
      at: review.submittedAt,
    });
  }
  // In the order the reviewers first gave one.
  const approvals: CodeHostApproval[] = [...latest.values()].map(
    ({ at: _at, ...approval }) => approval,
  );
  for (const request of facts.reviewRequests) {
    if (request.kind !== "user" || latest.has(request.name.toLowerCase()))
      continue;
    approvals.push({
      reviewer: { login: request.name, isBot: false },
      vote: "none",
    });
  }
  return approvals;
}

export function approvalsSummary(approvals: readonly CodeHostApproval[]) {
  const approved = approvals.filter(
    (approval) => approval.vote === "approved",
  ).length;
  return approved ? plural(approved, "approval") : "No approvals yet";
}

/** A user's name as the review page shows it. */
export function personName(user: { login: string; displayName?: string }) {
  return user.displayName ?? user.login;
}

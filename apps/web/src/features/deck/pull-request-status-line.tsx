import type { ReactNode } from "react";
import {
  RiCheckLine as Passed,
  RiCloseLine as Failed,
  RiSubtractLine as Skipped,
} from "@remixicon/react";
import type {
  CodeHostCheck,
  CodeHostCheckRunState,
  CodeHostChecksResult,
} from "@ajour/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  approvalsOf,
  approvalsSummary,
  checksSummary,
  checkStateLabels,
  personName,
  pullRequestStateLabel,
  rollupSummary,
  voteLabels,
  type StatusSummary,
} from "@/domain/deck/review-status";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { openSourceUrl } from "@/lib/source-navigation";
import type { PullRequestReadState } from "./use-pull-request-read";

/** A check's mark: a ring while pending, a tick once passed, a cross once failed. */
function CheckMark({ state }: { state: CodeHostCheckRunState }) {
  if (state === "pending")
    return (
      <span aria-hidden="true" className="deck-check-mark">
        <span className="deck-status-pending" />
      </span>
    );
  const Icon =
    state === "success" ? Passed : state === "failure" ? Failed : Skipped;
  return (
    <Icon
      aria-hidden="true"
      className="deck-check-mark"
      data-tone={state === "success" ? "success" : undefined}
    />
  );
}

function SummaryMark({ summary }: { summary: StatusSummary }) {
  if (summary.tone === "warning") return <CheckMark state="pending" />;
  if (summary.tone === "success") return <CheckMark state="success" />;
  return null;
}

function StatusItem({
  label,
  children,
  menu,
}: {
  /** Names the menu the item opens. */
  label: string;
  children: ReactNode;
  menu: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="deck-status-item"
            aria-label={label}
          />
        }
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto max-w-80">
        {menu}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChecksMenu({
  state,
  pullRequestUrl,
}: {
  state: PullRequestReadState<CodeHostChecksResult>;
  pullRequestUrl: string;
}) {
  const note = (text: string) => (
    <p className="px-3 py-1.5 text-sm text-muted-foreground">{text}</p>
  );
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Checks on the head</DropdownMenuLabel>
      {state.status === "loading"
        ? note("Loading the checks…")
        : state.status === "unavailable"
          ? note("This code host doesn't list its checks yet.")
          : state.status === "error"
            ? note(state.message)
            : state.value.checks.length === 0
              ? note("No checks ran on this pull request.")
              : state.value.checks.map((check: CodeHostCheck, index) => (
                  <DropdownMenuItem
                    key={`${check.name}:${index}`}
                    // A check without a page of its own opens the pull request.
                    onClick={() => openSourceUrl(check.url ?? pullRequestUrl)}
                  >
                    <CheckMark state={check.state} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {check.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {checkStateLabels[check.state]}
                    </span>
                  </DropdownMenuItem>
                ))}
    </DropdownMenuGroup>
  );
}

/**
 * The pull request's status in one line: its state, its checks and its
 * approvals, as `Open · 2 checks pending · 1 approval`. The checks and the
 * approvals each open a small menu.
 */
export function PullRequestStatusLine({
  pullRequest,
  checks,
}: {
  pullRequest: LocalPullRequest;
  checks: PullRequestReadState<CodeHostChecksResult>;
}) {
  const { facts } = pullRequest;
  const checksText =
    checks.status === "ready"
      ? checksSummary(checks.value.checks)
      : rollupSummary(facts.checks);
  const approvals = approvalsOf(facts);
  return (
    <p className="deck-status-line">
      <span className="deck-status-state">{pullRequestStateLabel(facts)}</span>
      <span aria-hidden="true">·</span>
      <StatusItem
        label={`Checks: ${checksText.text}`}
        menu={<ChecksMenu state={checks} pullRequestUrl={facts.url} />}
      >
        <SummaryMark summary={checksText} />
        {checksText.text}
      </StatusItem>
      <span aria-hidden="true">·</span>
      <StatusItem
        label={`Approvals: ${approvalsSummary(approvals)}`}
        menu={
          <DropdownMenuGroup>
            <DropdownMenuLabel>Reviewers</DropdownMenuLabel>
            {approvals.length === 0 ? (
              <p className="px-3 py-1.5 text-sm text-muted-foreground">
                No one was asked to review.
              </p>
            ) : (
              approvals.map((approval) => (
                <DropdownMenuItem key={approval.reviewer.login}>
                  <span className="min-w-0 flex-1 truncate">
                    {personName(approval.reviewer)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {approval.required
                      ? `${voteLabels[approval.vote]} · Required`
                      : voteLabels[approval.vote]}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuGroup>
        }
      >
        {approvalsSummary(approvals)}
      </StatusItem>
    </p>
  );
}

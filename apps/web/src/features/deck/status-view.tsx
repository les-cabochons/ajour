import type { ReactNode } from "react";
import {
  RiArrowRightUpLine as External,
  RiCheckLine as Passed,
  RiCloseLine as Failed,
  RiSubtractLine as Skipped,
} from "@remixicon/react";
import type {
  CodeHostApproval,
  CodeHostCheckRunState,
  CodeHostChecksResult,
  CodeHostMergeMethod,
} from "@ajour/shared";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { mergeMethodLabels } from "@/domain/deck/author-actions";
import type {
  MergeReadiness,
  RequirementState,
} from "@/domain/deck/merge-readiness";
import {
  checkStateLabels,
  personName,
  voteLabels,
} from "@/domain/deck/review-status";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { openSourceUrl } from "@/lib/source-navigation";
import { PluginUpdateLink } from "./plugin-update-link";
import type { PullRequestReadState } from "./use-pull-request-read";

/*
 * Deck's Status view: what the code host says about merging the pull
 * request. What is left first, then the reviewers and their votes, each
 * check on the head with its page, and the branches and the merge methods
 * the repository allows. It shows in a peek above the dock, or in the side
 * panel once pinned.
 */

/** A check's mark: a ring while pending, a tick once passed, a cross once failed. */
export function CheckMark({ state }: { state: CodeHostCheckRunState }) {
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
      data-tone={
        state === "success"
          ? "success"
          : state === "failure"
            ? "failure"
            : undefined
      }
    />
  );
}

const markOf: Record<RequirementState, CodeHostCheckRunState> = {
  met: "success",
  pending: "pending",
  failed: "failure",
};

/** A requirement's mark, as a check's. */
export function RequirementMark({ state }: { state: RequirementState }) {
  return <CheckMark state={markOf[state]} />;
}

const voteMark: Record<CodeHostApproval["vote"], CodeHostCheckRunState> = {
  approved: "success",
  changes_requested: "failure",
  rejected: "failure",
  none: "pending",
};

function Group({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="deck-view-group" aria-label={title}>
      <h3 className="deck-view-group-title">
        <span>{title}</span>
        {trailing !== undefined ? (
          <span className="deck-view-group-trailing">{trailing}</span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

function Checks({
  state,
  pullRequestUrl,
}: {
  state: PullRequestReadState<CodeHostChecksResult>;
  pullRequestUrl: string;
}) {
  if (state.status === "loading")
    return <p className="deck-view-note">Loading the checks…</p>;
  if (state.status === "unavailable")
    return (
      <p className="deck-view-note">
        {state.message}
        {state.update ? (
          <>
            {" "}
            <PluginUpdateLink />
          </>
        ) : null}
      </p>
    );
  if (state.status === "error")
    return <p className="deck-view-note">{state.message}</p>;
  if (state.value.checks.length === 0)
    return (
      <p className="deck-view-note">No checks ran on this pull request.</p>
    );
  return (
    <ul className="deck-view-list">
      {state.value.checks.map((check, index) => (
        <li key={`${check.name}:${index}`}>
          <button
            type="button"
            className="deck-view-row deck-view-link"
            // A check without a page of its own opens the pull request.
            onClick={() => openSourceUrl(check.url ?? pullRequestUrl)}
          >
            <CheckMark state={check.state} />
            <span className="deck-view-row-name">{check.name}</span>
            <span className="deck-view-row-detail">
              {checkStateLabels[check.state]}
            </span>
            <External aria-hidden="true" className="deck-view-external" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function StatusView({
  pullRequest,
  readiness,
  approvals,
  checks,
  methods,
}: {
  pullRequest: LocalPullRequest;
  readiness: MergeReadiness;
  approvals: readonly CodeHostApproval[];
  checks: PullRequestReadState<CodeHostChecksResult>;
  /** The merge methods the repository allows, once read. */
  methods: readonly CodeHostMergeMethod[] | undefined;
}) {
  const { facts, pluginId, pluginName } = pullRequest;
  const labels = mergeMethodLabels(pluginId);
  const open = facts.state === "open";
  return (
    <div className="deck-view deck-status-view">
      <p className="deck-view-lead">
        <span className="deck-view-lead-title">{readiness.label}</span>
        {open ? (
          <span className="deck-view-group-trailing">
            {readiness.left
              ? `${readiness.left} ${readiness.left === 1 ? "requirement" : "requirements"} left`
              : "Nothing left"}
          </span>
        ) : null}
      </p>
      {open ? (
        <Group title="Requirements">
          <ul className="deck-view-list">
            {readiness.requirements.map((requirement) => (
              <li key={requirement.key} className="deck-view-row">
                <RequirementMark state={requirement.state} />
                <span className="deck-view-row-name">{requirement.text}</span>
              </li>
            ))}
          </ul>
          <p className="deck-view-note">
            {`${pluginName} decides what blocks the merge; Ajour shows what it read.`}
          </p>
        </Group>
      ) : null}
      <Group
        title="Reviewers"
        trailing={`${approvals.filter((approval) => approval.vote === "approved").length} approved`}
      >
        {approvals.length === 0 ? (
          <p className="deck-view-note">No one was asked to review.</p>
        ) : (
          <ul className="deck-view-list">
            {approvals.map((approval) => (
              <li key={approval.reviewer.login} className="deck-view-row">
                <CheckMark state={voteMark[approval.vote]} />
                <span className="deck-view-row-name">
                  {personName(approval.reviewer)}
                </span>
                {approval.required ? <Chip>Required</Chip> : null}
                <span className="deck-view-row-detail">
                  {voteLabels[approval.vote]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Group>
      <Group title="Checks">
        <Checks state={checks} pullRequestUrl={facts.url} />
      </Group>
      <Group title="Branches">
        <p className="deck-view-row">
          <span className="deck-view-row-name deck-view-branches">
            {facts.headRef ? <code>{facts.headRef}</code> : "This branch"}
            {" → "}
            {facts.baseRef ? <code>{facts.baseRef}</code> : "its base branch"}
          </span>
        </p>
        {open ? (
          <p className="deck-view-note">
            {methods === undefined
              ? "Reading the merge methods…"
              : methods.length
                ? `Merges with ${methods.map((method) => labels[method]).join(", ")}.`
                : "The repository allows no merge method Deck offers."}
          </p>
        ) : null}
      </Group>
      <p className="deck-view-footer">
        {`Opened by ${personName(facts.author)}`}
        <Button
          variant="ghost"
          size="xs"
          className="deck-view-open"
          onClick={() => openSourceUrl(facts.url)}
        >
          {`Open in ${pluginName}`}
        </Button>
      </p>
    </div>
  );
}

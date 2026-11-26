import { Fragment } from "react";
import {
  RiArrowDownSLine as Down,
  RiCheckLine as Check,
} from "@remixicon/react";
import type { CodeHostVersion, CodeHostVersionsResult } from "@ajour/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toggle } from "@/components/ui/toggle";
import { Value } from "@/components/ui/value";
import { scopeLine, versionNames } from "@/domain/deck/versions";
import { EventTime } from "./review-thread-card";
import type {
  PullRequestReadState,
  SinceReviewState,
} from "./use-pull-request-read";

/*
 * The versions bar (#787), sticky above the diff: each push, or iteration,
 * the one the user reviewed checked, ▾ for each one's commits, and the
 * "Changes since your review" filter with its count. Its second row names
 * what the diff compares.
 */

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** The first 7 characters of a commit, as the code hosts show it. */
const shortSha = (sha: string) => sha.slice(0, 7);

function VersionsMenu({
  versions,
  shown,
  reviewed,
  names,
}: {
  versions: readonly CodeHostVersion[];
  shown: CodeHostVersion | undefined;
  reviewed: CodeHostVersion | undefined;
  names: ReturnType<typeof versionNames>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="deck-versions-list"
            aria-label={`${names.plural} and their commits`}
          />
        }
      >
        <span className="deck-versions-items">
          {versions.map((version, index) => (
            <Fragment key={version.number}>
              {index ? <span aria-hidden="true">·</span> : null}
              <span
                className="deck-version"
                data-shown={version === shown || undefined}
              >
                {`v${version.number}`}
              </span>
              {version === reviewed ? (
                <Check
                  role="img"
                  aria-label={`You reviewed v${version.number}`}
                  className="deck-version-reviewed"
                />
              ) : null}
            </Fragment>
          ))}
        </span>
        <Down aria-hidden="true" className="deck-versions-more" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto max-w-96">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{`${names.plural} and their commits`}</DropdownMenuLabel>
          {[...versions].reverse().map((version) => (
            <DropdownMenuItem
              key={version.number}
              className="deck-version-item"
            >
              <Value className="deck-version-number">{`v${version.number}`}</Value>
              <span className="deck-version-detail">
                <span>
                  {version.forced ? "Force-pushed · " : ""}
                  {plural(version.commits.length, "commit")} ·{" "}
                  <EventTime at={version.pushedAt} />
                  {version === reviewed ? " · You reviewed this" : ""}
                </span>
                {version.commits.map((commit) => (
                  <span key={commit.sha} className="deck-version-commit">
                    <Value tone="muted">{shortSha(commit.sha)}</Value>
                    <span className="truncate">{commit.headline}</span>
                  </span>
                ))}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function VersionsBar({
  versions,
  retryVersions,
  shownHead,
  reviewed,
  since,
  retrySince,
  changed,
  filtering,
  onFilter,
  hunkCount,
  shownCount,
  baseRef,
}: {
  versions: PullRequestReadState<CodeHostVersionsResult>;
  retryVersions: () => void;
  /** The head of the diff on screen. */
  shownHead: string;
  reviewed: CodeHostVersion | undefined;
  since: SinceReviewState;
  retrySince: () => void;
  /** The hunks changed since the version reviewed, once known. */
  changed: ReadonlyMap<string, number> | undefined;
  filtering: boolean;
  onFilter: (filtering: boolean) => void;
  /** Every hunk of the diff, and the ones the filter shows. */
  hunkCount: number;
  shownCount: number;
  baseRef: string | undefined;
}) {
  const list = versions.status === "ready" ? versions.value : undefined;
  const names = versionNames(list?.versionName);
  const shown = list?.versions.find((version) => version.headSha === shownHead);
  const canFilter = !!reviewed && changed !== undefined;
  const counted = canFilter
    ? String(changed.size)
    : since.status === "loading"
      ? "…"
      : "–";
  const detail = !list ? null : !reviewed ? (
    "You haven't reviewed this pull request yet."
  ) : since.status === "loading" ? (
    `Comparing with v${reviewed.number}…`
  ) : since.status === "error" || since.status === "unavailable" ? (
    <>
      {since.message}
      {since.status === "error" ? (
        <Button variant="ghost" size="xs" onClick={retrySince}>
          Retry
        </Button>
      ) : null}
    </>
  ) : filtering ? (
    `${shownCount} of ${plural(hunkCount, "hunk")} changed since your review of v${reviewed.number}`
  ) : null;
  return (
    <section className="deck-versions" aria-label={names.plural}>
      <div className="deck-versions-row">
        <span className="deck-versions-label">{names.plural}</span>
        {versions.status === "loading" ? (
          <span className="deck-versions-note">Loading…</span>
        ) : versions.status !== "ready" ? (
          <span className="deck-versions-note">
            {versions.message}
            {versions.status === "error" ? (
              <Button variant="ghost" size="xs" onClick={retryVersions}>
                Retry
              </Button>
            ) : null}
          </span>
        ) : (
          <>
            <VersionsMenu
              versions={versions.value.versions}
              shown={shown}
              reviewed={reviewed}
              names={names}
            />
            <span className="deck-versions-divider" aria-hidden="true" />
            <Toggle
              size="sm"
              variant="outline"
              className="deck-versions-since"
              pressed={filtering && canFilter}
              disabled={!canFilter}
              onPressedChange={onFilter}
              aria-label={`Changes since your review ${counted}`}
            >
              <span className="deck-versions-since-wide">
                Changes since your review
              </span>
              <span className="deck-versions-since-narrow">Since review</span>
              <Value className="deck-versions-count">{counted}</Value>
            </Toggle>
          </>
        )}
      </div>
      <div className="deck-versions-scope">
        <span className="deck-versions-scope-text">{scopeLine(baseRef)}</span>
        <span className="deck-versions-detail">
          {detail ??
            (shown
              ? `v${shown.number} · ${plural(hunkCount, "hunk")}`
              : plural(hunkCount, "hunk"))}
        </span>
      </div>
    </section>
  );
}

/**
 * New pushes during a review: the banner over the diff, which stays as it
 * is until the user refreshes.
 */
export function NewPushesBanner({
  count,
  names,
  onRefresh,
}: {
  count: number;
  names: ReturnType<typeof versionNames>;
  onRefresh: () => void;
}) {
  const what = count === 1 ? names.one : names.plural;
  return (
    <div
      role="status"
      aria-label={`New ${names.plural.toLowerCase()}`}
      className="deck-new-pushes"
    >
      <span className="flex-1">
        {`${count} new ${what.toLowerCase()} since you opened this pull request. The changes stay as they are until you refresh.`}
      </span>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  );
}

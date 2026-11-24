import { memo, useId } from "react";
import type { DeckFile, DeckPullRequestDiff } from "@ajour/shared/deck";
import { MessagePanel } from "@/components/app-surface";
import { DiffHunk } from "@/components/diff-hunk";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import {
  fileNote,
  fileWithoutLines,
  hunkLabel,
  hunkRowCount,
} from "@/domain/deck/review-diff";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { useResolvedTheme } from "@/lib/use-theme";
import { usePullRequestDiff } from "./use-pull-request-diff";

/** One file of the diff: its path, then its hunks in order. */
const ChangedFile = memo(function ChangedFile({
  file,
  theme,
}: {
  file: DeckFile;
  theme: "light" | "dark";
}) {
  const headingId = useId();
  const withoutLines = fileWithoutLines(file);
  const note = fileNote(file);
  return (
    <section className="deck-file" aria-labelledby={headingId}>
      <header className="deck-file-header">
        <h3 id={headingId} className="deck-file-path">
          {file.path}
        </h3>
        {note ? <span className="deck-file-note">{note}</span> : null}
      </header>
      {withoutLines ? (
        <p className="deck-file-empty">{withoutLines}</p>
      ) : (
        file.hunks.map((hunk) => (
          <DiffHunk
            key={hunk.id}
            patch={hunk.patch}
            rows={hunkRowCount(hunk)}
            label={hunkLabel(file, hunk)}
            theme={theme}
          />
        ))
      )}
    </section>
  );
});

function ChangedFiles({ diff }: { diff: DeckPullRequestDiff }) {
  const theme = useResolvedTheme();
  return diff.files.length ? (
    diff.files.map((file) => (
      <ChangedFile key={file.path} file={file} theme={theme} />
    ))
  ) : (
    <p className="deck-file-empty">This pull request changes no files.</p>
  );
}

/** The pull request's changes: every file's hunks, in file order. */
export function PullRequestChanges({
  pullRequest,
}: {
  pullRequest: LocalPullRequest;
}) {
  const { state, retry } = usePullRequestDiff(pullRequest);
  return (
    // Named outright: the heading's file count would join its name.
    <section className="deck-changes" aria-label="Changes">
      <SectionHeading
        trailing={
          state.status === "ready" ? state.diff.files.length : undefined
        }
      >
        Changes
      </SectionHeading>
      {state.status === "loading" ? (
        <p role="status" className="deck-file-empty">
          Loading the changes…
        </p>
      ) : state.status === "unavailable" ? (
        <p className="deck-file-empty">{state.message}</p>
      ) : state.status === "error" ? (
        <MessagePanel role="alert" className="flex items-center gap-3">
          <span className="flex-1">{state.message}</span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </MessagePanel>
      ) : (
        <ChangedFiles diff={state.diff} />
      )}
    </section>
  );
}

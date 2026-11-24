import { memo, useId } from "react";
import type { DeckFile, DeckPullRequestDiff } from "@ajour/shared/deck";
import { MessagePanel } from "@/components/app-surface";
import { DiffHunk } from "@/components/diff-hunk";
import { Button } from "@/components/ui/button";
import {
  fileWithoutLines,
  hunkLabel,
  hunkPatch,
} from "@/domain/deck/review-diff";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { useResolvedTheme } from "@/lib/use-theme";
import { usePullRequestDiff } from "./use-pull-request-diff";

const STATUS_NOTES: Partial<Record<DeckFile["status"], string>> = {
  added: "Added",
  deleted: "Deleted",
};

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
  const note =
    file.status === "renamed" && file.previousPath
      ? `Renamed from ${file.previousPath}`
      : STATUS_NOTES[file.status];
  return (
    <section className="deck-file" aria-labelledby={headingId}>
      <header className="deck-file-header">
        <h2 id={headingId} className="deck-file-path">
          {file.path}
        </h2>
        {note ? <span className="deck-file-note">{note}</span> : null}
      </header>
      {withoutLines ? (
        <p className="deck-file-empty">{withoutLines}</p>
      ) : (
        file.hunks.map((hunk) => (
          <DiffHunk
            key={hunk.id}
            patch={hunkPatch(file, hunk)}
            lineCount={hunk.lines.length}
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
  return (
    <section className="deck-changes" aria-label="Changes">
      {diff.files.length ? (
        diff.files.map((file) => (
          <ChangedFile key={file.path} file={file} theme={theme} />
        ))
      ) : (
        <p className="deck-file-empty">This pull request changes no files.</p>
      )}
    </section>
  );
}

/** The pull request's changes: every file's hunks, in file order. */
export function PullRequestChanges({
  pullRequest,
}: {
  pullRequest: LocalPullRequest;
}) {
  const { state, retry } = usePullRequestDiff(pullRequest);
  if (state.status === "loading")
    return (
      <p role="status" className="deck-file-empty">
        Loading the changes…
      </p>
    );
  if (state.status === "error")
    return (
      <MessagePanel role="alert" className="flex items-center gap-3">
        <span className="flex-1">{state.message}</span>
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      </MessagePanel>
    );
  return <ChangedFiles diff={state.diff} />;
}

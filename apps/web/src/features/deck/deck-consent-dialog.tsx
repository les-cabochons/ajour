import {
  repositoryName,
  type DeckConsentCovers,
  type DeckNeedsConsent,
} from "@ajour/shared/deck";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * What the dialog's list says leaves the machine: the code, and the
 * description and linked tickets a regroup sends (#794). Allow records
 * this, so a change to the list changes it too.
 */
const LISTED_COVERS: DeckConsentCovers = "context";

/**
 * The once-per-repository consent of Deck's asks (#791): it names the agent
 * and its version and says what leaves the machine. Allow records it, for
 * what the list names; Not now sends nothing. A repository allowed before
 * Regroup sent more asks again before its first regroup (#794), and says
 * why.
 */
export function DeckConsentDialog({
  request,
  onAnswer,
}: {
  /** The refusal that asks, or undefined while closed. */
  request: DeckNeedsConsent | undefined;
  /** What Allow covers, or null for Not now. */
  onAnswer: (covers: DeckConsentCovers | null) => void;
}) {
  const provider = request
    ? [request.provider.label, request.provider.version]
        .filter(Boolean)
        .join(" ")
    : "";
  return (
    <AlertDialog
      open={request !== undefined}
      onOpenChange={(open) => {
        if (!open) onAnswer(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {request
              ? `Ajour asks ${request.again ? "again" : "once"} for ${repositoryName(request.repository)}`
              : null}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {request?.again
              ? "You allowed questions about this repository. A regroup also sends the pull request's description and its linked tickets, so Ajour asks again. "
              : null}
            To answer, Ajour sends this repository's pull requests to {provider}
            , which runs on your computer and sends what it reads to its
            provider.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="text-sm">
          <p>What leaves this computer, for each question or regroup:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>the changed lines the question is about;</li>
            <li>any other hunks and changed files it reads;</li>
            <li>the review threads and their comments;</li>
            <li>
              the files it reads in your local clone, when you choose one;
            </li>
            <li>your question, when you type one;</li>
            <li>
              for a regroup, the pull request's description and its linked
              tickets.
            </li>
          </ul>
          <p className="mt-2 text-muted-foreground">
            Nothing is sent before you ask. Settings › Agents lists the
            repositories you allowed, with Revoke.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={() => onAnswer(LISTED_COVERS)}>
            Allow
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

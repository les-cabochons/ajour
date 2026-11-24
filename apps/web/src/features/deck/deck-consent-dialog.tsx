import type { DeckNeedsConsent } from "@ajour/shared/deck";
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

/** The repository's own name, without its owner: `billing-api`. */
export const repositoryName = (repository: string) =>
  repository.slice(repository.lastIndexOf("/") + 1) || repository;

/**
 * The once-per-repository consent of Deck's asks (#791): it names the agent
 * and its version and says what leaves the machine. Allow records it; Not
 * now sends nothing.
 */
export function DeckConsentDialog({
  request,
  onAnswer,
}: {
  /** The refusal that asks, or undefined while closed. */
  request: DeckNeedsConsent | undefined;
  onAnswer: (allowed: boolean) => void;
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
        if (!open) onAnswer(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {request
              ? `Ajour asks once for ${repositoryName(request.repository)}`
              : null}
          </AlertDialogTitle>
          <AlertDialogDescription>
            To answer, Ajour sends this repository's pull requests to {provider}
            , which runs on your computer and sends what it reads to its
            provider.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="text-sm">
          <p>What leaves this computer, for each question:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>the changed lines the question is about;</li>
            <li>any other hunks and changed files it reads;</li>
            <li>the review threads and their comments;</li>
            <li>your question, when you type one.</li>
          </ul>
          <p className="mt-2 text-muted-foreground">
            Nothing is sent before you ask. Settings › Agents lists the
            repositories you allowed, with Revoke.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={() => onAnswer(true)}>
            Allow
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

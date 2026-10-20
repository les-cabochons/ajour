import { useEffect, useState } from "react";
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
import { buttonVariants } from "@/components/ui/button";

/** A save of a description whose conversion to Markdown lost something. */
export interface LossySaveRequest {
  /** What the conversion lost, such as "text colour". */
  lost: readonly string[];
  /** The connection's name, such as "Work". */
  sourceName: string;
  sourceUrl?: string;
}

type PendingRequest = LossySaveRequest & { resolve: (save: boolean) => void };

let show: ((request: PendingRequest) => void) | undefined;

/**
 * Asks before a save writes a description that loses formatting (ADR 0009):
 * the dialog names each loss, with Save anyway, Edit in source and Cancel.
 * Resolves true for Save anyway.
 */
export function confirmLossySave(request: LossySaveRequest): Promise<boolean> {
  const open = show;
  if (!open) return Promise.resolve(false);
  return new Promise((resolve) => open({ ...request, resolve }));
}

/** Shows the dialog `confirmLossySave` asks for. The app shell renders one. */
export function LossySaveDialogHost() {
  const [request, setRequest] = useState<PendingRequest>();
  useEffect(() => {
    show = (next) =>
      setRequest((current) => {
        // A newer save replaces one still asking, which does not save.
        current?.resolve(false);
        return next;
      });
    return () => {
      show = undefined;
    };
  }, []);

  const close = (save: boolean) => {
    request?.resolve(save);
    setRequest(undefined);
  };

  return (
    <AlertDialog
      open={request !== undefined}
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Save and lose formatting?</AlertDialogTitle>
          <AlertDialogDescription>
            Markdown cannot hold some of this description's formatting in{" "}
            {request?.sourceName}. Saving here writes it without:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {request?.lost.map((loss) => (
            <li key={loss}>{loss.charAt(0).toUpperCase() + loss.slice(1)}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {request?.sourceUrl ? (
            <a
              href={request.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline" })}
              onClick={() => close(false)}
            >
              Edit in source
            </a>
          ) : null}
          <AlertDialogAction onClick={() => close(true)}>
            Save anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

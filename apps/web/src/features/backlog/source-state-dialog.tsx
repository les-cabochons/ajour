import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LocalWorkItem } from "@/domain/local-state";

interface SourceStateRequest {
  workItem: LocalWorkItem;
  title: string;
  description: string;
  sourceStatusLabels: string[];
  /** Offers "Move without writing", which resolves to "". */
  allowNoWrite: boolean;
  resolve: (sourceStatusLabel: string | null) => void;
}

let requestListener: ((request: SourceStateRequest) => void) | null = null;

/**
 * Asks which source state to write. Resolves to the chosen state, to "" for
 * "Move without writing", or to null when the user cancels. Without a mounted
 * host it cancels.
 */
export function requestSourceStateChoice(
  request: Omit<SourceStateRequest, "resolve">,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!requestListener) {
      resolve(null);
      return;
    }
    requestListener({ ...request, resolve });
  });
}

/**
 * The source state picker for Ask mappings and Change source state…. Mounted
 * once in the app shell.
 */
export function SourceStateDialogHost() {
  const [request, setRequest] = useState<SourceStateRequest | null>(null);

  useEffect(() => {
    const listener = (next: SourceStateRequest) => {
      setRequest((current) => {
        current?.resolve(null);
        return next;
      });
    };
    requestListener = listener;
    return () => {
      if (requestListener === listener) requestListener = null;
    };
  }, []);

  function answer(sourceStatusLabel: string | null) {
    request?.resolve(sourceStatusLabel);
    setRequest(null);
  }

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => !open && answer(null)}
    >
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader className="gap-1">
          <DialogTitle>{request?.title}</DialogTitle>
          <DialogDescription>{request?.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {request?.sourceStatusLabels.map((label) => (
            <Button
              key={label}
              type="button"
              variant="outline"
              className="justify-start"
              onClick={() => answer(label)}
            >
              {label}
              {label === request.workItem.sourceStatusLabel ? (
                <span className="ml-auto text-muted-foreground">Current</span>
              ) : null}
            </Button>
          ))}
        </div>
        {request?.allowNoWrite ? (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => answer("")}>
              Move without writing
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

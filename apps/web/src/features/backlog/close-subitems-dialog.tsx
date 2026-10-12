import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LocalWorkItem } from "@/domain/local-state";
import { localStore } from "@/lib/local-store";

/** Closing moves an item into a done state; settling waits on someone else. */
export type CloseSubitemsVerb = "close" | "settle";

interface CloseSubitemsRequest {
  workItem: LocalWorkItem;
  subitems: LocalWorkItem[];
  verb: CloseSubitemsVerb;
  resolve: (includeSubitems: boolean | null) => void;
}

let requestListener: ((request: CloseSubitemsRequest) => void) | null = null;

/**
 * Asks whether closing or settling a parent takes its open subitems along.
 * Resolves to the answer, or null when the user cancels. Without a mounted
 * host it leaves the subitems alone.
 */
export function requestCloseSubitemsChoice(
  workItem: LocalWorkItem,
  subitems: LocalWorkItem[],
  verb: CloseSubitemsVerb,
): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (!requestListener) {
      resolve(false);
      return;
    }
    requestListener({ workItem, subitems, verb, resolve });
  });
}

/** The "Also close its subitems?" dialog. Mounted once in the app shell. */
export function CloseSubitemsDialogHost() {
  const [request, setRequest] = useState<CloseSubitemsRequest | null>(null);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const listener = (next: CloseSubitemsRequest) => {
      setRemember(false);
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

  function answer(includeSubitems: boolean | null) {
    if (!request) return;
    if (includeSubitems !== null && remember) {
      localStore.setUserPreferences({
        closeParentSubitems: includeSubitems ? "include" : "leave",
      });
    }
    request.resolve(includeSubitems);
    setRequest(null);
  }

  const count = request?.subitems.length ?? 0;
  const noun = count === 1 ? "subitem" : "subitems";
  const verb = request?.verb === "settle" ? "settle" : "close";

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => !open && answer(null)}
    >
      <DialogContent className="max-w-md gap-4">
        <DialogHeader className="gap-1">
          <DialogTitle>
            Also {verb} its {count} open {noun}?
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {request?.workItem.title}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-[13px]">
          {request?.subitems.map((subitem) => (
            <li key={subitem._id} className="truncate">
              {subitem.title}
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Checkbox
            checked={remember}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          Remember my choice
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => answer(false)}>
            Only this item
          </Button>
          <Button type="button" autoFocus onClick={() => answer(true)}>
            Include {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

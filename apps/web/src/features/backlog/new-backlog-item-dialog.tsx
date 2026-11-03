import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BacklogItemEditorForm } from "@/features/backlog/backlog-item-editor-form";

let requestListener: (() => void) | null = null;

/** A new item has no "…" menu, so the form never runs an action. */
const NO_ACTION = () => {};

/**
 * Opens the New backlog item dialog over the current page, as the sidebar's
 * "+" does. Does nothing until the app shell has mounted the dialog.
 */
export function requestNewBacklogItem() {
  requestListener?.();
}

/**
 * Dialog host for a new manual backlog item. It opens over the current page,
 * so the page and its open editor stay as they are. The app shell mounts it,
 * not the sidebar, so hiding the sidebar with Cmd/Ctrl+B keeps the draft.
 * Save, Cancel, × and Escape close it; a click outside does nothing, so a
 * stray click never drops the draft.
 */
export function NewBacklogItemDialogHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const listener = () => setOpen(true);
    requestListener = listener;
    return () => {
      if (requestListener === listener) requestListener = null;
    };
  }, []);

  if (!open) return null;
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <DialogContent
        className="max-w-xl narrow:max-w-[calc(100%-1rem)]"
        showCloseButton={false}
      >
        <BacklogItemEditorForm
          target={{ kind: "create" }}
          titleAs={DialogTitle}
          surface="dialog"
          onClose={() => setOpen(false)}
          onAction={NO_ACTION}
        />
      </DialogContent>
    </Dialog>
  );
}

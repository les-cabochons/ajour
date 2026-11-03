import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BacklogItemEditorForm } from "@/features/backlog/backlog-item-editor-form";
import {
  createBacklogTaskEditorSeed,
  type BacklogTaskEditorFields,
} from "@/features/backlog/backlog-task-editor";

/** What a new item starts with. */
export interface NewBacklogItemPreset {
  /** The project the item starts in, such as the sidebar filter's. */
  projectId?: string;
}

let requestListener: ((preset: NewBacklogItemPreset) => void) | null = null;

/** A new item has no "…" menu, so the form never runs an action. */
const NO_ACTION = () => {};

/**
 * Opens the New backlog item dialog over the current page, as the sidebar's
 * "+" does. Does nothing until the app shell has mounted the dialog.
 */
export function requestNewBacklogItem(preset: NewBacklogItemPreset = {}) {
  requestListener?.(preset);
}

/**
 * Dialog host for a new manual backlog item. It opens over the current page,
 * so the page and its open editor stay as they are. The app shell mounts it,
 * not the sidebar, so hiding the sidebar with Cmd/Ctrl+B keeps the draft.
 * Save, Cancel, × and Escape close it; a click outside does nothing, so a
 * stray click never drops the draft.
 */
export function NewBacklogItemDialogHost() {
  /** The draft's starting fields while the dialog is open, else null. */
  const [initial, setInitial] = useState<BacklogTaskEditorFields | null>(null);

  useEffect(() => {
    const listener = ({ projectId }: NewBacklogItemPreset) =>
      setInitial({
        ...createBacklogTaskEditorSeed({ kind: "create" }),
        ...(projectId ? { projectId } : {}),
      });
    requestListener = listener;
    return () => {
      if (requestListener === listener) requestListener = null;
    };
  }, []);

  if (!initial) return null;
  const close = () => setInitial(null);
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) close();
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
          initialFields={initial}
          onClose={close}
          onAction={NO_ACTION}
        />
      </DialogContent>
    </Dialog>
  );
}

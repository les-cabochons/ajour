import { useEffect } from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { RiCloseLine } from "@remixicon/react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How long an Undo toast stays. Hovering or focusing the toasts pauses it. */
export const UNDO_TOAST_TIMEOUT_MS = 8000;

interface ToastData {
  /** Present on Undo toasts. The Undo button and Cmd+Z / Ctrl+Z call it. */
  onUndo?: () => void;
  /** A button other than Undo, such as Answer on an agent's question. */
  action?: { label: string; run: () => void };
}

/** One manager for the app, so feature code can show toasts outside React. */
const toastManager = ToastPrimitive.createToastManager<ToastData>();

/** The open Undo toast. Only the last action can be undone, so a new one replaces it. */
let undoToastId: string | undefined;

/**
 * Shows a toast with an Undo button for an action that already happened.
 * `onUndo` runs once, from the button or Cmd+Z / Ctrl+Z, then the toast closes.
 * `onClose` runs when the toast closes for any reason, including after Undo.
 */
export function showUndoToast({
  title,
  onUndo,
  onClose,
}: {
  title: string;
  onUndo: () => void;
  onClose?: () => void;
}) {
  if (undoToastId) toastManager.close(undoToastId);

  let undone = false;
  const id = toastManager.add({
    title,
    timeout: UNDO_TOAST_TIMEOUT_MS,
    data: {
      onUndo: () => {
        if (undone) return;
        undone = true;
        try {
          // Undo before closing: closing runs `onClose`, which may drop the undo.
          onUndo();
        } catch (error) {
          // A refused Undo, such as a stale window's, keeps the toast and lets
          // the user press Undo again.
          undone = false;
          throw error;
        }
        toastManager.close(id);
      },
    },
    onClose: () => {
      if (undoToastId === id) undoToastId = undefined;
      onClose?.();
    },
  });
  undoToastId = id;
}

/** Closes the open Undo toast, for when a later action replaced its undo. */
export function closeUndoToast() {
  if (undoToastId) toastManager.close(undoToastId);
}

/** Shows a short toast with no action, such as an Undo that could not run. */
export function showToast(title: string) {
  toastManager.add({ title });
}

/**
 * Shows a toast with one action button, such as "Answer". It stays until the
 * user acts on it or dismisses it. Returns a function that closes it.
 */
export function showActionToast({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const id = toastManager.add({
    title,
    timeout: 0,
    data: {
      action: {
        label: actionLabel,
        run: () => {
          onAction();
          toastManager.close(id);
        },
      },
    },
  });
  return () => toastManager.close(id);
}

/**
 * Shows an error from background work that has no place on screen, such as an
 * automatic connector sync. It stays until the user dismisses it.
 */
export function showErrorToast({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  toastManager.add({
    title,
    description,
    type: "error",
    timeout: 0,
    priority: "high",
  });
}

/** True when keys typed in `target` edit text, so Cmd+Z belongs to the field. */
function isTextField(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) {
    return true;
  }
  if (!(target instanceof HTMLInputElement)) return false;

  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(target.type);
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager<ToastData>();

  // Cmd+Z / Ctrl+Z presses Undo on the newest Undo toast still showing.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "z" ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented ||
        isTextField(event.target)
      ) {
        return;
      }

      const undoToast = toasts.find(
        (toast) =>
          toast.data?.onUndo &&
          toast.transitionStatus !== "ending" &&
          !toast.limited,
      );
      if (!undoToast) return;

      event.preventDefault();
      undoToast.data?.onUndo?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toasts]);

  return toasts.map((toast) => (
    <ToastPrimitive.Root
      key={toast.id}
      toast={toast}
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-border bg-popover py-2 pr-2 pl-4 text-[length:var(--control-font-size)] text-popover-foreground shadow-[var(--shadow-popup)] transition-[opacity,transform] duration-150 data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0",
        toast.type === "error" && "items-start border-destructive/50",
      )}
    >
      <ToastPrimitive.Content className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ToastPrimitive.Title
            // Titles wrap, so a refusal such as the lock message reads whole.
            className={cn(
              "font-medium [overflow-wrap:anywhere]",
              toast.type === "error" && "text-destructive",
            )}
          />
          <ToastPrimitive.Description className="[overflow-wrap:anywhere] text-muted-foreground" />
        </div>
        {toast.data?.onUndo ? (
          <ToastPrimitive.Action
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            onClick={toast.data.onUndo}
          >
            Undo
          </ToastPrimitive.Action>
        ) : null}
        {toast.data?.action ? (
          <ToastPrimitive.Action
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            onClick={toast.data.action.run}
          >
            {toast.data.action.label}
          </ToastPrimitive.Action>
        ) : null}
      </ToastPrimitive.Content>
      <ToastPrimitive.Close
        aria-label="Dismiss"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
      >
        <RiCloseLine />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  ));
}

/**
 * Renders the app's toasts: bottom right in a full window, bottom center in the
 * narrow view (the `narrow` variant from `lib/breakpoints.ts`). At most three
 * show, newest on top. While the agent indicator shows in a full window, the
 * viewport sits above it (`--agent-indicator-clearance`). In the narrow view
 * the indicator sits beside the navigation toggle, below the toasts. Mount it
 * once at the app root.
 */
export function Toaster() {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} limit={3}>
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport
          className={cn(
            "fixed right-4 bottom-[calc(1rem+var(--agent-indicator-clearance,0px))] z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 outline-none",
            "narrow:right-auto narrow:bottom-[var(--narrow-nav-clearance)] narrow:left-1/2 narrow:-translate-x-1/2",
          )}
        >
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}

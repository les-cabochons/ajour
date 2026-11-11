import { usePortalContainer } from "@/components/ui/portal-container";
import { useEffect } from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { RiCloseLine } from "@remixicon/react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { withEventAttribution } from "@/lib/wide-events";

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

/** The open Undo toast. Only the newest action shows one, so a new one replaces it. */
let undoToastId: string | undefined;

/**
 * Cmd+Z / Ctrl+Z when no Undo toast shows: undoes an earlier action, newest
 * first. Returns false when there is nothing left to undo.
 */
let undoShortcutFallback: (() => boolean) | undefined;

/** Sets what Cmd+Z / Ctrl+Z does once the Undo toasts have closed. */
export function setUndoShortcutFallback(fallback: () => boolean) {
  undoShortcutFallback = fallback;
}

/**
 * Shows a toast with an Undo button for an action that already happened.
 * `onUndo` runs once, from the button or Cmd+Z / Ctrl+Z, then the toast closes.
 * `onClose` runs when the toast closes for any reason, including after Undo.
 */
export function showUndoToast({
  title,
  onUndo,
  onClose,
  action,
}: {
  title: string;
  onUndo: () => void;
  onClose?: () => void;
  /** A second button after Undo, such as Change. It closes the toast. */
  action?: { label: string; run: () => void };
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
      ...(action
        ? {
            action: {
              label: action.label,
              run: () => {
                action.run();
                toastManager.close(id);
              },
            },
          }
        : {}),
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
 * user acts on it or dismisses it, or for `timeout`. Returns a function that
 * closes it.
 */
export function showActionToast({
  title,
  actionLabel,
  onAction,
  timeout = 0,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  /** How long it shows, in milliseconds. 0, the default, keeps it until dismissed. */
  timeout?: number;
}) {
  const id = toastManager.add({
    title,
    timeout,
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
 * automatic backlog sync. It stays until the user dismisses it. A toast with
 * the `id` of one still showing replaces its text in place instead of
 * stacking a new toast; once dismissed, the same `id` shows a new one.
 */
export function showErrorToast({
  id,
  title,
  description,
}: {
  id?: string;
  title: string;
  /** Line breaks show as separate lines. */
  description?: string;
}) {
  toastManager.add({
    id,
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

  // Cmd+Z / Ctrl+Z presses Undo on the newest Undo toast still showing, and
  // with none showing, undoes the newest earlier action still kept.
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
      if (!undoToast) {
        const fallback = undoShortcutFallback;
        if (!fallback) return;
        const undid = withEventAttribution({ surface: "shortcut" }, fallback);
        if (undid) event.preventDefault();
        return;
      }

      event.preventDefault();
      withEventAttribution({ surface: "shortcut" }, () =>
        undoToast.data?.onUndo?.(),
      );
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toasts]);

  return toasts.map((toast) => (
    <ToastPrimitive.Root
      key={toast.id}
      toast={toast}
      // A toast on its way out, such as one a newer Undo replaced, leaves
      // the accessibility tree at once, so only the newest Undo is found.
      aria-hidden={toast.transitionStatus === "ending" ? true : undefined}
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
          <ToastPrimitive.Description className="[overflow-wrap:anywhere] whitespace-pre-line text-muted-foreground" />
        </div>
        {toast.data?.onUndo ? (
          <ToastPrimitive.Action
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            onClick={() => {
              const onUndo = toast.data?.onUndo;
              if (onUndo) withEventAttribution({ surface: "toast" }, onUndo);
            }}
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
      <ToastPrimitive.Portal container={usePortalContainer()}>
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

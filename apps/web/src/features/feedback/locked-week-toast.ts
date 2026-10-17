import { showToast } from "@/components/ui/toast";
import { LockedWeekError } from "@/domain/time/locked-weeks";
import { StaleWindowError } from "@/lib/stale-window-error";

/**
 * Shows Ajour's refusal of a write to a submitted week as a toast. Every local
 * store write runs the lock check and throws `LockedWeekError`, and React
 * reports an error thrown in an event handler to the window. So this one
 * listener covers every write path without a disabled state of its own:
 * Cmd+V, Start and Stop, Continue, the command palette, Undo and imports.
 * It also shows `StaleWindowError`, the refusal of a write made before this
 * window read another window's Submit or Reopen. Other errors pass through
 * untouched.
 */
export function installLockedWeekToast(
  target: Pick<EventTarget, "addEventListener"> = window,
) {
  const show = (event: Event, error: unknown) => {
    if (
      !(error instanceof LockedWeekError) &&
      !(error instanceof StaleWindowError)
    ) {
      return;
    }
    event.preventDefault();
    showToast(error.message);
  };
  target.addEventListener("error", (event) =>
    show(event, (event as ErrorEvent).error),
  );
  target.addEventListener("unhandledrejection", (event) =>
    show(event, (event as PromiseRejectionEvent).reason),
  );
}

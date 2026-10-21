import { showToast } from "@/components/ui/toast";
import { LockedWeekError } from "@/domain/time/locked-weeks";
import { StaleWindowError } from "@/lib/stale-window-error";
import { storeCommandThatThrew } from "@/lib/store-command-events";
import { wideEvents } from "@/lib/wide-events";

/**
 * The renderer's handler for uncaught errors and unhandled rejections. Each
 * one emits an `app.error` event, with the store command it came from when a
 * store command threw it, and its message only once scrubbed.
 *
 * It also shows Ajour's refusal of a write to a submitted week as a toast.
 * Every local store write runs the lock check and throws `LockedWeekError`,
 * and React reports an error thrown in an event handler to the window. So
 * this one listener covers every write path without a disabled state of its
 * own: Cmd+V, Start and Stop, Continue, the command palette, Undo and
 * imports. It also shows `StaleWindowError`, the refusal of a write made
 * before this window read another window's Submit or Reopen. The command's
 * own event already recorded the refusal. Other errors pass through
 * untouched.
 */
export function installAppErrorHandler(
  target: Pick<EventTarget, "addEventListener"> = window,
) {
  const handle = (
    event: Event,
    error: unknown,
    origin: "uncaught_exception" | "unhandled_rejection",
  ) => {
    const refusal =
      error instanceof LockedWeekError || error instanceof StaleWindowError;
    if (refusal) {
      event.preventDefault();
      showToast(error.message);
    }
    const unit = wideEvents.start("app.error", {
      kind: "crash",
      trigger: "system",
      detached: true,
    });
    unit.set({
      crash: {
        origin,
        active_unit: storeCommandThatThrew(error),
        handled_by_toast: refusal,
      },
    });
    unit.fail(error);
    unit.end();
  };
  target.addEventListener("error", (event) =>
    handle(event, (event as ErrorEvent).error, "uncaught_exception"),
  );
  target.addEventListener("unhandledrejection", (event) =>
    handle(
      event,
      (event as PromiseRejectionEvent).reason,
      "unhandled_rejection",
    ),
  );
}

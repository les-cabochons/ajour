import { webcrypto } from "node:crypto";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LockedWeekError, lockedWeekMessage } from "@/domain/time/locked-weeks";
import { StaleWindowError } from "@/lib/stale-window-error";
import { replaceEventSink } from "@/lib/wide-events";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ showToast }));

import { installAppErrorHandler } from "@/features/feedback/app-error-handler";

function errorEvent(type: "error" | "unhandledrejection", value: unknown) {
  const key = type === "error" ? "error" : "reason";
  return Object.assign(new Event(type, { cancelable: true }), { [key]: value });
}

describe("installAppErrorHandler", () => {
  let sink: ReturnType<typeof createRecordingSink<AjourEvent>>;

  beforeEach(() => {
    showToast.mockClear();
    vi.stubGlobal("crypto", webcrypto);
    sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);
  });

  it("shows a refused write as a toast and stops the error there", () => {
    const target = new EventTarget();
    installAppErrorHandler(target);
    const event = errorEvent("error", new LockedWeekError("2026-10-05"));

    target.dispatchEvent(event);

    expect(showToast).toHaveBeenCalledWith(lockedWeekMessage("2026-10-05"));
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows a refusal from an async handler too", () => {
    const target = new EventTarget();
    installAppErrorHandler(target);

    target.dispatchEvent(
      errorEvent("unhandledrejection", new LockedWeekError("2026-10-12")),
    );

    expect(showToast).toHaveBeenCalledWith(lockedWeekMessage("2026-10-12"));
  });

  it("shows a write refused because another window changed Ajour", () => {
    const target = new EventTarget();
    installAppErrorHandler(target);
    const event = errorEvent("error", new StaleWindowError());

    target.dispatchEvent(event);

    expect(showToast).toHaveBeenCalledWith(
      "Ajour changed in another window. Try again.",
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves every other error to the browser, and records it", () => {
    const target = new EventTarget();
    installAppErrorHandler(target);
    const event = errorEvent("error", new TypeError("Boom at C:\\Users\\ada"));

    target.dispatchEvent(event);

    expect(showToast).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(sink.events).toMatchObject([
      {
        name: "app.error",
        kind: "crash",
        trigger: "system",
        outcome: "error",
        crash: { origin: "uncaught_exception", handled_by: "none" },
        error: { type: "TypeError" },
      },
    ]);
    // The renderer knows no home or data folder to scrub, so no message.
    expect(sink.events[0]!.error).toEqual({ type: "TypeError" });
  });

  it("records an unhandled rejection, and that a toast handled it", () => {
    const target = new EventTarget();
    installAppErrorHandler(target);

    target.dispatchEvent(
      errorEvent("unhandledrejection", new LockedWeekError("2026-10-12")),
    );

    expect(sink.events).toMatchObject([
      {
        name: "app.error",
        crash: { origin: "unhandled_rejection", handled_by: "toast" },
        error: { type: "LockedWeekError" },
      },
    ]);
  });

  it("names the store command that threw, whose own event came first", async () => {
    const { runStoreCommand } = await import("@/lib/store-command-events");
    const target = new EventTarget();
    installAppErrorHandler(target);
    let thrown: unknown;
    try {
      runStoreCommand("time_entry.delete", (unit) => {
        unit.refuse("locked_week");
        throw new LockedWeekError("2026-10-05");
      });
    } catch (error) {
      thrown = error;
    }

    target.dispatchEvent(errorEvent("error", thrown));

    expect(sink.events.map((event) => event.name)).toEqual([
      "time_entry.delete",
      "app.error",
    ]);
    expect(sink.events[1]).toMatchObject({
      crash: { active_unit: "time_entry.delete", handled_by: "toast" },
    });
  });

  it("ignores an error event without an error, such as a ResizeObserver loop warning", () => {
    const target = new EventTarget();
    installAppErrorHandler(target);

    target.dispatchEvent(
      Object.assign(new Event("error", { cancelable: true }), {
        error: null,
        message:
          "ResizeObserver loop completed with undelivered notifications.",
      }),
    );

    expect(sink.events).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LockedWeekError } from "@/domain/time/locked-weeks";
import { StaleWindowError } from "@/lib/stale-window-error";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ showToast }));

import { installLockedWeekToast } from "@/features/feedback/locked-week-toast";

function errorEvent(type: "error" | "unhandledrejection", value: unknown) {
  const key = type === "error" ? "error" : "reason";
  return Object.assign(new Event(type, { cancelable: true }), { [key]: value });
}

describe("installLockedWeekToast", () => {
  beforeEach(() => showToast.mockClear());

  it("shows a refused write as a toast and stops the error there", () => {
    const target = new EventTarget();
    installLockedWeekToast(target);
    const event = errorEvent("error", new LockedWeekError("2026-10-05"));

    target.dispatchEvent(event);

    expect(showToast).toHaveBeenCalledWith(
      "The week of 2026-10-05 is submitted. Reopen it to change it.",
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows a refusal from an async handler too", () => {
    const target = new EventTarget();
    installLockedWeekToast(target);

    target.dispatchEvent(
      errorEvent("unhandledrejection", new LockedWeekError("2026-10-12")),
    );

    expect(showToast).toHaveBeenCalledWith(
      "The week of 2026-10-12 is submitted. Reopen it to change it.",
    );
  });

  it("shows a write refused because another window changed Ajour", () => {
    const target = new EventTarget();
    installLockedWeekToast(target);
    const event = errorEvent("error", new StaleWindowError());

    target.dispatchEvent(event);

    expect(showToast).toHaveBeenCalledWith(
      "Ajour changed in another window. Try again.",
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves every other error alone", () => {
    const target = new EventTarget();
    installLockedWeekToast(target);
    const event = errorEvent("error", new Error("Boom"));

    target.dispatchEvent(event);

    expect(showToast).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

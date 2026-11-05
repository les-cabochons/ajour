// @vitest-environment jsdom
import { Activity } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTodayIsoDate } from "@/lib/use-now";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Today() {
  return <p>{useTodayIsoDate()}</p>;
}

describe("today's date", () => {
  it("rolls over at midnight", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 10, 5, 23, 59, 0));
    render(<Today />);
    expect(screen.getByText("2026-11-05")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByText("2026-11-06")).toBeTruthy();
  });

  it("shows today when a view hidden over midnight comes back", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(2026, 10, 5, 23, 59, 0));
    const view = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <Today />
      </Activity>
    );
    const { rerender } = render(view("visible"));
    rerender(view("hidden"));
    // Hidden, the view's timeout is gone: it misses midnight.
    vi.setSystemTime(new Date(2026, 10, 6, 8, 0, 0));
    rerender(view("visible"));
    expect(screen.getByText("2026-11-06")).toBeTruthy();
  });
});

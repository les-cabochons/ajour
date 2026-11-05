// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CompactTimerPanel } from "@/features/layout/compact-timer-panel";
import { localStore } from "@/lib/local-store";
import { installDomShims, renderRoutes } from "@/test-support/dom";

beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the compact timer panel", () => {
  it("limits the sidebar list to six matches and switches to today's saved entries", async () => {
    for (let i = 1; i <= 8; i++)
      localStore.addWorkItem({ title: `Tray six-limit ${i}` });
    await renderRoutes({
      routes: {
        "/": () => (
          <TooltipProvider>
            <CompactTimerPanel
              onOpenTask={() => {}}
              onOpenApp={() => {}}
              onDismiss={() => {}}
            />
          </TooltipProvider>
        ),
      },
    });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Tray six-limit" },
    });
    expect(
      within(screen.getByRole("list", { name: "Sidebar tasks" })).getAllByRole(
        "link",
      ),
    ).toHaveLength(6);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Tray six-limit 8" },
    });
    expect(screen.getByRole("link", { name: "Tray six-limit 8" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(
      screen.getByRole("tablist", { name: "Days of the week" }),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "Time entries" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Sidebar tasks" })).toBeNull();
  });
  it("opens tasks in Ajour, modifier clicks in the source, and local tasks in Ajour", async () => {
    const id = localStore.addWorkItem({ title: "Tray navigation fixture" });
    localStore.updateWorkItem(id, {
      sourceUrl: "https://github.com/example/repo/issues/12",
    });
    const openTask = vi.fn();
    const external = vi.spyOn(window, "open").mockReturnValue(null);
    await renderRoutes({
      routes: {
        "/": () => (
          <TooltipProvider>
            <CompactTimerPanel
              onOpenTask={openTask}
              onOpenApp={() => {}}
              onDismiss={() => {}}
            />
          </TooltipProvider>
        ),
      },
    });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Tray navigation fixture" },
    });
    const task = screen.getByRole("link", { name: "Tray navigation fixture" });
    fireEvent.click(task);
    expect(openTask).toHaveBeenLastCalledWith(id);
    openTask.mockClear();
    fireEvent.click(task, { ctrlKey: true });
    fireEvent.click(task, { metaKey: true });
    expect(external).toHaveBeenCalledTimes(2);
    expect(external).toHaveBeenLastCalledWith(
      "https://github.com/example/repo/issues/12",
      "_blank",
      "noopener,noreferrer",
    );
    expect(openTask).not.toHaveBeenCalled();
    act(() => {
      localStore.updateWorkItem(id, { sourceUrl: "javascript:alert(1)" });
    });
    fireEvent.click(
      screen.getByRole("link", { name: "Tray navigation fixture" }),
      { ctrlKey: true },
    );
    expect(openTask).toHaveBeenLastCalledWith(id);
    expect(external).toHaveBeenCalledTimes(2);
  });

  it("starts and stops from the always-visible task action, and opens the shared Add time form", async () => {
    const id = localStore.addWorkItem({ title: "Tray interaction fixture" });
    const openTask = vi.fn();
    await renderRoutes({
      routes: {
        "/": () => (
          <TooltipProvider>
            <CompactTimerPanel
              onOpenTask={openTask}
              onOpenApp={() => {}}
              onDismiss={() => {}}
            />
          </TooltipProvider>
        ),
      },
    });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Tray interaction fixture" },
    });
    const row = screen
      .getByRole("link", { name: "Tray interaction fixture" })
      .closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Start timer" }));
    expect(localStore.snapshot().timers[0]?.workItemId).toBe(id);
    expect(openTask).not.toHaveBeenCalled();
    const staleStop = within(row).getByRole("button", { name: "Stop timer" });
    act(() => {
      localStore.saveTimer(localStore.snapshot().timers[0]!._id);
      localStore.startTimer({ workItemId: id });
      fireEvent.click(staleStop);
    });
    expect(localStore.snapshot().timers[0]?.workItemId).toBe(id);
    fireEvent.click(within(row).getByRole("button", { name: "Stop timer" }));
    expect(localStore.snapshot().timers).toHaveLength(0);
    fireEvent.click(within(row).getByRole("button", { name: "Add time" }));
    expect(screen.getByText("New time entry")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Hours"), {
      target: { value: "invalid" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create time entry" }));
    expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe(
      "invalid",
    );
    fireEvent.change(screen.getByLabelText("Hours"), {
      target: { value: "0:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create entry" }));
    expect(
      localStore
        .snapshot()
        .timesheetEntries.some(
          (entry) => entry.workItemId === id && entry.durationMs === 1_800_000,
        ),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: /settle|snooze/i })).toBeNull();
  });
});

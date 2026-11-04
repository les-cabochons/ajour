// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomShims } from "@/test-support/dom";

/*
 * Settings › General › Desktop app (#534): the switch shows what main saved,
 * and keeps it when main could not save a change.
 */

const mocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/toast")>()),
  showErrorToast: mocks.error,
}));

const { KeepRunningSetting } =
  await import("@/features/settings/keep-running-setting");

function desktop(
  configureWindowSettings: (settings: {
    keepRunning: boolean;
  }) => Promise<{ keepRunning: boolean }>,
  getWindowSettings: () => Promise<{ keepRunning: boolean }> = async () => ({
    keepRunning: true,
  }),
) {
  window.ajourDesktop = {
    getWindowSettings,
    configureWindowSettings,
  } as never;
}

async function loadedSwitch() {
  render(<KeepRunningSetting />);
  const toggle = screen.getByRole("switch", {
    name: "Keep Ajour running when the window closes",
  });
  await waitFor(() => expect(toggle.hasAttribute("data-disabled")).toBe(false));
  return toggle;
}

describe("the keep running setting", () => {
  beforeEach(() => {
    installDomShims();
    mocks.error.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    delete window.ajourDesktop;
  });

  it("shows the setting main saved", async () => {
    const configure = vi.fn(async (settings: { keepRunning: boolean }) => ({
      ...settings,
    }));
    desktop(configure);
    const toggle = await loadedSwitch();

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(toggle.getAttribute("aria-checked")).toBe("false"),
    );
    expect(configure).toHaveBeenCalledWith({ keepRunning: false });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  // The next launch would read the old value from the file.
  it("keeps the saved setting and says so when main could not save it", async () => {
    desktop(async () => {
      throw new Error("Ajour could not write to its data folder.");
    });
    const toggle = await loadedSwitch();

    fireEvent.click(toggle);

    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.error).toHaveBeenCalledWith({
      title: "The setting was not saved.",
      description: "Ajour could not write to its data folder.",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("allows one save at a time and enables the switch after it answers", async () => {
    let answer!: (settings: { keepRunning: boolean }) => void;
    const configure = vi.fn(
      () =>
        new Promise<{ keepRunning: boolean }>((resolve) => {
          answer = resolve;
        }),
    );
    desktop(configure);
    const toggle = await loadedSwitch();

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(toggle.hasAttribute("data-disabled")).toBe(true),
    );
    fireEvent.click(toggle);
    expect(configure).toHaveBeenCalledOnce();

    answer({ keepRunning: false });

    await waitFor(() =>
      expect(toggle.hasAttribute("data-disabled")).toBe(false),
    );
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  // A second click during a save must not capture the first click's unsaved
  // value as the value to roll back to.
  it("shows the value main confirmed after two quick toggles both fail", async () => {
    const failures: Array<(error: Error) => void> = [];
    const configure = vi.fn(
      () =>
        new Promise<{ keepRunning: boolean }>((_, reject) => {
          failures.push(reject);
        }),
    );
    desktop(configure);
    const toggle = await loadedSwitch();

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    failures[0]?.(new Error("Ajour could not write to its data folder."));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(toggle.hasAttribute("data-disabled")).toBe(false),
    );
    fireEvent.click(toggle);
    failures[1]?.(new Error("Ajour could not write to its data folder."));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(toggle.hasAttribute("data-disabled")).toBe(false),
    );
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  // Main never answering must not leave the switch disabled on a value it
  // never confirmed.
  it("gives the switch back after the deadline when main never answers", async () => {
    const getWindowSettings = vi.fn(async () => ({ keepRunning: true }));
    desktop(
      () => new Promise<{ keepRunning: boolean }>(() => {}),
      getWindowSettings,
    );
    const toggle = await loadedSwitch();
    vi.useFakeTimers();

    fireEvent.click(toggle);
    expect(toggle.hasAttribute("data-disabled")).toBe(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(() => vi.advanceTimersByTimeAsync(4_900));
    expect(toggle.hasAttribute("data-disabled")).toBe(true);
    expect(mocks.error).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(200));

    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.error.mock.calls[0]?.[0]).toMatchObject({
      title: "The setting was not saved.",
    });
    expect(toggle.hasAttribute("data-disabled")).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(getWindowSettings).toHaveBeenCalledTimes(2);
  });

  it("reads the setting from main again after the deadline", async () => {
    const getWindowSettings = vi
      .fn<() => Promise<{ keepRunning: boolean }>>()
      .mockResolvedValueOnce({ keepRunning: true })
      .mockResolvedValue({ keepRunning: false });
    desktop(
      () => new Promise<{ keepRunning: boolean }>(() => {}),
      getWindowSettings,
    );
    const toggle = await loadedSwitch();
    vi.useFakeTimers();

    fireEvent.click(toggle);
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.hasAttribute("data-disabled")).toBe(false);
  });

  it("ignores an answer that arrives after the deadline", async () => {
    let answer!: (settings: { keepRunning: boolean }) => void;
    desktop(
      () =>
        new Promise<{ keepRunning: boolean }>((resolve) => {
          answer = resolve;
        }),
    );
    const toggle = await loadedSwitch();
    vi.useFakeTimers();

    fireEvent.click(toggle);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      answer({ keepRunning: false });
    });

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.hasAttribute("data-disabled")).toBe(false);
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it("leaves no timer and no update when it unmounts mid-save", async () => {
    let answer!: (settings: { keepRunning: boolean }) => void;
    desktop(
      () =>
        new Promise<{ keepRunning: boolean }>((resolve) => {
          answer = resolve;
        }),
    );
    const toggle = await loadedSwitch();
    vi.useFakeTimers();

    fireEvent.click(toggle);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    cleanup();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      answer({ keepRunning: false });
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.error).not.toHaveBeenCalled();
  });
});

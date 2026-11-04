// @vitest-environment jsdom
import {
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
) {
  window.ajourDesktop = {
    getWindowSettings: async () => ({ keepRunning: true }),
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
});

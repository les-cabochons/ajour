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
});

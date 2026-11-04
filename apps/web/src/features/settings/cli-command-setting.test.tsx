// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopCliCommandState } from "@/lib/desktop-bridge";
import { installDomShims } from "@/test-support/dom";

/*
 * Settings › General › Terminal › "ajour command" (#568, spec #567). The row
 * shows what main's controller reports: not installed, the install's three
 * phases with the download's progress, installed with its version and
 * folder, or why an install failed, next to the row and never in a toast. A
 * development build disables Install with its reason, and the browser build
 * has no such section.
 */

const mocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/toast")>()),
  showErrorToast: mocks.error,
  showSuccessToast: mocks.success,
}));

const { CliCommandSetting } =
  await import("@/features/settings/cli-command-setting");

const VERSION = "0.0.1-nightly.20261104.294";
const FOLDER = "C:\\Users\\alex\\AppData\\Local\\Ajour\\bin";
const NOT_INSTALLED: DesktopCliCommandState = {
  status: "not-installed",
  progress: null,
  error: null,
};
const INSTALLED: DesktopCliCommandState = {
  status: "installed",
  version: VERSION,
  binaryPath: `${FOLDER}\\ajour.exe`,
  location: FOLDER,
  progress: null,
  error: null,
};

/** A fake `window.ajourDesktop`: the test answers reads and pushes changes. */
function desktop(initial: DesktopCliCommandState | Error = NOT_INSTALLED) {
  let push: ((state: DesktopCliCommandState) => void) | undefined;
  let finishInstall:
    | {
        resolve: (state: DesktopCliCommandState) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  const unsubscribe = vi.fn();
  const getCliCommand = vi.fn(() =>
    initial instanceof Error
      ? Promise.reject(initial)
      : Promise.resolve(initial),
  );
  const installCliCommand = vi.fn(
    () =>
      new Promise<DesktopCliCommandState>((resolve, reject) => {
        finishInstall = { resolve, reject };
      }),
  );
  window.ajourDesktop = {
    getCliCommand,
    installCliCommand,
    onCliCommandChanged: (
      callback: (state: DesktopCliCommandState) => void,
    ) => {
      push = callback;
      return unsubscribe;
    },
  } as never;
  return {
    getCliCommand,
    installCliCommand,
    unsubscribe,
    push: (state: DesktopCliCommandState) => act(() => push!(state)),
    finish: (state: DesktopCliCommandState) =>
      act(async () => finishInstall!.resolve(state)),
    fail: (error: Error) => act(async () => finishInstall!.reject(error)),
  };
}

async function mount() {
  render(<CliCommandSetting />);
  // The first read answers.
  await act(async () => {});
}

const status = () => screen.getByRole("status").textContent;
/** The status line's lines, as the row shows them. */
const lines = () =>
  Array.from(screen.getByRole("status").children).map(
    (line) => line.textContent,
  );
const installButton = () => screen.getByRole("button", { name: /^Install/ });

describe("the ajour command setting", () => {
  beforeEach(() => {
    installDomShims();
    mocks.error.mockClear();
    mocks.success.mockClear();
  });
  afterEach(() => {
    cleanup();
    delete window.ajourDesktop;
  });

  it("is absent in the browser", async () => {
    await mount();

    expect(screen.queryByText("Terminal")).toBeNull();
    expect(screen.queryByText("ajour command")).toBeNull();
  });

  it("is absent on a system it doesn't install on yet", async () => {
    desktop({
      status: "unsupported",
      reason: "unsupported_platform",
      progress: null,
      error: null,
    });
    await mount();

    expect(screen.queryByText("ajour command")).toBeNull();
  });

  it("is a Terminal section with one row, not installed at first", async () => {
    desktop();
    await mount();

    expect(screen.getByRole("heading", { name: "Terminal" })).toBeTruthy();
    expect(
      screen.getByText("Use Ajour from your shell with the ajour command."),
    ).toBeTruthy();
    expect(screen.getByText("ajour command")).toBeTruthy();
    expect(status()).toBe("Not installed.");
    expect(installButton().hasAttribute("disabled")).toBe(false);
  });

  it("installs, showing each phase and the download's progress", async () => {
    const main = desktop();
    await mount();

    fireEvent.click(installButton());
    expect(main.installCliCommand).toHaveBeenCalledOnce();
    // The renderer passes no path or URL: only the trace, if any.
    expect(
      main.installCliCommand.mock.calls[0]!.every(
        (arg) => typeof arg !== "string",
      ),
    ).toBe(true);

    main.push({
      status: "installing",
      phase: "downloading",
      progress: 42,
      error: null,
    });
    expect(status()).toBe("Downloading ajour, 42%");
    expect(installButton().hasAttribute("disabled")).toBe(true);

    main.push({
      status: "installing",
      phase: "checking",
      progress: null,
      error: null,
    });
    expect(status()).toBe("Checking ajour…");

    main.push({
      status: "installing",
      phase: "linking",
      progress: null,
      error: null,
    });
    expect(status()).toBe("Adding ajour to your PATH…");

    await main.finish({ ...INSTALLED, newlyInstalled: true });
    expect(lines()).toEqual([
      `ajour ${VERSION}`,
      FOLDER,
      "Open a new terminal to use it.",
    ]);
    const link = screen.getByRole("link", { name: "How to use it" });
    expect(link.getAttribute("href")).toBe("https://docs.ajour.day/terminal/");
    expect(screen.queryByRole("button", { name: /^Install/ })).toBeNull();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("shows a skipped link removal and offers Retry without an installed record", async () => {
    const error =
      "The ajour link changed during reconciliation. Press Retry in Settings.";
    const main = desktop({ status: "error", progress: null, error });
    await mount();
    expect(screen.getByRole("alert").textContent).toBe(error);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(main.installCliCommand).toHaveBeenCalledOnce();
    await main.finish({ ...NOT_INSTALLED });
  });
  it("disables Install from the click, before main's first change arrives", async () => {
    const main = desktop();
    await mount();

    fireEvent.click(installButton());
    fireEvent.click(installButton());

    expect(installButton().hasAttribute("disabled")).toBe(true);
    expect(main.installCliCommand).toHaveBeenCalledOnce();
  });

  it("shows an install from an earlier launch without the new-terminal hint", async () => {
    desktop(INSTALLED);
    await mount();

    expect(lines()).toEqual([`ajour ${VERSION}`, FOLDER]);
    expect(screen.getByRole("link", { name: "How to use it" })).toBeTruthy();
  });

  it("shows why an install failed next to the row, never in a toast, and offers Retry", async () => {
    const main = desktop();
    await mount();
    fireEvent.click(installButton());

    const reason =
      "The ajour download doesn't match its published checksum, so Ajour didn't install it.";
    await main.finish({ status: "error", progress: null, error: reason });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(reason);
    expect(alert.className).toContain("text-destructive");
    expect(alert.closest(".settings-row")).toBe(
      screen.getByText("ajour command").closest(".settings-row"),
    );
    expect(mocks.error).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("keeps showing the installed version when a newer install fails", async () => {
    desktop({
      ...INSTALLED,
      status: "error",
      error:
        "Ajour couldn't reach GitHub. Check your connection, then try again.",
    });
    await mount();

    expect(lines()).toEqual([`ajour ${VERSION}`, FOLDER]);
    expect(screen.getByRole("alert").textContent).toBe(
      "Ajour couldn't reach GitHub. Check your connection, then try again.",
    );
  });

  it("shows an install main refused, such as from another window, as the row's error", async () => {
    const main = desktop();
    await mount();
    fireEvent.click(installButton());

    await main.fail(
      new Error("Only the active Ajour window can install the ajour command."),
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "Only the active Ajour window can install the ajour command.",
    );
    expect(status()).toBe("Not installed.");
    expect(installButton().hasAttribute("disabled")).toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("says when main doesn't answer the first read", async () => {
    desktop(new Error("No handler registered for 'ajour:get-cli-command'"));
    await mount();

    expect(screen.getByRole("alert").textContent).toBe(
      "No handler registered for 'ajour:get-cli-command'",
    );
  });

  it("disables Install in a development build, with its reason", async () => {
    const main = desktop({
      status: "unsupported",
      reason: "development_build",
      progress: null,
      error: null,
    });
    await mount();

    expect(lines()).toEqual([
      "The ajour command installs from released builds.",
      "From source, run: just cli",
    ]);
    const button = screen.getByRole("button", { name: "Install" });
    expect(button.hasAttribute("disabled")).toBe(true);
    // DisabledReason names the control with its reason, and takes focus.
    expect(
      screen.getByLabelText(
        "Install: The ajour command installs from released builds.",
      ),
    ).toBeTruthy();
    fireEvent.click(button);
    expect(main.installCliCommand).not.toHaveBeenCalled();
  });

  it("keeps one status line in every state", async () => {
    const main = desktop();
    await mount();
    const line = screen.getByRole("status");

    for (const state of [
      { status: "installing", phase: "downloading", progress: 3, error: null },
      { status: "installing", phase: "checking", progress: null, error: null },
      { ...INSTALLED, newlyInstalled: true },
      { status: "error", progress: null, error: "Refused." },
    ] as DesktopCliCommandState[]) {
      main.push(state);
      expect(screen.getByRole("status")).toBe(line);
    }
  });

  it("keeps the row's height in every state, cutting long lines but keeping their text", async () => {
    const version = "0.0.1-nightly.20261104.294+build.with.a.long.suffix";
    const folder =
      "C:\\Users\\someone-with-a-long-name\\AppData\\Local\\Ajour\\bin";
    const error = `The downloaded ajour says "${"x".repeat(80)}", not "ajour ${version}", so Ajour didn't install it.`;
    const main = desktop();
    await mount();
    const description = screen.getByRole("status").parentElement!;

    for (const state of [
      { status: "installing", phase: "downloading", progress: 3, error: null },
      {
        status: "installed",
        version,
        location: folder,
        binaryPath: `${folder}\\ajour.exe`,
        progress: null,
        error: null,
        newlyInstalled: true,
      },
      {
        status: "error",
        version,
        location: folder,
        binaryPath: `${folder}\\ajour.exe`,
        progress: null,
        error,
      },
      {
        status: "unsupported",
        reason: "development_build",
        progress: null,
        error: null,
      },
    ] as DesktopCliCommandState[]) {
      main.push(state);

      // The same box, of a fixed height, three lines at most.
      expect(screen.getByRole("status").parentElement).toBe(description);
      expect(description.className).toMatch(/(^| )h-12( |$)/);
      expect(description.className).not.toMatch(/min-h-/);
      expect(description.className).toContain("overflow-hidden");
      const shown = Array.from(
        description.querySelectorAll<HTMLElement>("[data-line]"),
      );
      expect(shown.length).toBeLessThanOrEqual(3);
      for (const line of shown) {
        // One line each, cut with an ellipsis, the whole text in its title.
        expect(line.className).toContain("h-4");
        expect(line.className).toMatch(/truncate|overflow-hidden/);
        expect(line.getAttribute("title")).toBe(line.textContent);
      }
    }

    // The error and the path are whole for assistive technology.
    main.push({
      status: "error",
      version,
      location: folder,
      binaryPath: `${folder}\\ajour.exe`,
      progress: null,
      error,
    });
    expect(screen.getByRole("alert").textContent).toBe(error);
    expect(lines()).toEqual([`ajour ${version}`, folder]);
  });

  it("cuts the folder in the middle, keeping where it ends", async () => {
    desktop(INSTALLED);
    await mount();

    const line = screen.getByTitle(FOLDER);
    expect(line.className).toContain("font-mono");
    const [head, tail] = Array.from(line.children);
    expect(head!.className).toContain("truncate");
    expect(tail!.textContent).toBe("\\Ajour\\bin");
    expect(tail!.className).toContain("shrink-0");
  });

  it("stops listening when it unmounts", async () => {
    const main = desktop();
    await mount();

    cleanup();

    expect(main.unsubscribe).toHaveBeenCalledOnce();
  });
});

it("shows the macOS password hint before installation", async () => {
  desktop();
  window.ajourDesktop = {
    ...window.ajourDesktop!,
    runtime: { ...window.ajourDesktop!.runtime!, platform: "darwin" },
  };
  render(<CliCommandSetting />);
  expect(
    await screen.findByText(
      "Asks for your password to add it to /usr/local/bin.",
    ),
  ).toBeTruthy();
});

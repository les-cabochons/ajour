// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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
  const removeCliCommand = vi.fn(
    () =>
      new Promise<DesktopCliCommandState>((resolve, reject) => {
        finishInstall = { resolve, reject };
      }),
  );
  window.ajourDesktop = {
    getCliCommand,
    installCliCommand,
    removeCliCommand,
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
    removeCliCommand,
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

it("shows follow progress and its failure with Retry in the fixed-height row", async () => {
  cleanup();
  installDomShims();
  const main = desktop({
    ...INSTALLED,
    status: "installing",
    pending: "1.2.3",
    progress: 42,
  });
  await mount();
  expect(status()).toContain("Updating ajour to 1.2.3, 42%");
  main.push({
    ...INSTALLED,
    status: "error",
    pending: "1.2.3",
    error: "GitHub is offline",
  });
  expect(screen.getByRole("alert").textContent).toBe(
    "ajour couldn't update to 1.2.3: GitHub is offline. The installed version keeps working.",
  );
  expect(screen.getByRole("status").parentElement!.className).toContain("h-12");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(main.installCliCommand).toHaveBeenCalledOnce();
  await main.finish(INSTALLED);
  cleanup();
  delete window.ajourDesktop;
});

it("Remove returns the fixed-height row to Not installed without confirmation", async () => {
  const fake = desktop(INSTALLED);
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(status()).toContain("Removing ajour…");
  expect(fake.removeCliCommand).toHaveBeenCalledWith();
  expect(fake.installCliCommand).not.toHaveBeenCalled();
  await fake.finish(NOT_INSTALLED);
  expect(status()).toContain("Not installed.");
  expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
  cleanup();
  delete window.ajourDesktop;
});

it("retries a failed Remove inline and keeps its status and alert roles", async () => {
  const fake = desktop({
    ...INSTALLED,
    status: "error",
    operation: "remove",
    error: "Removal failed.",
  });
  await mount();
  expect(screen.getByRole("alert").textContent).toBe("Removal failed.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(fake.removeCliCommand).toHaveBeenCalledWith();
  expect(fake.installCliCommand).not.toHaveBeenCalled();
  expect(status()).toContain("Removing ajour…");
  await fake.finish(NOT_INSTALLED);
  expect(screen.queryByRole("alert")).toBeNull();
  cleanup();
  delete window.ajourDesktop;
});

describe("the WSL command rows", () => {
  beforeEach(() => {
    installDomShims();
    mocks.error.mockClear();
    mocks.success.mockClear();
  });
  afterEach(() => {
    cleanup();
    delete window.ajourDesktop;
  });
  it("Given an installed Windows command, Ubuntu can be added from its Settings row", async () => {
    desktop({
      ...INSTALLED,
      wsl: {
        distros: [
          {
            name: "Ubuntu",
            wslVersion: 2,
            status: "not-added",
          },
        ],
      },
    });
    const add = vi.fn(async () => ({
      ...INSTALLED,
      wsl: {
        distros: [
          {
            name: "Ubuntu",
            wslVersion: 2 as const,
            status: "added" as const,
            hint: "Open a new Ubuntu terminal to use it.",
          },
        ],
      },
    }));
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      addCliCommandWsl: add,
    });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await act(async () => {});
    expect(add).toHaveBeenCalledWith({ distro: "Ubuntu" }, undefined);
    expect(
      screen.getByText("Open a new Ubuntu terminal to use it."),
    ).toBeTruthy();
  });

  it.each([
    ["downloading", "Downloading ajour, 42%"],
    ["checking", "Checking ajour in Ubuntu…"],
    ["linking", "Linking ~/.local/bin/ajour…"],
  ] as const)(
    "Given Ubuntu is adding during %s, Settings shows its phase with a disabled control",
    async (phase, sentence) => {
      desktop({
        ...INSTALLED,
        wsl: {
          distros: [
            {
              name: "Ubuntu",
              wslVersion: 2,
              status: "adding",
              phase,
              progress: 42,
            },
          ],
        },
      });
      Object.assign(window.ajourDesktop!, { runtime: { platform: "win32" } });
      await mount();
      expect(
        screen.getByText(sentence).closest('[role="status"]'),
      ).toBeTruthy();
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Add" }).disabled,
      ).toBe(true);
    },
  );

  it("Given Ubuntu Add failed, Settings shows an inline alert and Retry without a toast", async () => {
    desktop({
      ...INSTALLED,
      wsl: {
        distros: [
          {
            name: "Ubuntu",
            wslVersion: 2,
            status: "error",
            operation: "add",
            error:
              "Another ajour is at ~/.local/bin/ajour in Ubuntu. Remove it, then add again.",
            added: false,
          },
        ],
      },
    });
    Object.assign(window.ajourDesktop!, { runtime: { platform: "win32" } });
    await mount();
    expect(screen.getByRole("alert").textContent).toContain("Another ajour");
    expect(screen.getByText("Not added.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("Given adding an added Ubuntu again failed, its row stays Added with the reason and Retry", async () => {
    desktop({
      ...INSTALLED,
      wsl: {
        version: VERSION,
        distros: [
          {
            name: "Ubuntu",
            wslVersion: 2,
            status: "error",
            operation: "add",
            error:
              "Another ajour is at ~/.local/bin/ajour in Ubuntu. Remove it, then add again.",
            added: true,
          },
        ],
      },
    });
    Object.assign(window.ajourDesktop!, { runtime: { platform: "win32" } });
    await mount();

    expect(
      screen
        .getByText(`ajour ${VERSION} · ~/.local/bin/ajour`)
        .closest('[role="status"]'),
    ).toBeTruthy();
    expect(screen.queryByText("Not added.")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(
      "Another ajour is at ~/.local/bin/ajour in Ubuntu. Remove it, then add again.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("Given main rejects Ubuntu's Add without a sentence, the row says Ajour couldn't add ajour to Ubuntu", async () => {
    desktop({
      ...INSTALLED,
      wsl: {
        distros: [{ name: "Ubuntu", wslVersion: 2, status: "not-added" }],
      },
    });
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      addCliCommandWsl: vi.fn(() => Promise.reject(new Error(""))),
    });
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await act(async () => {});

    expect(screen.getByRole("alert").textContent).toBe(
      "Ajour couldn't add ajour to Ubuntu.",
    );
  });

  it("Given main rejects Ubuntu's Add, its reason shows in Ubuntu's row with Retry, never in a toast", async () => {
    desktop({
      ...INSTALLED,
      wsl: {
        distros: [
          {
            name: "Ubuntu",
            wslVersion: 2,
            status: "not-added",
          },
        ],
      },
    });
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      addCliCommandWsl: vi.fn(async () => {
        throw new Error(
          "Ajour can't find this distro in WSL's list any more. Reopen Settings to see the current list.",
        );
      }),
    });
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await act(async () => {});

    expect(screen.getByRole("alert").textContent).toBe(
      "Ajour can't find this distro in WSL's list any more. Reopen Settings to see the current list.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("Given Ubuntu's Add failed, Retry clears the old reason while it runs", async () => {
    desktop({
      ...INSTALLED,
      wsl: {
        distros: [
          {
            name: "Ubuntu",
            wslVersion: 2,
            status: "error",
            operation: "add",
            error:
              "Ajour couldn't run commands in Ubuntu. Check that it starts, then try again.",
            added: false,
          },
        ],
      },
    });
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      addCliCommandWsl: vi.fn(() => new Promise(() => {})),
    });
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {});

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Downloading ajour, 0%")).toBeTruthy();
  });

  it("Given a WSL 1 distro, its row says how to convert it and offers no Add", async () => {
    const add = vi.fn();
    desktop({
      ...INSTALLED,
      wsl: {
        distros: [
          {
            name: "Ubuntu-24.04",
            wslVersion: 1,
            status: "unsupported",
            reason:
              "WSL 1 isn't supported. Convert it with: wsl --set-version Ubuntu-24.04 2",
          },
          {
            name: "Debian",
            wslVersion: 2,
            status: "not-added",
          },
        ],
      },
    });
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      addCliCommandWsl: add,
    });
    await mount();

    const sentence = screen.getByText(
      "WSL 1 isn't supported. Convert it with: wsl --set-version Ubuntu-24.04 2",
    );
    expect(sentence.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // Only Debian's Add: none for Ubuntu-24.04, neither disabled nor explained.
    expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    const row = screen.getByText("Ubuntu-24.04").closest(".settings-row");
    expect(row).toBeTruthy();
    expect(row?.querySelector("button")).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  const ADDED_UBUNTU: DesktopCliCommandState = {
    ...INSTALLED,
    wsl: {
      version: VERSION,
      distros: [{ name: "Ubuntu", wslVersion: 2, status: "added" }],
    },
  };
  const NOT_ADDED_UBUNTU: DesktopCliCommandState = {
    ...INSTALLED,
    wsl: { distros: [{ name: "Ubuntu", wslVersion: 2, status: "not-added" }] },
  };
  const ubuntuRow = () =>
    screen.getByText("Ubuntu").closest(".settings-row") as HTMLElement;
  const rowLines = () =>
    Array.from(ubuntuRow().querySelector('[role="status"]')!.children).map(
      (line) => line.textContent,
    );

  /** Main's Remove for one distro, which the test ends. */
  function removeWslCall() {
    let finish!: {
      resolve: (state: DesktopCliCommandState) => void;
      reject: (error: Error) => void;
    };
    const remove = vi.fn(
      (_options: { distro: string }) =>
        new Promise<DesktopCliCommandState>((resolve, reject) => {
          finish = { resolve, reject };
        }),
    );
    return {
      remove,
      resolve: (state: DesktopCliCommandState) =>
        act(async () => finish.resolve(state)),
      reject: (error: Error) => act(async () => finish.reject(error)),
    };
  }

  it("Given Ubuntu is added, Remove shows Removing ajour… and ends Not added, without a confirmation", async () => {
    desktop(ADDED_UBUNTU);
    const main = removeWslCall();
    const add = vi.fn();
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      addCliCommandWsl: add,
      removeCliCommandWsl: main.remove,
    });
    await mount();
    expect(rowLines()).toEqual([`ajour ${VERSION} · ~/.local/bin/ajour`]);

    fireEvent.click(
      within(ubuntuRow()).getByRole("button", { name: "Remove" }),
    );

    expect(main.remove).toHaveBeenCalledWith({ distro: "Ubuntu" }, undefined);
    expect(window.ajourDesktop!.removeCliCommand).not.toHaveBeenCalled();
    expect(rowLines()).toEqual(["Removing ajour…"]);
    expect(
      within(ubuntuRow()).getByRole<HTMLButtonElement>("button", {
        name: "Remove",
      }).disabled,
    ).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await main.resolve(NOT_ADDED_UBUNTU);
    expect(rowLines()).toEqual(["Not added."]);
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("Given main reports Ubuntu removing, its row says so with Remove disabled", async () => {
    desktop({
      ...INSTALLED,
      wsl: {
        version: VERSION,
        distros: [{ name: "Ubuntu", wslVersion: 2, status: "removing" }],
      },
    });
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      removeCliCommandWsl: vi.fn(),
    });
    await mount();

    expect(rowLines()).toEqual(["Removing ajour…"]);
    const control = ubuntuRow().querySelector("button")!;
    expect([control.textContent, control.disabled]).toEqual(["Remove", true]);
  });

  it("Given Ubuntu's Remove failed, the row stays Added with the reason inline, and Retry removes", async () => {
    desktop({
      ...INSTALLED,
      wsl: {
        version: VERSION,
        distros: [
          {
            name: "Ubuntu",
            wslVersion: 2,
            status: "error",
            operation: "remove",
            error:
              "Ajour couldn't run commands in Ubuntu. Check that it starts, then try again.",
            added: true,
          },
        ],
      },
    });
    const main = removeWslCall();
    const add = vi.fn();
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      addCliCommandWsl: add,
      removeCliCommandWsl: main.remove,
    });
    await mount();

    expect(rowLines()).toEqual([`ajour ${VERSION} · ~/.local/bin/ajour`]);
    expect(screen.getByRole("alert").textContent).toBe(
      "Ajour couldn't run commands in Ubuntu. Check that it starts, then try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(main.remove).toHaveBeenCalledWith({ distro: "Ubuntu" }, undefined);
    expect(add).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(rowLines()).toEqual(["Removing ajour…"]);
    await main.resolve(NOT_ADDED_UBUNTU);
    expect(rowLines()).toEqual(["Not added."]);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("Given main rejects Ubuntu's Remove without a sentence, the row says Ajour couldn't remove ajour from Ubuntu, with Retry", async () => {
    desktop(ADDED_UBUNTU);
    const main = removeWslCall();
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      removeCliCommandWsl: main.remove,
    });
    await mount();

    fireEvent.click(
      within(ubuntuRow()).getByRole("button", { name: "Remove" }),
    );
    await main.reject(new Error(""));

    expect(screen.getByRole("alert").textContent).toBe(
      "Ajour couldn't remove ajour from Ubuntu.",
    );
    expect(rowLines()).toEqual([`ajour ${VERSION} · ~/.local/bin/ajour`]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(main.remove).toHaveBeenCalledTimes(2);
  });

  it("Given removing the command left a link in Ubuntu, the command row names it inline", async () => {
    const fake = desktop(ADDED_UBUNTU);
    Object.assign(window.ajourDesktop!, { runtime: { platform: "win32" } });
    await mount();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    await fake.finish({
      ...NOT_INSTALLED,
      notice:
        "ajour was removed, but ~/.local/bin/ajour in Ubuntu couldn't be. It now points at nothing.",
    });

    expect(status()).toContain("Not installed.");
    expect(screen.getByRole("alert").textContent).toBe(
      "ajour was removed, but ~/.local/bin/ajour in Ubuntu couldn't be. It now points at nothing.",
    );
    expect(screen.queryByText("Ubuntu")).toBeNull();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  const NEXT = "0.0.1-nightly.20261105.313";

  it("Given the Linux build follows the app, added rows show Updating ajour to the version with a disabled control", async () => {
    desktop({
      ...INSTALLED,
      version: NEXT,
      wsl: {
        version: VERSION,
        pending: NEXT,
        distros: [
          { name: "Ubuntu", wslVersion: 2, status: "updating", progress: 42 },
          { name: "Debian", wslVersion: 2, status: "not-added" },
        ],
      },
    });
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      addCliCommandWsl: vi.fn(),
      removeCliCommandWsl: vi.fn(),
    });
    await mount();

    expect(rowLines()).toEqual([`Updating ajour to ${NEXT}, 42%`]);
    const control = ubuntuRow().querySelector("button")!;
    expect(control.disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Add" }).disabled,
    ).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(ubuntuRow().querySelector(".h-12")).toBeTruthy();
  });

  it("Given the Linux build couldn't follow, added rows say so inline, keep the installed version, and Retry follows again", async () => {
    const main = desktop({
      ...INSTALLED,
      version: NEXT,
      wsl: {
        version: VERSION,
        pending: NEXT,
        distros: [
          {
            name: "Ubuntu",
            wslVersion: 2,
            status: "error",
            operation: "follow",
            error: "An ajour running in WSL is using its files.",
            added: true,
          },
        ],
      },
    });
    const add = vi.fn();
    const remove = vi.fn();
    Object.assign(window.ajourDesktop!, {
      runtime: { platform: "win32" },
      addCliCommandWsl: add,
      removeCliCommandWsl: remove,
    });
    await mount();

    expect(rowLines()).toEqual([`ajour ${VERSION} · ~/.local/bin/ajour`]);
    expect(within(ubuntuRow()).getByRole("alert").textContent).toBe(
      `ajour in WSL couldn't update to ${NEXT}: An ajour running in WSL is using its files. The installed version keeps working.`,
    );
    fireEvent.click(within(ubuntuRow()).getByRole("button", { name: "Retry" }));

    expect(main.installCliCommand).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(within(ubuntuRow()).queryByRole("alert")).toBeNull();
    expect(rowLines()).toEqual([`Updating ajour to ${NEXT}, 0%`]);
    await main.finish({
      ...INSTALLED,
      version: NEXT,
      wsl: {
        version: NEXT,
        distros: [{ name: "Ubuntu", wslVersion: 2, status: "added" }],
      },
    });
    expect(rowLines()).toEqual([`ajour ${NEXT} · ~/.local/bin/ajour`]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(["darwin", "linux", "win32"])(
    "Given no command on %s, WSL rows stay hidden",
    async (platform) => {
      desktop({
        ...NOT_INSTALLED,
        wsl: {
          distros: [
            {
              name: "Ubuntu",
              wslVersion: 2,
              status: "not-added",
            },
          ],
        },
      });
      Object.assign(window.ajourDesktop!, { runtime: { platform } });
      await mount();
      expect(screen.queryByText("Ubuntu")).toBeNull();
    },
  );
});

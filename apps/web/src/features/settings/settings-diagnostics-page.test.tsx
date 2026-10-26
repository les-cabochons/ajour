// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LocalLogSettings } from "@ajour/wide-events/local-log-file.ts";
import type { DesktopLogsStatus } from "@/lib/desktop-bridge";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { SettingsNavigation } from "./settings-navigation";
import { SettingsDiagnosticsPage } from "./settings-diagnostics-page";

/*
 * Settings > Diagnostics against a bridge that behaves as main does (#441):
 * it keeps the stored settings, refuses what it is told to, and answers each
 * call with the status the page then shows.
 */

beforeAll(installDomShims);

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
});

type Warning = DesktopLogsStatus["warning"];

/** Installs the bridge and returns it with the calls the page made. */
function installMain({
  settings: stored = {},
  warning,
  files = { storage_bytes: 2_621_440, file_count: 3, oldest_day: "2026-10-20" },
  refuseConfigure = false,
}: {
  settings?: Partial<LocalLogSettings>;
  warning?: Warning;
  files?: { storage_bytes: number; file_count: number; oldest_day?: string };
  refuseConfigure?: boolean;
} = {}) {
  let settings: LocalLogSettings = {
    enabled: false,
    retention_days: 7,
    size_limit_mb: 250,
    include_sensitive: false,
    ...stored,
  };
  let current = files;
  let stopped = warning;
  let refusing = refuseConfigure;
  const status = (): DesktopLogsStatus => ({
    settings: { ...settings },
    state: stopped ? "warning" : settings.enabled ? "on" : "off",
    ...(stopped ? { warning: stopped } : {}),
    ...current,
    dropped_event_count: 0,
  });
  const bridge = {
    getLogsStatus: vi.fn(async () => status()),
    configureLogs: vi.fn(async (changes: Partial<LocalLogSettings>) => {
      if (refusing) throw new Error("Invalid local log settings");
      settings = { ...settings, ...changes };
      stopped = undefined;
      return status();
    }),
    deleteAllLogs: vi.fn(async () => {
      current = { storage_bytes: 0, file_count: 0 };
      return status();
    }),
    openLogsFolder: vi.fn(async () => undefined),
    /** Main refuses `logs.configure` from now on, or accepts it again. */
    refuse: (on: boolean) => {
      refusing = on;
    },
  };
  window.ajourDesktop = bridge as unknown as typeof window.ajourDesktop;
  return bridge;
}

async function renderPage() {
  const view = await renderRoutes({
    routes: { "/": SettingsDiagnosticsPage },
  });
  // Let the page read logs.status.
  await act(async () => {});
  return view;
}

const isOn = (element: HTMLElement) =>
  element.getAttribute("aria-checked") === "true";
const isDisabled = (element: HTMLElement) =>
  element.hasAttribute("disabled") ||
  element.getAttribute("aria-disabled") === "true" ||
  element.hasAttribute("data-disabled");
const enabledSwitch = () =>
  screen.getByRole("switch", { name: "Write events to a local file" });
const sensitiveSwitch = () =>
  screen.getByRole("switch", { name: "Include sensitive fields" });
const choice = (name: string) => screen.getByRole("button", { name });
const storage = () => screen.getByTestId("local-log-storage").textContent;

/** Clicks and waits for the bridge call it starts to settle. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("the Settings tab", () => {
  it("opens on Settings, and shows only the tabs that are built", async () => {
    installMain();
    await renderPage();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Settings"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("heading", { name: "Local log file" }),
    ).toBeTruthy();
  });

  it("shows the stored settings and what the folder holds, from logs.status", async () => {
    installMain({
      settings: {
        enabled: true,
        retention_days: 30,
        size_limit_mb: 1000,
        include_sensitive: true,
      },
    });
    await renderPage();

    expect(isOn(enabledSwitch())).toBe(true);
    expect(isOn(sensitiveSwitch())).toBe(true);
    expect(choice("30 days").getAttribute("aria-pressed")).toBe("true");
    expect(choice("7 days").getAttribute("aria-pressed")).toBe("false");
    expect(choice("1 GB").getAttribute("aria-pressed")).toBe("true");
    expect(choice("250 MB").getAttribute("aria-pressed")).toBe("false");
    expect(storage()).toBe("2.5 MB in 3 files, oldest 2026-10-20");
  });

  it("starts with logging and sensitive fields off, 7 days and 250 MB", async () => {
    installMain();
    await renderPage();

    expect(isOn(enabledSwitch())).toBe(false);
    expect(isOn(sensitiveSwitch())).toBe(false);
    expect(choice("7 days").getAttribute("aria-pressed")).toBe("true");
    expect(choice("250 MB").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/The files stay on this computer/)).toBeTruthy();
    expect(
      screen.getByText(/scrubbed error messages and time-entry durations/),
    ).toBeTruthy();
  });

  it.each([
    ["Write events to a local file", { enabled: true }],
    ["Include sensitive fields", { include_sensitive: true }],
    ["1 day", { retention_days: 1 }],
    ["30 days", { retention_days: 30 }],
    ["90 days", { retention_days: 90 }],
    ["100 MB", { size_limit_mb: 100 }],
    ["1 GB", { size_limit_mb: 1000 }],
  ])(
    "saves %s through logs.configure, alone, on change",
    async (name, saved) => {
      const main = installMain();
      await renderPage();

      await click(
        name.startsWith("Write") || name.startsWith("Include")
          ? screen.getByRole("switch", { name })
          : choice(name),
      );

      expect(main.configureLogs).toHaveBeenCalledTimes(1);
      expect(main.configureLogs.mock.calls[0]![0]).toEqual(saved);
      // The control shows what main stored.
      const [key, value] = Object.entries(saved)[0]!;
      if (typeof value === "boolean") {
        const control = key === "enabled" ? enabledSwitch() : sensitiveSwitch();
        expect(isOn(control)).toBe(true);
      } else {
        expect(choice(name).getAttribute("aria-pressed")).toBe("true");
      }
    },
  );

  it("turns a switch off again by saving false", async () => {
    const main = installMain({ settings: { enabled: true } });
    await renderPage();

    await click(enabledSwitch());

    expect(main.configureLogs.mock.calls[0]![0]).toEqual({ enabled: false });
    expect(isOn(enabledSwitch())).toBe(false);
  });

  it("does not save the choice that is already selected", async () => {
    const main = installMain();
    await renderPage();

    await click(choice("7 days"));

    expect(main.configureLogs).not.toHaveBeenCalled();
    expect(choice("7 days").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows an error when logs.configure is refused, and keeps the stored values", async () => {
    const main = installMain({ refuseConfigure: true });
    await renderPage();

    await click(enabledSwitch());
    await click(choice("90 days"));

    expect(main.configureLogs).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't save the setting. The log settings stay as they were.",
    );
    expect(isOn(enabledSwitch())).toBe(false);
    expect(choice("90 days").getAttribute("aria-pressed")).toBe("false");
    expect(choice("7 days").getAttribute("aria-pressed")).toBe("true");
  });

  it("clears the error when the next save goes through", async () => {
    const main = installMain({ refuseConfigure: true });
    await renderPage();
    await click(enabledSwitch());
    expect(screen.getByRole("alert")).toBeTruthy();

    main.refuse(false);
    await click(enabledSwitch());

    expect(screen.queryByRole("alert")).toBeNull();
    expect(isOn(enabledSwitch())).toBe(true);
  });

  it("says when it cannot read the log settings, and offers no control to change", async () => {
    const main = installMain();
    main.getLogsStatus.mockRejectedValueOnce(new Error("unavailable"));
    await renderPage();

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't read the log settings.",
    );
    expect(isDisabled(enabledSwitch())).toBe(true);
    expect(
      isDisabled(screen.getByRole("button", { name: "Open folder" })),
    ).toBe(true);
  });
});

describe("the storage line", () => {
  it("counts one file in the singular, and shows zero for an empty folder", async () => {
    installMain({
      files: { storage_bytes: 512, file_count: 1, oldest_day: "2026-10-26" },
    });
    await renderPage();
    expect(storage()).toBe("512 B in 1 file, oldest 2026-10-26");

    cleanup();
    installMain({ files: { storage_bytes: 0, file_count: 0 } });
    await renderPage();
    expect(storage()).toBe("0 B in 0 files");
  });

  it("Open folder asks main to open it, and the page never receives a path", async () => {
    const main = installMain();
    await renderPage();

    await click(screen.getByRole("button", { name: "Open folder" }));

    expect(main.openLogsFolder).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/[A-Za-z]:\\|\/logs\/events/);
  });

  it("says when the folder cannot be opened", async () => {
    const main = installMain();
    main.openLogsFolder.mockRejectedValueOnce(new Error("no file manager"));
    await renderPage();

    await click(screen.getByRole("button", { name: "Open folder" }));

    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't open the log folder.",
    );
  });

  it("Delete all logs asks first, and does nothing when cancelled", async () => {
    const main = installMain();
    await renderPage();

    await click(screen.getByRole("button", { name: "Delete all logs" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Delete all logs?")).toBeTruthy();
    expect(main.deleteAllLogs).not.toHaveBeenCalled();

    await click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(main.deleteAllLogs).not.toHaveBeenCalled();
    expect(storage()).toBe("2.5 MB in 3 files, oldest 2026-10-20");
  });

  it("Delete all logs empties the folder once confirmed, and the storage line shows zero", async () => {
    const main = installMain();
    await renderPage();

    await click(screen.getByRole("button", { name: "Delete all logs" }));
    await click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete all logs",
      }),
    );

    expect(main.deleteAllLogs).toHaveBeenCalledTimes(1);
    expect(storage()).toBe("0 B in 0 files");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("the warning", () => {
  it.each([
    ["disk_full", "The disk is full."],
    ["no_permission", "Ajour isn't allowed to write in the log folder."],
    ["write_failed", "Writing to the log file failed."],
  ] as const)(
    "names the reason %s and says how to resume",
    async (reason, text) => {
      installMain({ settings: { enabled: true }, warning: reason });
      await renderPage();

      const warning = screen.getByRole("alert");
      expect(warning.textContent).toContain(text);
      expect(warning.textContent).toContain("Ajour stopped writing events");
      expect(warning.textContent).toContain(
        "turn Write events to a local file off and on again, or restart Ajour",
      );
      // MessagePanel with tone="warning" (the class is the panel's own).
      expect(warning.className).toMatch(/panel-warning/);
    },
  );

  it("shows no warning while logging is on and healthy, or off", async () => {
    installMain({ settings: { enabled: true } });
    await renderPage();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("goes away once the settings are saved again, which resumes writing", async () => {
    installMain({ settings: { enabled: true }, warning: "disk_full" });
    await renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();

    await click(enabledSwitch()); // off
    await click(enabledSwitch()); // on

    expect(screen.queryByRole("alert")).toBeNull();
    expect(isOn(enabledSwitch())).toBe(true);
  });
});

describe("without the desktop bridge", () => {
  it("shows no controls and asks for no log settings", async () => {
    await renderPage();

    expect(screen.getByText("Diagnostics needs the desktop app.")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });
});

describe("the Settings navigation", () => {
  const renderNavigation = () =>
    renderRoutes({
      routes: {
        "/": () => <SettingsNavigation pathname="/settings" view="narrow" />,
      },
    });

  it("lists Diagnostics under App in the desktop app, before Work", async () => {
    installMain();
    await renderNavigation();

    const link = screen.getByRole("link", { name: "Diagnostics" });
    expect(link.getAttribute("href")).toBe("/settings/diagnostics");
    const app = screen
      .getByRole("heading", { name: "App" })
      .closest("section")!;
    expect(within(app).getByRole("link", { name: "Diagnostics" })).toBe(link);
  });

  it("does not list Diagnostics in the web build", async () => {
    await renderNavigation();

    expect(screen.getByRole("link", { name: "General" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Diagnostics" })).toBeNull();
  });
});

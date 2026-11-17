// @vitest-environment jsdom
import type { ComponentType } from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopUpdateState } from "@/lib/desktop-bridge";
import { installDomShims, renderRoutes } from "@/test-support/dom";

/*
 * The sidebar header's gear. It opens Settings, until an update waits: then
 * it takes the accent and a dot, and opens a menu with Restart to update,
 * What's new and Settings. The Settings window's version opens What's new.
 */

const { SidebarHeaderActions } =
  await import("@/features/layout/sidebar-header-actions");
const { AppVersionFoot } = await import("@/features/settings/app-version-foot");

const INSTALLED = "0.0.1-nightly.20261116.376";
const LATEST = "0.0.1-nightly.20261116.377";

function updateState(available: boolean): DesktopUpdateState {
  return {
    status: available ? "available" : "up-to-date",
    track: "nightly",
    result: {
      track: "nightly",
      currentVersion: INSTALLED,
      latestVersion: available ? LATEST : INSTALLED,
      latestTag: null,
      releaseName: null,
      releaseUrl: null,
      publishedAt: null,
      updateAvailable: available,
      checkedAt: "2026-11-16T17:00:00Z",
    },
    progress: null,
    error: null,
    canInstall: true,
  };
}

function desktop(
  available: boolean,
  status: DesktopUpdateState["status"] = available ? "available" : "up-to-date",
) {
  const updateAndRestart = vi.fn(async (..._args: unknown[]) =>
    updateState(available),
  );
  window.ajourDesktop = {
    runtime: { version: INSTALLED },
    getUpdateState: async () => ({ ...updateState(available), status }),
    onUpdateStateChanged: () => () => {},
    checkForUpdates: async () => updateState(available),
    updateAndRestart,
  } as never;
  return { updateAndRestart };
}

async function mount(Component: ComponentType) {
  const view = await renderRoutes({ routes: { "/": () => <Component /> } });
  // The update state answers.
  await act(async () => {});
  return view;
}

const settingsSearch = (router: { state: { location: { search: unknown } } }) =>
  (router.state.location.search as Record<string, unknown>).settings;

describe("the sidebar header's gear", () => {
  beforeEach(() => installDomShims());
  afterEach(() => {
    cleanup();
    delete window.ajourDesktop;
  });

  it("opens Settings while Ajour is up to date", async () => {
    desktop(false);
    const { router } = await mount(SidebarHeaderActions);

    const gear = screen.getByRole("link", { name: "Settings" });
    await act(async () => fireEvent.click(gear));

    expect(settingsSearch(router)).toBe("general");
  });

  it("opens a menu with the update, What's new and Settings while an update waits", async () => {
    const { updateAndRestart } = desktop(true);
    const { router } = await mount(SidebarHeaderActions);

    const gear = screen.getByRole("button", {
      name: "Settings, Nightly 377 is ready",
    });
    expect(gear.className).toContain("text-primary");
    await act(async () => fireEvent.click(gear));

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("Restart to update"),
      "What's new",
      expect.stringContaining("Settings"),
    ]);
    await act(async () =>
      fireEvent.click(screen.getByRole("menuitem", { name: /Restart/ })),
    );
    expect(updateAndRestart.mock.calls[0]?.slice(0, 2)).toEqual([
      "nightly",
      LATEST,
    ]);

    await act(async () => fireEvent.click(gear));
    await act(async () =>
      fireEvent.click(screen.getByRole("menuitem", { name: "What's new" })),
    );
    expect(settingsSearch(router)).toBe("whats-new");
  });

  it("keeps the menu while Ajour checks again, with the update disabled", async () => {
    desktop(true, "checking");
    await mount(SidebarHeaderActions);

    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Settings, Nightly 377 is ready" }),
      ),
    );

    expect(
      screen
        .getByRole("menuitem", { name: /Restart/ })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});

describe("the Settings window's version", () => {
  beforeEach(() => installDomShims());
  afterEach(() => {
    cleanup();
    delete window.ajourDesktop;
  });

  it("opens What's new", async () => {
    desktop(false);
    const { router } = await mount(AppVersionFoot);

    await act(async () =>
      fireEvent.click(
        screen.getByRole("link", { name: `What's new in Ajour ${INSTALLED}` }),
      ),
    );

    expect(settingsSearch(router)).toBe("whats-new");
  });
});

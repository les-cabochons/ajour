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
import type {
  DesktopReleaseNote,
  DesktopUpdateState,
} from "@/lib/desktop-bridge";
import { localStore } from "@/lib/local-store";
import { installDomShims } from "@/test-support/dom";

/*
 * Settings › What's new: the update waiting to install heads the page, with
 * its changes and Update and restart, and the track's other latest releases
 * follow as a timeline that marks the installed one. Every release links to
 * GitHub, and every change to its pull request.
 */

const { SettingsWhatsNewPage } =
  await import("@/features/settings/settings-whats-new-page");

const pull = (number: number) =>
  `https://github.com/les-cabochons/ajour/pull/${number}`;
const version = (build: number) => `0.0.1-nightly.20261116.${build}`;

function note(build: number, lines: string[]): DesktopReleaseNote {
  return {
    tagName: `v${version(build)}`,
    packageVersion: version(build),
    name: `Ajour v${version(build)}`,
    releaseUrl: `https://github.com/les-cabochons/ajour/releases/tag/v${version(build)}`,
    publishedAt: "2026-11-16T16:27:41Z",
    body: ["## What's Changed", ...lines].join("\n"),
  };
}

const NOTES = [
  note(377, [
    `* feat(handoffs): edit prompt title and branch templates by @a in ${pull(739)}`,
  ]),
  note(376, [
    `* fix(backlog): narrow comments have no timeline by @a in ${pull(668)}`,
    `* feat(plugins): apply command modes to undeclared processes by @a in ${pull(738)}`,
  ]),
  note(374, [`* docs: tidy the README by @a in ${pull(737)}`]),
];

function updateState(available: boolean): DesktopUpdateState {
  return {
    status: available ? "available" : "up-to-date",
    track: "nightly",
    result: {
      track: "nightly",
      currentVersion: version(376),
      latestVersion: version(available ? 377 : 376),
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

function desktop({
  available = true,
  notes = Promise.resolve(NOTES),
}: {
  available?: boolean;
  notes?: Promise<DesktopReleaseNote[]>;
} = {}) {
  const getReleaseNotes = vi.fn((..._args: unknown[]) => notes);
  const updateAndRestart = vi.fn(async (..._args: unknown[]) =>
    updateState(available),
  );
  window.ajourDesktop = {
    runtime: { version: version(376) },
    getReleaseNotes,
    getUpdateState: async () => updateState(available),
    onUpdateStateChanged: () => () => {},
    checkForUpdates: async () => updateState(available),
    updateAndRestart,
  } as never;
  return { getReleaseNotes, updateAndRestart };
}

async function mount() {
  render(<SettingsWhatsNewPage />);
  await act(async () => {});
}

const timeline = () => screen.getByRole("list", { name: "Releases" });
const releaseRows = () =>
  within(timeline())
    .getAllByRole("listitem")
    .filter((item) => item.parentElement === timeline());

describe("What's new", () => {
  beforeEach(() => {
    installDomShims();
    localStore.setUserPreferences({ updateTrack: "nightly" });
  });
  afterEach(() => {
    cleanup();
    delete window.ajourDesktop;
  });

  it("reads the selected track's releases", async () => {
    const { getReleaseNotes } = desktop();
    await mount();

    expect(getReleaseNotes.mock.calls[0]?.[0]).toBe("nightly");
  });

  it("heads the page with the waiting update, its changes and Update and restart", async () => {
    const { updateAndRestart } = desktop();
    await mount();

    const update = screen.getByRole("region", { name: "Nightly 377 is ready" });
    expect(update.textContent).toContain(
      "Edit prompt title and branch templates",
    );
    fireEvent.click(
      within(update).getByRole("button", { name: "Update and restart" }),
    );
    expect(updateAndRestart.mock.calls[0]?.slice(0, 2)).toEqual([
      "nightly",
      version(377),
    ]);
    // The timeline holds the other releases, the installed one marked.
    expect(releaseRows().map((row) => row.dataset.release)).toEqual([
      version(376),
      version(374),
    ]);
    expect(within(releaseRows()[0]!).getByText("Installed")).toBeTruthy();
  });

  it("lists every release in the timeline when Ajour is up to date", async () => {
    desktop({ available: false });
    await mount();

    expect(screen.queryByRole("region", { name: /is ready$/ })).toBeNull();
    expect(releaseRows().map((row) => row.dataset.release)).toEqual([
      version(377),
      version(376),
      version(374),
    ]);
  });

  it("links each release to GitHub and each change to its pull request", async () => {
    desktop({ available: false });
    await mount();

    const installed = releaseRows()[1]!;
    expect(
      within(installed)
        .getByRole("link", { name: "Nightly 376 on GitHub" })
        .getAttribute("href"),
    ).toBe(NOTES[1]!.releaseUrl);
    expect(
      within(installed)
        .getByRole("link", { name: "Pull request 738" })
        .getAttribute("href"),
    ).toBe(pull(738));
    expect(installed.textContent).toContain("Fix");
    expect(installed.textContent).toContain("Backlog");
    // A release with nothing users would notice says so.
    expect(releaseRows()[2]!.textContent).toContain("Maintenance only");
  });

  it("offers another try when GitHub cannot be read", async () => {
    const { getReleaseNotes } = desktop({
      notes: Promise.reject(new Error("GitHub release check failed (503).")),
    });
    await mount();

    expect(screen.getByText("Couldn't load the release notes.")).toBeTruthy();
    getReleaseNotes.mockReturnValueOnce(Promise.resolve(NOTES));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(releaseRows()).toHaveLength(2);
  });

  it("points the browser build at GitHub's releases", async () => {
    await mount();

    expect(
      screen
        .getByRole("link", { name: /All releases on GitHub/ })
        .getAttribute("href"),
    ).toBe("https://github.com/les-cabochons/ajour/releases");
    expect(screen.queryByRole("list", { name: "Releases" })).toBeNull();
  });
});

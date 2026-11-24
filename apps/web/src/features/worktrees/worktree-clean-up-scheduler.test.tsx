// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "@/lib/app-api";
import { WorktreeCleanUpScheduler } from "./worktree-clean-up-scheduler";

/*
 * Automatic clean up starts with the app (#864), in the desktop app only:
 * the web build has no worktree. The local API module is mocked.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  cleanUpWorktrees: vi.fn(),
  listWorktrees: vi.fn(),
}));

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  vi.resetAllMocks();
});

it("starts a round at launch in the desktop app, and stops its timer when the app goes", async () => {
  window.ajourDesktop = {
    chooseFolder: vi.fn(),
  } as unknown as typeof window.ajourDesktop;
  vi.mocked(api.listWorktrees).mockResolvedValue([]);
  const cleared = vi.spyOn(window, "clearInterval");

  const { unmount } = render(<WorktreeCleanUpScheduler />);

  await vi.waitFor(() => expect(api.listWorktrees).toHaveBeenCalledTimes(1));
  unmount();
  expect(cleared).toHaveBeenCalledTimes(1);
});

it("starts nothing in the web build", () => {
  render(<WorktreeCleanUpScheduler />);

  expect(api.listWorktrees).not.toHaveBeenCalled();
});

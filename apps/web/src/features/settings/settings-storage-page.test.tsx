// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { DeckCacheStorage } from "@ajour/shared/deck";
import { Toaster } from "@/components/ui/toast";
import * as api from "@/lib/app-api";
import {
  installDomShims,
  renderRoutes,
  stubNarrowView,
} from "@/test-support/dom";
import { SettingsStoragePage } from "./settings-storage-page";

/*
 * Settings › Storage (#781): the size of Deck's content cache and its cap,
 * a new cap, and Clear cache. The local API module is mocked.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  clearDeckCache: vi.fn(),
  getDeckCacheStorage: vi.fn(),
  saveDeckCacheCap: vi.fn(),
}));

beforeAll(installDomShims);

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const USED: DeckCacheStorage = {
  sizeBytes: 312.4 * MB,
  capBytes: GB,
  entryCount: 14,
};

beforeEach(() => {
  vi.mocked(api.getDeckCacheStorage).mockResolvedValue(USED);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function chooseLimit(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Size limit" }));
  const option = await screen.findByRole("option", { name: label });
  fireEvent.keyDown(option, { key: "Enter" });
  fireEvent.click(option);
  await act(async () => {});
}

const renderPage = async () => {
  await renderRoutes({
    routes: {
      "/": () => (
        <>
          <SettingsStoragePage />
          <Toaster />
        </>
      ),
    },
  });
  await act(async () => {});
};

it("shows how much the content cache holds, of its cap", async () => {
  await renderPage();

  expect(screen.getByRole("heading", { name: "Content cache" })).toBeTruthy();
  expect(screen.getByText("312.4 MB of 1 GB")).toBeTruthy();
  expect(screen.getByText("14 versions of pull requests.")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Size limit" }).textContent).toBe(
    "1 GB",
  );
});

it("saves a new size limit, and shows what eviction left", async () => {
  vi.mocked(api.saveDeckCacheCap).mockResolvedValue({
    sizeBytes: 240 * MB,
    capBytes: 250 * MB,
    entryCount: 9,
  });
  await renderPage();

  await chooseLimit("250 MB");

  expect(api.saveDeckCacheCap).toHaveBeenCalledWith(250 * MB);
  expect(screen.getByText("240.0 MB of 250 MB")).toBeTruthy();
  expect(screen.getByText("9 versions of pull requests.")).toBeTruthy();
});

it("keeps the saved limit when a save fails, and says so", async () => {
  vi.mocked(api.saveDeckCacheCap).mockRejectedValue(new Error("Offline."));
  await renderPage();

  await chooseLimit("5 GB");

  expect(api.saveDeckCacheCap).toHaveBeenCalledTimes(1);
  expect(
    (await screen.findAllByText("Couldn't save the size limit")).length,
  ).toBeGreaterThan(0);
  expect(screen.getByRole("combobox", { name: "Size limit" }).textContent).toBe(
    "1 GB",
  );
});

it("clears the cache", async () => {
  vi.mocked(api.clearDeckCache).mockResolvedValue({
    sizeBytes: 0,
    capBytes: GB,
    entryCount: 0,
  });
  await renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Clear cache" }));
  await act(async () => {});

  expect(api.clearDeckCache).toHaveBeenCalledTimes(1);
  expect(screen.getByText("0 B of 1 GB")).toBeTruthy();
  expect(screen.getByText("Nothing cached.")).toBeTruthy();
  expect((await screen.findAllByText("Cache cleared")).length).toBeGreaterThan(
    0,
  );
});

it("says so when the local API can't read the cache, with nothing to set", async () => {
  vi.mocked(api.getDeckCacheStorage).mockRejectedValue(new Error("Offline."));
  await renderPage();

  expect(screen.getByRole("alert").textContent).toBe(
    "Couldn't read the content cache.",
  );
  expect(
    (screen.getByRole("button", { name: "Clear cache" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  // No limit is chosen, and the select can't open.
  const limit = screen.getByRole("combobox", { name: "Size limit" });
  expect(limit.textContent).toBe("—");
  expect(
    limit.hasAttribute("disabled") ||
      limit.getAttribute("aria-disabled") === "true" ||
      limit.hasAttribute("data-disabled"),
  ).toBe(true);
});

it("works in the narrow view", async () => {
  stubNarrowView(true);
  await renderPage();

  expect(screen.getByText("312.4 MB of 1 GB")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Size limit" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear cache" })).toBeTruthy();
});

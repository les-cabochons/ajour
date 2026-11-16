// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { RepositoryFoldersSection } from "./repository-folders-section";
import { RepositoryPicker } from "@/components/repository-picker";
import * as api from "@/lib/app-api";

vi.mock("@/lib/app-api", () => ({
  listRepositoryFolders: vi.fn(),
  removeRepositoryFolder: vi.fn(),
  useRepositoryFolder: vi.fn(),
}));
beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  vi.resetAllMocks();
});
const folder = {
  id: "one",
  projectId: "p",
  name: "service",
  path: "C:\\work\\service",
};

it("Given web only, explains the desktop requirement without calling the API", async () => {
  await renderRoutes({
    routes: { "/": () => <RepositoryFoldersSection projectId="p" /> },
  });
  expect(screen.getByText(/Folders need the desktop app/)).toBeTruthy();
  expect(api.listRepositoryFolders).not.toHaveBeenCalled();
});

it("Given desktop, adds through the chooser and removes only the saved mapping", async () => {
  const chooseFolder = vi.fn().mockResolvedValue(folder);
  window.ajourDesktop = { chooseFolder };
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([]);
  vi.mocked(api.removeRepositoryFolder).mockResolvedValue([]);
  await renderRoutes({
    routes: { "/": () => <RepositoryFoldersSection projectId="p" /> },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Add folder…" }));
  expect(await screen.findByText(folder.path)).toBeTruthy();
  expect(chooseFolder).toHaveBeenCalledWith("p");
  fireEvent.click(screen.getByRole("button", { name: "Remove service" }));
  await waitFor(() => expect(screen.queryByText(folder.path)).toBeNull());
  expect(api.removeRepositoryFolder).toHaveBeenCalledWith("p", "one");
});

it("Given several folders, preselects the last used and remembers confirmation", async () => {
  window.ajourDesktop = { chooseFolder: vi.fn() };
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    folder,
    { ...folder, id: "two", name: "client", lastUsedAt: 50 },
  ]);
  vi.mocked(api.useRepositoryFolder).mockResolvedValue([]);
  const onSelect = vi.fn();
  await renderRoutes({
    routes: {
      "/": () => (
        <RepositoryPicker
          projectId="p"
          open
          onOpenChange={() => {}}
          onSelect={onSelect}
        />
      ),
    },
  });
  const selected = await screen.findByRole("radio", { name: /client/ });
  expect((selected as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Use folder" }));
  await waitFor(() =>
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "two" }),
    ),
  );
  expect(api.useRepositoryFolder).toHaveBeenCalledWith("p", "two");
});

it("Given no folder, the picker offers the native chooser and displays refusals", async () => {
  window.ajourDesktop = {
    chooseFolder: vi
      .fn()
      .mockRejectedValue(new Error("Ajour's data folder cannot be used.")),
  };
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([]);
  await renderRoutes({
    routes: {
      "/": () => (
        <RepositoryPicker
          projectId="p"
          open
          onOpenChange={() => {}}
          onSelect={() => {}}
        />
      ),
    },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Add folder…" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Ajour's data folder",
  );
});

it("Given a saved selection, adding another folder selects the new folder", async () => {
  const added = { ...folder, id: "new", name: "added" };
  window.ajourDesktop = { chooseFolder: vi.fn().mockResolvedValue(added) };
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([folder]);
  await renderRoutes({
    routes: {
      "/": () => (
        <RepositoryPicker
          projectId="p"
          open
          onOpenChange={() => {}}
          onSelect={() => {}}
        />
      ),
    },
  });
  await screen.findByRole("radio", { name: /service/ });
  fireEvent.click(screen.getByRole("button", { name: /Add folder/ }));
  const radio = await screen.findByRole("radio", { name: /added/ });
  await waitFor(() => expect((radio as HTMLInputElement).checked).toBe(true));
});
it("Given a pending initial list, the section adds no loading line and uses normal controls", async () => {
  window.ajourDesktop = { chooseFolder: vi.fn() };
  vi.mocked(api.listRepositoryFolders).mockReturnValue(new Promise(() => {}));
  await renderRoutes({
    routes: { "/": () => <RepositoryFoldersSection projectId="p" /> },
  });
  expect(screen.queryByText(/Loading folders/)).toBeNull();
  expect(
    screen.getByRole("button", { name: /Add folder/ }).className,
  ).toContain("h-[var(--control-height)]");
});

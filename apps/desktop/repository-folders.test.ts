import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { recordingEvents, noWindowSession } from "./recording-events.ts";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const {
  protectedRepositoryFolders,
  createFolderChooser,
} = require("./electron/repository-folders.cjs");
it.each(["win32", "darwin", "development"])(
  "protects data, install, CLI and override locations for %s",
  (platform) => {
    const roots = protectedRepositoryFolders({
      platform: platform === "development" ? "win32" : platform,
      packaged: platform !== "development",
      userData: "/data",
      exe: "/install/ajour.exe",
      resources: "/Applications/Ajour.app/Contents/Resources",
      appPath: "/source",
      localAppData: "/local",
      env: {
        AJOUR_APP_API_STATE_PATH: "/state/custom.json",
        AJOUR_USER_DATA_PATH: "/override",
      },
    });
    expect(Object.values(roots)).toEqual(
      expect.arrayContaining([
        "/data",
        path.join("/local", "Ajour", "bin"),
        path.dirname(path.resolve("/state/custom.json")),
        path.resolve("/override"),
      ]),
    );
    expect(roots.install).toBe(
      platform === "development"
        ? "/source"
        : platform === "darwin"
          ? path.resolve("/Applications/Ajour.app/Contents/Resources", "../..")
          : path.dirname("/install/ajour.exe"),
    );
  },
);
it("refuses foreign senders and invalid projects before opening, records cancel and passes only the chosen path", async () => {
  const show = vi.fn().mockResolvedValue({ canceled: true, filePaths: [] });
  const add = vi.fn();
  const cancel = vi.fn();
  const window = { webContents: { mainFrame: {} } };
  const choose = createFolderChooser({
    window: () => window,
    assertSender: (event: unknown) => {
      if (event !== window) throw new Error("refused");
    },
    show,
    add,
    cancel,
  });
  await expect(choose({}, "p")).rejects.toThrow("refused");
  await expect(choose(window, 42)).rejects.toThrow("project");
  expect(show).not.toHaveBeenCalled();
  expect(await choose(window, "p")).toBeNull();
  expect(cancel).toHaveBeenCalledOnce();
  expect(add).not.toHaveBeenCalled();
  show.mockResolvedValue({ canceled: false, filePaths: ["/work/repo"] });
  await choose(window, "p");
  expect(add).toHaveBeenCalledWith("p", "/work/repo");
});

it("Given the registered main handler, refuses other senders and frames, validates projects and records cancellation", async () => {
  const source = await readFile(
    new URL("./electron/main.cjs", import.meta.url),
    "utf8",
  );
  const mainWindow = { webContents: { mainFrame: {} } };
  const { events, recorded } = recordingEvents();
  const {
    createIpcListeners,
    refusedSender,
  } = require("./electron/ipc-listeners.cjs");
  let invoke: (event: unknown, project: unknown) => Promise<unknown>;
  const showOpenDialog = vi
    .fn()
    .mockResolvedValue({ canceled: true, filePaths: [] });
  const context = vm.createContext({
    mainWindow,
    events,
    refusedSender,
    createFolderChooser,
    dialog: { showOpenDialog },
    ipc: createIpcListeners(
      {
        handle: (_channel: string, handler: typeof invoke) => {
          invoke = handler;
        },
      },
      { events, windowSession: noWindowSession },
    ),
  });
  const slice = (start: string, end: string) =>
    source.slice(
      source.indexOf(start),
      source.indexOf(end, source.indexOf(start)),
    );
  vm.runInContext(
    slice(
      "function assertActiveDesktopWindow(",
      "function assertDevelopmentBuild(",
    ) +
      slice(
        `ipc.handle(
  "ajour:choose-folder"`,
        'ipc.handle("ajour:install-plugin"',
      ),
    context,
  );
  await expect(invoke!({ sender: {} }, "p")).rejects.toThrow("active Ajour");
  await expect(
    invoke!({ sender: mainWindow.webContents, senderFrame: {} }, "p"),
  ).rejects.toThrow("main Ajour frame");
  const event = {
    sender: mainWindow.webContents,
    senderFrame: mainWindow.webContents.mainFrame,
  };
  await expect(invoke!(event, 42)).rejects.toThrow("project");
  expect(showOpenDialog).not.toHaveBeenCalled();
  expect(await invoke!(event, "p")).toBeNull();
  expect(
    recorded.map(({ name, kind, outcome, outcome_reason }) => ({
      name,
      kind,
      outcome,
      outcome_reason,
    })),
  ).toEqual([
    {
      name: "repository_folder.choose",
      kind: "ipc",
      outcome: "refused",
      outcome_reason: "foreign_sender",
    },
    {
      name: "repository_folder.choose",
      kind: "ipc",
      outcome: "refused",
      outcome_reason: "foreign_sender",
    },
    {
      name: "repository_folder.choose",
      kind: "ipc",
      outcome: "error",
      outcome_reason: undefined,
    },
    {
      name: "repository_folder.choose",
      kind: "ipc",
      outcome: "cancelled",
      outcome_reason: undefined,
    },
  ]);
});

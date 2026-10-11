import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { SHORTCUTS, isDigitChord } from "../web/src/lib/shortcuts";

type AppMenuItem =
  | { type: "separator" }
  | {
      type: "action";
      id: string;
      label: string;
      action: string;
      accelerator?: string;
    }
  | {
      type: "role";
      id: string;
      label: string;
      role: string;
      accelerator?: string;
    };

interface AppMenu {
  id: string;
  label: string;
  role?: string;
  items: AppMenuItem[];
}

interface TemplateItem {
  id?: string;
  label?: string;
  role?: string;
  type?: string;
  accelerator?: string;
  registerAccelerator?: boolean;
  submenu?: TemplateItem[];
  click?: (
    menuItem: unknown,
    window: unknown,
    event: { triggeredByAccelerator?: boolean },
  ) => void;
}

const require = createRequire(import.meta.url);
const {
  buildAppMenuTemplate,
  findAppMenuRoleItem,
  getAppMenuModel,
  isSingleKeyAccelerator,
} = require("./electron/app-menu.cjs") as {
  buildAppMenuTemplate: (
    model: AppMenu[],
    options: {
      platform: NodeJS.Platform;
      sendAction: (action: string) => void;
    },
  ) => TemplateItem[];
  findAppMenuRoleItem: (model: AppMenu[], itemId: unknown) => unknown;
  getAppMenuModel: (options: {
    platform: NodeJS.Platform;
    developmentBuild: boolean;
    appName: string;
  }) => AppMenu[];
  isSingleKeyAccelerator: (accelerator: string | undefined) => boolean;
};

function model(platform: NodeJS.Platform, developmentBuild: boolean) {
  return getAppMenuModel({ platform, developmentBuild, appName: "Ajour" });
}

/** Each menu as its label followed by its item labels, with "-" for separators. */
function outline(menus: AppMenu[]) {
  return menus.map((menu) => [
    menu.label,
    ...menu.items.map((item) => (item.type === "separator" ? "-" : item.label)),
  ]);
}

function roles(menus: AppMenu[]) {
  return menus.flatMap((menu) =>
    menu.items.flatMap((item) => (item.type === "role" ? [item.role] : [])),
  );
}

function templateItem(template: TemplateItem[], id: string) {
  const item = template
    .flatMap((menu) => menu.submenu ?? [])
    .find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`No template item "${id}".`);
  }
  return item;
}

describe("desktop app menu model", () => {
  it("lays out the macOS menus with the native app and window items", () => {
    expect(outline(model("darwin", false))).toEqual([
      [
        "Ajour",
        "About Ajour",
        "-",
        "Settings…",
        "Check for updates…",
        "-",
        "Hide Ajour",
        "Hide others",
        "Show all",
        "-",
        "Quit Ajour",
      ],
      ["Edit", "Undo", "Redo", "-", "Cut", "Copy", "Paste", "Select all"],
      [
        "View",
        "Day",
        "Week",
        "-",
        "Show or hide sidebar",
        "-",
        "Today",
        "Previous",
        "Next",
        "-",
        "Actual size",
        "Zoom in",
        "Zoom out",
      ],
      ["Entry", "New entry", "Start or stop", "Continue"],
      [
        "Window",
        "Minimize",
        "Zoom",
        "-",
        "Close window",
        "-",
        "Bring all to front",
      ],
      ["Help", "Keyboard shortcuts"],
    ]);
    expect(
      model("darwin", false).map((menu) => [menu.id, menu.role]),
    ).toContainEqual(["help", "help"]);
  });

  it("lays out the Windows menus without the macOS-only items", () => {
    const menus = model("win32", false);

    expect(outline(menus)[0]).toEqual([
      "Ajour",
      "About Ajour",
      "-",
      "Settings…",
      "Check for updates…",
      "-",
      "Exit",
    ]);
    expect(outline(menus)[4]).toEqual(["Window", "Minimize", "Close window"]);
    expect(roles(menus)).not.toContain("hide");
    expect(roles(menus)).not.toContain("front");
    expect(menus.every((menu) => menu.role === undefined)).toBe(true);
  });

  it.each(["darwin", "win32"] as const)(
    "drops Reload and DevTools from production builds on %s",
    (platform) => {
      const production = roles(model(platform, false));
      expect(production).not.toContain("reload");
      expect(production).not.toContain("forceReload");
      expect(production).not.toContain("toggleDevTools");
    },
  );

  it.each([
    ["darwin", "Alt+Command+I"],
    ["win32", "Ctrl+Shift+I"],
  ] as const)(
    "keeps Reload and DevTools in development builds on %s",
    (platform, devToolsAccelerator) => {
      const view = model(platform, true).find((menu) => menu.id === "view")!;
      expect(view.items.slice(-3)).toEqual([
        { type: "separator" },
        {
          type: "role",
          id: "role:reload",
          label: "Reload",
          role: "reload",
          accelerator: "CmdOrCtrl+R",
        },
        {
          type: "role",
          id: "role:toggleDevTools",
          label: "Toggle developer tools",
          role: "toggleDevTools",
          accelerator: devToolsAccelerator,
        },
      ]);
    },
  );

  it("uses the platform's Redo key", () => {
    const redo = (platform: NodeJS.Platform) =>
      model(platform, false)
        .flatMap((menu) => menu.items)
        .find((item) => item.type === "role" && item.role === "redo");

    expect(redo("darwin")).toMatchObject({ accelerator: "Shift+CmdOrCtrl+Z" });
    expect(redo("win32")).toMatchObject({ accelerator: "Ctrl+Y" });
  });

  it("shows the same keys as the shortcut registry", () => {
    const registryAccelerators = new Map(
      SHORTCUTS.flatMap((shortcut) => {
        const chord = shortcut.keys[0]!;
        // Pinned task digits are a key range that no menu item shows.
        if (shortcut.keys.length !== 1 || isDigitChord(chord)) {
          return [];
        }

        const key = chord.key.toUpperCase();
        return [[shortcut.id, chord.mod ? `CmdOrCtrl+${key}` : key] as const];
      }),
    );
    const actionItems = model("darwin", false)
      .flatMap((menu) => menu.items)
      .filter((item) => item.type === "action");

    for (const item of actionItems) {
      expect(item.accelerator, item.action).toBe(
        registryAccelerators.get(item.action as never),
      );
    }
  });
});

describe("desktop app menu template", () => {
  it("sends an action item's registry id when clicked", () => {
    const sendAction = vi.fn();
    const template = buildAppMenuTemplate(model("darwin", false), {
      platform: "darwin",
      sendAction,
    });

    templateItem(template, "action:app.toggle-sidebar").click?.(null, null, {
      triggeredByAccelerator: false,
    });

    expect(sendAction).toHaveBeenCalledWith("app.toggle-sidebar");
  });

  it("shows single keys on Windows as accelerators it does not register", () => {
    const sendAction = vi.fn();
    const template = buildAppMenuTemplate(model("win32", false), {
      platform: "win32",
      sendAction,
    });
    const day = templateItem(template, "action:time.day-view");

    expect(day).toMatchObject({
      label: "Day",
      accelerator: "D",
      registerAccelerator: false,
    });
    day.click?.(null, null, {});
    expect(sendAction).toHaveBeenCalledWith("time.day-view");
  });

  it.each([false, true])(
    "binds no single key on macOS, development build %s",
    (developmentBuild) => {
      const template = buildAppMenuTemplate(model("darwin", developmentBuild), {
        platform: "darwin",
        sendAction: vi.fn(),
      });
      const items = template.flatMap((menu) => menu.submenu ?? []);

      for (const item of items) {
        expect(
          item.accelerator === undefined ||
            !isSingleKeyAccelerator(item.accelerator),
          item.id,
        ).toBe(true);
      }
      expect(templateItem(template, "action:time.day-view").label).toBe(
        "Day (D)",
      );
      expect(templateItem(template, "action:app.shortcuts").label).toBe(
        "Keyboard shortcuts (?)",
      );
    },
  );

  it("registers modifier shortcuts as accelerators", () => {
    const template = buildAppMenuTemplate(model("darwin", false), {
      platform: "darwin",
      sendAction: vi.fn(),
    });

    const settings = templateItem(template, "action:app.settings");
    expect(settings.accelerator).toBe("CmdOrCtrl+,");
    expect(settings.registerAccelerator).toBeUndefined();
  });

  it("passes roles through to Electron and keeps the menu roles", () => {
    const template = buildAppMenuTemplate(model("darwin", false), {
      platform: "darwin",
      sendAction: vi.fn(),
    });

    expect(templateItem(template, "role:copy")).toEqual({
      id: "role:copy",
      label: "Copy",
      role: "copy",
      accelerator: "CmdOrCtrl+C",
    });
    expect(template.map((menu) => menu.role)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "window",
      "help",
    ]);
  });

  it("builds no Reload or DevTools items for production builds", () => {
    const template = buildAppMenuTemplate(model("win32", false), {
      platform: "win32",
      sendAction: vi.fn(),
    });
    const accelerators = template
      .flatMap((menu) => menu.submenu ?? [])
      .map((item) => item.accelerator);

    expect(accelerators).not.toContain("CmdOrCtrl+R");
    expect(accelerators).not.toContain("Ctrl+Shift+I");
  });
});

describe("desktop app menu helpers", () => {
  it("tells single keys from modifier shortcuts", () => {
    expect(isSingleKeyAccelerator("D")).toBe(true);
    expect(isSingleKeyAccelerator("[")).toBe(true);
    expect(isSingleKeyAccelerator("?")).toBe(true);
    expect(isSingleKeyAccelerator("CmdOrCtrl+B")).toBe(false);
    expect(isSingleKeyAccelerator(undefined)).toBe(false);
  });

  it("only finds role items for ids sent back by the Windows title bar", () => {
    const menus = model("win32", false);

    expect(findAppMenuRoleItem(menus, "role:copy")).toMatchObject({
      role: "copy",
    });
    expect(findAppMenuRoleItem(menus, "action:app.settings")).toBeUndefined();
    expect(findAppMenuRoleItem(menus, "role:reload")).toBeUndefined();
    expect(findAppMenuRoleItem(menus, 42)).toBeUndefined();
  });
});

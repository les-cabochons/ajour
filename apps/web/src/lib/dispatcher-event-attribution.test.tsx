// @vitest-environment jsdom
import { useEffect } from "react";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { Toaster } from "@/components/ui/toast";
import type { ObjectAction } from "@/domain/actions/object-actions";
import { createSidebarMatcher } from "@/domain/backlog/sidebar-filter";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import { BacklogPage } from "@/features/backlog/backlog-page";
import { CommandPalette } from "@/features/command-palette/command-palette";
import { offerUndo } from "@/features/feedback/undo-toast";
import { AppMenuBar } from "@/features/layout/app-menu-bar";
import { SidebarBacklogList } from "@/features/layout/sidebar-backlog-list";
import { TimeEntryEditorForm } from "@/features/time/time-entry-editor-form";
import { TimeEntryEditorPopover } from "@/features/time/time-entry-editor-popover";
import { useActionRequest } from "@/lib/action-request";
import { handleItemKeyDown } from "@/lib/item-keys";
import { localStore } from "@/lib/local-store";
import { ShortcutProvider, useShortcut } from "@/lib/shortcut-handlers";
import { replaceEventSink } from "@/lib/wide-events";
import {
  installDomShims,
  renderRoutes,
  stubNarrowView,
} from "@/test-support/dom";

/*
 * Every renderer command event says who started it (`trigger`) and from where
 * (`surface`). Each test here drives one real dispatcher, renders it or calls
 * its handler, and reads the command events it recorded. Each action is a
 * store command on a backlog item, so the events name the same thing and the
 * surface is the only difference.
 */

let sink: ReturnType<typeof createRecordingSink<AjourEvent>>;

beforeAll(installDomShims);

beforeEach(() => {
  sink = createRecordingSink<AjourEvent>();
  replaceEventSink(sink);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.ajourDesktop;
});

/** The recorded command events, or those of one name: what each did, who started it and from where. */
function commands(name?: string) {
  return sink.events
    .filter((event) => event.kind === "command")
    .filter((event) => name === undefined || event.name === name)
    .map((event) => ({
      name: event.name,
      trigger: event.trigger,
      surface: event.surface ?? null,
    }));
}

/** A backlog item whose title is unique to the test, so a search finds only it. */
function addItem(title: string) {
  const id = localStore.addWorkItem({ title });
  sink.events.length = 0;
  return id;
}

const PIN: ObjectAction<"pin">[] = [{ id: "pin", label: "Pin" }];

describe("a store command with no dispatcher", () => {
  it("reports the user and no surface", () => {
    localStore.addWorkItem({ title: "Called directly" });

    expect(commands()).toEqual([
      { name: "backlog_item.create", trigger: "user", surface: null },
    ]);
    expect(sink.events[0]).not.toHaveProperty("surface");
  });
});

describe("the command palette", () => {
  /** The palette and a Backlog page that runs `edit` requests, as the real page does. */
  async function renderPalette(path = "/backlog") {
    function Page() {
      useActionRequest(({ action, target }) => {
        if (action === "edit" && target) {
          localStore.updateWorkItem(target, { title: "Edited by the page" });
        }
      });
      return <p>Backlog</p>;
    }
    return renderRoutes({
      shell: ({ children }) => (
        <ShortcutProvider>
          <CommandPalette />
          {children}
        </ShortcutProvider>
      ),
      routes: { "/backlog": Page },
      path,
    });
  }

  /** Opens the palette, finds the item by its title, and picks one of its actions. */
  async function pickAction(title: string, action: RegExp) {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByLabelText("Search commands"), {
      target: { value: title },
    });
    fireEvent.click(await screen.findByText(title));
    fireEvent.click(await screen.findByRole("option", { name: action }));
  }

  it("marks a command it runs itself as palette", async () => {
    const id = addItem("Palette pin target");
    await renderPalette();

    await pickAction("Palette pin target", /^Pin/);

    await waitFor(() =>
      expect(commands()).toEqual([
        { name: "backlog_item.pin", trigger: "user", surface: "palette" },
      ]),
    );
    expect(
      localStore.snapshot().workItems.find((item) => item._id === id),
    ).toMatchObject({ pinnedAt: expect.any(Number) });
  });

  it("keeps palette on an action a page runs from the route, and not on the next command", async () => {
    const id = addItem("Palette edit target");
    const { router } = await renderPalette();

    await pickAction("Palette edit target", /^Edit/);

    await waitFor(() =>
      expect(commands()).toEqual([
        { name: "backlog_item.update", trigger: "user", surface: "palette" },
      ]),
    );
    // The request left the URL, so it cannot run again or leak into a reload.
    expect(router.state.location.search).toEqual({});
    expect(
      localStore.snapshot().workItems.find((item) => item._id === id)?.title,
    ).toBe("Edited by the page");

    const unrelated = localStore.addWorkItem({ title: "Unrelated" });
    localStore.pinWorkItem(unrelated);

    expect(commands().slice(1)).toEqual([
      { name: "backlog_item.create", trigger: "user", surface: null },
      { name: "backlog_item.pin", trigger: "user", surface: null },
    ]);
  });

  it("ignores a surface in the URL that is not the palette", async () => {
    const id = addItem("Typed into the URL");

    await renderPalette(`/backlog?action=edit&target=${id}&surface=toast`);

    await waitFor(() =>
      expect(commands()).toEqual([
        { name: "backlog_item.update", trigger: "user", surface: null },
      ]),
    );
  });
});

describe("the shortcut dispatcher", () => {
  it("marks a command a pressed key runs as shortcut", async () => {
    function Handler() {
      useShortcut("entry.new", () => {
        localStore.addWorkItem({ title: "From a key" });
      });
      return null;
    }
    await renderRoutes({
      shell: ({ children }) => (
        <ShortcutProvider>
          <Handler />
          {children}
        </ShortcutProvider>
      ),
      routes: { "/": () => null },
    });
    sink.events.length = 0;

    fireEvent.keyDown(window, { key: "n" });

    expect(commands()).toEqual([
      { name: "backlog_item.create", trigger: "user", surface: "shortcut" },
    ]);
  });
});

describe("the keys of a focused item", () => {
  it("marks an action key as item_key", () => {
    const id = addItem("Item key target");
    const actions: ObjectAction<"edit">[] = [{ id: "edit", label: "Edit" }];
    const { getByTestId } = render(
      <div
        data-testid="row"
        tabIndex={0}
        onKeyDown={(event) =>
          handleItemKeyDown(event, {
            actions,
            keys: { edit: "item.edit" },
            onAction: () => localStore.updateWorkItem(id, { title: "Edited" }),
          })
        }
      />,
    );

    fireEvent.keyDown(getByTestId("row"), { key: "Enter" });

    expect(commands()).toEqual([
      { name: "backlog_item.update", trigger: "user", surface: "item_key" },
    ]);
  });
});

describe("an object's action menus", () => {
  it("tells the right-click menu from the ... button for the same action", async () => {
    const id = addItem("Menu target");
    const item = localStore
      .snapshot()
      .workItems.find((candidate) => candidate._id === id)!;
    // The action runner sets button itself: the menu around it still wins.
    const onAction = () => runBacklogItemAction(item, "pin", () => {});
    const { getByTestId, getByRole } = render(
      <ObjectContextMenu
        actions={PIN}
        onAction={onAction}
        render={<div data-testid="row" />}
      >
        <ObjectActionsButton
          actions={PIN}
          onAction={onAction}
          label="Actions for the item"
        />
      </ObjectContextMenu>,
    );

    fireEvent.contextMenu(getByTestId("row"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Pin/ }));
    await waitFor(() => expect(commands()).toHaveLength(1));

    fireEvent.click(getByRole("button", { name: "Actions for the item" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Pin/ }));
    await waitFor(() => expect(commands()).toHaveLength(2));

    expect(commands()).toEqual([
      { name: "backlog_item.pin", trigger: "user", surface: "context_menu" },
      { name: "backlog_item.pin", trigger: "user", surface: "button" },
    ]);
  });
});

describe("the app menu", () => {
  it("marks an action the main process sends as app_menu", async () => {
    let send: (action: string) => void = () => {};
    window.ajourDesktop = {
      onMenuAction: (listener: (action: string) => void) => {
        send = listener;
        return () => {};
      },
    } as unknown as typeof window.ajourDesktop;
    function Handler() {
      useShortcut("entry.new", () => {
        localStore.addWorkItem({ title: "From the menu" });
      });
      return null;
    }
    await renderRoutes({
      shell: ({ children }) => (
        <ShortcutProvider>
          <Handler />
          <AppMenuBar />
          {children}
        </ShortcutProvider>
      ),
      routes: { "/": () => null },
    });
    sink.events.length = 0;

    act(() => send("entry.new"));

    expect(commands()).toEqual([
      { name: "backlog_item.create", trigger: "user", surface: "app_menu" },
    ]);
  });
});

describe("a drag", () => {
  it("marks the reorder a drop commits as drag", async () => {
    localStore.setBacklogSortMode("custom");
    localStore.addWorkItem({ title: "Dragged first" });
    localStore.addWorkItem({ title: "Dragged second" });
    await renderRoutes({
      shell: ({ children }) => <ShortcutProvider>{children}</ShortcutProvider>,
      routes: {
        "/": () => (
          <SidebarBacklogList
            pathname="/"
            matcher={createSidebarMatcher({ query: "" }, [])}
          />
        ),
      },
    });
    // jsdom has no layout: rows are 30px tall, in one drop target, inside a
    // list that shows them all.
    const box = (top: number, height: number) => () =>
      ({
        top,
        bottom: top + height,
        left: 0,
        right: 200,
        width: 200,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    for (const block of document.querySelectorAll<HTMLElement>(
      '[data-drop-target], [aria-label="Backlog items"]',
    )) {
      block.getBoundingClientRect = box(0, 1000);
    }
    const rows = [
      ...document.querySelectorAll<HTMLElement>("[data-backlog-item-id]"),
    ];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = box(index * 30, 30);
    });
    sink.events.length = 0;
    const pointer = { pointerId: 1, pointerType: "mouse", clientX: 10 };

    // The last row goes to the top.
    fireEvent.pointerDown(rows.at(-1)!, { ...pointer, button: 0, clientY: 75 });
    fireEvent.pointerMove(window, { ...pointer, clientY: 40 });
    fireEvent.pointerMove(window, { ...pointer, clientY: 2 });
    fireEvent.pointerUp(window, { ...pointer, clientY: 2 });

    expect(commands()).toEqual([
      { name: "backlog_item.reorder", trigger: "user", surface: "drag" },
    ]);
  });
});

describe("the entry editor", () => {
  /** Types 1.5 hours into a new entry and saves it. */
  async function saveNewEntry() {
    fireEvent.change(await screen.findByPlaceholderText("01:30"), {
      target: { value: "01:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  }

  it("marks a save in the side panel as editor", async () => {
    render(
      <TimeEntryEditorForm
        target={{ kind: "create", localDate: "2026-10-14" }}
        host="side_panel"
        onClose={() => {}}
      />,
    );

    await saveNewEntry();

    expect(commands()).toEqual([
      { name: "time_entry.create", trigger: "user", surface: "editor" },
    ]);
  });

  it("marks a save in the popover as popover", async () => {
    render(
      <TimeEntryEditorPopover
        target={{ kind: "create", localDate: "2026-10-14" }}
        open
        onOpenChange={() => {}}
        triggerLabel="New entry"
      >
        New
      </TimeEntryEditorPopover>,
    );

    await saveNewEntry();

    expect(commands()).toEqual([
      { name: "time_entry.create", trigger: "user", surface: "popover" },
    ]);
  });
});

describe("the backlog item editor", () => {
  /** Opens the editor for a new item on the Backlog page, and saves it. Returns whether it sat in a dialog. */
  async function saveNewItem(narrow: boolean) {
    stubNarrowView(narrow);
    await renderRoutes({
      shell: ({ children }) => <ShortcutProvider>{children}</ShortcutProvider>,
      routes: { "/backlog": BacklogPage },
      path: "/backlog?action=create",
    });
    sink.events.length = 0;
    fireEvent.change(await screen.findByPlaceholderText("Item name"), {
      target: { value: `Created in a ${narrow ? "dialog" : "side panel"}` },
    });
    const inDialog = screen.queryByRole("dialog") !== null;
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(commands()).toHaveLength(1));
    return inDialog;
  }

  it("marks a save in a dialog as dialog", async () => {
    expect(await saveNewItem(true)).toBe(true);
    expect(commands()).toEqual([
      { name: "backlog_item.create", trigger: "user", surface: "dialog" },
    ]);
  });

  it("marks a save in the side panel as editor", async () => {
    expect(await saveNewItem(false)).toBe(false);
    expect(commands()).toEqual([
      { name: "backlog_item.create", trigger: "user", surface: "editor" },
    ]);
  });
});

describe("the Undo toast", () => {
  /** Archives an item and offers its Undo, the way an action does. */
  function archiveWithUndo(title: string) {
    const id = addItem(title);
    offerUndo(localStore.archiveWorkItem(id), {
      title: `${title} archived`,
      subject: "backlog item",
    });
    sink.events.length = 0;
  }

  it("marks the Undo button as toast, and Cmd+Z or Ctrl+Z as shortcut", async () => {
    await renderRoutes({
      shell: ({ children }) => (
        <>
          <Toaster />
          {children}
        </>
      ),
      routes: { "/": () => null },
    });

    archiveWithUndo("Undone by click");
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(commands("undo.restore")).toEqual([
      { name: "undo.restore", trigger: "user", surface: "toast" },
    ]);

    archiveWithUndo("Undone by key");
    await screen.findByText("Undone by key archived");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(commands("undo.restore")).toEqual([
      { name: "undo.restore", trigger: "user", surface: "shortcut" },
    ]);
  });
});

describe("a domain action runner", () => {
  it("marks a backlog item action as button", () => {
    const id = addItem("Runner target");
    const item = localStore
      .snapshot()
      .workItems.find((candidate) => candidate._id === id)!;

    runBacklogItemAction(item, "pin", () => {});

    expect(commands()).toEqual([
      { name: "backlog_item.pin", trigger: "user", surface: "button" },
    ]);
  });
});

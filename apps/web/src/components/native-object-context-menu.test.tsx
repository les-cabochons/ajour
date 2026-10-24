// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import type { ObjectAction } from "@/domain/actions/object-actions";
import { installDomShims } from "@/test-support/dom";

/*
 * The desktop's right-click menu. `ObjectContextMenu` picks the native menu
 * when its module loads, so this file loads it with the desktop bridge in
 * place: the main process draws the menu, and the action picked there runs
 * as a `context_menu` action.
 */

beforeAll(installDomShims);

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  vi.resetModules();
});

const PIN: ObjectAction<"pin">[] = [{ id: "pin", label: "Pin" }];

/** The modules as the desktop window loads them, with a recording sink. */
async function loadDesktop(picked: string | null) {
  const showContextMenu = vi.fn(async () => picked);
  window.ajourDesktop = {
    showContextMenu,
  } as unknown as typeof window.ajourDesktop;
  vi.resetModules();
  const sink = createRecordingSink<AjourEvent>();
  (await import("@/lib/wide-events")).replaceEventSink(sink);
  const { ObjectContextMenu } =
    await import("@/components/object-actions-menu");
  const { localStore } = await import("@/lib/local-store");
  const { runBacklogItemAction } =
    await import("@/features/backlog/backlog-item-actions");
  const id = localStore.addWorkItem({ title: "Native menu target" });
  const item = localStore
    .snapshot()
    .workItems.find((candidate) => candidate._id === id)!;
  sink.events.length = 0;
  const view = render(
    <ObjectContextMenu
      actions={PIN}
      onAction={(action) => runBacklogItemAction(item, action, () => {})}
      render={<div data-testid="row" />}
    />,
  );
  return { showContextMenu, sink, view };
}

describe("the desktop's native right-click menu", () => {
  it("asks the main process for the menu, and runs the action picked there as a context_menu action", async () => {
    const { showContextMenu, sink, view } = await loadDesktop("pin");

    fireEvent.contextMenu(view.getByTestId("row"), {
      clientX: 40,
      clientY: 60,
    });

    await waitFor(() =>
      expect(
        sink.events.filter((event) => event.kind === "command"),
      ).toHaveLength(1),
    );
    expect(showContextMenu).toHaveBeenCalledWith(
      [expect.objectContaining({ type: "item", id: "pin", label: "Pin" })],
      { x: 40, y: 60 },
      undefined,
    );
    // The browser's own menu never opened.
    expect(view.queryByRole("menuitem")).toBeNull();
    expect(sink.events[0]).toMatchObject({
      name: "backlog_item.pin",
      kind: "command",
      trigger: "user",
      surface: "context_menu",
      outcome: "ok",
    });
  });

  it("runs nothing when the menu closes without a pick", async () => {
    const { showContextMenu, sink, view } = await loadDesktop(null);

    fireEvent.contextMenu(view.getByTestId("row"));

    await waitFor(() => expect(showContextMenu).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink.events).toEqual([]);
  });
});

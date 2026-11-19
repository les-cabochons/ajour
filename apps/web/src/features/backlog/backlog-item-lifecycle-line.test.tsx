// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import { installDomShims } from "@/test-support/dom";
import { BacklogItemLifecycleLine } from "./backlog-item-lifecycle-line";

beforeAll(installDomShims);
afterEach(cleanup);

type Status = "active" | "settled" | "archived";

function renderLine({
  status = "active" as Status,
  source = "azure_devops",
  isSnoozed = false,
} = {}) {
  const onAction =
    vi.fn<
      (id: BacklogItemActionId, options?: { askToSettle?: boolean }) => void
    >();
  const item = { status, source };
  render(
    <TooltipProvider>
      <BacklogItemLifecycleLine
        item={item}
        isSnoozed={isSnoozed}
        actions={getBacklogItemActions(item, {
          isRunning: false,
          isSubitem: false,
          isSnoozed,
          subitemCount: 0,
        })}
        onAction={onAction}
      />
    </TooltipProvider>,
  );
  return onAction;
}

const moves = () =>
  screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));

it.each([
  {
    name: "an active synced item",
    item: {},
    state: "Active",
    offers: ["Snooze", "Settle", "Archive"],
  },
  {
    name: "an active manual item, which archives through Settle",
    item: { source: "manual" },
    state: "Active",
    offers: ["Snooze", "Settle"],
  },
  {
    name: "a snoozed item",
    item: { isSnoozed: true },
    state: "Snoozed",
    offers: ["Unsnooze"],
  },
  {
    name: "a settled item",
    item: { status: "settled" as Status },
    state: "Settled",
    offers: ["Unsettle"],
  },
  {
    name: "an archived item",
    item: { status: "archived" as Status },
    state: "Archived",
    offers: ["Restore"],
  },
])(
  "names the state of $name and offers its moves",
  ({ item, state, offers }) => {
    renderLine(item);
    expect(
      screen.getByRole("group", { name: `Lifecycle: ${state}` }),
    ).toBeTruthy();
    expect(screen.getByText(state)).toBeTruthy();
    expect(moves()).toEqual(offers);
  },
);

it("runs each move in one click, and Settle asks first with Shift", () => {
  const onAction = renderLine();
  fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
  expect(onAction).toHaveBeenLastCalledWith("snooze", { askToSettle: false });
  fireEvent.click(screen.getByRole("button", { name: "Settle" }));
  expect(onAction).toHaveBeenLastCalledWith("settle", { askToSettle: false });
  fireEvent.click(screen.getByRole("button", { name: "Settle" }), {
    shiftKey: true,
  });
  expect(onAction).toHaveBeenLastCalledWith("settle", { askToSettle: true });
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(onAction).toHaveBeenLastCalledWith("archive", { askToSettle: false });
});

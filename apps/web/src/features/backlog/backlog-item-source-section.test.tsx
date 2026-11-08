// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
import { SourceSection } from "@/features/backlog/backlog-item-source-section";
import { installDomShims } from "@/test-support/dom";

const now = Date.UTC(2026, 10, 8, 14, 0);

const billet: LocalWorkItem = {
  _id: "w1",
  createdAt: now - 86_400_000,
  title: "Billet #11017098 - Réserver un lot",
  status: "active",
  source: "azure_devops",
  sourceId: "https://dev.azure.com/acme/_workitems/edit/331150",
  sourceExternalId: "331150",
  sourceConnectionId: "c1",
  sourceConnectionLabel: "nventive",
  sourceProjectName: "Oliva Horticulture",
  sourceWorkItemType: "Billet",
  sourceStatusLabel: "Active",
  sourceSyncedAt: now - 5 * 60_000,
  assignee: { id: "p1", displayName: "Alex Trépanier" },
};

function renderSection(item: LocalWorkItem, open = true) {
  return render(
    <SourceSection
      item={item}
      label="Azure DevOps"
      now={now}
      open={open}
      onOpenChange={() => {}}
    />,
  );
}

beforeEach(installDomShims);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a synced item's source section", () => {
  it("is titled by the plugin, carries the number, and lists the source's rows", () => {
    renderSection(billet);

    expect(
      screen.getByRole("button", { name: /Azure DevOps.*331150/ }),
    ).toBeTruthy();
    const terms = screen.getAllByRole("term").map((dt) => dt.textContent);
    expect(terms).toEqual([
      "ID",
      "Type",
      "State",
      "Project",
      "Assigned to",
      "Connection",
      "Synced",
    ]);
    expect(screen.getByText("Billet")).toBeTruthy();
    expect(screen.getByText("Oliva Horticulture")).toBeTruthy();
    expect(screen.getByText("Alex Trépanier")).toBeTruthy();
    expect(screen.getByText("nventive")).toBeTruthy();
    expect(screen.getByText("5 min ago")).toBeTruthy();
  });

  it("hides its rows while closed and leaves out what the source does not say", () => {
    renderSection(
      {
        ...billet,
        sourceWorkItemType: undefined,
        assignee: undefined,
        sourceConnectionLabel: undefined,
      },
      false,
    );
    expect(screen.queryByRole("term")).toBeNull();
    cleanup();

    renderSection({
      ...billet,
      sourceWorkItemType: undefined,
      assignee: null,
      sourceConnectionLabel: undefined,
    });
    const terms = screen.getAllByRole("term").map((dt) => dt.textContent);
    expect(terms).toEqual(["ID", "State", "Project", "Assigned to", "Synced"]);
    expect(screen.getByText("No one")).toBeTruthy();
  });

  it("copies the number", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderSection(billet);

    fireEvent.click(screen.getByRole("button", { name: "Copy ID" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("331150"));
  });
});

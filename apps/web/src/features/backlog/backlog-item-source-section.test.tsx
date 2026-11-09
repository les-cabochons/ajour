// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginsOverview } from "@ajour/shared";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  BacklogItemSourceSection,
  SourceSection,
} from "@/features/backlog/backlog-item-source-section";
import { cachePluginsOverview } from "@/lib/app-api";
import { updateBacklogItemCards } from "@/lib/backlog-item-cards";
import { installDomShims } from "@/test-support/dom";
import { codeHostOverview } from "../../../tests/fixtures/pull-requests";

const refreshBacklog = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/features/backlog/backlog-refresh-workflow", async (original) => ({
  ...(await original<object>()),
  refreshBacklog,
}));

const now = Date.UTC(2026, 10, 8, 14, 0);

const billet: LocalWorkItem = {
  _id: "w1",
  createdAt: now - 86_400_000,
  title: "Billet #11017098 - Réserver un lot",
  status: "active",
  source: "tracker",
  sourceId: "https://tracker.example/items/331150",
  sourceExternalId: "331150",
  sourceConnectionId: "c1",
  sourceConnectionLabel: "Work",
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
      label="Tracker"
      now={now}
      open={open}
      onOpenChange={() => {}}
    />,
  );
}

/** The overview with the item's plugin, "Tracker", and its connection c1. */
function trackerOverview(): PluginsOverview {
  const overview = structuredClone(codeHostOverview);
  const group = overview.connectionGroups[0]!;
  group.plugin = {
    ...group.plugin,
    id: "tracker",
    displayName: "Tracker",
    capabilities: { connector: {} },
  };
  group.connections = [
    { ...group.connections[0]!, id: "c1", pluginId: "tracker", label: "Work" },
  ];
  overview.plugins = [group.plugin];
  return overview;
}

beforeEach(() => {
  installDomShims();
  window.localStorage.clear();
  updateBacklogItemCards({ sourceOpen: true });
  refreshBacklog.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a synced item's source section", () => {
  it("is titled by the plugin, carries the number, and lists the source's rows", () => {
    renderSection(billet);

    expect(
      screen.getByRole("button", { name: /Tracker.*331150/ }),
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
    expect(screen.getByText("Work")).toBeTruthy();
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

describe("the section on the item page and in the peek", () => {
  it("shows nothing for a manual item", () => {
    cachePluginsOverview(trackerOverview());
    render(
      <BacklogItemSourceSection
        item={{ ...billet, source: "manual", sourceExternalId: undefined }}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("term")).toBeNull();
  });

  it("takes its title from the plugin, and falls back on the connection's label without the overview", () => {
    cachePluginsOverview(trackerOverview());
    render(<BacklogItemSourceSection item={billet} />);
    expect(
      screen.getByRole("button", { name: /^Tracker.*331150/ }),
    ).toBeTruthy();
    cleanup();

    cachePluginsOverview({ ...trackerOverview(), plugins: [] });
    render(<BacklogItemSourceSection item={billet} />);
    expect(screen.getByRole("button", { name: /^Work.*331150/ })).toBeTruthy();
  });

  it("stays closed on the next mount once the user closes it", () => {
    cachePluginsOverview(trackerOverview());
    const first = render(<BacklogItemSourceSection item={billet} />);
    expect(screen.getAllByRole("term").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^Tracker.*331150/ }));
    expect(screen.queryByRole("term")).toBeNull();
    first.unmount();

    render(<BacklogItemSourceSection item={billet} />);
    expect(screen.queryByRole("term")).toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem("ajour.backlog-item-cards")!),
    ).toMatchObject({ sourceOpen: false });
  });

  it("refreshes this item alone from its Synced row", () => {
    cachePluginsOverview(trackerOverview());
    render(<BacklogItemSourceSection item={billet} />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh item" }));

    expect(refreshBacklog).toHaveBeenCalledWith({
      source: {
        pluginId: "tracker",
        connectionId: "c1",
        sourceId: "https://tracker.example/items/331150",
        syncedAt: billet.sourceSyncedAt,
      },
    });
  });
});

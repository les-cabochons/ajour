import { afterEach, describe, expect, it } from "vitest";
import type {
  LocalAppState,
  LocalProject,
  LocalWorkItem,
} from "@/domain/local-state";
import { getSidebarBacklogItemIds } from "@/lib/sidebar-order";
import { updateSidebarLayout } from "@/lib/sidebar-layout";

function project(id: string, client: string): LocalProject {
  return {
    _id: id,
    name: `Project ${id}`,
    displayName: `Project ${id}`,
    color: "#000000",
    icon: "dot",
    status: "active",
    tasks: [],
    client,
    source: {
      pluginId: "example",
      connectionId: "planner",
      remoteId: id,
      syncedAt: 1,
    },
  } as unknown as LocalProject;
}

function item(id: string, projectId: string): LocalWorkItem {
  return {
    _id: id,
    title: `Item ${id}`,
    status: "active",
    source: "manual",
    createdAt: 1,
    projectId,
  } as LocalWorkItem;
}

describe("the sidebar's work list for the item page", () => {
  afterEach(() =>
    updateSidebarLayout(
      { client: undefined, projectId: undefined },
      { save: false },
    ),
  );

  it("follows the client picked in the filter menu, as the sidebar shows it", () => {
    const state = {
      projects: [project("acme", "Acme"), project("globex", "Globex")],
      workItems: [item("for-acme", "acme"), item("for-globex", "globex")],
      backlogSortMode: "custom",
    } as unknown as LocalAppState;
    updateSidebarLayout({ client: "Acme" }, { save: false });

    expect(getSidebarBacklogItemIds(state, 1_000)).toEqual(["for-acme"]);
  });
});

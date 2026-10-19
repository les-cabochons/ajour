import { describe, expect, it } from "vitest";
import type {
  LocalProject,
  LocalTimesheetEntry,
  LocalWorkItem,
} from "@/domain/local-state";
import { lockedWeekMessage } from "@/domain/time/locked-weeks";
import { SHORTCUTS } from "@/lib/shortcuts";
import {
  MAX_SEARCH_RESULTS,
  buildPaletteSections,
  buildSearchResults,
  scoreMatch,
  type PaletteInput,
} from "./command-palette-items";

function project(
  id: string,
  name: string,
  tasks: string[],
  overrides: Partial<LocalProject> = {},
): LocalProject {
  return {
    _id: id,
    name,
    color: "#000000",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: tasks.map((taskName, index) => ({
      _id: `${id}-task-${index}`,
      name: taskName,
      status: "active",
      createdAt: index,
    })),
    ...overrides,
  } as LocalProject;
}

function workItem(
  id: string,
  title: string,
  overrides: Partial<LocalWorkItem> = {},
): LocalWorkItem {
  return {
    _id: id,
    title,
    status: "active",
    source: "manual",
    createdAt: 1,
    ...overrides,
  };
}

const atlas = project("atlas", "Client Atlas", ["Development", "Design"], {
  code: "ATL",
});
const borealis = project("borealis", "Borealis", ["Développement web"]);

function input(overrides: Partial<PaletteInput> = {}): PaletteInput {
  return {
    query: "",
    view: { kind: "root" },
    focused: null,
    projects: [atlas, borealis],
    workItems: [],
    timesheetEntries: [],
    lockedWeeks: [],
    timer: null,
    shortcuts: SHORTCUTS,
    settingsPages: [{ to: "/settings/general", label: "General" }],
    platform: "mac",
    ...overrides,
  };
}

function labels(sections: ReturnType<typeof buildPaletteSections>) {
  return Object.fromEntries(
    sections.map((section) => [
      section.id,
      section.items.map((item) => item.label),
    ]),
  );
}

describe("scoreMatch", () => {
  it("needs every word to match the name or the context", () => {
    expect(scoreMatch("dev atlas", "Development", ["Client Atlas"])).not.toBe(
      null,
    );
    expect(scoreMatch("dev zeta", "Development", ["Client Atlas"])).toBe(null);
  });

  it("ranks exact, prefix, word start and substring name matches in order", () => {
    const exact = scoreMatch("design", "Design")!;
    const prefix = scoreMatch("des", "Design review")!;
    const wordStart = scoreMatch("rev", "Design review")!;
    const inside = scoreMatch("sign", "Design")!;
    const context = scoreMatch("design", "Mockups", ["Design"])!;

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(context);
  });

  it("ignores case and accents", () => {
    expect(scoreMatch("DEVELOPPEMENT", "Développement web")).toBe(
      scoreMatch("développement", "Développement web"),
    );
  });
});

describe("buildSearchResults", () => {
  it("returns nothing for an empty query", () => {
    expect(buildSearchResults(input({ query: "  " }))).toEqual([]);
  });

  it("finds tasks by name and project, and opens their actions", () => {
    const [first] = buildSearchResults(input({ query: "dev atl" }));

    expect(first).toMatchObject({
      label: "Development",
      detail: "Client Atlas",
      command: {
        kind: "show",
        view: { kind: "task", projectId: "atlas", taskId: "atlas-task-0" },
      },
    });
  });

  it("puts a project name match above its tasks", () => {
    const results = buildSearchResults(input({ query: "atlas" }));

    expect(results.map((item) => item.label)).toEqual([
      "Client Atlas",
      "Development",
      "Design",
    ]);
    expect(results[0]!.command).toEqual({
      kind: "open-project",
      projectId: "atlas",
    });
  });

  it("finds backlog items by title and source reference", () => {
    const item = workItem("item-1", "Fix login", {
      source: "azure_devops",
      sourceId: "https://dev.azure.com/org/_workitems/edit/4521",
      projectId: "atlas",
    });
    const results = buildSearchResults(
      input({ query: "4521", workItems: [item] }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      label: "Fix login",
      detail: "#4521 · Client Atlas",
    });
  });

  it("leaves out archived tasks and items, and ranks archived projects lower", () => {
    const archived = project("old", "Atlas legacy", ["Development"], {
      status: "archived",
    });
    const results = buildSearchResults(
      input({
        query: "atlas",
        projects: [archived, atlas],
        workItems: [workItem("gone", "Atlas cleanup", { status: "archived" })],
      }),
    );

    expect(results.map((item) => item.id)).toEqual([
      "project:atlas",
      "project:old",
      "task:atlas:atlas-task-0",
      "task:atlas:atlas-task-1",
    ]);
    expect(results[1]!.detail).toBe("Archived");
  });

  it("caps the number of results", () => {
    const big = project(
      "big",
      "Big",
      Array.from({ length: 30 }, (_, index) => `Task ${index}`),
    );
    expect(
      buildSearchResults(input({ query: "task", projects: [big] })),
    ).toHaveLength(MAX_SEARCH_RESULTS);
  });
});

describe("buildPaletteSections", () => {
  it("lists actions with their keys and navigation without a query", () => {
    const sections = buildPaletteSections(input());
    const byId = labels(sections);

    expect(sections.map((section) => section.id)).toEqual([
      "actions",
      "navigation",
    ]);
    expect(byId.actions).toContain("New entry");
    expect(byId.actions).toContain("Create project");
    expect(byId.actions).toContain("Create task in…");
    expect(byId.actions).not.toContain("Command palette");
    expect(byId.navigation).toEqual([
      "Go to Time",
      "Go to Backlog",
      "Go to Projects",
      "Go to Settings",
      "Archived projects",
      "General",
    ]);
    expect(
      sections[1]!.items.find((item) => item.label === "Go to Time")!.keys,
    ).toEqual(["G", "T"]);
  });

  it("lists only shortcuts whose handler is mounted", () => {
    const byId = labels(
      buildPaletteSections(
        input({
          shortcuts: SHORTCUTS.filter((shortcut) => shortcut.scope !== "time"),
        }),
      ),
    );

    expect(byId.actions).not.toContain("Day view");
  });

  it("puts search results before commands and filters commands", () => {
    const byId = labels(buildPaletteSections(input({ query: "design" })));

    expect(Object.keys(byId)).toEqual(["results"]);
    expect(byId.results).toEqual(["Design"]);
  });

  it("offers Start and New entry for a chosen task", () => {
    const [section] = buildPaletteSections(
      input({
        view: { kind: "task", projectId: "atlas", taskId: "atlas-task-0" },
      }),
    );

    expect(section!.heading).toBe("Development · Client Atlas");
    expect(section!.items.map((item) => item.label)).toEqual([
      "Start Development (Client Atlas)",
      "New entry…",
      "Edit",
      "Assign shortcut…",
      "Archive",
    ]);
    expect(section!.items[0]!.command).toEqual({
      kind: "task",
      projectId: "atlas",
      taskId: "atlas-task-0",
      actionId: "start-entry",
    });
  });

  it("offers a backlog item's action set with its subitem count", () => {
    const parent = workItem("parent", "Checkout");
    const child = workItem("child", "Card form", {
      parentWorkItemId: "parent",
    });
    const [section] = buildPaletteSections(
      input({
        view: { kind: "backlog-item", workItemId: "parent" },
        workItems: [parent, child],
      }),
    );

    expect(section!.items.map((item) => item.label)).toEqual([
      "Start entry",
      "New entry…",
      "Edit",
      "Add subitem",
      "Snooze…",
      "Pin",
      "Settle",
      "Delete (and 1 subitem)",
    ]);
  });

  it("lists active projects for Create task in…", () => {
    const archived = project("old", "Old", [], { status: "archived" });
    const [section] = buildPaletteSections(
      input({
        view: { kind: "create-task-in" },
        query: "bor",
        projects: [atlas, borealis, archived],
      }),
    );

    expect(section!.items).toEqual([
      expect.objectContaining({
        label: "Borealis",
        command: {
          kind: "project",
          projectId: "borealis",
          actionId: "new-task",
        },
      }),
    ]);
  });

  it("disables Create task in… when no project is active", () => {
    const createTask = buildPaletteSections(input({ projects: [] }))
      .flatMap((section) => section.items)
      .find((item) => item.id === "create-task-in");

    expect(createTask?.disabledReason).toBe("Create a project first");
  });

  it("lists the focused entry's actions first, with disabled reasons", () => {
    const entry = {
      _id: "entry-1",
      localDate: "2026-10-10",
      projectId: "atlas",
      taskId: "atlas-task-0",
      label: "",
      durationMs: 3_600_000,
      sourceBlockIds: [],
      committedAt: 1,
    } as LocalTimesheetEntry;
    const saved = buildPaletteSections(
      input({
        focused: { kind: "time-entry", entryId: "entry-1", isRunning: false },
        timesheetEntries: [entry],
      }),
    )[0]!;
    const running = buildPaletteSections(
      input({
        focused: { kind: "time-entry", entryId: "", isRunning: true },
        timer: {
          _id: "timer-1",
          startedAt: 1,
          localDate: "2026-10-11",
          accumulatedDurationMs: 0,
        },
      }),
    )[0]!;

    expect(saved.heading).toBe("Development · Client Atlas");
    expect(
      saved.items.map((item) => [item.label, item.keys?.join(" ")]),
    ).toEqual([
      ["Edit", "↩"],
      ["Continue", "C"],
      ["Duplicate", "⌘D"],
      ["Duplicate to…", undefined],
      ["Move to…", "M"],
      ["Move up", "⌥↑"],
      ["Move down", "⌥↓"],
      ["Delete", "⌫"],
    ]);
    expect(
      saved.items.find((item) => item.label === "Move down")?.command,
    ).toEqual({
      kind: "reorder",
      target: { kind: "time-entry", entryId: "entry-1", isRunning: false },
      step: 1,
    });
    expect(running.heading).toBe("Running · Time entry");
    expect(
      running.items.find((item) => item.label === "Move up")?.disabledReason,
    ).toBe("A new running entry stays last");
    expect(
      running.items.find((item) => item.label === "Duplicate"),
    ).toMatchObject({
      disabledReason: "Stop the running entry first",
      command: {
        kind: "running-entry",
        timerId: "timer-1",
        actionId: "duplicate",
      },
    });
  });

  it("locks the focused entry's actions on a submitted week", () => {
    const entry = {
      _id: "entry-1",
      localDate: "2026-10-06",
      projectId: "atlas",
      taskId: "atlas-task-0",
      label: "",
      durationMs: 3_600_000,
      sourceBlockIds: [],
      committedAt: 1,
    } as LocalTimesheetEntry;
    const section = buildPaletteSections(
      input({
        focused: { kind: "time-entry", entryId: "entry-1", isRunning: false },
        timesheetEntries: [entry],
        lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 1 }],
      }),
    )[0]!;
    const reason = lockedWeekMessage("2026-10-05");

    expect(
      section.items
        .filter((item) => item.locked)
        .map((item) => [item.label, item.disabledReason]),
    ).toEqual([
      ["Duplicate", reason],
      ["Move to…", reason],
      ["Move up", reason],
      ["Move down", reason],
      ["Delete", reason],
    ]);
    expect(
      section.items.filter((item) => !item.locked).map((item) => item.label),
    ).toEqual(["Edit", "Continue", "Duplicate to…"]);
  });

  it("moves a resumed running entry like its saved entry", () => {
    const entry = {
      _id: "entry-1",
      localDate: "2026-10-11",
      label: "",
      durationMs: 3_600_000,
      sourceBlockIds: [],
      committedAt: 1,
    } as LocalTimesheetEntry;
    const running = buildPaletteSections(
      input({
        focused: { kind: "time-entry", entryId: "entry-1", isRunning: true },
        timesheetEntries: [entry],
        timer: {
          _id: "timer-1",
          startedAt: 1,
          localDate: "2026-10-11",
          accumulatedDurationMs: 3_600_000,
          entryId: "entry-1",
        },
      }),
    )[0]!;

    expect(
      running.items.find((item) => item.label === "Move up"),
    ).toMatchObject({
      disabledReason: undefined,
      command: {
        kind: "reorder",
        target: { kind: "time-entry", entryId: "entry-1", isRunning: true },
        step: -1,
      },
    });
  });

  it.each(["focused", "item"] as const)(
    "passes running ownership to the %s backlog action section",
    (location) => {
      const backlog = workItem("backlog", "Atlas release");
      const list = (runningId?: string) =>
        buildPaletteSections(
          input({
            workItems: [backlog],
            focused:
              location === "focused"
                ? { kind: "backlog-item", workItemId: backlog._id }
                : null,
            view:
              location === "item"
                ? { kind: "backlog-item", workItemId: backlog._id }
                : { kind: "root" },
            timer: runningId
              ? {
                  _id: "timer",
                  workItemId: runningId,
                  startedAt: 1,
                  accumulatedDurationMs: 0,
                  localDate: "2026-10-12",
                }
              : null,
          }),
        )
          .flatMap((section) => section.items)
          .find(
            (item) =>
              item.command.kind === "backlog-item" &&
              (item.command.actionId === "start-entry" ||
                item.command.actionId === "stop-entry"),
          );
      // The running item offers Stop in Start entry's slot.
      expect(list(backlog._id)?.command).toMatchObject({
        actionId: "stop-entry",
      });
      expect(list(backlog._id)?.disabledReason).toBeUndefined();
      expect(list("another")?.command).toMatchObject({
        actionId: "start-entry",
      });
      expect(list("another")?.disabledReason).toBeUndefined();
      expect(list()?.disabledReason).toBeUndefined();
    },
  );

  it("offers Move up and Move down only on top-level backlog items", () => {
    const parent = workItem("parent", "Atlas release");
    const child = workItem("child", "Atlas notes", {
      parentWorkItemId: "parent",
    });
    const labels = (workItemId: string) =>
      buildPaletteSections(
        input({
          focused: { kind: "backlog-item", workItemId },
          workItems: [parent, child],
        }),
      )[0]!.items.map((item) => item.label);

    expect(labels("parent")).toContain("Move up");
    expect(labels("child")).not.toContain("Move up");
  });

  it("offers Move up and Move down on active projects only", () => {
    const labels = (status: "active" | "archived") =>
      buildPaletteSections(
        input({
          focused: { kind: "project", projectId: "atlas" },
          projects: [{ ...atlas, status }],
        }),
      )[0]!.items.map((item) => item.label);

    expect(labels("active")).toEqual([
      "Edit",
      "New task",
      "Move up",
      "Move down",
      "Archive",
    ]);
    expect(labels("archived")).not.toContain("Move up");
  });

  it("drops the focused section when the object is gone", () => {
    const sections = buildPaletteSections(
      input({ focused: { kind: "backlog-item", workItemId: "missing" } }),
    );

    expect(sections.map((section) => section.id)).not.toContain("focused");
  });
});

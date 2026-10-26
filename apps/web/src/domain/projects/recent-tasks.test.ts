import { describe, expect, it } from "vitest";
import type {
  LocalProject,
  LocalTimer,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import {
  formatLastUsed,
  getRecentTasks,
  getTaskLastUsedTimes,
  taskUseKey,
} from "@/domain/projects/recent-tasks";

function project(
  id: string,
  taskIds: string[],
  status: LocalProject["status"] = "active",
): LocalProject {
  return {
    _id: id,
    name: id,
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status,
    tasks: taskIds.map((taskId) => ({
      _id: taskId,
      name: taskId,
      status: taskId.startsWith("archived") ? "archived" : "active",
      createdAt: 1,
    })),
  };
}

function entry(
  projectId: string | undefined,
  taskId: string | undefined,
  committedAt: number,
): LocalTimesheetEntry {
  return {
    _id: `entry-${committedAt}`,
    localDate: "2026-10-26",
    projectId,
    taskId,
    label: "",
    durationMs: 60_000,
    sourceBlockIds: [],
    committedAt,
  };
}

function timer(projectId: string, taskId: string, startedAt: number) {
  return {
    _id: "timer",
    startedAt,
    localDate: "2026-10-26",
    accumulatedDurationMs: 0,
    projectId,
    taskId,
  } as LocalTimer;
}

const ids = (recent: ReturnType<typeof getRecentTasks>) =>
  recent.map(({ task }) => task._id);

describe("recent tasks", () => {
  it("lists each task once, by its latest save or start, newest first", () => {
    const projects = [project("p", ["a", "b", "c"])];
    const recent = getRecentTasks(
      projects,
      [entry("p", "a", 10), entry("p", "b", 20), entry("p", "a", 30)],
      [timer("p", "c", 25)],
    );

    expect(ids(recent)).toEqual(["a", "c", "b"]);
    expect(recent[0]?.usedAt).toBe(30);
  });

  it("counts a continued entry's Stop, which keeps its first save time", () => {
    const projects = [project("p", ["a", "b"])];
    const continued = { ...entry("p", "a", 10), usedAt: 40 };

    expect(
      ids(getRecentTasks(projects, [continued, entry("p", "b", 30)], [])),
    ).toEqual(["a", "b"]);
  });

  it("leaves out entries without a task, gone tasks and archived ones", () => {
    const projects = [
      project("p", ["a", "archived-b"]),
      project("old", ["c"], "archived"),
    ];
    const recent = getRecentTasks(
      projects,
      [
        entry("p", undefined, 50),
        entry(undefined, undefined, 49),
        entry("p", "gone", 48),
        entry("p", "archived-b", 47),
        entry("old", "c", 46),
        entry("p", "a", 1),
      ],
      [],
    );

    expect(ids(recent)).toEqual(["a"]);
  });

  it("keeps the 10 most recent tasks", () => {
    const taskIds = Array.from({ length: 12 }, (_, index) => `t${index}`);
    const recent = getRecentTasks(
      [project("p", taskIds)],
      taskIds.map((taskId, index) => entry("p", taskId, index)),
      [],
    );

    expect(ids(recent)).toEqual(taskIds.slice(2).reverse());
  });

  it("knows when any task was last used, recent or not", () => {
    const lastUsed = getTaskLastUsedTimes(
      [entry("p", "a", 10), entry("p", "a", 5)],
      [timer("p", "b", 7)],
    );

    expect(lastUsed.get(taskUseKey("p", "a"))).toBe(10);
    expect(lastUsed.get(taskUseKey("p", "b"))).toBe(7);
  });
});

describe("last used", () => {
  const now = 1_000 * 60 * 60 * 24 * 100;
  const minutesAgo = (minutes: number) => now - minutes * 60_000;

  it("says how long ago, in the largest whole unit", () => {
    expect(formatLastUsed(minutesAgo(0.5), now)).toBe("Now");
    expect(formatLastUsed(minutesAgo(5), now)).toBe("5m");
    expect(formatLastUsed(minutesAgo(125), now)).toBe("2h");
    expect(formatLastUsed(minutesAgo(60 * 24 * 3), now)).toBe("3d");
    expect(formatLastUsed(minutesAgo(60 * 24 * 15), now)).toBe("2w");
  });
});

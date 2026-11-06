import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalProject } from "@/domain/local-state";
import { captureUndo, restoreUndo } from "@/domain/local-state-undo";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  archiveProject,
  archiveProjectTask,
} from "@/domain/projects/project-archive";

const factories = {
  createId: (prefix: string) => `${prefix}-1`,
  now: () => 10 * 60_000,
};

function project(id: string): LocalProject {
  return {
    _id: id,
    name: id,
    color: "#2563eb",
    icon: DEFAULT_PROJECT_ICON,
    status: "active",
    tasks: [
      { _id: `${id}-design`, name: "Design", status: "active", createdAt: 1 },
      { _id: `${id}-build`, name: "Build", status: "active", createdAt: 1 },
    ],
  };
}

function state(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    user: { _id: "u", name: "U", email: "u@example.com" },
    projects: [project("atlas"), project("beta")],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [
      {
        _id: "timer",
        startedAt: 0,
        localDate: "2026-11-06",
        projectId: "atlas",
        taskId: "atlas-design",
        accumulatedDurationMs: 0,
      },
    ],
    timesheetEntries: [],
    timesheetTombstones: [],
    lockedWeeks: [],
    timesheetImportDrafts: [],
    commitPromptedWeeks: [],
    workItems: [],
    workflowStates: [],
    workflowStateMappings: [],
    workflowStateWriteRules: [],
    backlogSortMode: "custom",
    capture: {
      urlMode: "sanitized_path",
      titleMode: "normalized",
      blockedDomains: [],
      sensitiveDomains: [],
      maxPathSegments: 4,
    },
    userPreferences: {} as LocalAppState["userPreferences"],
    updatedAt: 0,
    ...overrides,
  };
}

describe("archiving a project with its entry running", () => {
  it("stops and saves the entry, and Undo brings both back", () => {
    const before = state();
    const archived = archiveProject(before, "atlas", factories);

    expect(archived.result.savedRunningEntry).toBe(true);
    expect(archived.state.projects[0]?.status).toBe("archived");
    expect(archived.state.timers).toEqual([]);
    expect(archived.state.timesheetEntries).toEqual([
      expect.objectContaining({
        projectId: "atlas",
        taskId: "atlas-design",
        durationMs: 10 * 60_000,
      }),
    ]);

    const undo = captureUndo(before, archived.state)!;
    const restored = restoreUndo(archived.state, undo);
    expect(restored.result).toBe("restored");
    expect(restored.state.timers).toEqual(before.timers);
    expect(restored.state.timesheetEntries).toEqual([]);
    expect(restored.state.projects[0]?.status).toBe("active");
  });

  it("leaves an entry on another project running", () => {
    const archived = archiveProject(state(), "beta", factories);

    expect(archived.result.savedRunningEntry).toBe(false);
    expect(archived.state.timers).toHaveLength(1);
    expect(archived.state.projects[1]?.status).toBe("archived");
  });
});

describe("archiving a task with its entry running", () => {
  it("stops and saves only the entry on that task", () => {
    const archived = archiveProjectTask(
      state(),
      "atlas",
      "atlas-design",
      factories,
    );
    expect(archived.result.savedRunningEntry).toBe(true);
    expect(archived.state.timers).toEqual([]);

    const other = archiveProjectTask(
      state(),
      "atlas",
      "atlas-build",
      factories,
    );
    expect(other.result.savedRunningEntry).toBe(false);
    expect(other.state.timers).toHaveLength(1);
  });
});

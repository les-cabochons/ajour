import { describe, expect, it } from "vitest";
import type { LocalProject } from "@/domain/local-state";
import {
  findCommitTarget,
  getCommitTarget,
} from "@/domain/projects/commit-target";
import {
  normalizeProject,
  updateProjectTask,
} from "@/domain/projects/project-transitions";

function project(overrides: Partial<LocalProject> = {}): LocalProject {
  return {
    _id: "acme",
    name: "Acme",
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [
      { _id: "build", name: "05 Build", status: "active", createdAt: 1 },
      {
        _id: "temp",
        name: "Temp migration",
        status: "active",
        createdAt: 1,
        commitAs: "waiting",
      },
      {
        _id: "lunch",
        name: "Team lunch",
        status: "active",
        createdAt: 1,
        commitAs: "local",
      },
    ],
    ...overrides,
  };
}

describe("commit target", () => {
  it("sends a task under a name unless it is Not known yet or Local only", () => {
    const projects = [project()];
    expect(findCommitTarget(projects, "acme", "build")).toBe("sent");
    expect(findCommitTarget(projects, "acme", "temp")).toBe("waiting");
    expect(findCommitTarget(projects, "acme", "lunch")).toBe("local");
  });

  it("makes every task of a Local only project local", () => {
    const projects = [project({ localOnly: true })];
    expect(findCommitTarget(projects, "acme", "build")).toBe("local");
    expect(findCommitTarget(projects, "acme", "temp")).toBe("local");
    expect(findCommitTarget(projects, "acme", undefined)).toBe("local");
  });

  it("sends time without a project or task, so the missing task warning shows it", () => {
    expect(getCommitTarget(undefined, undefined)).toBe("sent");
    expect(findCommitTarget([project()], "gone", "build")).toBe("sent");
    expect(findCommitTarget([project()], "acme", undefined)).toBe("sent");
  });

  it("keeps valid stored values and drops the rest when loading", () => {
    const stored = project({
      localOnly: "yes" as unknown as boolean,
    });
    stored.tasks[0]!.commitAs = "maybe" as unknown as "local";
    const normalized = normalizeProject(stored, () => 1);
    expect(normalized.localOnly).toBeUndefined();
    expect(normalized.tasks.map((task) => task.commitAs)).toEqual([
      undefined,
      "waiting",
      "local",
    ]);
    expect(
      normalizeProject(project({ localOnly: true }), () => 1).localOnly,
    ).toBe(true);
  });

  it("sets and clears a task's commitAs with a task edit", () => {
    const [waiting] = updateProjectTask([project()], "acme", "build", {
      commitAs: "waiting",
    });
    expect(waiting!.tasks[0]!.commitAs).toBe("waiting");
    const [cleared] = updateProjectTask([waiting!], "acme", "build", {
      commitAs: undefined,
    });
    expect(cleared!.tasks[0]!.commitAs).toBeUndefined();
    const [renamed] = updateProjectTask([project()], "acme", "temp", {
      name: "Temp",
    });
    expect(renamed!.tasks[1]!.commitAs).toBe("waiting");
  });
});

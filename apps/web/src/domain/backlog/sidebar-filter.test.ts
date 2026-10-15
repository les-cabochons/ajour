import { describe, expect, it } from "vitest";
import type { LocalProject } from "@/domain/local-state";
import { createSidebarMatcher } from "@/domain/backlog/sidebar-filter";

function project(overrides: Partial<LocalProject> & { _id: string }) {
  return {
    name: overrides._id,
    color: "#000000",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [],
    ...overrides,
  } satisfies LocalProject;
}

const projects = [
  project({ _id: "ajour", name: "Ajour", code: "AJR" }),
  project({ _id: "rideau", name: "rideau-internal", displayName: "Rideau" }),
  project({ _id: "old", name: "Old", status: "archived" }),
];

const pullRequest = (title: string, repository: string) => ({
  facts: { title, repository },
});

describe("createSidebarMatcher", () => {
  it("matches everything while the query is blank and no project is picked", () => {
    const matcher = createSidebarMatcher({ query: "  " }, projects);

    expect(matcher.active).toBe(false);
    expect(matcher.workItem({ title: "Anything" })).toBe(true);
    expect(matcher.pullRequest(pullRequest("Anything", "org/repo"))).toBe(true);
  });

  it("matches the title or the project, ignoring case and accents", () => {
    const matcher = createSidebarMatcher({ query: "ETE" }, projects);

    expect(matcher.active).toBe(true);
    expect(matcher.workItem({ title: "Plan de l'été" })).toBe(true);
    expect(matcher.workItem({ title: "Winter" })).toBe(false);
    expect(
      createSidebarMatcher({ query: "rideau" }, projects).workItem({
        title: "Backup",
        projectId: "rideau",
      }),
    ).toBe(true);
    expect(
      createSidebarMatcher({ query: "ajr" }, projects).workItem({
        title: "Backup",
        projectId: "ajour",
      }),
    ).toBe(true);
  });

  it("needs every word, each in the title or the project", () => {
    const matcher = createSidebarMatcher({ query: "ajour sidebar" }, projects);

    expect(
      matcher.workItem({ title: "Sidebar search", projectId: "ajour" }),
    ).toBe(true);
    expect(
      matcher.workItem({ title: "Sidebar search", projectId: "rideau" }),
    ).toBe(false);
  });

  it("keeps only the picked project's items and hides pull requests", () => {
    const matcher = createSidebarMatcher(
      { query: "", projectId: "ajour" },
      projects,
    );

    expect(matcher.active).toBe(true);
    expect(matcher.workItem({ title: "A", projectId: "ajour" })).toBe(true);
    expect(matcher.workItem({ title: "B", projectId: "rideau" })).toBe(false);
    expect(matcher.workItem({ title: "C" })).toBe(false);
    expect(matcher.pullRequest(pullRequest("Fix", "org/ajour"))).toBe(false);
  });

  it("ignores a picked project that is archived or gone", () => {
    for (const projectId of ["old", "deleted"]) {
      const matcher = createSidebarMatcher({ query: "", projectId }, projects);
      expect(matcher.active).toBe(false);
      expect(matcher.workItem({ title: "C" })).toBe(true);
    }
  });

  it("matches a pull request on its title or repository", () => {
    const matcher = createSidebarMatcher({ query: "cabochons" }, projects);

    expect(matcher.pullRequest(pullRequest("Fix", "les-cabochons/ajour"))).toBe(
      true,
    );
    expect(matcher.pullRequest(pullRequest("Fix", "org/other"))).toBe(false);
  });
});

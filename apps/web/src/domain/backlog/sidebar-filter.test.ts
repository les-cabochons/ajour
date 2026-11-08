import { describe, expect, it } from "vitest";
import type { LocalProject } from "@/domain/local-state";
import {
  createSidebarMatcher,
  getPickedSidebarClient,
  getSidebarClients,
} from "@/domain/backlog/sidebar-filter";

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

  it("finds a synced item by the start of its number", () => {
    const billet = {
      title: "Billet #11017098",
      projectId: "ajour",
      sourceExternalId: "331150",
    };

    expect(
      createSidebarMatcher({ query: "3311" }, projects).workItem(billet),
    ).toBe(true);
    expect(
      createSidebarMatcher({ query: "150" }, projects).workItem(billet),
    ).toBe(false);
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
    expect(matcher.projectId).toBe("ajour");
    expect(matcher.workItem({ title: "A", projectId: "ajour" })).toBe(true);
    expect(matcher.workItem({ title: "B", projectId: "rideau" })).toBe(false);
    expect(matcher.workItem({ title: "C" })).toBe(false);
    expect(matcher.pullRequest(pullRequest("Fix", "org/ajour"))).toBe(false);
  });

  it("ignores a picked project that is archived or gone", () => {
    for (const projectId of ["old", "deleted"]) {
      const matcher = createSidebarMatcher({ query: "", projectId }, projects);
      expect(matcher.active).toBe(false);
      expect(matcher.projectId).toBeUndefined();
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

describe("the client filter (#508)", () => {
  const source = (remoteId: string) => ({
    pluginId: "example-project-source",
    connectionId: "planner",
    remoteId,
    syncedAt: 1,
  });
  const managed = [
    project({
      _id: "support",
      name: "Acme - Support",
      client: "Acme inc.",
      source: source("ACME-SUP"),
    }),
    project({
      _id: "website",
      name: "Acme - Website",
      client: "Acme inc.",
      source: source("ACME-WEB"),
    }),
    project({
      _id: "globex",
      name: "Globex - Internal",
      client: "Globex corp.",
      source: source("GLOBEX-INT"),
    }),
    project({
      _id: "initech",
      name: "Initech",
      client: "Initech",
      status: "archived",
      source: source("INITECH"),
    }),
    ...projects,
  ];

  it("offers each client of the active managed projects once, by name", () => {
    expect(getSidebarClients(managed)).toEqual(["Acme inc.", "Globex corp."]);
    expect(getSidebarClients(projects)).toEqual([]);
  });

  it("keeps only the items of the client's projects and hides pull requests", () => {
    const matcher = createSidebarMatcher(
      { query: "", client: "Acme inc." },
      managed,
    );

    expect(matcher.active).toBe(true);
    expect(matcher.projectId).toBeUndefined();
    expect(matcher.workItem({ title: "A", projectId: "support" })).toBe(true);
    expect(matcher.workItem({ title: "B", projectId: "website" })).toBe(true);
    expect(matcher.workItem({ title: "C", projectId: "globex" })).toBe(false);
    expect(matcher.workItem({ title: "D", projectId: "ajour" })).toBe(false);
    expect(matcher.workItem({ title: "E" })).toBe(false);
    expect(matcher.pullRequest(pullRequest("Fix", "org/acme"))).toBe(false);
  });

  it("still needs every typed word among the client's items", () => {
    const matcher = createSidebarMatcher(
      { query: "login", client: "Acme inc." },
      managed,
    );

    expect(matcher.workItem({ title: "Login", projectId: "support" })).toBe(
      true,
    );
    expect(matcher.workItem({ title: "Export", projectId: "support" })).toBe(
      false,
    );
  });

  it("ignores a client no active managed project has any more", () => {
    for (const client of ["Initech", "Gone"]) {
      const matcher = createSidebarMatcher({ query: "", client }, managed);
      expect(matcher.active).toBe(false);
      expect(matcher.workItem({ title: "A", projectId: "ajour" })).toBe(true);
    }
  });

  describe("a client's spelling", () => {
    const spaced = [
      project({
        _id: "a",
        client: "Acme",
        source: {
          pluginId: "p",
          connectionId: "c",
          remoteId: "A",
          syncedAt: 1,
        },
      }),
      project({
        _id: "b",
        client: "Acme ",
        source: {
          pluginId: "p",
          connectionId: "c",
          remoteId: "B",
          syncedAt: 1,
        },
      }),
    ];

    it("offers 'Acme' and 'Acme ' as one client", () => {
      expect(getSidebarClients(spaced)).toEqual(["Acme"]);
    });

    it("keeps the items of both spellings when the client is picked", () => {
      const matcher = createSidebarMatcher(
        { query: "", client: "Acme" },
        spaced,
      );
      expect(matcher.workItem({ title: "x", projectId: "a" })).toBe(true);
      expect(matcher.workItem({ title: "x", projectId: "b" })).toBe(true);
    });

    it("names the picked client only while a project still has it", () => {
      expect(getPickedSidebarClient(spaced, "Acme ")).toBe("Acme");
      expect(getPickedSidebarClient(spaced, "Gone")).toBeUndefined();
      expect(getPickedSidebarClient(spaced, undefined)).toBeUndefined();
    });
  });
});

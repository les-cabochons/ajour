import { describe, expect, it } from "vitest";
import { fixtureSnapshot } from "../../../../../packages/example/index.ts";
import type { LocalProject } from "@/domain/local-state";
import { normalizeProject } from "@/domain/projects/project-transitions";
import { normalizeProjectSources } from "@/domain/projects/source-link";

/*
 * Stored managed projects and project source records read back (#505):
 * what is well formed stays, and a malformed link turns the project local.
 */

const now = () => 1;

function project(overrides: Record<string, unknown>): LocalProject {
  return {
    _id: "p1",
    name: "Acme - Support",
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [],
    ...overrides,
  } as LocalProject;
}

describe("normalizeProject for a managed project", () => {
  it("keeps the source link, the source-owned fields and the archive marks", () => {
    const stored = project({
      source: {
        pluginId: "planner",
        connectionId: "c1",
        remoteId: "ACME-SUP",
        url: "https://planner.example/projects/ACME-SUP",
        syncedAt: 7,
      },
      client: "Acme inc.",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      budget: {
        unit: "hours",
        total: 40,
        consumed: 31.5,
        since: "2026-01-01",
        asOf: "2026-10-31T23:59:59.000Z",
      },
      status: "archived",
      archivedBySource: true,
      tasks: [
        {
          _id: "t1",
          name: "Login",
          status: "archived",
          createdAt: 1,
          archivedAt: 2,
          archivedByMissingSync: true,
          source: {
            remoteId: "1001",
            group: "Support",
            assigned: true,
            myHours: 5,
          },
        },
      ],
    });

    const normalized = normalizeProject(stored, now);

    expect(normalized).toMatchObject({
      source: stored.source,
      client: "Acme inc.",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      budget: stored.budget,
      archivedBySource: true,
    });
    expect(normalized.tasks[0]).toMatchObject({
      archivedByMissingSync: true,
      source: {
        remoteId: "1001",
        group: "Support",
        assigned: true,
        myHours: 5,
      },
    });
  });

  it("drops a malformed source link, which makes the project and its tasks local", () => {
    const normalized = normalizeProject(
      project({
        source: { pluginId: "planner", remoteId: "ACME-SUP" },
        budget: { unit: "days" },
        archivedBySource: "yes",
        tasks: [
          {
            _id: "t1",
            name: "Login",
            status: "active",
            createdAt: 1,
            source: { remoteId: "1001", assigned: true },
          },
        ],
      }),
      now,
    );

    expect(normalized.source).toBeUndefined();
    expect(normalized.budget).toBeUndefined();
    expect(normalized.archivedBySource).toBeUndefined();
    expect(normalized.tasks[0]!.source).toBeUndefined();
  });
});

describe("normalizeProjectSources", () => {
  it("reads records back, with their held projects, and drops malformed ones", () => {
    const record = {
      pluginId: "planner",
      label: "Example planner",
      url: "https://planner.example",
      asOf: "2026-10-31T23:59:59.000Z",
      me: {
        hoursAvailable: false,
        hoursNote: "Link your account.",
        hoursSince: "2026-10-01",
      },
      syncedAt: 9,
      held: [fixtureSnapshot.projects[0], { remoteId: "broken" }],
    };

    expect(
      normalizeProjectSources({
        c1: record,
        c2: { pluginId: "planner" },
        c3: "nonsense",
      }),
    ).toEqual({ c1: { ...record, held: [fixtureSnapshot.projects[0]] } });
    expect(normalizeProjectSources(undefined)).toEqual({});
  });
});

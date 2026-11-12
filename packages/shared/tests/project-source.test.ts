import { describe, expect, it } from "vitest";
import {
  PROJECT_SOURCE_MAX_PROJECTS,
  PROJECT_SOURCE_MAX_TASKS,
  parseProjectSourceSyncResult,
  projectSourceSnapshotSchema,
  projectSourceSyncRequestSchema,
  projectSourceSyncResultSchema,
  type ProjectSourceSnapshot,
} from "../project-source";
import {
  PLUGIN_API_VERSION,
  pluginHasProjectSource,
  pluginManifestSchema,
  pluginRunsCode,
  pluginSwitchableCapabilities,
  switchableCapabilityLabels,
} from "../plugins";
import { pluginApi4ManifestSchema } from "../plugin-api-4";
import { projectSourceManifest } from "./fixtures/api-4-manifests";

/** A snapshot with every field, as a plugin maps it from its source. */
function fullSnapshot(): ProjectSourceSnapshot {
  return {
    source: { label: "Planner", url: "https://planner.example/home" },
    asOf: "2026-10-31T23:59:59.000Z",
    me: { hoursAvailable: true },
    projects: [
      {
        remoteId: "ACME-SUP",
        name: "Acme - Support",
        code: "ACME-SUP",
        url: "https://planner.example/projects/ACME-SUP",
        client: "Acme inc.",
        complete: false,
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
        budget: {
          unit: "hours",
          total: 40,
          consumed: 31.5,
          remaining: 8.5,
          status: "warning",
        },
        tasks: [
          {
            remoteId: "1001",
            name: "Ticket #101 - Login",
            group: "Support",
            closed: false,
            billable: true,
            estimateHours: 8,
            assigned: true,
            myHours: 5.25,
          },
          {
            remoteId: "1002",
            name: "Ticket #102 - Export",
            group: "Support",
            closed: true,
            billable: true,
            estimateHours: 2,
            assigned: false,
          },
        ],
      },
      {
        remoteId: "GLOBEX-INT",
        name: "Globex - Internal",
        code: "GLOBEX-INT",
        complete: false,
        budget: {
          unit: "money",
          consumed: 212,
          remaining: -12,
          status: "over",
        },
        tasks: [],
      },
    ],
  };
}

/** The least a snapshot can say: where it comes from, when, and no project. */
function minimalSnapshot(): ProjectSourceSnapshot {
  return {
    source: { label: "Planner" },
    asOf: "2026-10-31T23:59:59Z",
    projects: [],
  };
}

function snapshotIssues(snapshot: unknown) {
  const result = projectSourceSnapshotSchema.safeParse(snapshot);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

describe("the project source snapshot", () => {
  it("carries a source's projects, tasks and budgets as a plugin maps them", () => {
    const snapshot = fullSnapshot();

    expect(projectSourceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("needs only a source, a time and a project list", () => {
    expect(snapshotIssues(minimalSnapshot())).toEqual([]);
  });

  it("says when the source can't give the user's hours, in the plugin's words", () => {
    const snapshot = {
      ...minimalSnapshot(),
      me: {
        hoursAvailable: false,
        hoursNote: "Link your account in Planner to compare your hours.",
      },
    };

    expect(projectSourceSnapshotSchema.parse(snapshot).me).toEqual(snapshot.me);
  });

  it("says from which day the consumed figures and the user's hours count", () => {
    const snapshot = {
      ...fullSnapshot(),
      me: { hoursAvailable: true, hoursSince: "2026-10-01" },
    };
    snapshot.projects[0]!.budget!.since = "2026-01-01";

    const parsed = projectSourceSnapshotSchema.parse(snapshot);

    expect(parsed.me?.hoursSince).toBe("2026-10-01");
    expect(parsed.projects[0]!.budget?.since).toBe("2026-01-01");
  });

  it.each([
    [
      "a task without a name",
      (s: ProjectSourceSnapshot) => {
        delete (s.projects[0]!.tasks[0] as { name?: string }).name;
      },
      "projects.0.tasks.0.name",
    ],
    [
      "a budget whose unit is unknown",
      (s: ProjectSourceSnapshot) => {
        (s.projects[0]!.budget as { unit: string }).unit = "days";
      },
      "projects.0.budget.unit",
    ],
    [
      "a budget status that isn't one of the four",
      (s: ProjectSourceSnapshot) => {
        (s.projects[0]!.budget as { status: string }).status = "Yellow";
      },
      "projects.0.budget.status",
    ],
    [
      "a project without a code",
      (s: ProjectSourceSnapshot) => {
        delete (s.projects[1] as { code?: string }).code;
      },
      "projects.1.code",
    ],
    [
      "a project URL that isn't https",
      (s: ProjectSourceSnapshot) => {
        s.projects[0]!.url = "/projects/ACME-SUP";
      },
      "projects.0.url",
    ],
    [
      "a start date that isn't a calendar date",
      (s: ProjectSourceSnapshot) => {
        s.projects[0]!.startsOn = "2026-01-01T00:00:00Z";
      },
      "projects.0.startsOn",
    ],
    [
      "an end date that does not exist",
      (s: ProjectSourceSnapshot) => {
        s.projects[0]!.endsOn = "2026-02-30";
      },
      "projects.0.endsOn",
    ],
    [
      "a budget period that starts on a day that does not exist",
      (s: ProjectSourceSnapshot) => {
        s.projects[0]!.budget!.since = "2026-02-30";
      },
      "projects.0.budget.since",
    ],
    [
      "hours counted since a date-time instead of a day",
      (s: ProjectSourceSnapshot) => {
        s.me = { hoursAvailable: true, hoursSince: "2026-10-01T00:00:00Z" };
      },
      "me.hoursSince",
    ],
    [
      "an asOf that isn't a date-time",
      (s: ProjectSourceSnapshot) => {
        s.asOf = "yesterday";
      },
      "asOf",
    ],
    [
      "negative consumed hours",
      (s: ProjectSourceSnapshot) => {
        s.projects[0]!.budget!.consumed = -1;
      },
      "projects.0.budget.consumed",
    ],
  ])("refuses %s, naming its path", (_name, change, path) => {
    const snapshot = fullSnapshot();
    change(snapshot);

    expect(snapshotIssues(snapshot).map(([at]) => at)).toEqual([path]);
  });

  it("lets a budget's remaining go negative, since over is a status", () => {
    expect(fullSnapshot().projects[1]!.budget!.remaining).toBe(-12);
    expect(snapshotIssues(fullSnapshot())).toEqual([]);
  });

  it("refuses two projects with one remote id", () => {
    const snapshot = fullSnapshot();
    snapshot.projects[1]!.remoteId = "ACME-SUP";

    expect(snapshotIssues(snapshot)).toEqual([
      ["projects.1.remoteId", 'Two projects use the remote id "ACME-SUP".'],
    ]);
  });

  it("refuses two tasks of a project with one remote id", () => {
    const snapshot = fullSnapshot();
    snapshot.projects[0]!.tasks[1]!.remoteId = "1001";

    expect(snapshotIssues(snapshot)).toEqual([
      [
        "projects.0.tasks.1.remoteId",
        'Two tasks of project "ACME-SUP" use the remote id "1001".',
      ],
    ]);
  });

  it("bounds a snapshot so it fits a plugin's result", () => {
    const project = fullSnapshot().projects[0]!;
    const task = project.tasks[0]!;
    const half = PROJECT_SOURCE_MAX_TASKS / 2;
    const tasks = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ ...task, remoteId: `t${i}` }));
    // Each project stays under the bound: the total is what crosses it.
    const tooManyTasks = {
      ...minimalSnapshot(),
      projects: [
        { ...project, remoteId: "a", tasks: tasks(half + 1) },
        { ...project, remoteId: "b", tasks: tasks(half) },
      ],
    };
    const tooManyProjects = {
      ...minimalSnapshot(),
      projects: Array.from(
        { length: PROJECT_SOURCE_MAX_PROJECTS + 1 },
        (_, i) => ({ ...project, remoteId: `p${i}`, tasks: [] }),
      ),
    };

    expect(snapshotIssues(tooManyTasks)).toEqual([
      [
        "projects",
        `A snapshot holds at most ${PROJECT_SOURCE_MAX_TASKS} tasks, not ${PROJECT_SOURCE_MAX_TASKS + 1}.`,
      ],
    ]);
    expect(snapshotIssues(tooManyProjects).map(([at]) => at)).toEqual([
      "projects",
    ]);
  });
});

describe("a project source sync", () => {
  it("sends the cursor Ajour kept, or nothing on the first sync", () => {
    expect(projectSourceSyncRequestSchema.parse({})).toEqual({});
    expect(
      projectSourceSyncRequestSchema.parse({ cursor: "W/etag-1" }),
    ).toEqual({
      cursor: "W/etag-1",
    });
  });

  it("says whether the user asked for the sync, and refuses another trigger", () => {
    expect(projectSourceSyncRequestSchema.parse({ trigger: "manual" })).toEqual(
      { trigger: "manual" },
    );
    expect(
      projectSourceSyncRequestSchema.safeParse({ trigger: "startup" }).success,
    ).toBe(false);
  });

  it("answers with a snapshot and the next cursor, or that nothing changed", () => {
    const snapshot = minimalSnapshot();

    expect(
      projectSourceSyncResultSchema.parse({ snapshot, cursor: "W/etag-2" }),
    ).toEqual({ snapshot, cursor: "W/etag-2" });
    expect(projectSourceSyncResultSchema.parse({ snapshot })).toEqual({
      snapshot,
    });
    expect(projectSourceSyncResultSchema.parse({ unchanged: true })).toEqual({
      unchanged: true,
    });
  });

  it("refuses a result that is neither", () => {
    expect(() => parseProjectSourceSyncResult({})).toThrow(
      "The plugin's result is not valid: snapshot: Required.",
    );
    expect(() => parseProjectSourceSyncResult({ unchanged: false })).toThrow(
      "snapshot: Required",
    );
  });

  it("refuses a bad snapshot in a result by its path, in one sentence", () => {
    const snapshot = fullSnapshot();
    snapshot.projects[0]!.tasks[0]!.assigned = "yes" as unknown as boolean;

    expect(() => parseProjectSourceSyncResult({ snapshot })).toThrow(
      "The plugin's result is not valid: snapshot.projects[0].tasks[0].assigned: Expected boolean, received string.",
    );
  });
});

describe("the projectSource capability", () => {
  it("is accepted on plugin API 4, read only, with no options", () => {
    const manifest = projectSourceManifest();

    expect(pluginApi4ManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      pluginApi4ManifestSchema.safeParse({
        ...manifest,
        capabilities: { projectSource: { write: true } },
      }).success,
    ).toBe(false);
  });

  it("is refused on plugin API 3", () => {
    const manifest = {
      ...projectSourceManifest(),
      apiVersion: PLUGIN_API_VERSION,
      network: undefined,
    };

    const result = pluginManifestSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "The projectSource capability needs plugin API 4.",
    );
  });

  it("runs code, so it needs an entrypoint and connection fields", () => {
    const manifest = projectSourceManifest();
    delete (manifest as { entrypoint?: string }).entrypoint;
    manifest.connectionFields = [];
    manifest.network = undefined;

    const result = pluginApi4ManifestSchema.safeParse(manifest);

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "A plugin that runs code needs an entrypoint.",
      "A backlog, code host, calendar or project source plugin needs connection fields.",
    ]);
  });

  it("is a capability of its own the user can switch, named for what it brings", () => {
    const manifest = pluginApi4ManifestSchema.parse(projectSourceManifest());

    expect(pluginHasProjectSource(manifest)).toBe(true);
    expect(pluginRunsCode(manifest)).toBe(true);
    expect(pluginSwitchableCapabilities(manifest)).toEqual(["projectSource"]);
    expect(switchableCapabilityLabels.projectSource).toBe("Managed projects");
  });
});

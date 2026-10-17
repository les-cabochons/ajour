import { describe, expect, it } from "vitest";
import type { TeamProject } from "@ajour/shared";
import type {
  LocalAppState,
  LocalProject,
  LocalTeamConnection,
} from "@/domain/local-state";
import {
  buildPickerModel,
  describePickerResults,
  planPickerApply,
} from "./team-picker";

const CONNECTION = "acme";

function project(
  id: string,
  name: string,
  overrides: Partial<LocalProject> = {},
) {
  return {
    _id: id,
    name,
    displayName: name,
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [],
    ...overrides,
  } satisfies LocalProject as LocalProject;
}

function teamProject(remoteId: string, name: string): TeamProject {
  return {
    remoteId,
    name,
    displayName: name,
    code: null,
    color: "#4f46e5",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [],
  };
}

function state(
  projects: LocalProject[],
  connection: Partial<LocalTeamConnection> | null = {},
): Pick<LocalAppState, "projects" | "teamConnections"> {
  return {
    projects,
    teamConnections:
      connection === null
        ? {}
        : {
            [CONNECTION]: {
              cursor: "c1",
              unsharedRemoteIds: [],
              unsharedLocalIds: [],
              heldArrivals: [],
              ...connection,
            },
          },
  };
}

describe("team picker", () => {
  it("sets a held project to link to the local one of its name", () => {
    const beta = project("beta", "Beta");
    const model = buildPickerModel(
      state([beta, project("gamma", "Gamma")], {
        heldArrivals: [teamProject("r-beta", "beta"), teamProject("r-x", "X")],
      }),
      CONNECTION,
      {},
    );

    expect(
      model.arrivals.map((entry) => [entry.match?._id, entry.choice]),
    ).toEqual([
      ["beta", "link"],
      [undefined, "separate"],
    ]);
    // Beta is linked by the same Apply, so it is not offered for sharing.
    expect(model.shareable.map((entry) => entry._id)).toEqual(["gamma"]);
    expect(planPickerApply(model, new Set(["gamma"]))).toEqual({
      resolutions: [
        { remoteId: "r-beta", choice: { kind: "link", projectId: "beta" } },
        { remoteId: "r-x", choice: { kind: "addSeparately" } },
      ],
      shares: ["gamma"],
    });
  });

  it("blocks sharing a project whose held twin is added separately", () => {
    const model = buildPickerModel(
      state([project("beta", "Beta")], {
        heldArrivals: [teamProject("r-beta", "Beta")],
      }),
      CONNECTION,
      { "r-beta": "separate" },
    );

    expect(model.shareable).toEqual([]);
    expect(model.blocked.map((entry) => entry.project._id)).toEqual(["beta"]);
    expect(planPickerApply(model, new Set(["beta"])).shares).toEqual([]);
  });

  it("blocks a name a shared project of this team already has", () => {
    const model = buildPickerModel(
      state([
        project("shared", "Beta", { team: { connectionId: CONNECTION } }),
        project("mine", "BETA"),
      ]),
      CONNECTION,
      {},
    );

    expect(model.shareable).toEqual([]);
    expect(model.blocked[0]?.reason).toMatch(/same name/);
  });

  it("needs a first sync before anything can be shared", () => {
    expect(
      buildPickerModel(state([project("p", "P")], null), CONNECTION, {})
        .needsSync,
    ).toBe(true);
    expect(
      buildPickerModel(state([project("p", "P")], {}), CONNECTION, {})
        .needsSync,
    ).toBe(false);
  });

  it("sums up what Apply did", () => {
    expect(
      describePickerResults({ linked: 1, added: 0, shared: 2, failed: [] }),
    ).toBe("1 linked · 2 shared");
    expect(
      describePickerResults({ linked: 0, added: 0, shared: 0, failed: [] }),
    ).toBe("Nothing changed");
  });
});

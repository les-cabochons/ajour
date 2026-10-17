import type { TeamProject } from "@ajour/shared";
import type { LocalAppState, LocalProject } from "@/domain/local-state";
import {
  findLocalProjectNamed,
  type HeldArrivalChoice,
} from "@/domain/projects/team-sync";

/*
 * What the team picker shows and what its Apply does, apart from rendering.
 * See TeamPickerDialog in team-connection-ui.tsx.
 */

export type ArrivalChoice = "link" | "separate";

export interface PickerArrival {
  arrival: TeamProject;
  /** The local project of the same name, which Link would make shared. */
  match?: LocalProject;
  choice: ArrivalChoice;
}

export interface PickerModel {
  arrivals: PickerArrival[];
  /** Local projects the user may check to share. */
  shareable: LocalProject[];
  /**
   * Local projects that cannot be shared with this team: a team project has
   * their name, and sharing would be refused. Each comes with why.
   */
  blocked: { project: LocalProject; reason: string }[];
  /**
   * The connection has not synced yet, so Ajour does not know the team's
   * projects. Nothing can be shared until it has.
   */
  needsSync: boolean;
}

function named(project: LocalProject, name: string) {
  return findLocalProjectNamed([project], name) !== undefined;
}

export function buildPickerModel(
  state: Pick<LocalAppState, "projects" | "teamConnections">,
  connectionId: string,
  choices: Readonly<Record<string, ArrivalChoice>>,
): PickerModel {
  const connection = state.teamConnections?.[connectionId];
  const local = state.projects.filter((project) => !project.team);
  const sharedHere = state.projects.filter(
    (project) => project.team?.connectionId === connectionId,
  );

  const arrivals = (connection?.heldArrivals ?? []).map(
    (arrival): PickerArrival => {
      const match = findLocalProjectNamed(local, arrival.name);
      const chosen = choices[arrival.remoteId];
      return {
        arrival,
        match,
        choice: match ? (chosen ?? "link") : "separate",
      };
    },
  );

  const shareable: LocalProject[] = [];
  const blocked: PickerModel["blocked"] = [];
  for (const project of local) {
    if (project.status !== "active") continue;
    const held = arrivals.find((entry) => entry.match?._id === project._id);
    if (held?.choice === "link") continue; // Linked above.
    if (held) {
      blocked.push({
        project,
        reason: `the team's ${held.arrival.name} is added as its own project`,
      });
      continue;
    }
    if (sharedHere.some((shared) => named(project, shared.name))) {
      blocked.push({
        project,
        reason: "a shared project of this team has the same name",
      });
      continue;
    }
    shareable.push(project);
  }

  return {
    arrivals,
    shareable,
    blocked,
    needsSync: !connection?.cursor,
  };
}

export interface PickerPlan {
  resolutions: { remoteId: string; choice: HeldArrivalChoice }[];
  shares: string[];
}

/** What Apply does: answer every held project, then share the checked ones. */
export function planPickerApply(
  model: PickerModel,
  checked: ReadonlySet<string>,
): PickerPlan {
  return {
    resolutions: model.arrivals.map(({ arrival, match, choice }) => ({
      remoteId: arrival.remoteId,
      choice:
        choice === "link" && match
          ? { kind: "link", projectId: match._id }
          : { kind: "addSeparately" },
    })),
    shares: model.shareable
      .filter((project) => checked.has(project._id))
      .map((project) => project._id),
  };
}

export interface PickerResults {
  linked: number;
  added: number;
  shared: number;
  /** Names of the projects Ajour could not link, add or share. */
  failed: string[];
}

export function describePickerResults(results: PickerResults) {
  const parts = [
    results.linked ? `${results.linked} linked` : null,
    results.added ? `${results.added} added` : null,
    results.shared ? `${results.shared} shared` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing changed";
}

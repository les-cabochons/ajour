import {
  planTeamSync,
  type UnsendableRecord,
} from "@/domain/projects/team-sync";
import { isConnectionRemoved, runTeamSyncRound } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";

/*
 * Runs a team sync: plans a round from the local projects, sends it, applies
 * the answer, and goes on while the page bounds left changes or the team has
 * more pages. The rules live in domain/projects/team-sync.ts. See
 * docs/superpowers/specs/2026-10-16-team-project-sync-design.md.
 */

/** Rounds in one sync. A larger backlog goes on at the next interval. */
const MAX_ROUNDS = 40;

export interface TeamSyncOutcome {
  rounds: number;
  /** Shared projects whose changes, or tasks' changes, went to the team. */
  sentProjectCount: number;
  createdProjectIds: string[];
  updatedProjectIds: string[];
  /** Team projects newly held because a local project has their name. */
  heldArrivals: { remoteId: string; localProjectId: string }[];
  /** Records the contract refuses as they are. They stay local until fixed. */
  unsendable: UnsendableRecord[];
  /** Changes or pages were left for the next sync. */
  incomplete: boolean;
}

const runningSyncs = new Map<string, Promise<TeamSyncOutcome>>();

/**
 * Syncs one team connection. A manual and a scheduled call share one run. A
 * result the workspace refuses throws, with nothing applied; the next sync
 * sends the same round again.
 */
export function syncTeamConnection(
  pluginId: string,
  connectionId: string,
): Promise<TeamSyncOutcome> {
  const key = JSON.stringify([pluginId, connectionId]);
  const running = runningSyncs.get(key);
  if (running) return running;

  const run = async (): Promise<TeamSyncOutcome> => {
    const outcome: TeamSyncOutcome = {
      rounds: 0,
      sentProjectCount: 0,
      createdProjectIds: [],
      updatedProjectIds: [],
      heldArrivals: [],
      unsendable: [],
      incomplete: true,
    };
    const unsendable = new Map<string, UnsendableRecord>();

    while (outcome.rounds < MAX_ROUNDS) {
      const state = localStore.snapshot();
      const plan = planTeamSync(
        {
          projects: state.projects,
          teamConnections: state.teamConnections ?? {},
        },
        connectionId,
        localStore.pendingUndoProjectIds(),
      );
      for (const record of plan.unsendable) {
        unsendable.set(`${record.projectId}:${record.taskId ?? ""}`, record);
      }

      const result = await runTeamSyncRound(
        pluginId,
        connectionId,
        plan.request,
      );
      if (isConnectionRemoved(pluginId, connectionId)) break;
      const applied = localStore.applyTeamSyncRound(
        connectionId,
        plan.request.changes,
        result,
      );
      if (applied.kind === "rejected") {
        throw new Error(
          `${applied.reason} Ajour applied nothing from this sync and will try again.`,
        );
      }

      outcome.rounds += 1;
      outcome.sentProjectCount += plan.request.changes.length;
      outcome.createdProjectIds.push(...applied.createdProjectIds);
      outcome.updatedProjectIds.push(
        ...applied.updatedProjectIds.filter(
          (id) => !outcome.updatedProjectIds.includes(id),
        ),
      );
      outcome.heldArrivals.push(...applied.heldArrivals);
      if (!plan.hasMoreChanges && !result.hasMore) {
        outcome.incomplete = false;
        break;
      }
    }

    outcome.unsendable = [...unsendable.values()];
    return outcome;
  };

  const promise = run().finally(() => {
    if (runningSyncs.get(key) === promise) runningSyncs.delete(key);
  });
  runningSyncs.set(key, promise);
  return promise;
}

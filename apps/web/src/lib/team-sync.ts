import {
  AGENT_ACCESS_FIELD_ID,
  isCapabilityActive,
  type PluginConnectionSummary,
  type PluginOverviewGroup,
  type PluginsOverview,
} from "@ajour/shared";
import {
  planTeamSync,
  type UnsendableRecord,
} from "@/domain/projects/team-sync";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type { Unit } from "@ajour/wide-events";
import { getPluginsOverview, runTeamSyncRound } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { wideEvents } from "@/lib/wide-events";

/*
 * Runs a team sync: plans a round from the local projects, sends it, applies
 * the answer, and goes on while the page bounds left changes or the team has
 * more pages. The rules live in domain/projects/team-sync.ts. See
 * docs/specs/2026-10-16-team-project-sync-design.md.
 */

/** Rounds in one sync. A larger backlog goes on at the next interval. */
const MAX_ROUNDS = 40;

/** The connection fields Ajour owns. They do not name the team. */
const HOST_FIELDS = new Set([
  "label",
  "tenantLabel",
  "autoSync",
  "autoSyncIntervalMinutes",
  "pullRequestAutoSync",
  AGENT_ACCESS_FIELD_ID,
]);

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

/**
 * Which team a connection names: its plugin and the values of its own
 * non-secret fields, such as the deployment and the team ID. A new secret
 * keeps the team; a new team ID or deployment does not.
 */
export function teamConnectionIdentity(
  group: Pick<PluginOverviewGroup, "plugin">,
  connection: Pick<PluginConnectionSummary, "editableValues">,
) {
  const fieldIds = group.plugin.connectionFields
    .filter((field) => !field.secret && !HOST_FIELDS.has(field.id))
    .map((field) => field.id)
    .sort();
  return JSON.stringify([
    group.plugin.id,
    ...fieldIds.map((id) => [id, connection.editableValues[id] ?? null]),
  ]);
}

/**
 * The connection's identity as the local API has it now, or undefined when
 * it is gone or its team capability is off. Read fresh, so a change in
 * another window counts too.
 */
async function currentIdentity(pluginId: string, connectionId: string) {
  const overview = await getPluginsOverview();
  if (overview.pluginsEnabled === false) return undefined;
  const group = overview.connectionGroups.find(
    (entry) => entry.plugin.id === pluginId,
  );
  const connection = group?.connections.find(
    (entry) => entry.id === connectionId,
  );
  if (!group || !connection || !isCapabilityActive(group, "team")) {
    return undefined;
  }
  return teamConnectionIdentity(group, connection);
}

const runningSyncs = new Map<string, Promise<TeamSyncOutcome>>();

/** Runs `operation` while no other window of this app syncs the same connection. */
function exclusively<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  // The lock resolves with what the operation resolves with.
  return locks
    ? (locks.request(name, operation) as unknown as Promise<T>)
    : operation();
}

/**
 * Syncs one team connection, as one `team.sync` job: its rounds' local API
 * calls and store commands count on it. A manual and a scheduled call share
 * one run, and its event, and other windows wait for it. A result the
 * workspace refuses throws, with nothing applied; the next sync sends the
 * same round again.
 */
export function syncTeamConnection(
  pluginId: string,
  connectionId: string,
  options: { trigger?: "user" | "schedule" } = {},
): Promise<TeamSyncOutcome> {
  const key = JSON.stringify([pluginId, connectionId]);
  const running = runningSyncs.get(key);
  if (running) return running;

  const run = async (
    job: Unit<AjourCatalog, "team.sync">,
  ): Promise<TeamSyncOutcome> => {
    job.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
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

    const identity = await job.enter(() =>
      currentIdentity(pluginId, connectionId),
    );
    if (!identity) {
      job.refuse("connection_not_found");
      throw new Error("This team connection is gone, or Projects is off.");
    }
    // The connection now names another team: its links and cursor belong to
    // the old one, so its projects turn local and the new team starts fresh.
    const stored = localStore.snapshot().teamConnections?.[connectionId];
    if (stored?.identity && stored.identity !== identity) {
      job.set({ team_sync: { identity_changed: true } });
      job.enter(() => localStore.removeConnectionTeamData(connectionId));
    }

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

      const result = await job.enter(() =>
        runTeamSyncRound(pluginId, connectionId, plan.request),
      );
      // Removed, turned off or pointed at another team while the round was
      // on its way, here or in another window: its answer does not apply.
      if (
        (await job.enter(() => currentIdentity(pluginId, connectionId))) !==
        identity
      ) {
        break;
      }
      const applied = job.enter(() =>
        localStore.applyTeamSyncRound(
          connectionId,
          plan.request.changes,
          result,
          identity,
        ),
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
    job.set({
      team_sync: {
        round_count: outcome.rounds,
        projects_sent: outcome.sentProjectCount,
        created_count: outcome.createdProjectIds.length,
        updated_count: outcome.updatedProjectIds.length,
        held_arrival_count: outcome.heldArrivals.length,
        unsendable_count: outcome.unsendable.length,
        incomplete: outcome.incomplete,
      },
    });
    return outcome;
  };

  // The job opens now, so the time other windows hold the lock counts too.
  const promise = wideEvents
    .run(
      "team.sync",
      { kind: "job", trigger: options.trigger ?? "user", detached: true },
      (job) => exclusively(`ajour-team-sync:${key}`, () => run(job)),
    )
    .finally(() => {
      if (runningSyncs.get(key) === promise) runningSyncs.delete(key);
    });

  runningSyncs.set(key, promise);
  return promise;
}

/** A team connection the user can share a project with. */
export interface TeamConnectionChoice {
  pluginId: string;
  connectionId: string;
  teamName: string;
}

/** The team connections whose Projects capability is on. */
export async function listTeamConnections(): Promise<TeamConnectionChoice[]> {
  return teamConnectionsOf(await getPluginsOverview());
}

/** The team connections of an overview whose Projects capability is on. */
export function teamConnectionsOf(
  overview: PluginsOverview,
): TeamConnectionChoice[] {
  if (overview.pluginsEnabled === false) return [];
  return overview.connectionGroups
    .filter((group) => isCapabilityActive(group, "team"))
    .flatMap((group) =>
      group.connections.map((connection) => ({
        pluginId: group.plugin.id,
        connectionId: connection.id,
        teamName: connection.tenantLabel,
      })),
    );
}

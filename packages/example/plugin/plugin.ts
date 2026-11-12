// The example project source: a plugin API 4 plugin that serves the fixture
// snapshot, and a time sync over an in-memory remote, without touching the
// network, so Ajour's tests have a project source and a time sync that are
// theirs. Erasable TypeScript only, with explicit .ts imports: Ajour strips
// the types as it loads the file.
import type {} from "../../plugin-sdk/globals.ts";
import type {
  PluginConnection,
  ProjectSourceSyncRequest,
  ProjectSourceSyncResult,
  TimeSyncRequest,
  TimeSyncResult,
  ValidationResult,
} from "../../plugin-sdk/index.ts";
import { FIXTURE_CURSOR, fixtureSnapshot } from "./fixture.ts";
import { runRound } from "./time-sync.ts";

export async function validateConnection(
  connection: PluginConnection,
): Promise<ValidationResult> {
  return {
    normalizedConfig: connection.config,
    connectionSummary: { user: "ada@example.test" },
  };
}

/** The fixture, or "unchanged" when Ajour sends the fixture's own cursor back. */
export async function syncProjects(
  _connection: PluginConnection,
  request: ProjectSourceSyncRequest,
): Promise<ProjectSourceSyncResult> {
  if (request.cursor === FIXTURE_CURSOR) return { unchanged: true };
  return { snapshot: fixtureSnapshot, cursor: FIXTURE_CURSOR };
}

/**
 * One time sync round against the connection's in-memory remote: it applies
 * the changes in order, adopting a create whose client reference it holds,
 * refuses an entry over 24 hours, then lists the window.
 */
export async function syncTimeEntries(
  connection: PluginConnection,
  request: TimeSyncRequest,
): Promise<TimeSyncResult> {
  return runRound(connection.id, request);
}

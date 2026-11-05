// The example project source: a plugin API 4 plugin that serves the fixture
// snapshot without touching the network, so Ajour's tests have a project
// source that is theirs. Erasable TypeScript only, with explicit .ts
// imports: Ajour strips the types as it loads the file.
import type {} from "../../plugin-sdk/globals.ts";
import type {
  PluginConnection,
  ProjectSourceSyncRequest,
  ProjectSourceSyncResult,
  ValidationResult,
} from "../../plugin-sdk/index.ts";
import { FIXTURE_CURSOR, fixtureSnapshot } from "./fixture.ts";

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

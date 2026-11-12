// Entry point: the example project source plugin, for Ajour's own tests and
// the acceptance harness. The plugin itself is `plugin/`, a plugin API 4
// package Ajour loads from disk as a development plugin. It serves a fixture
// snapshot, and a time sync over an in-memory remote per connection
// (`plugin/time-sync.ts`). This file hands out its folder, the fixture it
// serves, its time sync round, and a way to log, edit and delete remote
// entries, and start a timer there, as another tool would, so a test can
// assert on what Ajour received, answer a mocked route the way the plugin
// would, or change the remote under Ajour.
import path from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./plugin/plugin.json" with { type: "json" };

export { FIXTURE_CURSOR, fixtureSnapshot } from "./plugin/fixture.ts";
export {
  deleteElsewhere as deleteExampleRemoteEntry,
  editElsewhere as editExampleRemoteEntry,
  logElsewhere as logExampleRemoteEntry,
  runRound as runExampleTimeSyncRound,
  startElsewhere as startExampleRemoteTimer,
} from "./plugin/time-sync.ts";

/** The plugin's manifest, as `plugin/plugin.json` declares it. */
export const exampleProjectSourceManifest = manifest;

/** The plugin's folder, to pass as a development plugin directory. */
export const exampleProjectSourceDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "plugin",
);

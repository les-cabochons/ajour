// Entry point: the example project source plugin, for Ajour's own tests and
// the acceptance harness. The plugin itself is `plugin/`, a plugin API 4
// package Ajour loads from disk as a development plugin; this file hands
// out its folder and the fixture it serves, so a test can assert on what
// Ajour received.
import path from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./plugin/plugin.json" with { type: "json" };

export { FIXTURE_CURSOR, fixtureSnapshot } from "./plugin/fixture.ts";

/** The plugin's manifest, as `plugin/plugin.json` declares it. */
export const exampleProjectSourceManifest = manifest;

/** The plugin's folder, to pass as a development plugin directory. */
export const exampleProjectSourceDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "plugin",
);

// Declares the `ajour` global a plugin's code receives. Import it once, for
// its types only, as `import type {} from '@ajour/plugin-sdk/globals'`.
import type { Ajour } from "./lib/runtime.js";

declare global {
  var ajour: Ajour;
}

export {};

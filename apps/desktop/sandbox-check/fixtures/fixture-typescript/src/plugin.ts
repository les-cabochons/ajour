// An API 4 plugin shipped as TypeScript source: main strips the types of
// each file as the renderer imports it, this one and the files it imports.
import type { Greeting } from "./greeting.ts";
import { greet } from "./greeting.ts";

interface Described {
  greeting: Greeting;
  origin: string;
  module: string;
}

export function describe(name: string): Described {
  return {
    greeting: greet(name),
    origin: self.location.origin,
    module: import.meta.url,
  } satisfies Described;
}

// Entry point: the error scrubber. The emitter scrubs every message a unit
// records; callers that put a message elsewhere can scrub it the same way.
export { MAX_MESSAGE_CHARACTERS, scrubErrorMessage } from "./lib/scrub.ts";
export type { ScrubContext } from "./lib/scrub.ts";

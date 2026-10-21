// Entry point: the emitter and the envelope. Each runtime creates one emitter
// at start, with its runtime context and a sink. See docs/logging-strategy.md.
export { createEmitter } from "./lib/emitter.ts";
export type {
  Emitter,
  EmitterOptions,
  FailOptions,
  Unit,
  UnitInit,
} from "./lib/emitter.ts";
export { errorIdentity } from "./lib/errors.ts";
export { synchronousScope } from "./lib/scope.ts";
export type { ScopeStore } from "./lib/scope.ts";
export type {
  Channel,
  Envelope,
  EventError,
  Kind,
  Outcome,
  Runtime,
  RuntimeContext,
  StepFailure,
  Surface,
  Trigger,
} from "./lib/envelope.ts";

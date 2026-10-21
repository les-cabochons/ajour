// Entry point for Node runtimes only: the local API and the main process.
// The browser uses the default synchronous scope.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ScopeStore } from "./lib/scope.ts";

/**
 * Tracks the active unit with Node's async context, so it follows `await`s
 * and callbacks: a unit started anywhere in a request's flow folds into it.
 */
export function asyncContextScope(): ScopeStore {
  const storage = new AsyncLocalStorage<unknown>();
  return {
    active: () => storage.getStore(),
    run: (frame, work) => storage.run(frame, work),
  };
}

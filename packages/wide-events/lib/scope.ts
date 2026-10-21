/**
 * Tracks which unit of work is active, so a unit started inside another can
 * fold into it. Frames are opaque to the store.
 */
export interface ScopeStore {
  active(): unknown;
  run<Result>(frame: unknown, work: () => Result): Result;
}

/**
 * The browser's scope: a stack that holds a frame while `work` runs
 * synchronously. Store commands are synchronous, so this is enough for them.
 * An async unit leaves the stack at its first await.
 */
export function synchronousScope(): ScopeStore {
  const stack: unknown[] = [];
  return {
    active: () => stack[stack.length - 1],
    run(frame, work) {
      stack.push(frame);
      try {
        return work();
      } finally {
        stack.pop();
      }
    },
  };
}

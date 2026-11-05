/**
 * Runs `operation` while no other window of this app holds the lock `name`,
 * and resolves with what it resolves with. Without Web Locks, as in tests,
 * it runs at once.
 */
export function exclusively<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks
    ? (locks.request(name, operation) as unknown as Promise<T>)
    : operation();
}

const listeners = new Set<(pluginId: string) => void>();
export function commandAccessChanged(pluginId: string) {
  for (const listener of listeners) listener(pluginId);
}
export function subscribeCommandAccess(listener: (pluginId: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

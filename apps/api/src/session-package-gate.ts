/**
 * The package half of a process session's gate (#743): a session ends when
 * its plugin is suspended, or when another package of the plugin replaced
 * the one that opened it. Finding the package reads every plugin folder,
 * and a development package's key reads each of its files, so the package
 * found is kept per plugin. The host forgets it on an install, a replace or
 * an uninstall, and a change in a development package's folder forgets it
 * too. Suspension is asked afresh on every check: it costs nothing.
 */
import { watch as watchFolder } from "node:fs";
import type { BrokerCaller } from "./broker-port.ts";
import type { ResolvedPlugin } from "./plugin-package.ts";

interface PackageFound {
  version: string;
  packageKey: string;
  development: boolean;
}

export interface SessionPackageGateOptions {
  suspended(pluginId: string): boolean;
  /** The plugin's package now, or undefined when it has none. */
  find(pluginId: string): Promise<ResolvedPlugin | undefined>;
  processPackage(
    pluginId: string,
    resolved: ResolvedPlugin,
  ): Promise<{ packageKey: string; development: boolean }>;
  /** Calls back on any change in the folder, until closed. */
  watch?(directory: string, changed: () => void): { close(): void };
}

export interface SessionPackageGate {
  check(caller: BrokerCaller): Promise<"plugin_off" | undefined>;
  /** The plugin's package may have changed: find it again on the next check. */
  invalidate(pluginId: string): void;
  close(): void;
}

/** Watches a folder and everything in it; a watch that fails counts as a change. */
export function watchPackageFolder(
  directory: string,
  changed: () => void,
): { close(): void } {
  const watcher = watchFolder(directory, { recursive: true }, () => changed());
  watcher.on("error", () => changed());
  watcher.unref();
  return { close: () => watcher.close() };
}

export function createSessionPackageGate(
  options: SessionPackageGateOptions,
): SessionPackageGate {
  interface Entry {
    found: Promise<PackageFound | undefined>;
    watcher?: { close(): void };
  }
  const known = new Map<string, Entry>();
  let closed = false;
  const watch = options.watch ?? watchPackageFolder;

  const invalidate = (pluginId: string, entry = known.get(pluginId)) => {
    if (!entry || known.get(pluginId) !== entry) return;
    known.delete(pluginId);
    entry.watcher?.close();
  };

  const find = (pluginId: string): Promise<PackageFound | undefined> => {
    const kept = known.get(pluginId);
    if (kept) return kept.found;
    const entry: Entry = { found: Promise.resolve(undefined) };
    // Once closed, nothing is kept or watched.
    let keep = !closed;
    entry.found = (async () => {
      const resolved = await options.find(pluginId);
      if (!resolved) return undefined;
      // Watched before its key is read, so no change slips between.
      if (keep && resolved.source === "development") {
        try {
          const watcher = watch(resolved.directory, () =>
            invalidate(pluginId, entry),
          );
          if (known.get(pluginId) === entry) entry.watcher = watcher;
          else watcher.close();
        } catch {
          // Unwatched, it is found afresh on every check.
          keep = false;
        }
      }
      const current = await options.processPackage(pluginId, resolved);
      return {
        version: resolved.manifest.version,
        packageKey: current.packageKey,
        development: current.development,
      };
    })();
    known.set(pluginId, entry);
    // Only a package found is kept: a miss or a failure asks again.
    entry.found.then(
      (found) => {
        if (!found || !keep) invalidate(pluginId, entry);
      },
      () => invalidate(pluginId, entry),
    );
    return entry.found;
  };

  return {
    async check(caller) {
      if (options.suspended(caller.pluginId)) return "plugin_off";
      let current: PackageFound | undefined;
      try {
        current = await find(caller.pluginId);
      } catch {
        return "plugin_off";
      }
      if (
        !current ||
        current.version !== caller.manifest.version ||
        current.packageKey !== caller.packageKey ||
        current.development !== (caller.development === true)
      )
        return "plugin_off";
      return undefined;
    },
    invalidate: (pluginId) => invalidate(pluginId),
    close() {
      closed = true;
      for (const pluginId of [...known.keys()]) invalidate(pluginId);
    },
  };
}

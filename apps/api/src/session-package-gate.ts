/**
 * The package half of a process session's gate (#743): a session ends when
 * its plugin is suspended, or when another package of the plugin replaced
 * the one that opened it. Finding the package reads every plugin folder,
 * and a development package's key reads each of its files, so the package
 * found is kept per plugin. The host forgets it on an install, a replace or
 * an uninstall, and a change in a development package's folder forgets it
 * too. Windows hears nothing when that folder itself is renamed or moved,
 * so each check also compares the folder's identity, one stat, with the
 * one it had when found. Some file systems give a folder no identity to
 * trust, and some give one that changes: a package whose identity is
 * missing or keeps changing is found again at most every 10 s. Suspension
 * is asked afresh on every check: it costs nothing.
 */
import { watch as watchFolder } from "node:fs";
import type { BigIntStats } from "node:fs";
import { stat } from "node:fs/promises";
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
  /**
   * The folder's identity, null when it has none to trust, or undefined
   * once nothing is at its path.
   */
  identify?(directory: string): Promise<string | null | undefined>;
}

/** The least time between two finds a folder's identity asks for. */
const DOUBT_MS = 10_000;

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

/** A folder's device and inode, which a rename or a replacement changes. */
export async function folderIdentity(
  directory: string,
): Promise<string | null | undefined> {
  try {
    return identityOf(await stat(directory, { bigint: true }));
  } catch {
    return undefined;
  }
}

/**
 * A stat's device and inode, or null when the file system gives no file
 * id: Windows reports 0 for some, and the id isn't unique on others.
 */
export function identityOf(
  found: Pick<BigIntStats, "dev" | "ino" | "isDirectory">,
): string | null | undefined {
  if (!found.isDirectory()) return undefined;
  if (found.ino === 0n) return null;
  return `${found.dev}:${found.ino}`;
}

export function createSessionPackageGate(
  options: SessionPackageGateOptions,
): SessionPackageGate {
  interface Entry {
    found: Promise<PackageFound | undefined>;
    watcher?: { close(): void };
    /** A development package's folder, as it was when found. */
    folder?: { directory: string; identity: string | null };
  }
  const known = new Map<string, Entry>();
  /** When a plugin's folder identity last had its package found again. */
  const doubted = new Map<string, number>();
  let closed = false;
  const watch = options.watch ?? watchPackageFolder;
  const identify = options.identify ?? folderIdentity;

  const invalidate = (pluginId: string, entry = known.get(pluginId)) => {
    if (!entry || known.get(pluginId) !== entry) return;
    known.delete(pluginId);
    entry.watcher?.close();
  };

  const find = (pluginId: string): Entry => {
    const kept = known.get(pluginId);
    if (kept) return kept;
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
          const identity = await identify(resolved.directory);
          // A folder already gone is found afresh on the next check.
          if (identity === undefined) keep = false;
          else entry.folder = { directory: resolved.directory, identity };
          // One with no identity is kept for a while only.
          if (identity === null) doubted.set(pluginId, Date.now());
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
    return entry;
  };

  /**
   * The package now: a kept one whose folder went is found again, and one
   * whose folder moved or can't tell is found again at most every 10 s.
   */
  const currentPackage = async (pluginId: string) => {
    const entry = find(pluginId);
    const found = await entry.found;
    const folder = entry.folder;
    if (!folder || known.get(pluginId) !== entry) return found;
    const identity = await identify(folder.directory);
    if (identity !== null && identity === folder.identity) return found;
    if (identity !== undefined) {
      const now = Date.now();
      if (now - (doubted.get(pluginId) ?? -Infinity) < DOUBT_MS) return found;
      doubted.set(pluginId, now);
    }
    invalidate(pluginId, entry);
    return find(pluginId).found;
  };

  return {
    async check(caller) {
      if (options.suspended(caller.pluginId)) return "plugin_off";
      let current: PackageFound | undefined;
      try {
        current = await currentPackage(caller.pluginId);
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
      doubted.clear();
    },
  };
}

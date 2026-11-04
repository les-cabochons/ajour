import type { AjourClient } from "./client.ts";
import { localDate } from "./context.ts";
import {
  parseEntryRef,
  pickFoundEntry,
  resolveTask,
  ReferenceError,
  type FoundEntry,
  type ResolvedTask,
} from "./refs.ts";

/**
 * References resolved against Ajour: refs.ts parses and picks, this asks
 * the read tools for what it picks from.
 */

/** The one active task `query` names, from list_projects. */
export async function findTask(
  client: AjourClient,
  query: string,
): Promise<ResolvedTask> {
  const { projects } = await client.call("list_projects", {});
  return resolveTask(query, projects);
}

/** The same local time of day, `days` calendar days earlier. */
export function daysBefore(now: number, days: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

/**
 * The entry `text` names: the running entry, the saved entry used last on
 * any day, or the one whose short id starts with it.
 */
export async function findEntry(
  client: AjourClient,
  text: string,
  now: number,
): Promise<FoundEntry> {
  const ref = parseEntryRef(text);
  const today = localDate(now);
  if (ref.kind === "running") {
    const { running } = await client.call("get_running_timer", {});
    if (!running) throw new ReferenceError("No entry is running.");
    return { kind: "running", running };
  }
  if (ref.kind === "last") {
    const { entry } = await client.call("get_last_saved_entry", {});
    if (!entry) throw new ReferenceError("No entry has been saved yet.");
    return { kind: "entry", entry };
  }
  const found = await client.call("find_entries", { idPrefix: ref.prefix });
  return pickFoundEntry(ref.prefix, found, today);
}

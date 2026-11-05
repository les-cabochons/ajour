import {
  projectSourceBudgetSchema,
  projectSourceProjectSchema,
} from "@ajour/shared";
import type {
  LocalProject,
  LocalProjectSource,
  LocalProjectSourceBudget,
  LocalProjectSourceLink,
  LocalTaskSourceLink,
} from "@/domain/local-state";

/*
 * Reads stored project source links and records back (#505). A link whose
 * shape is wrong is dropped, which turns its project local, or its task one
 * the source doesn't know yet. Kept apart from source-sync.ts so project
 * normalization does not depend on the sync rules.
 */

/** What the user calls the project's source, such as "Example planner". */
export function getProjectSourceLabel(
  project: Pick<LocalProject, "source">,
  projectSources: Readonly<Record<string, LocalProjectSource>> | undefined,
): string | undefined {
  const connectionId = project.source?.connectionId;
  return connectionId ? projectSources?.[connectionId]?.label : undefined;
}

/**
 * The words that name a source in a sentence: its label, or "its source" when
 * the connection's label is not known. `atStart` capitalizes the fallback.
 */
export function sourceNameOf(
  label: string | undefined,
  atStart = false,
): string {
  return label ?? (atStart ? "Its source" : "its source");
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizeProjectSourceLink(
  value: unknown,
): LocalProjectSourceLink | undefined {
  const link = asRecord(value);
  if (
    !link ||
    !nonEmptyString(link.pluginId) ||
    !nonEmptyString(link.connectionId) ||
    !nonEmptyString(link.remoteId) ||
    !finiteNumber(link.syncedAt)
  ) {
    return undefined;
  }
  return {
    pluginId: link.pluginId,
    connectionId: link.connectionId,
    remoteId: link.remoteId,
    ...(nonEmptyString(link.url) ? { url: link.url } : {}),
    syncedAt: link.syncedAt,
  };
}

export function normalizeTaskSourceLink(
  value: unknown,
): LocalTaskSourceLink | undefined {
  const link = asRecord(value);
  if (
    !link ||
    !nonEmptyString(link.remoteId) ||
    typeof link.assigned !== "boolean"
  ) {
    return undefined;
  }
  return {
    remoteId: link.remoteId,
    ...(nonEmptyString(link.group) ? { group: link.group } : {}),
    assigned: link.assigned,
    ...(finiteNumber(link.myHours) && link.myHours >= 0
      ? { myHours: link.myHours }
      : {}),
  };
}

export function normalizeProjectSourceBudget(
  value: unknown,
): LocalProjectSourceBudget | undefined {
  const budget = asRecord(value);
  if (!budget || !nonEmptyString(budget.asOf)) return undefined;
  const parsed = projectSourceBudgetSchema.safeParse(budget);
  return parsed.success ? { ...parsed.data, asOf: budget.asOf } : undefined;
}

/** A stored text field of a managed project, such as its client. */
export function normalizeSourceText(value: unknown): string | undefined {
  return nonEmptyString(value) ? value : undefined;
}

/** A stored archive mark: true, or undefined for anything else. */
export function normalizeArchiveMark(value: unknown): true | undefined {
  return value === true ? true : undefined;
}

export function normalizeProjectSources(
  value: unknown,
): Record<string, LocalProjectSource> {
  const stored = asRecord(value);
  if (!stored) return {};
  const records: Record<string, LocalProjectSource> = {};
  for (const [connectionId, candidate] of Object.entries(stored)) {
    const record = asRecord(candidate);
    if (
      !nonEmptyString(connectionId) ||
      !record ||
      !nonEmptyString(record.pluginId) ||
      !nonEmptyString(record.label) ||
      !nonEmptyString(record.asOf) ||
      !finiteNumber(record.syncedAt)
    ) {
      continue;
    }
    const me = asRecord(record.me);
    records[connectionId] = {
      pluginId: record.pluginId,
      label: record.label,
      ...(nonEmptyString(record.url) ? { url: record.url } : {}),
      asOf: record.asOf,
      ...(me && typeof me.hoursAvailable === "boolean"
        ? {
            me: {
              hoursAvailable: me.hoursAvailable,
              ...(nonEmptyString(me.hoursNote)
                ? { hoursNote: me.hoursNote }
                : {}),
            },
          }
        : {}),
      syncedAt: record.syncedAt,
      held: Array.isArray(record.held)
        ? record.held.flatMap((project) => {
            const parsed = projectSourceProjectSchema.safeParse(project);
            return parsed.success ? [parsed.data] : [];
          })
        : [],
    };
  }
  return records;
}

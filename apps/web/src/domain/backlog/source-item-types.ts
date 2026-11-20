import type { LocalWorkItem } from "@/domain/local-state";

/** An item type a connection's items have, and how many of them. */
export type SourceItemTypeCount = { name: string; count: number };

/**
 * The item types of one connection's synced items in the backlog, active or
 * settled, most items first, then by name. Names that differ only in case or
 * spaces are one type, spelled as its first item spells it.
 */
export function countSourceItemTypes(
  workItems: ReadonlyArray<
    Pick<
      LocalWorkItem,
      "source" | "sourceConnectionId" | "sourceWorkItemType" | "status"
    >
  >,
  source: string,
  connectionId: string,
): SourceItemTypeCount[] {
  const byKey = new Map<string, SourceItemTypeCount>();
  for (const workItem of workItems) {
    const name = workItem.sourceWorkItemType?.trim();
    if (
      !name ||
      workItem.status === "archived" ||
      workItem.source !== source ||
      workItem.sourceConnectionId !== connectionId
    ) {
      continue;
    }
    const key = name.toLowerCase();
    const counted = byKey.get(key);
    if (counted) counted.count += 1;
    else byKey.set(key, { name, count: 1 });
  }
  return [...byKey.values()].sort(
    (left, right) =>
      right.count - left.count || left.name.localeCompare(right.name),
  );
}

import type { LocalWorkItem } from "@/domain/local-state";

/**
 * An item type a connection's items have, how many of them, and the source
 * id of one of them, so its plugin can find the item's project.
 */
export type SourceItemTypeCount = {
  name: string;
  count: number;
  sourceId?: string;
};

/**
 * The item types of one connection's synced items in the backlog, active or
 * settled, most items first, then by name. Names that differ only in case or
 * spaces are one type, spelled as its first item spells it. Its `sourceId`
 * is its first item's that has one.
 */
export function countSourceItemTypes(
  workItems: ReadonlyArray<
    Pick<
      LocalWorkItem,
      | "source"
      | "sourceConnectionId"
      | "sourceId"
      | "sourceWorkItemType"
      | "status"
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
    const counted = byKey.get(key) ?? { name, count: 0 };
    counted.count += 1;
    counted.sourceId ??= workItem.sourceId;
    byKey.set(key, counted);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      right.count - left.count || left.name.localeCompare(right.name),
  );
}

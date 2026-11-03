/**
 * The item to open once `currentId` left the sidebar's list, as after a
 * settle or a snooze on its page (#488). `before` is the list as the action
 * started, `after` the list once it was made, both as item ids in the
 * sidebar's order.
 *
 * The next one is the first row after it in `before` that is still in
 * `after`, so a parent settled with its subitems skips them. With none after
 * it, the row before it opens. An item that wasn't in the list, such as one
 * the search hides, opens the list's first row. Undefined when the list is
 * empty.
 */
export function pickNextItemId(
  before: readonly string[],
  after: readonly string[],
  currentId: string,
): string | undefined {
  const remaining = new Set(after);
  remaining.delete(currentId);
  const index = before.indexOf(currentId);
  if (index === -1) return after.find((id) => remaining.has(id));
  const later = before.slice(index + 1).find((id) => remaining.has(id));
  if (later) return later;
  const earlier = before
    .slice(0, index)
    .reverse()
    .find((id) => remaining.has(id));
  // A row new to the list, such as one a sync brought meanwhile.
  return earlier ?? after.find((id) => remaining.has(id));
}

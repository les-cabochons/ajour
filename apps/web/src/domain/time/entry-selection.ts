/**
 * Selecting time entries on the Day list and the Week Days cards, as in a file
 * explorer, and where pasted entries land. See "Selecting, copying and pasting
 * entries" in agents/ux-spec.md.
 */

/**
 * The selected entries, in the order they were selected. `anchorId` is the entry
 * a Shift+click range starts from: the last entry clicked without Shift.
 */
export interface EntrySelection {
  ids: readonly string[];
  anchorId: string | null;
}

export const EMPTY_ENTRY_SELECTION: EntrySelection = {
  ids: [],
  anchorId: null,
};

/** The modifier keys held during a click. `toggle` is Cmd on macOS, Ctrl elsewhere. */
export interface EntrySelectionModifiers {
  range: boolean;
  toggle: boolean;
}

/**
 * The selection after a click on `entryId`. `orderedIds` lists the shown entries in
 * reading order, which Shift+click ranges follow: the Day list top to bottom, or the
 * Week columns from Monday, each top to bottom.
 *
 * - A plain click selects the entry alone.
 * - Cmd or Ctrl+click adds the entry or removes it.
 * - Shift+click selects every entry from the anchor to the entry, and keeps the
 *   anchor so the next Shift+click redraws the range from it.
 */
export function selectEntryOnClick(
  selection: EntrySelection,
  orderedIds: readonly string[],
  entryId: string,
  modifiers: EntrySelectionModifiers,
): EntrySelection {
  if (modifiers.range) {
    const anchorIndex = selection.anchorId
      ? orderedIds.indexOf(selection.anchorId)
      : -1;
    const entryIndex = orderedIds.indexOf(entryId);
    if (anchorIndex !== -1 && entryIndex !== -1) {
      const [start, end] =
        anchorIndex <= entryIndex
          ? [anchorIndex, entryIndex]
          : [entryIndex, anchorIndex];
      return {
        ids: orderedIds.slice(start, end + 1),
        anchorId: selection.anchorId,
      };
    }
  }

  if (modifiers.toggle) {
    return {
      ids: selection.ids.includes(entryId)
        ? selection.ids.filter((id) => id !== entryId)
        : [...selection.ids, entryId],
      anchorId: entryId,
    };
  }

  return { ids: [entryId], anchorId: entryId };
}

/**
 * Drops selected entries that are no longer shown, such as a deleted entry.
 * Returns `selection` itself when nothing changed, so React can skip a render.
 */
export function keepShownEntries(
  selection: EntrySelection,
  shownIds: ReadonlySet<string>,
): EntrySelection {
  const ids = selection.ids.filter((id) => shownIds.has(id));
  const anchorId =
    selection.anchorId && shownIds.has(selection.anchorId)
      ? selection.anchorId
      : null;
  return ids.length === selection.ids.length && anchorId === selection.anchorId
    ? selection
    : { ids, anchorId };
}

/**
 * Where a paste puts entries:
 * - `day` puts every entry on `localDate`, as in the Day view or "Paste here".
 * - `same-weekday` keeps each entry's weekday within `weekDates`, Monday first,
 *   so an entry copied from a Monday lands on the shown week's Monday.
 */
export type EntryPasteTarget =
  | { kind: "day"; localDate: string }
  | { kind: "same-weekday"; weekDates: readonly string[] };

/** The weekday of a "YYYY-MM-DD" date, 0 for Monday through 6 for Sunday. */
function isoWeekdayIndex(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  return (new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay() + 6) % 7;
}

/** The day a pasted entry copied from `sourceDate` lands on. */
export function getPasteDate(sourceDate: string, target: EntryPasteTarget) {
  if (target.kind === "day") {
    return target.localDate;
  }

  return target.weekDates[isoWeekdayIndex(sourceDate)] ?? sourceDate;
}

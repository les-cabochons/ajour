/**
 * Selecting time entries on the Day list and the Week Days cards, as in a file
 * explorer, and where pasted entries land. See "Selecting, copying and pasting
 * entries" in docs/agents/ux-spec.md.
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

/** The modifier keys held during a click. `toggle` is Cmd or Ctrl. */
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
 * The selection when a press (pointer down) starts on `entryId`, before any drag,
 * as in Finder. A plain press on an unselected entry selects it alone at once, so
 * a drag that follows carries that entry only. A press on a selected entry keeps
 * the selection, so a drag carries all of it, and the click that ends a press
 * without a drag collapses it. Shift, Cmd and Ctrl presses leave the change to
 * the click.
 */
export function selectEntryOnPress(
  selection: EntrySelection,
  entryId: string,
  modifiers: EntrySelectionModifiers,
): EntrySelection {
  if (modifiers.range || modifiers.toggle || selection.ids.includes(entryId)) {
    return selection;
  }

  return { ids: [entryId], anchorId: entryId };
}

/**
 * The selection when a right-click, the menu key or Shift+F10 opens the menu of
 * `entryId`: an unselected entry is selected alone first, so the menu always
 * acts on the selection. A selected entry keeps the selection.
 */
export function selectEntryOnMenu(
  selection: EntrySelection,
  entryId: string,
): EntrySelection {
  return selection.ids.includes(entryId)
    ? selection
    : { ids: [entryId], anchorId: entryId };
}

/** Cmd+A and Select All: every shown entry, anchored on the first one. */
export function selectAllEntries(
  orderedIds: readonly string[],
): EntrySelection {
  return { ids: [...orderedIds], anchorId: orderedIds[0] ?? null };
}

/**
 * Shift+↑ and Shift+↓ from the focused entry `fromId`: the entry focus moves to,
 * the previous or next one in reading order, and the range from the anchor to it.
 * With no shown anchor, `fromId` becomes the anchor. Returns null at either end
 * of the list, or when `fromId` is not shown.
 */
export function extendEntrySelection(
  selection: EntrySelection,
  orderedIds: readonly string[],
  fromId: string,
  step: -1 | 1,
): { focusId: string; selection: EntrySelection } | null {
  const fromIndex = orderedIds.indexOf(fromId);
  const focusId = fromIndex === -1 ? undefined : orderedIds[fromIndex + step];
  if (!focusId) {
    return null;
  }

  const anchorId =
    selection.anchorId && orderedIds.includes(selection.anchorId)
      ? selection.anchorId
      : fromId;
  return {
    focusId,
    selection: selectEntryOnClick(
      { ids: selection.ids, anchorId },
      orderedIds,
      focusId,
      { range: true, toggle: false },
    ),
  };
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
 * The entries an action on `entryId` applies to, or null when the action applies
 * to that entry alone, because it is the whole selection or nothing is selected.
 *
 * Menus always find their entry selected, because opening one selects an
 * unselected entry first (`selectEntryOnMenu`). Keys can come from an entry
 * outside the selection, such as one Cmd+click just toggled off while it kept
 * focus, and they act on the selection: the key always follows it.
 */
export function getSelectionActionIds(
  selection: EntrySelection,
  entryId: string,
): readonly string[] | null {
  if (
    selection.ids.length === 0 ||
    (selection.ids.length === 1 && selection.ids[0] === entryId)
  ) {
    return null;
  }

  return selection.ids;
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

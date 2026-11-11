import { recordsEqual } from "@/domain/records-equal";

/**
 * Fields that change together: a draft keeps or takes them as one, such as a
 * project and its task, so it never holds one pick's project with another's task.
 */
export type DraftFieldGroup<Fields> = readonly (keyof Fields)[];

/** A draft's fields, with the saved record's values they started from. */
export interface ReconciledDraft<Fields> {
  fields: Fields;
  base: Fields;
}

function groupsOf<Fields extends object>(
  fields: Fields,
  groups: readonly DraftFieldGroup<Fields>[] | undefined,
): DraftFieldGroup<Fields>[] {
  const grouped = new Set((groups ?? []).flat());
  const alone = (Object.keys(fields) as (keyof Fields)[])
    .filter((key) => !grouped.has(key))
    .map((key) => [key] as const);
  return [...(groups ?? []), ...alone];
}

function sameValues<Fields extends object>(
  group: DraftFieldGroup<Fields>,
  left: Fields,
  right: Fields,
) {
  return group.every((key) => recordsEqual(left[key], right[key]));
}

/**
 * Brings a kept draft up to the record as it is now. `base` holds the record's
 * values when the draft started. A group the user did not change takes the
 * record's current value, and a group only the user changed stays as typed. A
 * group both changed to different values stays as typed too, and stays a
 * conflict (`findDraftConflicts`) for the user to decide, so nothing is
 * overwritten silently.
 */
export function reconcileDraft<Fields extends object>(
  draft: ReconciledDraft<Fields>,
  current: Fields,
  groups?: readonly DraftFieldGroup<Fields>[],
): ReconciledDraft<Fields> {
  const fields = { ...draft.fields };
  const base = { ...draft.base };
  for (const group of groupsOf(current, groups)) {
    // The user's change stays; so does a conflict, for the user to decide.
    const takesCurrent =
      sameValues(group, draft.fields, draft.base) ||
      (!sameValues(group, current, draft.base) &&
        sameValues(group, draft.fields, current));
    if (!takesCurrent) continue;
    for (const key of group) {
      fields[key] = current[key];
      base[key] = current[key];
    }
  }
  return { fields, base };
}

/** The groups the user changed and the record changed to a different value. */
export function findDraftConflicts<Fields extends object>(
  draft: ReconciledDraft<Fields>,
  current: Fields,
  groups?: readonly DraftFieldGroup<Fields>[],
): DraftFieldGroup<Fields>[] {
  return groupsOf(current, groups).filter(
    (group) =>
      !sameValues(group, draft.fields, draft.base) &&
      !sameValues(group, current, draft.base) &&
      !sameValues(group, draft.fields, current),
  );
}

/** Keeps the user's value for a conflicting group: the record's now counts as seen. */
export function keepMineInDraft<Fields extends object>(
  draft: ReconciledDraft<Fields>,
  current: Fields,
  group: DraftFieldGroup<Fields>,
): ReconciledDraft<Fields> {
  const base = { ...draft.base };
  for (const key of group) base[key] = current[key];
  return { fields: draft.fields, base };
}

/** Takes the record's value for a conflicting group, dropping the user's. */
export function useTheirsInDraft<Fields extends object>(
  draft: ReconciledDraft<Fields>,
  current: Fields,
  group: DraftFieldGroup<Fields>,
): ReconciledDraft<Fields> {
  const fields = { ...draft.fields };
  const base = { ...draft.base };
  for (const key of group) {
    fields[key] = current[key];
    base[key] = current[key];
  }
  return { fields, base };
}

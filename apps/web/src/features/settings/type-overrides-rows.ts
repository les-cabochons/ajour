import {
  formatTypeOverrides,
  parseTypeOverrides,
  type PluginFieldValue,
} from "@ajour/shared";
import type { SourceItemTypeCount } from "@/domain/backlog/source-item-types";

/**
 * The texts a form holds for one item type of a `typeOverrides` field, as
 * typed: the form stores them trimmed, but the input keeps the user's spaces
 * while they type a field name such as "Original Estimate".
 */
export type TypeOverrideDraft = {
  name: string;
  values: Record<string, string>;
};

/** One row of the By work item type block. */
export type TypeOverrideRow = {
  name: string;
  /** How many of the connection's items have the type. Absent for a type not found. */
  count?: number;
  values: Record<string, string>;
  /** Only a type the connection's items don't have can be removed. */
  removable: boolean;
};

function sameType(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * The drafts a form starts with, from the saved value. A value the form
 * can't read starts with none: saving then replaces it.
 */
export function draftsOfValue(
  value: PluginFieldValue | undefined,
): TypeOverrideDraft[] {
  try {
    return Object.entries(parseTypeOverrides(value)).map(([name, values]) => ({
      name,
      values,
    }));
  } catch {
    return [];
  }
}

/** The value the form saves: trimmed texts, blanks left out, `""` for none. */
export function valueOfDrafts(drafts: readonly TypeOverrideDraft[]) {
  return formatTypeOverrides(
    Object.fromEntries(drafts.map((draft) => [draft.name, draft.values])),
  );
}

/**
 * The rows: the types found in the connection's items, most first, each
 * with its draft's texts, then the drafts of other types in their order.
 */
export function typeOverrideRows(
  found: readonly SourceItemTypeCount[],
  drafts: readonly TypeOverrideDraft[],
): TypeOverrideRow[] {
  const foundRows = found.map((type) => ({
    name: type.name,
    count: type.count,
    values:
      drafts.find((draft) => sameType(draft.name, type.name))?.values ?? {},
    removable: false,
  }));
  const otherRows = drafts
    .filter((draft) => !found.some((type) => sameType(type.name, draft.name)))
    .map((draft) => ({
      name: draft.name,
      values: draft.values,
      removable: true,
    }));
  return [...foundRows, ...otherRows];
}

/** The drafts with one text set, adding the type when it has no draft yet. */
export function withDraftText(
  drafts: readonly TypeOverrideDraft[],
  typeName: string,
  fieldId: string,
  text: string,
): TypeOverrideDraft[] {
  if (!drafts.some((draft) => sameType(draft.name, typeName))) {
    return [...drafts, { name: typeName, values: { [fieldId]: text } }];
  }
  return drafts.map((draft) =>
    sameType(draft.name, typeName)
      ? { ...draft, values: { ...draft.values, [fieldId]: text } }
      : draft,
  );
}

/** The drafts with an empty one for a type the user adds, unless it has one. */
export function withDraftAdded(
  drafts: readonly TypeOverrideDraft[],
  typeName: string,
): TypeOverrideDraft[] {
  const name = typeName.trim();
  if (!name || drafts.some((draft) => sameType(draft.name, name))) {
    return [...drafts];
  }
  return [...drafts, { name, values: {} }];
}

/** The drafts without a type's. */
export function withoutDraft(
  drafts: readonly TypeOverrideDraft[],
  typeName: string,
): TypeOverrideDraft[] {
  return drafts.filter((draft) => !sameType(draft.name, typeName));
}

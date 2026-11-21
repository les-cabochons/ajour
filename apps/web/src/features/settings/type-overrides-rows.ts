import {
  formatTypeOverrides,
  parseTypeOverrides,
  type BacklogItemType,
  type BacklogItemTypesRequest,
  type BacklogItemTypesResult,
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

/** Two names of one type or field: trimmed, in any case. */
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

/**
 * What the form asks the plugin about: the types found, each with one of
 * its items, then the types only the saved value names, without one.
 */
export function itemTypesRequest(
  found: readonly SourceItemTypeCount[],
  drafts: readonly TypeOverrideDraft[],
): BacklogItemTypesRequest {
  return {
    types: [
      ...found.map((type) =>
        type.sourceId
          ? { name: type.name, sourceId: type.sourceId }
          : { name: type.name },
      ),
      ...drafts
        .filter(
          (draft) => !found.some((type) => sameType(type.name, draft.name)),
        )
        .map((draft) => ({ name: draft.name })),
    ],
  };
}

/** What the plugin said about a type, matched by name in any case. */
export function describedType(
  described: BacklogItemTypesResult | undefined,
  typeName: string,
): BacklogItemType | undefined {
  return described?.types.find((type) => sameType(type.name, typeName));
}

/** A field the connection names and a type lacks, and what the plugin proposes instead. */
export type MissingField = { field: string; proposal?: string };

/**
 * The connection's field a type lacks, for one chip: the chip is empty, so
 * the type would use the connection's field, and the type's fields, by name
 * or id in any case, don't include it. Nothing when the plugin gave the
 * type no fields, since Ajour can't tell. The proposal is the plugin's
 * first suggestion for that column; the form never saves it by itself.
 */
export function missingField(
  type: BacklogItemType | undefined,
  fieldId: string,
  connectionField: string,
  chipText: string,
): MissingField | undefined {
  const field = connectionField.trim();
  if (!type?.fields || !field || chipText.trim()) return undefined;
  const hasIt = type.fields.some(
    (candidate) =>
      sameType(candidate.name, field) ||
      (candidate.id !== undefined && sameType(candidate.id, field)),
  );
  if (hasIt) return undefined;
  const proposal = type.suggestions?.[fieldId]?.[0];
  return proposal ? { field, proposal } : { field };
}

/** The plugin's types that have no row yet, for Add a type, in its order. */
export function otherItemTypes(
  described: BacklogItemTypesResult | undefined,
  rows: readonly TypeOverrideRow[],
): BacklogItemType[] {
  return (described?.types ?? []).filter(
    (type) => !rows.some((row) => sameType(row.name, type.name)),
  );
}

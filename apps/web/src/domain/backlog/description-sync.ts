import {
  BACKLOG_DESCRIPTION_MAX_LENGTH,
  isCapabilityActive,
  type BacklogDescriptionCapability,
  type BacklogSyncedDescription,
  type PluginsOverview,
} from "@ajour/shared";
import type {
  LocalWorkItem,
  LocalWorkItemDescriptionSync,
} from "@/domain/local-state";
import { mergeTexts } from "@/domain/backlog/text-merge";

/**
 * Two-way descriptions of synced backlog items (ADR 0009). Ajour keeps the
 * text both sides last agreed on, so a sync can tell which side changed:
 * one side follows the other, and a change on both is a conflict.
 */

type Described = Pick<LocalWorkItem, "description" | "descriptionSync">;

/**
 * A description as Ajour stores and compares it: Unix line endings, without
 * blank lines or trailing spaces, but with its first line's indentation as
 * written: an indented code block needs it, and indented list items or code
 * fences read differently without it. Every place that saves a description
 * uses it, so texts compare equal when they read the same.
 */
export function normalizeDescriptionText(text: string | undefined) {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
}

const storedText = normalizeDescriptionText;
const normalizeText = normalizeDescriptionText;

/** The 4,000-character note an item's description was once imported as. */
function oldImportedNote(text: string) {
  return text.length > 4000 ? `${text.slice(0, 3997).trimEnd()}...` : text;
}

function sourceFacts(source: BacklogSyncedDescription, remote: string) {
  return {
    remote,
    ...(source.lost?.length ? { lost: source.lost } : {}),
    ...(source.cut ? { cut: true } : {}),
  };
}

function agreed(source: BacklogSyncedDescription, text: string): Described {
  return {
    description: text || undefined,
    descriptionSync: { baseline: text, ...sourceFacts(source, text) },
  };
}

/** A newly imported item takes the source's text. */
export function importedDescription(
  source: BacklogSyncedDescription,
): Described & { descriptionSync: LocalWorkItemDescriptionSync } {
  const text = storedText(source.text);
  return agreed(source, text) as Described & {
    descriptionSync: LocalWorkItemDescriptionSync;
  };
}

/**
 * The description after a sync. With no text agreed on yet, as for an item
 * synced before descriptions were, the source's text wins only over an empty
 * description, the same text, or the 4,000-character note it was once cut
 * to; any other local text is the user's and becomes a conflict.
 */
export function reconcileDescription(
  item: Described,
  source: BacklogSyncedDescription,
  now: number,
): Described {
  const remote = storedText(source.text);
  const baseline = item.descriptionSync?.baseline;
  const local = normalizeText(item.description);
  const comparedRemote = normalizeText(remote);
  const comparedBaseline =
    baseline === undefined ? undefined : normalizeText(baseline);

  const takesSource =
    comparedBaseline === undefined
      ? !local ||
        local === comparedRemote ||
        // The old note was trimmed whole, indentation included.
        local.trim() === oldImportedNote(comparedRemote.trim())
      : local === comparedRemote || local === comparedBaseline;
  if (takesSource) return agreed(source, remote);

  if (baseline !== undefined && comparedRemote === comparedBaseline) {
    const writeError = item.descriptionSync?.writeError;
    return {
      description: item.description,
      // A local edit the last save could not write still waits, with why.
      descriptionSync: {
        baseline,
        ...sourceFacts(source, remote),
        ...(writeError ? { writeError } : {}),
      },
    };
  }

  return descriptionInConflict(item, source, now);
}

/**
 * The description once both sides changed it differently: the local text
 * stays, and the conflict keeps when it was first seen while its texts stay
 * the same.
 */
export function descriptionInConflict(
  item: Described,
  source: BacklogSyncedDescription,
  now: number,
): Described {
  const remote = storedText(source.text);
  const baseline = item.descriptionSync?.baseline;
  const previous = item.descriptionSync?.conflict;
  const sameConflict =
    previous !== undefined &&
    normalizeText(previous.localText) === normalizeText(item.description) &&
    normalizeText(previous.remoteText) === normalizeText(remote);
  return {
    description: item.description,
    descriptionSync: {
      ...(baseline === undefined ? {} : { baseline }),
      ...sourceFacts(source, remote),
      conflict: {
        detectedAt: sameConflict ? previous.detectedAt : now,
        localText: item.description ?? "",
        remoteText: remote,
      },
    },
  };
}

/** What saving an edited synced description does, given the source's text now. */
export type DescriptionSavePlan =
  /** The source already holds the result, so nothing is written. */
  | { kind: "agreed" }
  /** `merged` when the text joins the user's edit with the source's. */
  | { kind: "write"; text: string; merged: boolean }
  | { kind: "conflict" };

/**
 * Plans the save of `local`, the user's text, by a three-way merge with the
 * text both sides last agreed on and the source's text now. Without an agreed
 * text, any difference is a conflict.
 */
export function planDescriptionSave(
  baseline: string | undefined,
  local: string | undefined,
  source: string,
): DescriptionSavePlan {
  const mine = normalizeText(local);
  const theirs = normalizeText(source);
  if (mine === theirs) return { kind: "agreed" };
  if (baseline === undefined) return { kind: "conflict" };
  const base = normalizeText(baseline);
  if (theirs === base) return { kind: "write", text: mine, merged: false };
  const merge = mergeTexts(base, mine, theirs);
  if ("conflict" in merge) return { kind: "conflict" };
  const merged = normalizeText(merge.merged);
  return merged === theirs
    ? { kind: "agreed" }
    : { kind: "write", text: merged, merged: true };
}

/**
 * Plans Keep mine on a conflict: the user's text wins over the source's text
 * they saw. A source that changed again since is a new conflict, to see first.
 */
export function planKeepMine(
  item: Described,
  source: string,
): DescriptionSavePlan {
  const sync = item.descriptionSync;
  const mine = normalizeText(item.description);
  if (mine === normalizeText(source)) return { kind: "agreed" };
  if (!sync || normalizeText(sync.remote) !== normalizeText(source)) {
    return { kind: "conflict" };
  }
  return { kind: "write", text: mine, merged: false };
}

/**
 * The description once the source holds `source`, after a save of `saved`.
 * Both sides agree on it, and the item shows it, merged text included. A text
 * the user changed again meanwhile stays, for the next save.
 */
export function descriptionSaved(
  item: Described,
  saved: string | undefined,
  source: BacklogSyncedDescription,
): Described {
  const remote = storedText(source.text);
  if (normalizeText(item.description) === normalizeText(saved)) {
    return agreed(source, remote);
  }
  return {
    description: item.description,
    descriptionSync: { baseline: remote, ...sourceFacts(source, remote) },
  };
}

/** The description after a save that could not write it, with why. */
export function descriptionWriteFailed(
  item: Described,
  message: string,
  now: number,
): Described {
  if (!item.descriptionSync) return item;
  return {
    description: item.description,
    descriptionSync: {
      ...item.descriptionSync,
      writeError: { at: now, message },
    },
  };
}

/**
 * Load latest in the editor: the source's text replaces the item's, and both
 * sides agree on it.
 */
export function latestDescription(source: BacklogSyncedDescription): Described {
  return agreed(source, storedText(source.text));
}

/**
 * Whether the item holds a local edit not written to the source yet, as after
 * a save that failed. A conflict is shown as one instead.
 */
export function hasUnwrittenDescription(item: Described) {
  const sync = item.descriptionSync;
  return Boolean(
    sync &&
    !sync.conflict &&
    sync.baseline !== undefined &&
    normalizeText(item.description) !== normalizeText(sync.baseline),
  );
}

/**
 * Whether the source's text, read when the editor opened, differs from the
 * text both sides last agreed on.
 */
export function sourceDescriptionChanged(
  item: Described,
  source: BacklogSyncedDescription,
) {
  const baseline = item.descriptionSync?.baseline;
  return (
    baseline !== undefined &&
    normalizeText(source.text) !== normalizeText(baseline)
  );
}

/**
 * The most characters the editor saves: what Ajour stores, or less when the
 * source takes less.
 */
export function descriptionLimit(
  capability: BacklogDescriptionCapability | undefined,
) {
  return Math.min(
    BACKLOG_DESCRIPTION_MAX_LENGTH,
    capability?.maxLength ?? BACKLOG_DESCRIPTION_MAX_LENGTH,
  );
}

export type DescriptionAccess =
  | { editable: true }
  | { editable: false; reason: "archived" | "notWritable" | "cut" };

/**
 * Whether the user may edit an item's description, wherever it is edited.
 * A synced description is read-only unless its plugin writes descriptions
 * back, and a cut one always is, so a shortened copy is never written.
 * `capability` is the plugin's, or undefined while it is unknown.
 */
export function descriptionAccess(
  item: Pick<LocalWorkItem, "status" | "descriptionSync">,
  capability: BacklogDescriptionCapability | undefined,
): DescriptionAccess {
  if (item.status === "archived")
    return { editable: false, reason: "archived" };
  const sync = item.descriptionSync;
  if (!sync) return { editable: true };
  if (sync.cut) return { editable: false, reason: "cut" };
  if (!capability?.write) return { editable: false, reason: "notWritable" };
  return { editable: true };
}

/**
 * The description support of the plugin serving a synced item, or undefined
 * when the item is manual, its plugin or connection is gone, its backlog
 * capability is off, or the overview is not known yet.
 */
export function descriptionCapabilityOf(
  item: Pick<LocalWorkItem, "source" | "sourceConnectionId">,
  overview: PluginsOverview | null | undefined,
): BacklogDescriptionCapability | undefined {
  if (item.source === "manual" || !item.sourceConnectionId || !overview) {
    return undefined;
  }
  const group = overview.connectionGroups.find(
    (candidate) => candidate.plugin.id === item.source,
  );
  if (
    !group ||
    !isCapabilityActive(group, "connector") ||
    !group.connections.some(
      (connection) => connection.id === item.sourceConnectionId,
    )
  ) {
    return undefined;
  }
  return group.plugin.capabilities.connector?.description;
}

/**
 * The description after the user took the source's side of a conflict:
 * the source's text, which both sides then agree on.
 */
export function takeSourceDescription(item: Described): Described {
  const sync = item.descriptionSync;
  if (!sync?.conflict) return item;
  const { conflict: _conflict, writeError: _writeError, ...rest } = sync;
  return {
    description: sync.remote || undefined,
    descriptionSync: { ...rest, baseline: sync.remote },
  };
}

/** The items whose description a change put in conflict, oldest first. */
export function newDescriptionConflicts(
  before: readonly LocalWorkItem[],
  after: readonly LocalWorkItem[],
): LocalWorkItem[] {
  const conflicted = new Set(
    before
      .filter((item) => item.descriptionSync?.conflict)
      .map((item) => item._id),
  );
  return after.filter(
    (item) => item.descriptionSync?.conflict && !conflicted.has(item._id),
  );
}

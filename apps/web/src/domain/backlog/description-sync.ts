import {
  isCapabilityActive,
  type BacklogDescriptionCapability,
  type BacklogSyncedDescription,
  type PluginsOverview,
} from "@ajour/shared";
import type {
  LocalWorkItem,
  LocalWorkItemDescriptionSync,
} from "@/domain/local-state";

/**
 * Two-way descriptions of synced backlog items (ADR 0009). Ajour keeps the
 * text both sides last agreed on, so a sync can tell which side changed:
 * one side follows the other, and a change on both is a conflict.
 */

type Described = Pick<LocalWorkItem, "description" | "descriptionSync">;

/**
 * A description as Ajour stores and compares it: Unix line endings, without
 * blank lines or spaces around it, but with a first line's indentation of
 * four spaces or more, which Markdown reads as an indented code block. Every
 * place that saves a description uses it, so texts compare equal when they
 * read the same.
 */
export function normalizeDescriptionText(text: string | undefined) {
  return (
    (text ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/^(?:[ \t]*\n)+/, "")
      // One to three leading spaces mean nothing in Markdown; four start code.
      .replace(/^ {1,3}(?=\S)/, "")
      .trimEnd()
  );
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
    return {
      description: item.description,
      descriptionSync: { baseline, ...sourceFacts(source, remote) },
    };
  }

  const previous = item.descriptionSync?.conflict;
  const sameConflict =
    previous !== undefined &&
    normalizeText(previous.localText) === local &&
    normalizeText(previous.remoteText) === comparedRemote;
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

import { useEffect, useState, useSyncExternalStore } from "react";
import { RiExternalLinkLine as ExternalIcon } from "@remixicon/react";
import type { BacklogSyncedDescription } from "@ajour/shared";
import { Value } from "@/components/ui/value";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  descriptionAccess,
  descriptionCapabilityOf,
  descriptionLimit,
  hasUnwrittenDescription,
  latestDescription,
  lostFormatting,
  normalizeDescriptionText,
  rebaseDescriptionDraft,
  sourceDescriptionChanged,
  type DescriptionAccess,
} from "@/domain/backlog/description-sync";
import { usePluginsOverview } from "@/features/backlog/plugins-overview";
import { useOpenSyncReview } from "@/features/backlog/sync-conflicts";
import { offerUndo } from "@/features/feedback/undo-toast";
import { readBacklogDescription } from "@/lib/app-api";
import {
  isSavingDescription,
  markDescriptionDraftConflict,
  saveSyncedDescription,
  subscribeDescriptionSaving,
} from "@/lib/description-save";
import { localStore } from "@/lib/local-store";

/** Whether the user may edit the item's description, wherever it is edited. */
export function useDescriptionAccess(
  item:
    | Pick<
        LocalWorkItem,
        "status" | "source" | "sourceConnectionId" | "descriptionSync"
      >
    | undefined,
): DescriptionAccess {
  const overview = usePluginsOverview();
  if (!item) return { editable: true };
  return descriptionAccess(item, descriptionCapabilityOf(item, overview));
}

const READ_ONLY_REASONS = {
  notWritable: "Synced from the source, which keeps this description.",
  cut: "Longer than Ajour keeps, so it shows cut off.",
} as const;

function readOnlyReason(
  item: Pick<LocalWorkItem, "descriptionSync">,
  reason: keyof typeof READ_ONLY_REASONS | "lossy",
) {
  return reason === "lossy"
    ? `Editing here would lose its ${lostFormatting(item.descriptionSync?.lost ?? [])}.`
    : READ_ONLY_REASONS[reason];
}

/** Why a synced description is read-only, with a link to edit it in the source. */
export function SyncedDescriptionNote({
  item,
  access,
}: {
  item: Pick<LocalWorkItem, "sourceUrl" | "descriptionSync">;
  access: DescriptionAccess;
}) {
  if (access.editable || access.reason === "archived") return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span>{readOnlyReason(item, access.reason)}</span>
      {item.sourceUrl ? (
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
        >
          Edit in source
          <ExternalIcon className="size-3" aria-hidden="true" />
        </a>
      ) : null}
    </p>
  );
}

type SyncedItem = Pick<
  LocalWorkItem,
  | "_id"
  | "status"
  | "source"
  | "sourceId"
  | "sourceConnectionId"
  | "sourceConnectionLabel"
  | "description"
  | "descriptionSync"
>;

function sourceName(item: Pick<LocalWorkItem, "sourceConnectionLabel">) {
  return item.sourceConnectionLabel ?? "the source";
}

/** Whether saving the item's description writes it to its source. */
export function writesToSource(
  item: Pick<LocalWorkItem, "descriptionSync">,
  access: DescriptionAccess,
) {
  return Boolean(item.descriptionSync) && access.editable;
}

/**
 * The most characters the item's description editor saves, or undefined when
 * it is local: what Ajour stores, or less when the source takes less.
 */
export function useDescriptionLimit(
  item:
    | Pick<LocalWorkItem, "source" | "sourceConnectionId" | "descriptionSync">
    | undefined,
  access: DescriptionAccess,
) {
  const overview = usePluginsOverview();
  return item && writesToSource(item, access)
    ? descriptionLimit(descriptionCapabilityOf(item, overview))
    : undefined;
}

/** Whether a description is longer than its editor saves. */
export function isOverDescriptionLimit(
  text: string,
  limit: number | undefined,
) {
  return limit !== undefined && normalizeDescriptionText(text).length > limit;
}

/** The description's length, from 80% of its limit. Text over it is not saved. */
export function DescriptionLength({
  text,
  limit,
}: {
  text: string;
  limit: number | undefined;
}) {
  if (limit === undefined) return null;
  const length = normalizeDescriptionText(text).length;
  if (length < limit * 0.8) return null;
  const over = length > limit;
  return (
    <p className="mt-1 text-xs">
      <Value tone={over ? "danger" : "muted"}>
        {over ? "Too long to save: " : ""}
        {length.toLocaleString()} / {limit.toLocaleString()}
      </Value>
    </p>
  );
}

/**
 * Saves an edited description locally, then writes it to its source in the
 * background. There is no Undo for the text, which the source then holds;
 * a timelog the text sets a project or task from keeps its own.
 */
export function saveDescriptionToSource(
  itemId: string,
  description: string | undefined,
) {
  offerUndo(localStore.saveWorkItemEdits(itemId, { description }), {
    title: "Project and task set from the description",
    subject: "backlog item",
  });
  void saveSyncedDescription(itemId);
}

/**
 * Takes a change the item's text got under an open draft into the draft, as
 * `rebaseDescriptionDraft` does, and returns the draft to show. A draft the
 * change conflicts with stays, and its save records the conflict.
 */
export function followDescriptionDraft(
  itemId: string,
  base: string,
  draft: string,
  current: string,
) {
  const rebased = rebaseDescriptionDraft(base, draft, current);
  if ("text" in rebased) return rebased.text;
  markDescriptionDraftConflict(itemId, base);
  return draft;
}

/** Whether a save of the item's description is on its way to the source. */
export function useDescriptionSaving(itemId: string) {
  return useSyncExternalStore(subscribeDescriptionSaving, () =>
    isSavingDescription(itemId),
  );
}

/**
 * The source's description, read in the background once `active`: the editor
 * opens at once, and warns when the source changed since the last sync. A
 * failed read shows nothing; saving reads again anyway.
 */
export function useSourceDescriptionCheck(
  item: SyncedItem | undefined,
  active: boolean,
) {
  const [latest, setLatest] = useState<{
    itemId: string;
    description: BacklogSyncedDescription;
  }>();
  const itemId = item?._id;
  const pluginId = item?.source;
  const connectionId = item?.sourceConnectionId;
  const sourceId = item?.sourceId;
  const synced = Boolean(item?.descriptionSync);
  useEffect(() => {
    if (
      !active ||
      !synced ||
      !itemId ||
      !pluginId ||
      pluginId === "manual" ||
      !connectionId ||
      !sourceId
    ) {
      return;
    }
    let current = true;
    readBacklogDescription(pluginId, connectionId, sourceId).then(
      ({ description }) => {
        if (current) setLatest({ itemId, description });
      },
      () => undefined,
    );
    return () => {
      current = false;
      setLatest(undefined);
    };
  }, [active, synced, itemId, pluginId, connectionId, sourceId]);
  return latest && latest.itemId === itemId ? latest.description : undefined;
}

/**
 * The editor's warning that the source changed since the last sync: before
 * the user types, with Load latest; after, saying that saving will merge.
 */
export function SourceChangedWarning({
  item,
  latest,
  typed,
}: {
  item: SyncedItem;
  latest: BacklogSyncedDescription | undefined;
  typed: boolean;
}) {
  if (!latest || !sourceDescriptionChanged(item, latest)) return null;
  const source = latest;
  return (
    <p
      role="status"
      className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
    >
      <span>
        Changed in {sourceName(item)} since the last sync.
        {typed ? " Saving will merge the changes." : ""}
      </span>
      {typed ? null : (
        <button
          type="button"
          className="text-foreground underline-offset-2 hover:underline"
          // Keeps the editor focused, so it stays open.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            localStore.updateSyncedDescription(item._id, () =>
              latestDescription(source),
            )
          }
        >
          Load latest
        </button>
      )}
    </p>
  );
}

/**
 * Where the item's description stands with its source: on its way, in
 * conflict with Resolve, or not written, with why and Retry.
 */
export function DescriptionSaveStatus({
  item,
  access,
}: {
  item: SyncedItem;
  access: DescriptionAccess;
}) {
  const saving = useDescriptionSaving(item._id);
  const openSyncReview = useOpenSyncReview();
  const sync = item.descriptionSync;
  if (!sync) return null;
  const actionClass = "text-foreground underline-offset-2 hover:underline";
  if (saving && access.editable) {
    return (
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        Saving to {sourceName(item)}…
      </p>
    );
  }
  if (sync.conflict) {
    return (
      <p
        role="status"
        className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-destructive"
      >
        <span>Changed in {sourceName(item)} too, in the same lines.</span>
        <button
          type="button"
          className={actionClass}
          onClick={() => void openSyncReview(item._id)}
        >
          Resolve
        </button>
      </p>
    );
  }
  if (access.editable && hasUnwrittenDescription(item)) {
    return (
      <p
        role="status"
        className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-destructive"
      >
        <span>
          Not saved to {sourceName(item)}
          {sync.writeError ? `: ${sync.writeError.message}` : "."}
        </span>
        <button
          type="button"
          className={actionClass}
          onClick={() => void saveSyncedDescription(item._id)}
        >
          Retry
        </button>
      </p>
    );
  }
  return null;
}

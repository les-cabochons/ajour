import { RiExternalLinkLine as ExternalIcon } from "@remixicon/react";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  descriptionAccess,
  descriptionCapabilityOf,
  type DescriptionAccess,
} from "@/domain/backlog/description-sync";
import { usePluginsOverview } from "@/features/backlog/plugins-overview";

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

/** Why a synced description is read-only, with a link to edit it in the source. */
export function SyncedDescriptionNote({
  item,
  access,
}: {
  item: Pick<LocalWorkItem, "sourceUrl">;
  access: DescriptionAccess;
}) {
  if (access.editable || access.reason === "archived") return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span>{READ_ONLY_REASONS[access.reason]}</span>
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

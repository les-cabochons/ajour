import { useSyncExternalStore } from "react";
import { RiFileCopyLine as CopyIcon } from "@remixicon/react";
import {
  PropertyList,
  PropertyRow,
  PropertySection,
} from "@/components/property-list";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { Value } from "@/components/ui/value";
import { getWorkItemKey } from "@/domain/backlog/backlog-item-summary";
import { syncAge } from "@/domain/backlog/sync-freshness";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  changeSourceStateWithUndo,
  getOtherSourceStates,
} from "@/features/backlog/backlog-item-moves";
import { BacklogRefresh } from "@/features/backlog/backlog-refresh";
import { PluginIcon } from "@/features/backlog/work-item-icons";
import {
  getCachedPluginsOverview,
  subscribePluginsOverview,
} from "@/lib/app-api";
import {
  updateBacklogItemCards,
  useBacklogItemCards,
} from "@/lib/backlog-item-cards";
import { copyTextToClipboard } from "@/lib/clipboard";
import { safeSourceUrl } from "@/lib/source-navigation";
import { useNow } from "@/lib/use-now";

/**
 * The source's facts on a synced item, as a section at the end of the
 * properties card (#653), on the item page and in the peek: the item's
 * number with Copy, its type, its source state, who the source assigns it
 * to, the connection and the last sync with the refresh control. The section
 * is titled by the source project, else by the plugin, so core never names a
 * product, and the plugin's icon and the item's number open it in the
 * source. It starts open and this device remembers it closed.
 */
export function BacklogItemSourceSection({ item }: { item: LocalWorkItem }) {
  const overview = useSyncExternalStore(
    subscribePluginsOverview,
    getCachedPluginsOverview,
    getCachedPluginsOverview,
  );
  const { sourceOpen } = useBacklogItemCards();
  const now = useNow();
  if (item.source === "manual") return null;
  const plugin = overview?.plugins.find((p) => p.id === item.source);
  return (
    <SourceSection
      item={item}
      pluginName={plugin?.displayName ?? item.sourceConnectionLabel ?? "Source"}
      pluginIconSvg={plugin?.iconSvg}
      now={now}
      open={sourceOpen}
      onOpenChange={(sourceOpen) => updateBacklogItemCards({ sourceOpen })}
    />
  );
}

/** The section with everything resolved, so a test can render it as is. */
export function SourceSection({
  item,
  pluginName,
  pluginIconSvg,
  now,
  open,
  onOpenChange,
}: {
  item: LocalWorkItem;
  /** The plugin's display name, as the plugins overview gives it. */
  pluginName: string;
  /** The plugin's icon, shown before the item's number. */
  pluginIconSvg?: string;
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Items synced before Ajour kept the number read it from their link until
  // their next sync, so they keep a way to open the source.
  const number = item.sourceExternalId ?? getWorkItemKey(item);
  const sourceUrl = safeSourceUrl(item.sourceUrl);
  // As tall as the number's text, so it reads as one more character.
  const icon = pluginIconSvg ? (
    <PluginIcon svg={pluginIconSvg} className="size-3" />
  ) : null;
  return (
    <PropertySection
      // The project already says where the item lives, and the plugin's icon
      // says which tool; a plugin without projects names itself.
      title={item.sourceProjectName ?? pluginName}
      action={
        number && sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${number} in ${pluginName}`}
            className="inline-flex shrink-0 items-center gap-1 text-source-link hover:underline"
          >
            {icon}
            <Value className="text-source-link">{number}</Value>
          </a>
        ) : number ? (
          <span className="inline-flex shrink-0 items-center gap-1">
            {icon}
            <Value tone="muted">{number}</Value>
          </span>
        ) : undefined
      }
      open={open}
      onOpenChange={onOpenChange}
      indent
    >
      <PropertyList>
        {number ? (
          <PropertyRow label="ID">
            <Value size="base">{number}</Value>
            <TooltipButton
              label="Copy ID"
              render={<Button variant="ghost" size="icon-xs" />}
              onClick={async () => {
                if (await copyTextToClipboard(number)) showToast("ID copied");
              }}
            >
              <CopyIcon aria-hidden />
            </TooltipButton>
          </PropertyRow>
        ) : null}
        {item.sourceWorkItemType ? (
          <PropertyRow label="Type">{item.sourceWorkItemType}</PropertyRow>
        ) : null}
        {item.sourceStatusLabel ? (
          <PropertyRow label="State">
            <Button
              variant="ghost"
              className="property-picker min-w-0 justify-start"
              aria-label={`Change source state of ${item.title}`}
              disabled={getOtherSourceStates(item).length === 0}
              onClick={() => void changeSourceStateWithUndo(item)}
            >
              <span className="min-w-0 truncate">{item.sourceStatusLabel}</span>
            </Button>
          </PropertyRow>
        ) : null}
        {/* Absent when the plugin doesn't say; null when no one has it. */}
        {item.assignee !== undefined ? (
          <PropertyRow label="Assigned to">
            {item.assignee ? (
              <span className="truncate">{item.assignee.displayName}</span>
            ) : (
              <span className="text-muted-foreground">No one</span>
            )}
          </PropertyRow>
        ) : null}
        {item.sourceConnectionLabel ? (
          <PropertyRow label="Connection">
            {item.sourceConnectionLabel}
          </PropertyRow>
        ) : null}
        <PropertyRow label="Synced">
          {/* The value column is narrow: the refresh's status, shown while a
              sync runs or failed, truncates, and its tooltip says it all. */}
          <span className="flex min-w-0 flex-1 items-center gap-1.5 [&_[role=status]]:min-w-0 [&_[role=status]]:truncate">
            <span className="shrink-0">
              {sentenceCase(syncAge(item.sourceSyncedAt, now))}
            </span>
            {item.sourceConnectionId && item.sourceId ? (
              <BacklogRefresh
                source={{
                  pluginId: item.source,
                  connectionId: item.sourceConnectionId,
                  sourceId: item.sourceId,
                  syncedAt: item.sourceSyncedAt,
                }}
              />
            ) : null}
          </span>
        </PropertyRow>
      </PropertyList>
    </PropertySection>
  );
}

/** "just now" as a row value: "Just now". */
function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

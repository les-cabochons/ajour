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
import { syncAge } from "@/domain/backlog/sync-freshness";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  changeSourceStateWithUndo,
  getOtherSourceStates,
} from "@/features/backlog/backlog-item-moves";
import { BacklogRefresh } from "@/features/backlog/backlog-refresh";
import {
  getCachedPluginsOverview,
  subscribePluginsOverview,
} from "@/lib/app-api";
import {
  updateBacklogItemCards,
  useBacklogItemCards,
} from "@/lib/backlog-item-cards";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useNow } from "@/lib/use-now";

/**
 * The source's facts on a synced item, as a section at the end of the
 * properties card (#653), on the item page and in the peek: the item's
 * number with Copy, its type, its source state, the source project, who the
 * source assigns it to, the connection and the last sync with the refresh
 * control. The section is titled by the plugin, so core never names a
 * product; it starts open and this device remembers it closed.
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
      label={plugin?.displayName ?? item.sourceConnectionLabel ?? "Source"}
      now={now}
      open={sourceOpen}
      onOpenChange={(sourceOpen) => updateBacklogItemCards({ sourceOpen })}
    />
  );
}

/** The section with everything resolved, so a test can render it as is. */
export function SourceSection({
  item,
  label,
  now,
  open,
  onOpenChange,
}: {
  item: LocalWorkItem;
  /** The plugin's display name, such as "Azure DevOps". */
  label: string;
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const number = item.sourceExternalId;
  return (
    <PropertySection
      title={label}
      trailing={
        number ? (
          <Value tone="muted" className="ml-auto">
            #{number}
          </Value>
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
        {item.sourceProjectName ? (
          <PropertyRow label="Project">{item.sourceProjectName}</PropertyRow>
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
          <span className="capitalize">
            {syncAge(item.sourceSyncedAt, now)}
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
        </PropertyRow>
      </PropertyList>
    </PropertySection>
  );
}

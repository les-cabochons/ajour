import { useId, type ReactNode } from "react";
import {
  RiExternalLinkLine as ExternalIcon,
  RiLinksLine as SourceIcon,
  RiLockLine as LockIcon,
} from "@remixicon/react";
import { propertyActionClassName } from "@/components/property-list";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { syncAge } from "@/domain/backlog/sync-freshness";
import { sourceNameOf } from "@/domain/projects/source-link";

/*
 * What a managed project shows of its project source (#506): the "From
 * <source>" mark by its title and on its list row, the lock on the fields
 * the source sets, and Open in <source>. The label is the one the plugin's
 * snapshot gave, never a product name Ajour knows (ADR 0016).
 */

/** The mark on a managed project's list row. Like the shared mark, no tooltip. */
export function ManagedProjectMark({ label }: { label: string | undefined }) {
  return (
    <span
      role="img"
      aria-label={`From ${sourceNameOf(label)}`}
      className="inline-flex shrink-0 text-muted-foreground [&_svg]:size-3.5"
    >
      <SourceIcon aria-hidden="true" />
    </span>
  );
}

/** The time of the last sync, as the tooltip and the mark's description say it. */
function lastSyncText(syncedAt: number) {
  return `Last sync ${syncAge(syncedAt, Date.now())} (${new Date(syncedAt).toLocaleString()})`;
}

/** "From <source>" by a managed project's title, its tooltip giving the last sync. */
export function ManagedProjectTitleMark({
  label,
  syncedAt,
}: {
  label: string | undefined;
  syncedAt: number;
}) {
  const descriptionId = useId();
  const lastSync = lastSyncText(syncedAt);
  // The wrapper gives way first when the header is narrow, so it cuts the
  // mark, never the title, and a chip after it stays beside it.
  return (
    <span className="flex min-w-0 shrink-[1000]">
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              role="group"
              aria-label={`From ${sourceNameOf(label)}`}
              aria-describedby={descriptionId}
              className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
            />
          }
        >
          <SourceIcon aria-hidden="true" />
          <span aria-hidden="true" className="min-w-0 truncate">
            From {sourceNameOf(label)}
          </span>
        </TooltipTrigger>
        <TooltipContent>{lastSync}</TooltipContent>
      </Tooltip>
      <span id={descriptionId} hidden>
        {lastSync}
      </span>
    </span>
  );
}

/**
 * A field the project source sets, as text with a lock where an editable
 * field shows its pencil. The lock's tooltip names the source.
 */
export function LockedValue({
  children,
  label,
  muted = false,
}: {
  children: ReactNode;
  /** The source's label. */
  label: string | undefined;
  /** The source gave no value, such as a code: "None", muted. */
  muted?: boolean;
}) {
  return (
    <span className="flex w-full min-w-0 items-center gap-1">
      <span
        className={
          muted ? "min-w-0 truncate text-muted-foreground" : "min-w-0 truncate"
        }
      >
        {children}
      </span>
      {/* No id: the note reads inline, after the value, for a text value
          that has no control to describe. */}
      <LockHint label={label} />
    </span>
  );
}

/** What a locked field says about itself, naming the source. */
export function lockedHintText(label: string | undefined) {
  return `Locked. ${sourceNameOf(label, true)} sets it.`;
}

/**
 * The lock after a field the project source sets. The icon is a hover
 * tooltip only, so it adds no tab stop. A control the lock belongs to points
 * `aria-describedby` at `id`, where the hint sits hidden; without an `id`
 * the hint reads inline, after a text value.
 */
export function LockHint({
  label,
  id,
}: {
  label: string | undefined;
  id?: string;
}) {
  const hint = lockedHintText(label);
  return (
    <>
      {id ? (
        <span id={id} hidden>
          {hint}
        </span>
      ) : (
        <span className="sr-only">{hint}</span>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-hidden="true"
              className="ml-auto inline-flex shrink-0 text-muted-foreground"
            />
          }
        >
          <LockIcon className="size-3" />
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </>
  );
}

/** Open in <source>, as a card action, for a managed project its source gave a URL. */
export function OpenInSourceAction({
  url,
  label,
}: {
  url: string;
  label: string | undefined;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      data-slot="property-action"
      className={propertyActionClassName}
    >
      <ExternalIcon aria-hidden="true" />
      Open in {sourceNameOf(label)}
    </a>
  );
}

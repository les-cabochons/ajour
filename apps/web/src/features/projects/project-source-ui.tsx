import type { ReactNode } from "react";
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
import type { LocalProject, LocalProjectSource } from "@/domain/local-state";

/*
 * What a managed project shows of its project source (#506): the "From
 * <source>" mark by its title and on its list row, the lock on the fields
 * the source sets, and Open in <source>. The label is the one the plugin's
 * snapshot gave, never a product name Ajour knows (ADR 0016).
 */

/** What the user calls the project's source, such as "Example planner". */
export function getManagedProjectSourceLabel(
  project: Pick<LocalProject, "source">,
  projectSources: Readonly<Record<string, LocalProjectSource>> | undefined,
): string | undefined {
  const connectionId = project.source?.connectionId;
  return connectionId ? projectSources?.[connectionId]?.label : undefined;
}

/** The mark on a managed project's list row. Like the shared mark, no tooltip. */
export function ManagedProjectMark({ label }: { label: string | undefined }) {
  return (
    <span
      role="img"
      aria-label={`From ${label ?? "its source"}`}
      className="inline-flex shrink-0 text-muted-foreground [&_svg]:size-3.5"
    >
      <SourceIcon aria-hidden="true" />
    </span>
  );
}

/** The time of the last sync, read when the tooltip opens. */
function LastSync({ syncedAt }: { syncedAt: number }) {
  return (
    <>
      Last sync {syncAge(syncedAt, Date.now())} (
      {new Date(syncedAt).toLocaleString()})
    </>
  );
}

/** "From <source>" by a managed project's title, its tooltip giving the last sync. */
export function ManagedProjectTitleMark({
  label,
  syncedAt,
}: {
  label: string | undefined;
  syncedAt: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground [&_svg]:size-3.5"
          />
        }
      >
        <SourceIcon aria-hidden="true" />
        From {label ?? "its source"}
      </TooltipTrigger>
      <TooltipContent>
        <LastSync syncedAt={syncedAt} />
      </TooltipContent>
    </Tooltip>
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
  /** The value is a placeholder, such as "None". */
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
      <LockHint label={label} />
    </span>
  );
}

/** The lock after a field the project source sets. Its tooltip names the source. */
export function LockHint({ label }: { label: string | undefined }) {
  const hint = `Locked. ${label ?? "Its source"} sets it.`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            role="img"
            aria-label={hint}
            className="ml-auto inline-flex shrink-0 text-muted-foreground"
          />
        }
      >
        <LockIcon aria-hidden="true" className="size-3" />
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
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
      Open in {label ?? "its source"}
    </a>
  );
}

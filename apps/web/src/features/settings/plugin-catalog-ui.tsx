import { useEffect, useState, type ReactNode } from "react";
import {
  RiArrowRightLine as ArrowRight,
  RiPuzzle2Line as Puzzle,
} from "@remixicon/react";
import { AppPanel } from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PluginCatalogEntry } from "@timetracker/shared";

const capabilityDescriptions: Record<string, string> = {
  "estimate-update": "Update remote estimates from decisions made in Ajour.",
  "project-data-shape":
    "Apply a project and task schema while Ajour keeps ownership of the file format.",
  "work-item-sync": "Bring remote work items into Ajour's local backlog.",
};

function titleCaseSlug(value: string) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function capabilityDisplayName(value: string) {
  return value === "project-data-shape" ? "Schema" : titleCaseSlug(value);
}

function tagDisplayName(value: string) {
  return value === "data-shape" ? "Schema" : titleCaseSlug(value);
}

function PluginIdentityMark({
  entry,
  iconSvg,
  className,
  imageClassName,
}: {
  entry: PluginCatalogEntry;
  iconSvg?: string;
  className?: string;
  imageClassName?: string;
}) {
  const thumbnail = entry.images?.thumbnailDataUrl;
  const manifestIcon = iconSvg
    ? `data:image/svg+xml,${encodeURIComponent(iconSvg)}`
    : undefined;
  const preferredSource = thumbnail ?? manifestIcon;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [preferredSource]);

  return (
    <span
      className={cn(
        "relative inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-[var(--surface-low)] text-foreground",
        className,
      )}
      aria-hidden="true"
    >
      {preferredSource && !imageFailed ? (
        <img
          className={cn("size-full object-cover", imageClassName)}
          src={preferredSource}
          alt=""
          onError={() => setImageFailed(true)}
        />
      ) : (
        <>
          <Puzzle className="size-[46%] text-muted-foreground" />
          <span className="absolute right-1 bottom-0.5 font-mono text-[9px] font-semibold text-foreground/70 uppercase">
            {entry.title.charAt(0)}
          </span>
        </>
      )}
    </span>
  );
}

function PluginCapabilityBand({ entry }: { entry: PluginCatalogEntry }) {
  const [heroFailed, setHeroFailed] = useState(false);
  const hero = entry.images?.heroDataUrl;
  useEffect(() => setHeroFailed(false), [hero]);

  if (hero && !heroFailed) {
    return (
      <div className="min-h-40 overflow-hidden rounded-lg border border-border/70 bg-[var(--surface-low)] sm:aspect-[16/5]">
        <img
          className="size-full min-h-40 object-cover"
          src={hero}
          alt={`${entry.title} plugin artwork`}
          onError={() => setHeroFailed(true)}
        />
      </div>
    );
  }

  const startLabel = entry.type === "connector" ? "External service" : "Ajour projects";
  const endLabel = entry.type === "connector" ? "Local backlog" : "Excel files";

  return (
    <AppPanel
      as="section"
      className="min-h-40 justify-center gap-5 overflow-hidden bg-[var(--surface-low)] p-5 sm:aspect-[16/5]"
      aria-label={`${entry.title} capability overview`}
    >
      <div className="flex min-w-0 items-center justify-center gap-2 text-xs text-muted-foreground sm:gap-4 sm:text-sm">
        <span className="min-w-0 rounded-[var(--control-radius)] border border-border/70 bg-background px-2.5 py-2 text-center sm:px-4">
          {startLabel}
        </span>
        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 rounded-[var(--control-radius)] border border-border/70 bg-background px-2.5 py-2 text-center font-medium text-foreground sm:px-4">
          {entry.title}
        </span>
        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 rounded-[var(--control-radius)] border border-border/70 bg-background px-2.5 py-2 text-center sm:px-4">
          {endLabel}
        </span>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {entry.capabilities.map((capability) => (
          <Badge key={capability} variant="outline">
            {capabilityDisplayName(capability)}
          </Badge>
        ))}
      </div>
    </AppPanel>
  );
}

function PluginCapabilityList({ entry }: { entry: PluginCatalogEntry }) {
  return (
    <div className="divide-y divide-border/60 border-y border-border/60">
      {entry.capabilities.map((capability) => (
        <div key={capability} className="flex items-start gap-3 py-4">
          <span
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-[var(--surface-low)]"
            aria-hidden="true"
          >
            <Puzzle className="size-4 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {capabilityDisplayName(capability)}
            </p>
            <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
              {capabilityDescriptions[capability] ??
                `Adds ${capabilityDisplayName(capability).toLowerCase()} support to Ajour.`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExternalValue({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="w-fit rounded-[var(--control-radius)] font-medium text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      {children}
    </a>
  );
}

function PluginInfoLedger({
  entry,
  version,
}: {
  entry: PluginCatalogEntry;
  version?: string;
}) {
  const rows: Array<[string, ReactNode]> = [
    ["Author", <ExternalValue href={entry.author.url}>{entry.author.name}</ExternalValue>],
    ["Type", entry.type === "connector" ? "Connector" : "Plugin"],
    ["License", <ExternalValue href={entry.license.url}>{entry.license.name}</ExternalValue>],
    [
      "Compatibility",
      <span className="font-mono text-xs">Plugin API {entry.compatibility.pluginApiVersion}</span>,
    ],
    ...(version
      ? [["Version", <span className="font-mono text-xs">{version}</span>] as [string, ReactNode]]
      : []),
    ["Website", <ExternalValue href={entry.website}>Visit website</ExternalValue>],
    [
      "Repository",
      <ExternalValue href={entry.repository.url}>{entry.repository.slug}</ExternalValue>,
    ],
    [
      "Tags",
      <span className="flex flex-wrap gap-1.5">
        {entry.tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tagDisplayName(tag)}
          </Badge>
        ))}
      </span>,
    ],
  ];

  return (
    <dl className="border-y border-border/60">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-1 border-b border-border/60 py-3 last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4"
        >
          <dt className="text-xs text-[var(--text-tertiary)]">{label}</dt>
          <dd className="min-w-0 text-sm text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export {
  PluginCapabilityBand,
  PluginCapabilityList,
  PluginIdentityMark,
  PluginInfoLedger,
  titleCaseSlug,
};

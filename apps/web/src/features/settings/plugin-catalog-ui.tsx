import { useEffect, useState, type ReactNode } from "react";
import {
  RiArrowRightLine as ArrowRight,
  RiPuzzle2Line as Puzzle,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  PLUGIN_API_VERSION,
  comparePluginVersions,
  isSignedPlugin,
  type PluginCatalogCapability,
  type PluginCatalogEntry,
  type PluginOrigin,
  type PluginOverviewItem,
} from "@ajour/shared";

const featureDescriptions: Record<string, string> = {
  "estimate-update": "Update remote estimates from decisions made in Ajour.",
  "project-data-shape":
    "Apply a project and task schema while Ajour keeps ownership of the file format.",
  "project-sync": "Keep shared projects and tasks in step with your team.",
  "pull-requests": "Sync pull requests you authored or were asked to review.",
  "calendar-events":
    "Suggest your calendar's meetings as time entries. Read-only.",
  "work-item-sync": "Bring remote items into Ajour's local backlog.",
};

const capabilityLabels: Record<PluginCatalogCapability, string> = {
  connector: "Backlog",
  codeHost: "Code host",
  calendar: "Calendar",
  team: "Team",
  agentTask: "Agent tasks",
  schema: "Schema",
};

/** "Backlog", or "Backlog · Code host" for a plugin with both. */
export function pluginCapabilitiesLabel(entry: PluginCatalogEntry) {
  return entry.capabilities
    .map((capability) => capabilityLabels[capability])
    .join(" · ");
}

/** Whether this Ajour version can install the plugin's package. */
export function canInstallCatalogPlugin(entry: PluginCatalogEntry) {
  return (
    entry.capabilities.includes("connector") ||
    entry.capabilities.includes("codeHost") ||
    entry.capabilities.includes("calendar") ||
    entry.capabilities.includes("team") ||
    entry.capabilities.includes("agentTask")
  );
}

/**
 * Whether downloading the catalog package again would replace an installed
 * package this Ajour version cannot run. A catalog entry built for another
 * plugin API would install the same problem, so it does not count.
 */
export function canUpdateFromCatalog(entry: PluginCatalogEntry) {
  return (
    entry.status === "available" &&
    entry.install !== undefined &&
    canInstallCatalogPlugin(entry) &&
    entry.compatibility.pluginApiVersion === PLUGIN_API_VERSION
  );
}

/**
 * Whether the catalog offers an installed plugin an update: a compatible
 * package over one this Ajour cannot run, a newer version, or a signed
 * replacement at the same version for a file or legacy install. A plugin
 * already owned by a source is only updated from that source.
 */
export function catalogOffersUpdate(
  entry: PluginCatalogEntry,
  plugin: Pick<PluginOverviewItem, "version" | "unavailableReason" | "origin">,
) {
  if (!canUpdateFromCatalog(entry)) return false;
  if (
    plugin.origin?.sourceUrl !== undefined &&
    entry.source?.url !== plugin.origin.sourceUrl
  ) {
    return false;
  }
  const versionOrder = comparePluginVersions(entry.version, plugin.version);
  const signedReplacement =
    (plugin.origin === undefined || plugin.origin.kind === "file") &&
    !isSignedPlugin(plugin) &&
    entry.source?.signed === true &&
    versionOrder === 0;
  return (
    plugin.unavailableReason !== undefined ||
    versionOrder > 0 ||
    signedReplacement
  );
}

/**
 * Whether Ajour vouches for the plugin: an installed one by where it came
 * from, one not installed yet by its source's signature.
 */
export function isEntrySigned(
  entry: PluginCatalogEntry,
  installed?: Pick<PluginOverviewItem, "origin">,
) {
  return installed ? isSignedPlugin(installed) : entry.source?.signed === true;
}

/** The plain "Unsigned" mark, beside a plugin's status. */
export function UnsignedBadge() {
  return (
    <Badge
      variant="outline"
      title="Ajour can't check who made this plugin or that nobody changed it."
    >
      Unsigned
    </Badge>
  );
}

const capabilityFlows: Record<
  PluginCatalogCapability,
  { start: string; end: string }
> = {
  connector: { start: "External service", end: "Local backlog" },
  codeHost: { start: "Code host", end: "Pull requests" },
  calendar: { start: "Calendar", end: "Time suggestions" },
  team: { start: "Ajour projects", end: "Team" },
  agentTask: { start: "Task prompt", end: "Coding agent" },
  schema: { start: "Ajour projects", end: "Excel files" },
};

function titleCaseSlug(value: string) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function featureDisplayName(value: string) {
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
      <div className="min-h-40 overflow-hidden rounded-lg bg-[var(--surface-low)] desktop:aspect-[16/5]">
        <img
          className="size-full min-h-40 object-cover"
          src={hero}
          alt={`${entry.title} plugin artwork`}
          onError={() => setHeroFailed(true)}
        />
      </div>
    );
  }

  const flow = capabilityFlows[entry.capabilities[0] ?? "connector"];
  const startLabel = flow.start;
  const endLabel = flow.end;

  // Without artwork the band is a plain line of text: where data comes
  // from, the plugin, and where it lands.
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={`${entry.title} capability overview`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span className="min-w-0">{startLabel}</span>
        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 font-medium text-foreground">
          {entry.title}
        </span>
        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">{endLabel}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {entry.features.map((feature) => (
          <Badge key={feature} variant="outline">
            {featureDisplayName(feature)}
          </Badge>
        ))}
      </div>
    </section>
  );
}

function PluginCapabilityList({ entry }: { entry: PluginCatalogEntry }) {
  return (
    <div className="flex flex-col gap-4">
      {entry.features.map((feature) => (
        <div key={feature} className="flex items-start gap-3">
          <Puzzle
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {featureDisplayName(feature)}
            </p>
            <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
              {featureDescriptions[feature] ??
                `Adds ${featureDisplayName(feature).toLowerCase()} support to Ajour.`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExternalValue({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
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

/** Where an installed plugin came from, or the source that lists it. */
function sourceValue(
  entry: PluginCatalogEntry,
  origin?: PluginOrigin,
): ReactNode {
  if (origin?.kind === "file") return "Installed from a file";
  const url = origin?.sourceUrl ?? entry.source?.url;
  const name = origin?.sourceName ?? entry.source?.name;
  if (!url) return "Not listed by a plugin source";
  const official = origin?.official ?? entry.source?.official;
  return (
    <ExternalValue href={url}>
      {name ?? url}
      {official ? " (official)" : ""}
    </ExternalValue>
  );
}

function signatureValue(
  entry: PluginCatalogEntry,
  installed?: Pick<PluginOverviewItem, "origin">,
) {
  const signed = isEntrySigned(entry, installed);
  const fingerprint = installed
    ? installed.origin?.keyFingerprint
    : entry.source?.keyFingerprint;
  return signed ? (
    <span>
      Signed{fingerprint ? " · key " : ""}
      {fingerprint ? (
        <span className="font-mono text-xs">{fingerprint}</span>
      ) : null}
    </span>
  ) : (
    "Unsigned"
  );
}

function PluginInfoList({
  entry,
  version,
  installed,
}: {
  entry: PluginCatalogEntry;
  version?: string;
  /** The installed plugin, whose origin says where it came from. */
  installed?: Pick<PluginOverviewItem, "origin">;
}) {
  const rows: Array<[string, ReactNode]> = [
    [
      "Author",
      <ExternalValue href={entry.author.url}>
        {entry.author.name}
      </ExternalValue>,
    ],
    ["Capabilities", pluginCapabilitiesLabel(entry)],
    [
      "License",
      entry.license.url ? (
        <ExternalValue href={entry.license.url}>
          {entry.license.name}
        </ExternalValue>
      ) : (
        entry.license.name
      ),
    ],
    [
      "Compatibility",
      <span className="font-mono text-xs">
        Plugin API {entry.compatibility.pluginApiVersion}
      </span>,
    ],
    ...(version
      ? [
          ["Version", <span className="font-mono text-xs">{version}</span>] as [
            string,
            ReactNode,
          ],
        ]
      : []),
    ["Source", sourceValue(entry, installed?.origin)],
    ["Signature", signatureValue(entry, installed)],
    ...(entry.website
      ? [
          [
            "Website",
            <ExternalValue href={entry.website}>Visit website</ExternalValue>,
          ] as [string, ReactNode],
        ]
      : []),
    ...(entry.repository
      ? [
          [
            "Repository",
            <ExternalValue href={entry.repository.url}>
              {entry.repository.slug}
            </ExternalValue>,
          ] as [string, ReactNode],
        ]
      : []),
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
    <dl className="flex flex-col gap-3">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-1 desktop:grid-cols-[8rem_minmax(0,1fr)] desktop:gap-4"
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
  PluginInfoList,
  titleCaseSlug,
};

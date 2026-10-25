import {
  RiArrowRightSLine as ChevronRight,
  RiCpuLine as Cpu,
  RiErrorWarningLine as Warning,
  RiGlobalLine as Globe,
  RiKey2Line as Key,
  RiPuzzleLine as Puzzle,
  RiRobot2Line as Robot,
} from "@remixicon/react";
import type { PluginOverviewGroup } from "@ajour/shared";
import { MessagePanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  describeAccess,
  describeBlockedAttempts,
  describeLastRequest,
  describeLegacyAccess,
  type AccessItem,
  type AccessItemKind,
  type AccessLabels,
} from "@/domain/plugins/plugin-access-model";

const KIND_ICON: Record<AccessItemKind, typeof Globe> = {
  capability: Puzzle,
  network: Globe,
  credential: Key,
  agent: Robot,
  runtime: Cpu,
};

/** The plugin API that declares what a plugin reaches. */
const FIRST_LIMITED_PLUGIN_API = 4;

function labelsOf(group: PluginOverviewGroup): AccessLabels {
  return {
    fields: group.plugin.connectionFields,
    tasks: group.plugin.capabilities.agentTask?.tasks ?? [],
  };
}

/** Whether the plugin's access is limited and listed, as plugin API 4 makes it. */
export function hasListedAccess(group: PluginOverviewGroup) {
  return group.plugin.apiVersion >= FIRST_LIMITED_PLUGIN_API && !!group.access;
}

function EndpointDisclosure({ item }: { item: AccessItem }) {
  const endpoints = item.endpoints ?? [];
  if (endpoints.length === 0) return null;
  return (
    <details className="group mt-1 text-xs text-[var(--text-tertiary)]">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 transition-transform group-open:rotate-90"
        />
        {endpoints.length} endpoint{endpoints.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5 pl-4 font-mono">
        {endpoints.map((endpoint) => (
          <li
            key={`${endpoint.text}|${endpoint.gate ?? ""}`}
            className="flex flex-wrap items-center gap-x-2 [overflow-wrap:anywhere]"
          >
            <span>{endpoint.text}</span>
            {endpoint.gate ? (
              <span className="font-sans">· {endpoint.gate}</span>
            ) : null}
            {endpoint.isNew ? (
              <Chip tone="accent" className="font-sans">
                New
              </Chip>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The access list, as the prototype's variant A drew it (#222): an icon, a
 * plain title and detail, and the endpoints of a host behind a disclosure.
 * `label` names the list for assistive technology.
 */
function AccessList({ items, label }: { items: AccessItem[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind];
        return (
          <li
            key={item.id}
            data-access-item={item.id}
            className="flex items-start gap-3"
          >
            <Icon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium [overflow-wrap:anywhere] text-foreground">
                {item.title}
                {item.isNew ? <Chip tone="accent">New</Chip> : null}
                {item.hasNewEndpoints ? (
                  <Chip tone="accent">New endpoints</Chip>
                ) : null}
              </p>
              <p className="text-[13px] text-[var(--text-secondary)]">
                {item.detail}
              </p>
              <EndpointDisclosure item={item} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Access section of an installed plugin's page, before Features: what it
 * reaches, its credential, its agent tasks and its start mode, then the
 * broker's last request and any attempt to connect directly. A plugin built
 * for plugin API 3 lists what it can do without limits, because nothing
 * declares otherwise. An update waiting for consent marks what is new.
 */
export function PluginAccessSection({
  group,
  now,
}: {
  group: PluginOverviewGroup;
  now: number;
}) {
  const labels = labelsOf(group);
  const listed = hasListedAccess(group);
  const items =
    listed && group.access
      ? describeAccess(group.access, labels, {
          difference: group.pendingAccess?.difference,
        })
      : describeLegacyAccess(labels);
  const blocked = describeBlockedAttempts(group.accessActivity, now);

  return (
    <section className="settings-section" aria-labelledby="plugin-access">
      <h2 id="plugin-access" className="settings-section-title">
        Access
      </h2>
      <p className="settings-section-desc">
        {listed
          ? "What this plugin can reach. Ajour enforces it: anything else is blocked."
          : "This plugin was built for an older plugin API, so Ajour can't limit it. Update it to move it onto one that does."}
      </p>
      {listed ? (
        <p className="text-[13px] text-muted-foreground" data-access-activity>
          {describeLastRequest(group.accessActivity, now)}
        </p>
      ) : null}
      <AccessList items={items} label="Access" />
      {blocked ? (
        <p
          className="flex items-start gap-2 text-[13px] text-[var(--warning)]"
          data-access-blocked
        >
          <Warning aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{blocked}</span>
        </p>
      ) : null}
    </section>
  );
}

/**
 * The warning an update that reaches more shows on the plugin's page: the
 * version, only the new items marked New, and the one action that allows
 * them and turns the plugin on.
 */
export function PluginAccessUpdatePanel({
  group,
  disabled,
  onAllow,
}: {
  group: PluginOverviewGroup;
  disabled: boolean;
  onAllow: () => void;
}) {
  const { pendingAccess, access } = group;
  if (!pendingAccess || !access) return null;
  const items = describeAccess(access, labelsOf(group), {
    difference: pendingAccess.difference,
    onlyNew: true,
  });
  return (
    <MessagePanel tone="warning" data-access-update>
      <p className="font-medium">
        Version {pendingAccess.version} needs more access
      </p>
      <p>
        It stays inactive until you allow it. Your connections and settings are
        kept.
      </p>
      <div className="mt-3">
        <AccessList items={items} label="New access" />
      </div>
      <div className="mt-3 flex gap-2">
        <Button disabled={disabled} onClick={onAllow}>
          Allow and activate
        </Button>
      </div>
    </MessagePanel>
  );
}

/**
 * What a catalog plugin's page says about access before it is downloaded.
 * The catalog doesn't carry a plugin's hosts, so the page says where they
 * will be and that turning the plugin on is the consent.
 */
export function CatalogAccessSection({
  pluginApiVersion,
  canDownload,
}: {
  pluginApiVersion: number;
  canDownload: boolean;
}) {
  return (
    <section className="settings-section" aria-labelledby="plugin-access">
      <h2 id="plugin-access" className="settings-section-title">
        Access
      </h2>
      <p className="settings-section-desc">
        {pluginApiVersion >= FIRST_LIMITED_PLUGIN_API
          ? "The addresses it reaches, the credential it uses, its agent tasks and how it starts are listed here once you download it."
          : "This plugin is built for an older plugin API, which Ajour can't limit. Its entry lists no addresses."}
      </p>
      {canDownload ? (
        <p className="text-[13px] text-muted-foreground">
          After the download the plugin stays inactive. Turning it on allows the
          access listed on its page.
        </p>
      ) : null}
    </section>
  );
}

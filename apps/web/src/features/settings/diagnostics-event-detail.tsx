import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  RiFileCopyLine as CopyIcon,
  RiFilter3Line as FilterIcon,
  RiNodeTree as TraceIcon,
  RiRestartLine as LaunchIcon,
} from "@remixicon/react";
import {
  PropertyAction,
  PropertyList,
  PropertyRow,
} from "@/components/property-list";
import { SectionHeading } from "@/components/section-heading";
import { Value } from "@/components/ui/value";
import { usePluginsOverview } from "@/features/backlog/plugins-overview";
import type { LoggedEvent } from "@/lib/desktop-bridge";
import { localStore } from "@/lib/local-store";
import {
  domainFieldsOf,
  formatEventDuration,
  hiddenSensitiveFields,
  joinedNameOf,
  type EventDisplayNames,
} from "./diagnostics-events-model";
import { OutcomeDot } from "./diagnostics-event-table";

/** What a sensitive field the file doesn't hold shows instead of its value. */
export const HIDDEN_SENSITIVE = "hidden · sensitive fields are off";

/**
 * Names from Ajour's own data for the IDs an event holds: connections and
 * plugins from the plugins overview, backlog items and projects from the
 * local store. They are joined at display time and never reach the log.
 */
export function useEventDisplayNames(): EventDisplayNames {
  const overview = usePluginsOverview();
  const workItems = useSyncExternalStore(
    localStore.subscribe,
    () => localStore.snapshot().workItems,
  );
  const projects = useSyncExternalStore(
    localStore.subscribe,
    () => localStore.snapshot().projects,
  );
  return useMemo(() => {
    const groups = overview?.connectionGroups ?? [];
    return {
      connections: new Map(
        groups.flatMap((group) =>
          group.connections.map((connection) => [
            connection.id,
            connection.label,
          ]),
        ),
      ),
      plugins: new Map(
        [
          ...(overview?.plugins ?? []),
          ...groups.map((group) => group.plugin),
        ].map((plugin) => [plugin.id, plugin.displayName]),
      ),
      backlogItems: new Map(workItems.map((item) => [item._id, item.title])),
      projects: new Map(
        projects.map((project) => [
          project._id,
          project.displayName ?? project.name,
        ]),
      ),
    };
  }, [overview, workItems, projects]);
}

function Hidden() {
  return (
    <span className="text-xs text-muted-foreground">{HIDDEN_SENSITIVE}</span>
  );
}

/** An ID, with the name Ajour knows for it after it. */
function IdValue({ id, name }: { id: string; name?: string }) {
  return (
    <>
      <Value className="truncate">{id}</Value>
      {name ? (
        <span className="truncate text-xs text-muted-foreground">{name}</span>
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <PropertyRow label={<span className="truncate text-xs">{label}</span>}>
      {children}
    </PropertyRow>
  );
}

/**
 * The selected event: its actions, then its envelope, its own fields,
 * `steps`, `step_failures` and `counts`. Connection, plugin, item and project
 * IDs show the names Ajour knows for them; Copy JSON copies the event as
 * stored, without them.
 */
export function EventDetail({
  event,
  names,
  includeSensitive,
  onShowTrace,
  onSameName,
  onSameLaunch,
  onCopyJson,
}: {
  event: LoggedEvent;
  names: EventDisplayNames;
  includeSensitive: boolean;
  onShowTrace: () => void;
  onSameName: () => void;
  onSameLaunch: () => void;
  onCopyJson: () => void;
}) {
  const fields = domainFieldsOf(event);
  const hidden = hiddenSensitiveFields(event, includeSensitive);
  const hiddenFields = hidden.filter((path) => path !== "error.message");
  const steps = event.steps ?? [];
  const failures = event.step_failures ?? [];
  const counts = Object.entries(event.counts ?? {});
  const { app, device, error } = event;

  return (
    <section aria-label="Event details" className="flex min-w-0 flex-col">
      <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <OutcomeDot outcome={event.outcome} />
        <span className="truncate">{event.name}</span>
      </h3>
      <div className="mt-2 mb-3 flex flex-wrap items-center gap-1 [&>*:first-child]:-ml-2">
        <PropertyAction onClick={onShowTrace}>
          <TraceIcon aria-hidden />
          Show trace
        </PropertyAction>
        <PropertyAction onClick={onSameName}>
          <FilterIcon aria-hidden />
          Same name
        </PropertyAction>
        <PropertyAction onClick={onSameLaunch}>
          <LaunchIcon aria-hidden />
          Same launch
        </PropertyAction>
        <PropertyAction onClick={onCopyJson}>
          <CopyIcon aria-hidden />
          Copy JSON
        </PropertyAction>
      </div>

      <SectionHeading>Envelope</SectionHeading>
      <PropertyList>
        <Row label="Outcome">
          <span>{event.outcome}</span>
          {event.outcome_reason ? (
            <span className="truncate text-xs text-muted-foreground">
              {event.outcome_reason}
            </span>
          ) : null}
        </Row>
        <Row label="Kind">{event.kind}</Row>
        <Row label="Runtime">{event.runtime}</Row>
        <Row label="Started">
          <Value className="truncate">{event.started_at}</Value>
        </Row>
        <Row label="Duration">
          <Value>{formatEventDuration(event.duration_ms)}</Value>
        </Row>
        <Row label="Trigger">
          {event.trigger}
          {event.surface ? (
            <span className="text-xs text-muted-foreground">
              {event.surface}
            </span>
          ) : null}
        </Row>
        <Row label="Trace">
          <Value className="truncate">{event.trace_id}</Value>
        </Row>
        <Row label="Span">
          <Value className="truncate">{event.span_id}</Value>
        </Row>
        {event.parent_span_id ? (
          <Row label="Parent span">
            <Value className="truncate">{event.parent_span_id}</Value>
          </Row>
        ) : null}
        <Row label="Launch">
          <Value className="truncate">{event.launch_id}</Value>
        </Row>
        {event.window_id ? (
          <Row label="Window">
            <Value className="truncate">{event.window_id}</Value>
          </Row>
        ) : null}
        {app ? (
          <Row label="App">
            <Value className="truncate">
              {[app.version, app.channel, app.commit]
                .filter(Boolean)
                .join(" · ")}
            </Value>
          </Row>
        ) : null}
        {device ? (
          <Row label="Device">
            <span className="truncate">
              {[device.platform, device.arch, device.electron]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Row>
        ) : null}
        {error ? (
          <>
            <Row label="Error">
              <span className="truncate">
                {[error.type, error.code].filter(Boolean).join(" · ")}
              </span>
            </Row>
            <Row label="Message">
              {error.message !== undefined ? (
                <span className="truncate text-xs">{error.message}</span>
              ) : hidden.includes("error.message") ? (
                <Hidden />
              ) : null}
            </Row>
          </>
        ) : null}
      </PropertyList>

      {fields.length > 0 || hiddenFields.length > 0 ? (
        <>
          <SectionHeading>Fields</SectionHeading>
          <PropertyList>
            {fields.map(({ path, value }) => (
              <Row key={path} label={path}>
                <IdValue id={value} name={joinedNameOf(path, value, names)} />
              </Row>
            ))}
            {hiddenFields.map((path) => (
              <Row key={path} label={path}>
                <Hidden />
              </Row>
            ))}
          </PropertyList>
        </>
      ) : null}

      {steps.length > 0 ? (
        <>
          <SectionHeading
            trailing={
              <Value tone="muted">
                {steps.length + (event.dropped_step_count ?? 0)}
              </Value>
            }
          >
            Steps
          </SectionHeading>
          <ol className="flex flex-col text-sm" aria-label="Steps">
            {steps.map((step, index) => (
              <li
                key={`${index}:${step}`}
                className="flex min-h-7 items-center"
              >
                <span className="truncate">{step}</span>
              </li>
            ))}
            {event.dropped_step_count ? (
              <li className="flex min-h-7 items-center text-xs text-muted-foreground">
                {`and ${event.dropped_step_count} more`}
              </li>
            ) : null}
          </ol>
        </>
      ) : null}

      {failures.length > 0 ? (
        <>
          <SectionHeading
            trailing={<Value tone="muted">{failures.length}</Value>}
          >
            Step failures
          </SectionHeading>
          <ul className="flex flex-col text-sm" aria-label="Step failures">
            {failures.map((failure, index) => (
              <li
                key={`${index}:${failure.name}`}
                className="flex min-h-7 min-w-0 items-center gap-2"
              >
                <OutcomeDot outcome={failure.outcome} />
                <span className="truncate">{failure.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[
                    failure.outcome,
                    failure.outcome_reason,
                    failure.error_type,
                    failure.error_code,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {counts.length > 0 ? (
        <>
          <SectionHeading>Counts</SectionHeading>
          <PropertyList aria-label="Counts">
            {counts.map(([name, count]) => (
              <Row key={name} label={name}>
                <Value>{count}</Value>
              </Row>
            ))}
          </PropertyList>
        </>
      ) : null}
    </section>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import { MessagePanel } from "@/components/app-surface";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { Toggle } from "@/components/ui/toggle";
import { Value } from "@/components/ui/value";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { LoggedEvent } from "@/lib/desktop-bridge";
import { desktopLaunchId } from "@/lib/wide-events";
import { EventDetail, useEventDisplayNames } from "./diagnostics-event-detail";
import { EventTable } from "./diagnostics-event-table";
import {
  EVENT_KINDS,
  EVENT_RANGES,
  EVENT_RUNTIMES,
  describeQueryError,
  eventKey,
  eventsSearchOf,
  formatQuery,
  logFilterOf,
  parseEventsView,
  parseQuery,
  type EventRange,
  type EventsView,
} from "./diagnostics-events-model";
import {
  SettingsLink,
  useOpenSettings,
  useSettingsSearch,
} from "./settings-link";
import { useLocalLogs } from "./use-local-logs";
import { useLogEvents } from "./use-log-events";

const ANY = "any";

const LAUNCH_LABELS: Record<string, string> = {
  this: "This launch",
  all: "All launches",
};

/** One filter chip: its name, its value, and a menu of the choices. */
function FilterMenu({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const current =
    choices.find((choice) => choice.value === value)?.label ?? value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" />}
        aria-label={`${label}: ${current}`}
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="max-w-40 truncate">{current}</span>
        <ChevronDown data-icon="inline-end" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto" aria-label={label}>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(String(next))}
        >
          {choices.map((choice) => (
            <DropdownMenuRadioItem
              key={choice.value}
              value={choice.value}
              closeOnClick
            >
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The query box: Enter applies its terms, Escape puts the applied ones back. */
function QueryBox({
  view,
  onApply,
}: {
  view: EventsView;
  onApply: (terms: EventsView["terms"]) => void;
}) {
  const applied = formatQuery(view.terms);
  const [draft, setDraft] = useState(applied);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(applied);
    setError(null);
  }, [applied]);

  return (
    <div className="flex min-w-60 flex-1 flex-col gap-1">
      <Input
        type="search"
        aria-label="Query"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "diagnostics-query-error" : undefined}
        placeholder="name:backlog.sync outcome:error trace: connection: plugin:"
        value={draft}
        onChange={(changeEvent) => {
          setDraft(changeEvent.target.value);
          setError(null);
        }}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === "Enter") {
            keyEvent.preventDefault();
            const parsed = parseQuery(draft);
            if (parsed.ok) onApply(parsed.terms);
            else setError(describeQueryError(parsed.error));
          } else if (keyEvent.key === "Escape" && draft !== applied) {
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            setDraft(applied);
            setError(null);
          }
        }}
      />
      {error ? (
        <p id="diagnostics-query-error" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function EventsEmpty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Empty align="start" className="border-b">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/**
 * Diagnostics > Events (#443): the local log file's events, filtered by the
 * chips and the query box, which live in the page's search so links open the
 * tab filtered. Selecting a row shows the event beside the list.
 */
export function DiagnosticsEventsTab() {
  const search = useSettingsSearch();
  const openSettings = useOpenSettings();
  const { status } = useLocalLogs();
  const searchKey = JSON.stringify(eventsSearchOf(parseEventsView(search)));
  const view = useMemo(
    () => parseEventsView(JSON.parse(searchKey) as Record<string, string>),
    [searchKey],
  );
  // "Now" moves when the filter does, so a range starts when it is chosen
  // and the rows' times don't re-render on their own.
  const now = useMemo(() => Date.now(), [searchKey]);
  const launchId = useMemo(() => desktopLaunchId(), []);
  const filter = useMemo(
    () => logFilterOf(view, { now, launchId }),
    [view, now, launchId],
  );
  const [live, setLive] = useState(false);
  const events = useLogEvents(filter, live);
  const [selected, setSelected] = useState<LoggedEvent | null>(null);
  const names = useEventDisplayNames();

  const show = useCallback(
    (next: EventsView) =>
      void openSettings(
        {
          page: "diagnostics",
          search: { tab: "events", ...eventsSearchOf(next) },
        },
        { replace: true },
      ),
    [openSettings],
  );

  const loggingOff = status?.settings.enabled === false;
  const includeSensitive = status?.settings.include_sensitive === true;

  const copyJson = async (event: LoggedEvent) => {
    // The event exactly as main read it from the file: no joined names.
    const copied = await copyTextToClipboard(JSON.stringify(event, null, 2));
    showToast(copied ? "Copied the event's JSON." : "Couldn't copy the event.");
  };

  const toolbar = (
    <div
      role="toolbar"
      aria-label="Event filters"
      className="flex flex-wrap items-center gap-2"
    >
      <Toggle
        variant="outline"
        size="sm"
        pressed={view.problems}
        onPressedChange={(problems) => show({ ...view, problems })}
      >
        Problems only
      </Toggle>
      <FilterMenu
        label="Runtime"
        value={view.runtime ?? ANY}
        choices={[
          { value: ANY, label: "Any" },
          ...EVENT_RUNTIMES.map((runtime) => ({
            value: runtime,
            label: runtime,
          })),
        ]}
        onChange={(runtime) =>
          show({
            ...view,
            runtime: EVENT_RUNTIMES.find((value) => value === runtime),
          })
        }
      />
      <FilterMenu
        label="Kind"
        value={view.kind ?? ANY}
        choices={[
          { value: ANY, label: "Any" },
          ...EVENT_KINDS.map((kind) => ({ value: kind, label: kind })),
        ]}
        onChange={(kind) =>
          show({ ...view, kind: EVENT_KINDS.find((value) => value === kind) })
        }
      />
      <FilterMenu
        label="Launch"
        value={view.launch}
        choices={[
          { value: "this", label: LAUNCH_LABELS.this! },
          { value: "all", label: LAUNCH_LABELS.all! },
          ...(view.launch in LAUNCH_LABELS
            ? []
            : [{ value: view.launch, label: `Launch ${view.launch}` }]),
        ]}
        onChange={(launch) => show({ ...view, launch })}
      />
      <FilterMenu
        label="Time"
        value={view.range ?? ANY}
        choices={[
          { value: ANY, label: "Any time" },
          ...(Object.keys(EVENT_RANGES) as EventRange[]).map((range) => ({
            value: range,
            label: EVENT_RANGES[range].label,
          })),
        ]}
        onChange={(range) =>
          show({
            ...view,
            range:
              range === ANY ? undefined : (range as EventRange | undefined),
          })
        }
      />
      <QueryBox view={view} onApply={(terms) => show({ ...view, terms })} />
    </div>
  );

  let list: ReactNode;
  if (events.status === "error") {
    list = (
      <MessagePanel tone="warning" role="alert">
        Couldn't read the log file.
      </MessagePanel>
    );
  } else if (events.status === "loading" && events.events.length === 0) {
    list = (
      <p className="py-6 text-xs text-muted-foreground" role="status">
        Reading the log file…
      </p>
    );
  } else if (events.events.length === 0) {
    list = loggingOff ? (
      <EventsEmpty
        title="Logging is off"
        action={
          <SettingsLink
            page="diagnostics"
            search={{ tab: "settings" }}
            replace
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open the Settings tab
          </SettingsLink>
        }
      >
        Turn on Write events to a local file to record what Ajour does.
      </EventsEmpty>
    ) : (
      <EventsEmpty title="No events match">
        Change the filters, or turn on Live to follow new events.
      </EventsEmpty>
    );
  } else {
    list = (
      <EventTable
        events={events.events}
        selectedKey={selected ? eventKey(selected) : null}
        now={now}
        onSelect={setSelected}
        onNearEnd={events.loadMore}
      />
    );
  }

  return (
    <div className="@container flex min-w-0 flex-col gap-3">
      {toolbar}
      <div className="flex min-h-6 items-center gap-2 text-xs text-muted-foreground">
        {events.status === "ready" ? (
          <span data-testid="event-count">
            <Value tone="muted">{events.matchCount.toLocaleString()}</Value>
            {events.matchCount === 1 ? " event" : " events"}
          </span>
        ) : null}
        {loggingOff && events.events.length > 0 ? (
          <span>Logging is off: no new events are written.</span>
        ) : null}
        {live && events.liveError ? (
          <span role="alert">Live couldn't follow the log file.</span>
        ) : null}
        <Toggle
          variant="outline"
          size="sm"
          className="ml-auto"
          pressed={live}
          onPressedChange={setLive}
        >
          Live
        </Toggle>
      </div>
      <div className="grid min-w-0 gap-6 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">{list}</div>
        {selected ? (
          <EventDetail
            event={selected}
            names={names}
            includeSensitive={includeSensitive}
            onShowTrace={() =>
              void openSettings({
                page: "diagnostics",
                search: { tab: "actions", trace: selected.trace_id },
              })
            }
            onSameName={() =>
              show({ ...view, terms: { ...view.terms, name: selected.name } })
            }
            onSameLaunch={() =>
              show({
                ...view,
                launch:
                  selected.launch_id === launchId ? "this" : selected.launch_id,
              })
            }
            onCopyJson={() => void copyJson(selected)}
          />
        ) : events.events.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Select an event to see its fields.
          </p>
        ) : null}
      </div>
    </div>
  );
}

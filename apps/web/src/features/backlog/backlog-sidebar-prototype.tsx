/**
 * PROTOTYPE, throwaway. Never merge to main.
 *
 * Question: what should the backlog sidebar and the backlog item page look like?
 * (issue #69, spec section "Backlog sidebar" in agents/ux-spec.md)
 *
 * Three variants, switched with `?proto=A|B|C` or the floating bar (← → keys):
 *   A: Flat list. T3 Code style, 200px, one line per item, actions on hover,
 *      collapsible Snoozed and Settled sections. Page: properties rail on the right.
 *   B: Two-line rows. Wider sidebar (272px), a meta line per item (id, state, time left).
 *      Page: one document column with property chips and tabs.
 *   C: Up next. The top item is a card with visible actions, the rest is compact, and
 *      Active / Snoozed / Settled are tabs instead of sections. Page: overview tiles.
 *
 * Everything is mock Azure DevOps data held in memory. Settle, snooze, undo and the
 * delayed write are simulated. The floating bar has two buttons to simulate a snooze
 * ending and a sync that brings a settled item back.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import {
  RiArrowDownSLine as ChevronDown,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiBugLine as BugIcon,
  RiBookOpenLine as StoryIcon,
  RiCheckboxCircleLine as SettleIcon,
  RiCheckboxBlankCircleLine as ManualIcon,
  RiExternalLinkLine as ExternalIcon,
  RiFlashlightLine as FeatureIcon,
  RiMore2Line as MoreIcon,
  RiPlayFill as PlayIcon,
  RiTaskLine as TaskIcon,
  RiTimeLine as SnoozeIcon,
  RiArrowGoBackLine as UnsettleIcon,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mock data

type Kind = "bug" | "story" | "task" | "feature" | "manual";
type ItemState = "active" | "snoozed" | "settled" | "archived";
type Category =
  "Proposed" | "In Progress" | "Resolved" | "Completed" | "Removed";

interface TimeEntry {
  date: string;
  minutes: number;
  note?: string;
}

interface ProtoItem {
  id: string;
  externalId?: number;
  kind: Kind;
  title: string;
  sourceProject?: string;
  sourceState?: string;
  priority?: number;
  parentId?: string;
  state: ItemState;
  snoozedUntil?: number;
  settledAt?: number;
  returned?: "snooze" | "source";
  running?: boolean;
  project?: string;
  task?: string;
  backlogStatus?: string;
  original?: number;
  remaining?: number;
  completed?: number;
  estimateSync?: "synced" | "conflict";
  note?: string;
  entries?: TimeEntry[];
}

const ADO_STATES: { name: string; category: Category }[] = [
  { name: "New", category: "Proposed" },
  { name: "Active", category: "In Progress" },
  { name: "Waiting for client", category: "In Progress" },
  { name: "Ready for QA", category: "Resolved" },
  { name: "Resolved", category: "Resolved" },
  { name: "Closed", category: "Completed" },
  { name: "Removed", category: "Removed" },
];
const DONE_CATEGORIES: Category[] = ["Completed", "Removed"];

const SETTLE_RULES: Record<
  string,
  { mode: "ask" } | { mode: "apply"; state?: string; priority?: number }
> = {
  "Client portal": { mode: "ask" },
  "Mobile app": { mode: "apply", state: "Ready for QA" },
};

const HOUR = 3600000;
const DAY = 24 * HOUR;
const now0 = Date.now();

const INITIAL_ITEMS: ProtoItem[] = [
  {
    id: "i1",
    externalId: 48213,
    kind: "bug",
    title: "Login fails after password reset on Safari",
    sourceProject: "Client portal",
    sourceState: "Active",
    priority: 1,
    state: "active",
    running: true,
    project: "Maison Lumière",
    task: "Maintenance",
    backlogStatus: "In progress",
    original: 6,
    remaining: 2.5,
    completed: 3.5,
    estimateSync: "synced",
    note: "Users who reset their password from the email link land on a blank page in Safari 17. The reset token is read from the hash, which Safari strips on the redirect from the auth domain.\n\nRepro: request a reset, open the link in Safari, set a new password.",
    entries: [
      { date: "Oct 9", minutes: 95, note: "Repro and HAR capture" },
      { date: "Oct 10", minutes: 115, note: "Token moved to query string" },
    ],
  },
  {
    id: "i2",
    externalId: 48190,
    kind: "story",
    title: "Export invoices as CSV",
    sourceProject: "Client portal",
    sourceState: "Active",
    priority: 1,
    state: "active",
    project: "Maison Lumière",
    task: "Development",
    backlogStatus: "In progress",
    original: 16,
    remaining: 9,
    completed: 7,
    estimateSync: "conflict",
    note: "As an accountant, I want to export the invoices of a period as CSV so I can import them in Acomba.\n\nAcceptance: one row per invoice line, French headers, semicolon separator.",
    entries: [
      { date: "Oct 6", minutes: 180, note: "Spike on Acomba format" },
      { date: "Oct 8", minutes: 240 },
    ],
  },
  {
    id: "i2a",
    externalId: 48201,
    kind: "task",
    title: "Add CSV serializer",
    sourceProject: "Client portal",
    sourceState: "Active",
    priority: 1,
    parentId: "i2",
    state: "active",
    remaining: 4,
    original: 6,
    completed: 2,
  },
  {
    id: "i2b",
    externalId: 48202,
    kind: "task",
    title: "Write export tests",
    sourceProject: "Client portal",
    sourceState: "New",
    parentId: "i2",
    state: "active",
    remaining: 3,
    original: 3,
    completed: 0,
  },
  {
    id: "i3",
    externalId: 48177,
    kind: "bug",
    title: "Push notifications duplicated on Android",
    sourceProject: "Mobile app",
    sourceState: "Active",
    priority: 2,
    state: "active",
    returned: "snooze",
    project: "Maison Lumière",
    task: "Maintenance",
    original: 4,
    remaining: 4,
    completed: 0,
    note: "Android 14 devices receive every push twice since 3.8.0. Suspect both FCM and the legacy handler are registered.",
  },
  {
    id: "i4",
    kind: "manual",
    title: "Prepare sprint demo for Thursday",
    priority: 2,
    state: "active",
    project: "Maison Lumière",
    task: "Meetings",
  },
  {
    id: "i5",
    externalId: 48120,
    kind: "story",
    title: "Account deletion flow (Loi 25)",
    sourceProject: "Client portal",
    sourceState: "New",
    priority: 2,
    state: "active",
    project: "Maison Lumière",
    task: "Development",
    original: 12,
    remaining: 12,
    completed: 0,
  },
  {
    id: "i6",
    externalId: 48302,
    kind: "task",
    title: "Upgrade React Native to 0.76",
    sourceProject: "Mobile app",
    sourceState: "New",
    priority: 3,
    state: "active",
    original: 8,
    remaining: 8,
    completed: 0,
  },
  {
    id: "i7",
    kind: "manual",
    title: "Review onboarding doc from Marie",
    priority: 3,
    state: "active",
  },
  {
    id: "i8",
    externalId: 48099,
    kind: "bug",
    title: "Wrong currency format in fr-CA receipts",
    sourceProject: "Client portal",
    sourceState: "Active",
    priority: 3,
    state: "active",
    returned: "source",
    original: 2,
    remaining: 1,
    completed: 1,
    note: "QA moved it back to Active: the thin space before $ is missing in PDF receipts.",
  },
  {
    id: "s1",
    externalId: 48250,
    kind: "bug",
    title: "Crash on cold start, iOS 17",
    sourceProject: "Mobile app",
    sourceState: "Active",
    priority: 1,
    state: "snoozed",
    snoozedUntil: now0 + DAY,
  },
  {
    id: "s2",
    kind: "manual",
    title: "Renew Apple certificates",
    priority: 2,
    state: "snoozed",
    snoozedUntil: now0 + 4 * DAY,
  },
  {
    id: "t1",
    externalId: 48001,
    kind: "story",
    title: "Onboarding carousel",
    sourceProject: "Client portal",
    sourceState: "Waiting for client",
    priority: 2,
    state: "settled",
    settledAt: now0 - 2 * HOUR,
  },
  {
    id: "t2",
    externalId: 47980,
    kind: "bug",
    title: "Map pins overlap at low zoom",
    sourceProject: "Mobile app",
    sourceState: "Ready for QA",
    priority: 2,
    state: "settled",
    settledAt: now0 - DAY,
  },
  {
    id: "t3",
    externalId: 47955,
    kind: "feature",
    title: "Sentry release tagging",
    sourceProject: "Mobile app",
    sourceState: "Resolved",
    priority: 3,
    state: "settled",
    settledAt: now0 - 3 * DAY,
  },
];

// ---------------------------------------------------------------------------
// In-memory store

type Variant = "A" | "B" | "C";
const VARIANTS: { key: Variant; name: string }[] = [
  { key: "A", name: "Flat list" },
  { key: "B", name: "Two-line rows" },
  { key: "C", name: "Up next" },
];

interface Toast {
  message: string;
  detail?: string;
  snapshot: ProtoItem[];
  expiresAt: number;
}

interface Store {
  items: ProtoItem[];
  variant: Variant;
  toast?: Toast;
  settleDialogFor?: string;
  snoozeMenuFor?: string;
  customSnoozeFor?: string;
  writes: string[];
}

function readVariant(): Variant {
  const value = new URLSearchParams(window.location.search).get("proto");
  return VARIANTS.some((item) => item.key === value) ? (value as Variant) : "A";
}

let store: Store = {
  items: INITIAL_ITEMS,
  variant: readVariant(),
  writes: [],
};
const listeners = new Set<() => void>();
function setStore(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((listener) => listener());
}
function useStore() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => store,
  );
}

function updateItems(
  update: (item: ProtoItem) => ProtoItem,
  toast?: Omit<Toast, "snapshot" | "expiresAt">,
) {
  const snapshot = store.items;
  setStore({
    items: store.items.map(update),
    toast: toast
      ? { ...toast, snapshot, expiresAt: Date.now() + 8000 }
      : store.toast,
  });
}

function itemById(id: string) {
  return store.items.find((item) => item.id === id);
}

function categoryOf(stateName?: string) {
  return ADO_STATES.find((state) => state.name === stateName)?.category;
}

const actions = {
  start(id: string) {
    updateItems((item) => ({ ...item, running: item.id === id }));
  },
  open(id: string) {
    updateItems((item) =>
      item.id === id ? { ...item, returned: undefined } : item,
    );
  },
  snooze(id: string, until: number, label: string) {
    const target = itemById(id);
    updateItems(
      (item) =>
        item.id === id
          ? {
              ...item,
              state: "snoozed",
              snoozedUntil: until,
              returned: undefined,
            }
          : item,
      { message: `Snoozed until ${label}`, detail: target?.title },
    );
    setStore({ snoozeMenuFor: undefined, customSnoozeFor: undefined });
  },
  unsnooze(id: string) {
    updateItems((item) =>
      item.id === id
        ? { ...item, state: "active", snoozedUntil: undefined }
        : item,
    );
  },
  requestSettle(id: string, forceDialog = false) {
    const target = itemById(id);
    if (!target) return;
    if (target.kind === "manual") {
      actions.settle(id, {});
      return;
    }
    const rule = SETTLE_RULES[target.sourceProject ?? ""] ?? { mode: "ask" };
    if (rule.mode === "apply" && !forceDialog) {
      actions.settle(id, { state: rule.state, priority: rule.priority });
      return;
    }
    setStore({ settleDialogFor: id });
  },
  settle(id: string, change: { state?: string; priority?: number }) {
    const target = itemById(id);
    if (!target) return;
    const isManual = target.kind === "manual";
    const nextState = change.state ?? target.sourceState;
    const archives =
      isManual || DONE_CATEGORIES.includes(categoryOf(nextState) as Category);
    const changed: string[] = [];
    if (change.state && change.state !== target.sourceState)
      changed.push(change.state);
    if (change.priority && change.priority !== target.priority)
      changed.push(`priority ${change.priority}`);
    const carries = (item: ProtoItem) =>
      item.id === id ||
      (item.parentId === id &&
        item.priority === undefined &&
        item.state === "active");
    updateItems(
      (item) =>
        carries(item)
          ? {
              ...item,
              state: archives ? "archived" : "settled",
              settledAt: Date.now(),
              running: false,
              returned: undefined,
              sourceState: item.id === id ? nextState : item.sourceState,
              priority:
                item.id === id
                  ? (change.priority ?? item.priority)
                  : item.priority,
            }
          : item,
      {
        message: isManual
          ? "Archived"
          : archives
            ? `Archived · ${nextState}`
            : changed.length
              ? `Settled · ${changed.join(", ")}`
              : "Settled in Ajour",
        detail:
          !isManual && changed.length
            ? `Writes to Azure DevOps when this closes`
            : target.title,
      },
    );
    if (!isManual && changed.length) {
      pendingWrite = `#${target.externalId} → ${changed.join(", ")}`;
    } else {
      pendingWrite = undefined;
    }
    setStore({ settleDialogFor: undefined });
  },
  unsettle(id: string) {
    updateItems((item) =>
      item.id === id || (item.parentId === id && item.state === "settled")
        ? { ...item, state: "active", settledAt: undefined }
        : item,
    );
  },
  undo() {
    if (!store.toast) return;
    pendingWrite = undefined;
    setStore({ items: store.toast.snapshot, toast: undefined });
  },
  simulateSnoozeEnd() {
    const next = store.items
      .filter((item) => item.state === "snoozed")
      .sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0))[0];
    if (!next) return;
    updateItems((item) =>
      item.id === next.id
        ? {
            ...item,
            state: "active",
            snoozedUntil: undefined,
            returned: "snooze",
          }
        : item,
    );
  },
  simulateSyncReturn() {
    const next = store.items
      .filter((item) => item.state === "settled" && item.kind !== "manual")
      .sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0))[0];
    if (!next) return;
    updateItems((item) =>
      item.id === next.id
        ? {
            ...item,
            state: "active",
            sourceState: "Active",
            settledAt: undefined,
            returned: "source",
          }
        : item,
    );
  },
};
let pendingWrite: string | undefined;

// ---------------------------------------------------------------------------
// Helpers

function sidebarItems(items: ProtoItem[]) {
  const visible = items.filter(
    (item) =>
      item.state === "active" &&
      (!item.parentId || item.priority !== undefined),
  );
  return visible.sort(
    (a, b) =>
      (a.priority ?? 99) - (b.priority ?? 99) ||
      items.indexOf(a) - items.indexOf(b),
  );
}

function parentTitle(item: ProtoItem) {
  return item.parentId ? itemById(item.parentId)?.title : undefined;
}

function formatHours(hours?: number) {
  if (hours === undefined) return "–";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function formatWhen(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const time = date.toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  });
  const days = Math.round(
    (new Date(date.toDateString()).getTime() -
      new Date(today.toDateString()).getTime()) /
      DAY,
  );
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  return `${date.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

function snoozePresets() {
  const now = new Date();
  const at = (days: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date.getTime();
  };
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  const presets = [
    { label: "In an hour", until: now.getTime() + HOUR },
    { label: "In 3 hours", until: now.getTime() + 3 * HOUR },
  ];
  if (now.getHours() < 12) {
    presets.push({ label: "This afternoon", until: at(0, 13) });
  }
  presets.push(
    { label: "Tomorrow", until: at(1, 9) },
    { label: "Next week", until: at(daysToMonday, 9) },
  );
  return presets;
}

const KIND_META: Record<
  Kind,
  { label: string; icon: typeof BugIcon; color: string }
> = {
  bug: { label: "Bug", icon: BugIcon, color: "text-red-600 dark:text-red-400" },
  story: {
    label: "User Story",
    icon: StoryIcon,
    color: "text-sky-600 dark:text-sky-400",
  },
  task: {
    label: "Task",
    icon: TaskIcon,
    color: "text-amber-600 dark:text-amber-400",
  },
  feature: {
    label: "Feature",
    icon: FeatureIcon,
    color: "text-violet-600 dark:text-violet-400",
  },
  manual: {
    label: "Backlog item",
    icon: ManualIcon,
    color: "text-muted-foreground",
  },
};

function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <Icon
      className={cn("size-3.5 shrink-0", meta.color, className)}
      aria-label={meta.label}
    />
  );
}

function RunningMarker() {
  return (
    <span className="relative flex size-2 shrink-0" title="Running entry">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
    </span>
  );
}

function ReturnedDot({ item }: { item: ProtoItem }) {
  return (
    <button
      type="button"
      className="flex size-4 shrink-0 items-center justify-center"
      title={
        item.returned === "snooze"
          ? "Back from snooze. Click to clear"
          : "Changed in Azure DevOps. Click to clear"
      }
      onClick={(event) => {
        event.stopPropagation();
        actions.open(item.id);
      }}
    >
      <span className="size-2 rounded-full bg-sky-500" />
    </button>
  );
}

function StateBadge({ state }: { state?: string }) {
  const category = categoryOf(state);
  const tone =
    category === "In Progress"
      ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
      : category === "Resolved"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : category === "Completed"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium",
        tone,
      )}
    >
      {state ?? "Local"}
    </span>
  );
}

function useOpenItem() {
  const navigate = useNavigate();
  return (id: string) => {
    actions.open(id);
    void navigate({ to: "/backlog/$itemId", params: { itemId: id } });
  };
}

function rowKeyDown(
  event: React.KeyboardEvent,
  item: ProtoItem,
  open: (id: string) => void,
) {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter") {
    event.preventDefault();
    open(item.id);
  } else if (event.key.toLowerCase() === "e") {
    event.preventDefault();
    actions.requestSettle(item.id, event.shiftKey);
  } else if (event.key.toLowerCase() === "b") {
    event.preventDefault();
    setStore({ snoozeMenuFor: item.id });
  }
}

// ---------------------------------------------------------------------------
// Shared action controls

function SnoozeMenu({
  item,
  trigger,
}: {
  item: ProtoItem;
  trigger: React.ReactElement;
}) {
  const { snoozeMenuFor } = useStore();
  return (
    <DropdownMenu
      open={snoozeMenuFor === item.id}
      onOpenChange={(open) =>
        setStore({ snoozeMenuFor: open ? item.id : undefined })
      }
    >
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Snooze until</DropdownMenuLabel>
          {snoozePresets().map((preset) => (
            <DropdownMenuItem
              key={preset.label}
              onClick={() =>
                actions.snooze(item.id, preset.until, formatWhen(preset.until))
              }
            >
              {preset.label}
              <DropdownMenuShortcut>
                {formatWhen(preset.until).replace(/^(Today|Tomorrow) /, "")}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              setStore({ customSnoozeFor: item.id, snoozeMenuFor: undefined })
            }
          >
            Custom…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IconAction({
  label,
  onClick,
  children,
  ...props
}: {
  label: string;
  onClick?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function HoverActions({
  item,
  className,
}: {
  item: ProtoItem;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <IconAction label="Start entry" onClick={() => actions.start(item.id)}>
        <PlayIcon className="size-3.5" />
      </IconAction>
      <SnoozeMenu
        item={item}
        trigger={
          <IconAction label="Snooze (B)">
            <SnoozeIcon className="size-3.5" />
          </IconAction>
        }
      />
      <IconAction
        label="Settle (E). Shift-click for options"
        onClick={(event) => actions.requestSettle(item.id, event.shiftKey)}
      >
        <SettleIcon className="size-3.5" />
      </IconAction>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1 px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
    >
      <ChevronDown
        className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
      />
      {label}
      {count !== undefined ? (
        <span className="ml-auto font-normal">{count}</span>
      ) : null}
    </button>
  );
}

function SnoozedRows({
  items,
  compact,
}: {
  items: ProtoItem[];
  compact?: boolean;
}) {
  const open = useOpenItem();
  return (
    <>
      {items
        .sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0))
        .map((item) => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => open(item.id)}
            className="group flex items-center gap-2 rounded px-2 py-1 text-[13px] text-muted-foreground hover:bg-foreground/5"
          >
            <KindIcon kind={item.kind} className="opacity-70" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.title}</span>
              {!compact ? (
                <span className="block text-[11px]">
                  {formatWhen(item.snoozedUntil ?? 0)}
                </span>
              ) : null}
            </span>
            {compact ? (
              <span className="shrink-0 text-[11px] group-hover:hidden">
                {formatWhen(item.snoozedUntil ?? 0).replace(/ \d.*$/, "")}
              </span>
            ) : null}
            <span className="hidden group-hover:flex">
              <IconAction
                label="Unsnooze"
                onClick={() => actions.unsnooze(item.id)}
              >
                <UnsettleIcon className="size-3.5" />
              </IconAction>
            </span>
          </div>
        ))}
    </>
  );
}

function SettledRows({
  items,
  compact,
}: {
  items: ProtoItem[];
  compact?: boolean;
}) {
  const open = useOpenItem();
  const [shown, setShown] = useState(20);
  const sorted = items.sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0));
  return (
    <>
      {sorted.slice(0, shown).map((item) => (
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          onClick={() => open(item.id)}
          className="group flex items-center gap-2 rounded px-2 py-1 text-[13px] text-muted-foreground hover:bg-foreground/5"
        >
          <KindIcon kind={item.kind} className="opacity-70" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{item.title}</span>
            {!compact ? (
              <span className="block truncate text-[11px]">
                {item.sourceState}
              </span>
            ) : null}
          </span>
          <span className="hidden group-hover:flex">
            <IconAction
              label="Unsettle"
              onClick={() => actions.unsettle(item.id)}
            >
              <UnsettleIcon className="size-3.5" />
            </IconAction>
          </span>
        </div>
      ))}
      {sorted.length > shown ? (
        <button
          type="button"
          className="px-2 py-1 text-left text-[12px] text-muted-foreground hover:text-foreground"
          onClick={() => setShown(shown + 20)}
        >
          Show more
        </button>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sidebar variants

function SidebarA({ activeItemId }: { activeItemId?: string }) {
  const { items } = useStore();
  const open = useOpenItem();
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const [settledOpen, setSettledOpen] = useState(false);
  const list = sidebarItems(items);
  const snoozed = items.filter((item) => item.state === "snoozed");
  const settled = items.filter((item) => item.state === "settled");
  return (
    <div className="flex flex-col px-2 pb-2">
      <div className="px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Backlog
      </div>
      {list.map((item) => {
        const parent = parentTitle(item);
        return (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => open(item.id)}
            onKeyDown={(event) => rowKeyDown(event, item, open)}
            className={cn(
              "group relative flex h-7 items-center gap-2 rounded px-2 text-[13px] outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring",
              activeItemId === item.id && "bg-foreground/[0.07] font-medium",
            )}
            title={parent ? `${parent} › ${item.title}` : item.title}
          >
            <KindIcon kind={item.kind} />
            <span className="min-w-0 flex-1 truncate">
              {item.title}
              {parent ? (
                <span className="text-muted-foreground"> · {parent}</span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1 group-hover:hidden group-focus-visible:hidden">
              {item.running ? <RunningMarker /> : null}
              {item.returned ? <ReturnedDot item={item} /> : null}
            </span>
            <HoverActions
              item={item}
              className="hidden group-hover:flex group-focus-visible:flex"
            />
          </div>
        );
      })}
      <SectionHeader
        label="Snoozed"
        count={snoozed.length}
        open={snoozedOpen}
        onToggle={() => setSnoozedOpen(!snoozedOpen)}
      />
      {snoozedOpen ? <SnoozedRows items={snoozed} compact /> : null}
      <SectionHeader
        label="Settled"
        open={settledOpen}
        onToggle={() => setSettledOpen(!settledOpen)}
      />
      {settledOpen ? <SettledRows items={settled} compact /> : null}
    </div>
  );
}

function SidebarB({ activeItemId }: { activeItemId?: string }) {
  const { items } = useStore();
  const open = useOpenItem();
  const [snoozedOpen, setSnoozedOpen] = useState(true);
  const [settledOpen, setSettledOpen] = useState(false);
  const list = sidebarItems(items);
  const snoozed = items.filter((item) => item.state === "snoozed");
  const settled = items.filter((item) => item.state === "settled");
  return (
    <div className="flex flex-col gap-px px-2 pb-2">
      <div className="flex items-center px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Backlog
        <span className="ml-auto font-normal normal-case">by priority</span>
      </div>
      {list.map((item) => {
        const parent = parentTitle(item);
        return (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => open(item.id)}
            onKeyDown={(event) => rowKeyDown(event, item, open)}
            className={cn(
              "group relative flex items-start gap-2 rounded-md px-2 py-1.5 outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring",
              activeItemId === item.id && "bg-foreground/[0.07]",
            )}
          >
            <KindIcon kind={item.kind} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "line-clamp-2 text-[13px] leading-snug",
                  item.returned && "font-semibold",
                )}
              >
                {item.title}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                {parent ? (
                  <span className="truncate">↳ {parent}</span>
                ) : (
                  <>
                    {item.externalId ? (
                      <span>#{item.externalId}</span>
                    ) : (
                      <span>Local</span>
                    )}
                    {item.sourceState ? (
                      <span>· {item.sourceState}</span>
                    ) : null}
                    {item.remaining !== undefined ? (
                      <span>· {formatHours(item.remaining)} left</span>
                    ) : null}
                  </>
                )}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 pt-1 group-hover:hidden">
              {item.running ? <RunningMarker /> : null}
              {item.returned ? <ReturnedDot item={item} /> : null}
            </span>
            <HoverActions
              item={item}
              className="absolute top-1 right-1 hidden rounded-md bg-background/95 shadow-sm ring-1 ring-border group-hover:flex"
            />
          </div>
        );
      })}
      <SectionHeader
        label="Snoozed"
        count={snoozed.length}
        open={snoozedOpen}
        onToggle={() => setSnoozedOpen(!snoozedOpen)}
      />
      {snoozedOpen ? <SnoozedRows items={snoozed} /> : null}
      <SectionHeader
        label="Settled"
        count={settled.length}
        open={settledOpen}
        onToggle={() => setSettledOpen(!settledOpen)}
      />
      {settledOpen ? <SettledRows items={settled} /> : null}
    </div>
  );
}

function SidebarC({ activeItemId }: { activeItemId?: string }) {
  const { items } = useStore();
  const open = useOpenItem();
  const [tab, setTab] = useState<"active" | "snoozed" | "settled">("active");
  const list = sidebarItems(items);
  const snoozed = items.filter((item) => item.state === "snoozed");
  const settled = items.filter((item) => item.state === "settled");
  const [first, ...rest] = list;
  return (
    <div className="flex min-h-0 flex-col px-2 pb-2">
      <div className="mt-3 mb-2 grid grid-cols-3 rounded-md bg-foreground/5 p-0.5 text-[11px] whitespace-nowrap">
        {(
          [
            ["active", `Up next`],
            ["snoozed", `Snoozed·${snoozed.length}`],
            ["settled", `Settled`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "rounded px-1 py-1",
              tab === key
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "active" ? (
        <>
          {first ? (
            <div
              role="button"
              tabIndex={0}
              onClick={() => open(first.id)}
              onKeyDown={(event) => rowKeyDown(event, first, open)}
              className={cn(
                "mb-2 rounded-lg border bg-background p-2.5 shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring",
                activeItemId === first.id && "border-foreground/30",
              )}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <KindIcon kind={first.kind} />
                {first.externalId ? `#${first.externalId}` : "Local"}
                <span className="ml-auto flex items-center gap-1">
                  {first.running ? <RunningMarker /> : null}
                  {first.returned ? <ReturnedDot item={first} /> : null}
                </span>
              </div>
              <div className="mt-1 text-[13px] leading-snug font-medium">
                {first.title}
              </div>
              <div className="mt-2 flex gap-0.5">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.start(first.id);
                  }}
                >
                  <PlayIcon /> Start
                </Button>
                <SnoozeMenu
                  item={first}
                  trigger={
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <SnoozeIcon /> Snooze
                    </Button>
                  }
                />
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label="Settle"
                  title="Settle (E)"
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.requestSettle(first.id, event.shiftKey);
                  }}
                >
                  <SettleIcon />
                </Button>
              </div>
            </div>
          ) : null}
          {rest.map((item) => {
            const parent = parentTitle(item);
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => open(item.id)}
                onKeyDown={(event) => rowKeyDown(event, item, open)}
                className={cn(
                  "group flex h-7 items-center gap-2 rounded px-2 text-[13px] outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring",
                  activeItemId === item.id &&
                    "bg-foreground/[0.07] font-medium",
                )}
              >
                <span className="w-3 shrink-0 text-center text-[10px] text-muted-foreground tabular-nums">
                  {item.priority}
                </span>
                <KindIcon kind={item.kind} />
                <span className="min-w-0 flex-1 truncate">
                  {item.title}
                  {parent ? (
                    <span className="text-muted-foreground"> · {parent}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1 group-hover:hidden">
                  {item.running ? <RunningMarker /> : null}
                  {item.returned ? <ReturnedDot item={item} /> : null}
                </span>
                <HoverActions item={item} className="hidden group-hover:flex" />
              </div>
            );
          })}
        </>
      ) : null}
      {tab === "snoozed" ? <SnoozedRows items={snoozed} /> : null}
      {tab === "settled" ? <SettledRows items={settled} /> : null}
    </div>
  );
}

/** Mounted inside the app sidebar when it is expanded. */
export function BacklogSidebarPrototype({ pathname }: { pathname: string }) {
  const { variant } = useStore();
  const activeItemId = pathname.startsWith("/backlog/")
    ? pathname.split("/")[2]
    : undefined;

  // Variant B widens the sidebar to test whether two-line rows earn the space.
  useEffect(() => {
    const body = document.querySelector<HTMLElement>(".ajour-app-body");
    if (!body) return;
    if (variant === "B" && body.dataset.appSidebar !== "rail") {
      body.style.setProperty("--app-sidebar-width", "272px");
    } else {
      body.style.removeProperty("--app-sidebar-width");
    }
  }, [variant]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {variant === "A" ? <SidebarA activeItemId={activeItemId} /> : null}
      {variant === "B" ? <SidebarB activeItemId={activeItemId} /> : null}
      {variant === "C" ? <SidebarC activeItemId={activeItemId} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settle dialog, custom snooze, toast and the floating switcher

function SettleDialog() {
  const { settleDialogFor } = useStore();
  const item = settleDialogFor ? itemById(settleDialogFor) : undefined;
  const rule = item ? SETTLE_RULES[item.sourceProject ?? ""] : undefined;
  const [stateName, setStateName] = useState<string | undefined>();
  const [priority, setPriority] = useState<number | undefined>();

  useEffect(() => {
    if (!item) return;
    setStateName(
      rule?.mode === "apply" && rule.state ? rule.state : item.sourceState,
    );
    setPriority(
      rule?.mode === "apply" && rule.priority ? rule.priority : item.priority,
    );
  }, [settleDialogFor]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = Array.from(
    new Set(ADO_STATES.map((state) => state.category)),
  );
  const archives = DONE_CATEGORIES.includes(categoryOf(stateName) as Category);
  const nothingChanged =
    item && stateName === item.sourceState && priority === item.priority;

  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => !open && setStore({ settleDialogFor: undefined })}
    >
      <DialogContent className="max-w-md gap-4">
        <DialogHeader className="gap-1">
          <DialogTitle>Settle #{item?.externalId}</DialogTitle>
          <DialogDescription className="truncate">
            {item?.title}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="text-[12px] font-medium text-muted-foreground">
            State in Azure DevOps
          </div>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {categories.map((category) => (
              <div key={category}>
                <div className="mb-0.5 text-[11px] tracking-wide text-muted-foreground uppercase">
                  {category}
                </div>
                <div className="flex flex-wrap gap-1">
                  {ADO_STATES.filter(
                    (state) => state.category === category,
                  ).map((state) => (
                    <button
                      key={state.name}
                      type="button"
                      onClick={() => setStateName(state.name)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[13px]",
                        stateName === state.name
                          ? "border-foreground bg-foreground text-background"
                          : "hover:bg-muted",
                      )}
                    >
                      {state.name}
                      {state.name === item?.sourceState ? (
                        <span className="ml-1 opacity-60">(now)</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <span className="w-16 text-muted-foreground">Priority</span>
            <select
              className="h-8 rounded-md border bg-background px-2"
              value={priority ?? ""}
              onChange={(event) =>
                setPriority(Number(event.target.value) || undefined)
              }
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[12px] text-muted-foreground">
            {archives
              ? "Done state: the item will be archived."
              : nothingChanged
                ? "Nothing changes in Azure DevOps. The item is settled in Ajour only."
                : "Ajour writes the change to Azure DevOps when the Undo toast closes."}
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setStore({ settleDialogFor: undefined })}
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              item && actions.settle(item.id, { state: stateName, priority })
            }
          >
            {archives ? "Archive" : "Settle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomSnoozeDialog() {
  const { customSnoozeFor } = useStore();
  const [value, setValue] = useState("");
  return (
    <Dialog
      open={Boolean(customSnoozeFor)}
      onOpenChange={(open) => !open && setStore({ customSnoozeFor: undefined })}
    >
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader>
          <DialogTitle>Snooze until</DialogTitle>
        </DialogHeader>
        <input
          type="datetime-local"
          className="h-9 rounded-md border bg-background px-2"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <DialogFooter>
          <Button
            disabled={!value}
            onClick={() =>
              customSnoozeFor &&
              actions.snooze(
                customSnoozeFor,
                new Date(value).getTime(),
                formatWhen(new Date(value).getTime()),
              )
            }
          >
            Snooze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UndoToast() {
  const { toast, writes } = useStore();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!toast) return;
    const interval = window.setInterval(() => {
      if (Date.now() >= toast.expiresAt) {
        window.clearInterval(interval);
        setStore({
          toast: undefined,
          writes: pendingWrite ? [pendingWrite, ...writes].slice(0, 3) : writes,
        });
        pendingWrite = undefined;
      } else {
        tick((value) => value + 1);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "z" &&
        store.toast
      ) {
        event.preventDefault();
        actions.undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!toast) return null;
  const seconds = Math.max(0, Math.ceil((toast.expiresAt - Date.now()) / 1000));
  return (
    <div className="fixed right-4 bottom-20 z-50 flex w-80 items-center gap-3 rounded-lg border bg-background p-3 text-[13px] shadow-lg">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{toast.message}</div>
        {toast.detail ? (
          <div className="truncate text-[12px] text-muted-foreground">
            {toast.detail}
          </div>
        ) : null}
      </div>
      <Button size="sm" variant="outline" onClick={actions.undo}>
        Undo{" "}
        <span className="text-muted-foreground tabular-nums">{seconds}</span>
      </Button>
    </div>
  );
}

/** Floating bar: variant switcher, simulations and a state readout. */
export function BacklogPrototypeChrome() {
  const { variant, items, writes } = useStore();
  if (import.meta.env.PROD) return null;

  function cycle(step: number) {
    const index = VARIANTS.findIndex((item) => item.key === variant);
    const next =
      VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!.key;
    const url = new URL(window.location.href);
    url.searchParams.set("proto", next);
    window.history.replaceState(window.history.state, "", url);
    setStore({ variant: next });
  }

  return createPortal(
    <>
      <SettleDialog />
      <CustomSnoozeDialog />
      <UndoToast />
      <PrototypeKeys onCycle={cycle} />
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-neutral-900 px-2 py-1.5 text-[12px] whitespace-nowrap text-white shadow-xl">
        <button
          type="button"
          className="rounded-full p-1 hover:bg-white/15"
          onClick={() => cycle(-1)}
          aria-label="Previous variant"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-36 text-center font-medium">
          {variant} ({VARIANTS.find((item) => item.key === variant)?.name})
        </span>
        <button
          type="button"
          className="rounded-full p-1 hover:bg-white/15"
          onClick={() => cycle(1)}
          aria-label="Next variant"
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-white/25" />
        <button
          type="button"
          className="rounded-full px-2 py-0.5 hover:bg-white/15"
          onClick={actions.simulateSnoozeEnd}
        >
          End a snooze
        </button>
        <button
          type="button"
          className="rounded-full px-2 py-0.5 hover:bg-white/15"
          onClick={actions.simulateSyncReturn}
        >
          Sync: QA bounces one
        </button>
        <span className="mx-1 h-4 w-px bg-white/25" />
        <span className="pr-2 text-white/70 tabular-nums">
          {(["active", "snoozed", "settled", "archived"] as const)
            .map(
              (state) =>
                `${state} ${items.filter((item) => item.state === state).length}`,
            )
            .join(" · ")}
          {writes[0] ? ` · last write ${writes[0]}` : ""}
        </span>
      </div>
    </>,
    document.body,
  );
}

function PrototypeKeys({ onCycle }: { onCycle: (step: number) => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      if (target?.closest("[role='button']")) return;
      if (event.key === "ArrowLeft" && !event.metaKey && !event.altKey)
        onCycle(-1);
      if (event.key === "ArrowRight" && !event.metaKey && !event.altKey)
        onCycle(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCycle]);
  return null;
}

// ---------------------------------------------------------------------------
// Backlog item page variants

function PageHeaderActions({ item }: { item: ProtoItem }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {item.state === "active" ? (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => actions.start(item.id)}
          >
            <PlayIcon /> Start entry
          </Button>
          <SnoozeMenu
            item={item}
            trigger={
              <Button size="sm" variant="ghost">
                <SnoozeIcon /> Snooze
              </Button>
            }
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => actions.requestSettle(item.id, event.shiftKey)}
          >
            <SettleIcon /> Settle
          </Button>
        </>
      ) : null}
      {item.state === "snoozed" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => actions.unsnooze(item.id)}
        >
          Unsnooze
        </Button>
      ) : null}
      {item.state === "settled" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => actions.unsettle(item.id)}
        >
          Unsettle
        </Button>
      ) : null}
      {item.state === "archived" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => actions.unsettle(item.id)}
        >
          Restore
        </Button>
      ) : null}
      <Button size="icon-sm" variant="ghost" aria-label="More actions">
        <MoreIcon />
      </Button>
    </div>
  );
}

function StateNotice({ item }: { item: ProtoItem }) {
  if (item.state === "active" && !item.returned) return null;
  const text =
    item.state === "snoozed"
      ? `Snoozed until ${formatWhen(item.snoozedUntil ?? 0)}`
      : item.state === "settled"
        ? `Settled ${formatWhen(item.settledAt ?? 0)} · waiting in "${item.sourceState}"`
        : item.state === "archived"
          ? "Archived"
          : item.returned === "snooze"
            ? "Back from snooze"
            : "Changed in Azure DevOps since you settled it";
  return (
    <div className="rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
      {text}
    </div>
  );
}

function Subitems({ item }: { item: ProtoItem }) {
  const { items } = useStore();
  const open = useOpenItem();
  const children = items.filter((child) => child.parentId === item.id);
  if (!children.length)
    return <p className="text-[13px] text-muted-foreground">No subitems.</p>;
  return (
    <div className="flex flex-col divide-y rounded-md border">
      {children.map((child) => (
        <button
          key={child.id}
          type="button"
          onClick={() => open(child.id)}
          className="flex items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted/60"
        >
          <KindIcon kind={child.kind} />
          <span className="text-muted-foreground">#{child.externalId}</span>
          <span className="min-w-0 flex-1 truncate">{child.title}</span>
          {child.priority ? (
            <span className="text-[11px] text-muted-foreground">
              P{child.priority}
            </span>
          ) : null}
          <StateBadge state={child.sourceState} />
          <span className="w-12 text-right text-[12px] text-muted-foreground tabular-nums">
            {formatHours(child.remaining)}
          </span>
        </button>
      ))}
    </div>
  );
}

function Entries({ item }: { item: ProtoItem }) {
  if (!item.entries?.length)
    return (
      <p className="text-[13px] text-muted-foreground">No time logged yet.</p>
    );
  return (
    <div className="flex flex-col divide-y rounded-md border">
      {item.entries.map((entry, index) => (
        <div
          key={index}
          className="flex items-center gap-3 px-3 py-2 text-[13px]"
        >
          <span className="w-14 text-muted-foreground">{entry.date}</span>
          <span className="min-w-0 flex-1 truncate">
            {entry.note ?? (
              <span className="text-muted-foreground">No note</span>
            )}
          </span>
          <span className="tabular-nums">{formatMinutes(entry.minutes)}</span>
        </div>
      ))}
    </div>
  );
}

function loggedMinutes(item: ProtoItem) {
  return (item.entries ?? []).reduce((sum, entry) => sum + entry.minutes, 0);
}

function Property({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-baseline gap-2 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function SourceLink({ item }: { item: ProtoItem }) {
  if (!item.externalId)
    return <span className="text-muted-foreground">Manual item</span>;
  return (
    <a
      href="#"
      onClick={(event) => event.preventDefault()}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
    >
      #{item.externalId} <ExternalIcon className="size-3" />
    </a>
  );
}

function PageA({ item }: { item: ProtoItem }) {
  const parent = item.parentId ? itemById(item.parentId) : undefined;
  const open = useOpenItem();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <KindIcon kind={item.kind} />
            {KIND_META[item.kind].label}
            <SourceLink item={item} />
            {parent ? (
              <button
                type="button"
                className="truncate hover:text-foreground"
                onClick={() => open(parent.id)}
              >
                in {parent.title}
              </button>
            ) : null}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            {item.title}
          </h1>
        </div>
        <PageHeaderActions item={item} />
      </div>
      <StateNotice item={item} />
      <div className="grid grid-cols-[1fr_260px] gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">
              Description
            </h2>
            <p className="text-[14px] leading-relaxed whitespace-pre-line">
              {item.note ?? (
                <span className="text-muted-foreground">No description.</span>
              )}
            </p>
          </section>
          <section>
            <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">
              Subitems
            </h2>
            <Subitems item={item} />
          </section>
          <section>
            <h2 className="mb-2 flex text-[12px] font-medium text-muted-foreground">
              Time entries{" "}
              <span className="ml-auto tabular-nums">
                {formatMinutes(loggedMinutes(item))}
              </span>
            </h2>
            <Entries item={item} />
          </section>
        </div>
        <aside className="flex flex-col divide-y self-start rounded-lg border px-3 py-1">
          <div className="py-1">
            <Property label="State">
              <StateBadge state={item.sourceState} />
            </Property>
            <Property label="Status">{item.backlogStatus ?? "–"}</Property>
            <Property label="Priority">
              {item.priority ?? "Follows parent"}
            </Property>
          </div>
          <div className="py-1">
            <Property label="Project">{item.project ?? "–"}</Property>
            <Property label="Task">{item.task ?? "–"}</Property>
            <Property label="Source">{item.sourceProject ?? "Ajour"}</Property>
          </div>
          <div className="py-1">
            <Property label="Original">{formatHours(item.original)}</Property>
            <Property label="Remaining">{formatHours(item.remaining)}</Property>
            <Property label="Completed">
              {formatHours(item.completed)}
              {item.estimateSync === "conflict" ? (
                <span className="ml-1.5 text-[11px] text-amber-600">
                  conflict
                </span>
              ) : null}
            </Property>
          </div>
          <div className="py-2 text-[11px] text-muted-foreground">
            Room for assignee, iteration, area path and tags (#71).
          </div>
        </aside>
      </div>
    </div>
  );
}

function PageB({ item }: { item: ProtoItem }) {
  const [tab, setTab] = useState<"details" | "subitems" | "time">("details");
  const { items } = useStore();
  const childCount = items.filter((child) => child.parentId === item.id).length;
  const parent = item.parentId ? itemById(item.parentId) : undefined;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <KindIcon kind={item.kind} /> {KIND_META[item.kind].label}{" "}
          <SourceLink item={item} />
        </div>
        <PageHeaderActions item={item} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{item.title}</h1>
      {parent ? (
        <div className="-mt-2 text-[13px] text-muted-foreground">
          ↳ {parent.title}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <StateBadge state={item.sourceState} />
        {item.priority ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
            Priority {item.priority}
          </span>
        ) : null}
        {item.project ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
            {item.project} · {item.task}
          </span>
        ) : null}
        {item.remaining !== undefined ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
            {formatHours(item.remaining)} left of {formatHours(item.original)}
          </span>
        ) : null}
        {item.sourceProject ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
            {item.sourceProject}
          </span>
        ) : null}
      </div>
      <StateNotice item={item} />
      <div className="flex gap-4 border-b text-[13px]">
        {(
          [
            ["details", "Details"],
            ["subitems", `Subitems ${childCount}`],
            ["time", `Time ${formatMinutes(loggedMinutes(item))}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 pb-2",
              tab === key
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "details" ? (
        <div className="flex flex-col gap-6">
          <p className="text-[15px] leading-relaxed whitespace-pre-line">
            {item.note ?? (
              <span className="text-muted-foreground">No description.</span>
            )}
          </p>
          <dl className="grid grid-cols-2 gap-x-8 rounded-lg bg-muted/40 px-4 py-2">
            <Property label="Status">{item.backlogStatus ?? "–"}</Property>
            <Property label="Original">{formatHours(item.original)}</Property>
            <Property label="Completed">{formatHours(item.completed)}</Property>
            <Property label="Estimates">
              {item.estimateSync === "conflict"
                ? "Conflict with Azure DevOps"
                : "In sync"}
            </Property>
          </dl>
        </div>
      ) : null}
      {tab === "subitems" ? <Subitems item={item} /> : null}
      {tab === "time" ? <Entries item={item} /> : null}
    </div>
  );
}

function PageC({ item }: { item: ProtoItem }) {
  const logged = loggedMinutes(item) / 60;
  const done = item.original
    ? Math.min(1, (item.completed ?? 0) / item.original)
    : 0;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <KindIcon kind={item.kind} className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {item.title}
            </h1>
            <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
              <SourceLink item={item} /> · {item.sourceProject ?? "Ajour"} ·{" "}
              <StateBadge state={item.sourceState} />
            </div>
          </div>
        </div>
        <PageHeaderActions item={item} />
      </div>
      <StateNotice item={item} />
      <div className="grid grid-cols-4 gap-3">
        {[
          ["Original", formatHours(item.original)],
          ["Remaining", formatHours(item.remaining)],
          ["Completed", formatHours(item.completed)],
          ["Logged in Ajour", formatHours(logged || undefined)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {value}
            </div>
          </div>
        ))}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${done * 100}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 rounded-lg border p-4">
          <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">
            Description
          </h2>
          <p className="text-[14px] leading-relaxed whitespace-pre-line">
            {item.note ?? (
              <span className="text-muted-foreground">No description.</span>
            )}
          </p>
        </div>
        <div className="flex flex-col rounded-lg border p-4">
          <h2 className="mb-1 text-[12px] font-medium text-muted-foreground">
            Mapping
          </h2>
          <Property label="Project">{item.project ?? "–"}</Property>
          <Property label="Task">{item.task ?? "–"}</Property>
          <Property label="Status">{item.backlogStatus ?? "–"}</Property>
          <Property label="Priority">
            {item.priority ?? "Follows parent"}
          </Property>
        </div>
        <div className="col-span-2 rounded-lg border p-4">
          <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">
            Subitems
          </h2>
          <Subitems item={item} />
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">
            Time entries
          </h2>
          <Entries item={item} />
        </div>
      </div>
    </div>
  );
}

/** Route component for /backlog/$itemId. */
export function BacklogItemPrototypePage({ itemId }: { itemId: string }) {
  const { items, variant } = useStore();
  const item = items.find((candidate) => candidate.id === itemId);
  const projected = useMemo(() => item, [item]);
  if (!projected) {
    return (
      <div className="p-6 text-[13px] text-muted-foreground">
        Unknown prototype item.
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      {variant === "A" ? <PageA item={projected} /> : null}
      {variant === "B" ? <PageB item={projected} /> : null}
      {variant === "C" ? <PageC item={projected} /> : null}
    </div>
  );
}

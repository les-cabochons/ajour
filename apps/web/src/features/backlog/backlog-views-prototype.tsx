/**
 * PROTOTYPE, throwaway. Never merge to main.
 *
 * Question: what should the Backlog page's list and board look like, Linear-inspired
 * but in Ajour's identity? (design in agents/adr/0002-workflow-states-and-done.md)
 *
 * Three variants on `/backlog`, switched with `?proto=A|B|C` or the floating bar (← →):
 *   A: Linear classic. One toolbar (layout toggle, Filter, Display), single-line rows
 *      grouped by workflow state, and an open board of equal columns.
 *   B: Table and peek. Ajour's column table with headers, a properties peek on the
 *      right for the selected item, and a board with project swimlanes and a folded
 *      Done column.
 *   C: Time first. A workflow rail on the left, two-line rows with estimate progress
 *      and Start entry, and a board of richer cards with a Done drop strip.
 *
 * Mock Azure DevOps and manual items held in memory. Moving into a done state, the
 * Ask mapping, the subitem prompt, Undo and the delayed source write are simulated.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  RiAddLine as PlusIcon,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiBookOpenLine as StoryIcon,
  RiBugLine as BugIcon,
  RiCheckboxBlankCircleLine as ManualIcon,
  RiCloseLine as CloseIcon,
  RiEqualizerLine as DisplayIcon,
  RiFilter3Line as FilterIcon,
  RiFlashlightLine as FeatureIcon,
  RiKanbanView as BoardIcon,
  RiListUnordered as ListIcon,
  RiMore2Line as MoreIcon,
  RiPlayFill as PlayIcon,
  RiTaskLine as TaskIcon,
  RiTimeLine as SettledIcon,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mock data

type Kind = "bug" | "story" | "task" | "feature" | "manual";
type Priority = 0 | 1 | 2 | 3 | 4; // 0 none, 1 urgent … 4 low
type OutMapping = { kind: "default"; sourceState: string } | { kind: "ask" };

interface WorkflowState {
  id: string;
  name: string;
  color: string;
  done?: boolean;
  /** Source states of the "Ajour" Azure DevOps project that map in. */
  sourceStates: string[];
  out?: OutMapping;
}

const WORKFLOW: WorkflowState[] = [
  { id: "none", name: "No state", color: "#94a3b8", sourceStates: [] },
  {
    id: "todo",
    name: "To do",
    color: "#64748b",
    sourceStates: ["New", "Approved"],
    out: { kind: "default", sourceState: "New" },
  },
  {
    id: "progress",
    name: "In progress",
    color: "#d97706",
    sourceStates: ["Active", "Committed"],
    out: { kind: "default", sourceState: "Active" },
  },
  {
    id: "review",
    name: "In review",
    color: "#7c3aed",
    sourceStates: ["Resolved", "In QA"],
    out: { kind: "ask" },
  },
  {
    id: "done",
    name: "Done",
    color: "#059669",
    done: true,
    sourceStates: ["Closed", "Removed"],
    out: { kind: "default", sourceState: "Closed" },
  },
];

const PROJECTS = ["Northwind portal", "Ajour", "Internal"] as const;

interface Item {
  id: string;
  externalId?: number;
  kind: Kind;
  title: string;
  stateId: string;
  sourceState?: string;
  priority: Priority;
  project?: (typeof PROJECTS)[number];
  task?: string;
  parentId?: string;
  originalHours?: number;
  remainingHours?: number;
  loggedHours: number;
  settled?: boolean;
  archived?: boolean;
  archivedAt?: number;
  closedWithParentId?: string;
  running?: boolean;
  createdAt: number;
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 11, 15);

const SEED: Item[] = [
  {
    id: "i1",
    externalId: 48213,
    kind: "story",
    title: "Login page supports SSO with the client's Entra tenant",
    stateId: "progress",
    sourceState: "Active",
    priority: 1,
    project: "Northwind portal",
    task: "Development",
    originalHours: 16,
    remainingHours: 6.5,
    loggedHours: 9.5,
    running: true,
    createdAt: NOW - 12 * DAY,
  },
  {
    id: "i1a",
    externalId: 48214,
    kind: "task",
    title: "Fix token refresh after sleep",
    stateId: "progress",
    sourceState: "Active",
    priority: 0,
    project: "Northwind portal",
    task: "Development",
    parentId: "i1",
    originalHours: 4,
    remainingHours: 1.5,
    loggedHours: 2.5,
    createdAt: NOW - 10 * DAY,
  },
  {
    id: "i1b",
    externalId: 48215,
    kind: "task",
    title: "Map Entra groups to portal roles",
    stateId: "todo",
    sourceState: "New",
    priority: 0,
    project: "Northwind portal",
    task: "Development",
    parentId: "i1",
    originalHours: 6,
    remainingHours: 6,
    loggedHours: 0,
    createdAt: NOW - 10 * DAY,
  },
  {
    id: "i1c",
    externalId: 48216,
    kind: "task",
    title: "Sign-in error copy",
    stateId: "review",
    sourceState: "Resolved",
    priority: 0,
    project: "Northwind portal",
    task: "Development",
    parentId: "i1",
    originalHours: 1,
    remainingHours: 0,
    loggedHours: 1,
    createdAt: NOW - 9 * DAY,
  },
  {
    id: "i2",
    externalId: 48190,
    kind: "bug",
    title: "Invoice PDF cuts the last line on A4",
    stateId: "review",
    sourceState: "In QA",
    priority: 2,
    project: "Northwind portal",
    task: "Support",
    originalHours: 3,
    remainingHours: 0.5,
    loggedHours: 2.75,
    settled: true,
    createdAt: NOW - 6 * DAY,
  },
  {
    id: "i3",
    externalId: 48302,
    kind: "feature",
    title: "Export timesheets to the client's Workday tenant",
    stateId: "todo",
    sourceState: "Approved",
    priority: 2,
    project: "Ajour",
    task: "Development",
    originalHours: 24,
    remainingHours: 24,
    loggedHours: 0,
    createdAt: NOW - 4 * DAY,
  },
  {
    id: "i4",
    externalId: 48311,
    kind: "bug",
    title: "Week grid loses focus after Undo",
    stateId: "progress",
    sourceState: "Committed",
    priority: 3,
    project: "Ajour",
    task: "Development",
    originalHours: 2,
    remainingHours: 1,
    loggedHours: 1.25,
    createdAt: NOW - 3 * DAY,
  },
  {
    id: "i5",
    kind: "manual",
    title: "Prepare the Q4 estimate review with Marie",
    stateId: "todo",
    priority: 3,
    project: "Internal",
    task: "Meetings",
    originalHours: 2,
    remainingHours: 2,
    loggedHours: 0,
    createdAt: NOW - 2 * DAY,
  },
  {
    id: "i6",
    externalId: 48330,
    kind: "story",
    title: "Board view for the backlog",
    stateId: "none",
    sourceState: "Design",
    priority: 2,
    project: "Ajour",
    originalHours: 20,
    remainingHours: 20,
    loggedHours: 0,
    createdAt: NOW - 1 * DAY,
  },
  {
    id: "i7",
    externalId: 48140,
    kind: "bug",
    title: "Session expires during long form entry",
    stateId: "review",
    sourceState: "Resolved",
    priority: 1,
    project: "Northwind portal",
    task: "Support",
    originalHours: 5,
    remainingHours: 0,
    loggedHours: 5.5,
    createdAt: NOW - 8 * DAY,
  },
  {
    id: "i8",
    kind: "manual",
    title: "Update the onboarding checklist",
    stateId: "todo",
    priority: 0,
    project: "Internal",
    loggedHours: 0,
    createdAt: NOW - 5 * DAY,
  },
  {
    id: "i9",
    externalId: 48100,
    kind: "story",
    title: "Customer list paging",
    stateId: "done",
    sourceState: "Closed",
    priority: 3,
    project: "Northwind portal",
    task: "Development",
    originalHours: 8,
    remainingHours: 0,
    loggedHours: 7,
    archived: true,
    archivedAt: NOW - 10 * DAY,
    createdAt: NOW - 20 * DAY,
  },
  {
    id: "i10",
    externalId: 48122,
    kind: "bug",
    title: "Dark mode contrast on badges",
    stateId: "done",
    sourceState: "Closed",
    priority: 4,
    project: "Ajour",
    task: "Development",
    originalHours: 1,
    remainingHours: 0,
    loggedHours: 0.75,
    archived: true,
    archivedAt: NOW - 2 * DAY,
    createdAt: NOW - 15 * DAY,
  },
  {
    id: "i11",
    externalId: 48340,
    kind: "task",
    title: "Write the release note for 0.9",
    stateId: "progress",
    sourceState: "Active",
    priority: 4,
    project: "Ajour",
    task: "Documentation",
    originalHours: 1,
    remainingHours: 1,
    loggedHours: 0,
    createdAt: NOW - 1 * DAY,
  },
];

// ---------------------------------------------------------------------------
// View settings

type Layout = "list" | "board";
type Grouping = "state" | "priority" | "project" | "none";
type Ordering = "custom" | "priority" | "created" | "title";
type DoneWindow = "week" | "all" | "none";
type PropertyKey = "id" | "priority" | "project" | "estimate" | "sourceState";

interface ViewSettings {
  layout: Layout;
  grouping: Grouping;
  ordering: Ordering;
  showSubitems: boolean;
  showSettled: boolean;
  doneWindow: DoneWindow;
  properties: Record<PropertyKey, boolean>;
}

const DEFAULT_VIEW: ViewSettings = {
  layout: "list",
  grouping: "state",
  ordering: "custom",
  showSubitems: true,
  showSettled: true,
  doneWindow: "week",
  properties: {
    id: true,
    priority: true,
    project: true,
    estimate: true,
    sourceState: false,
  },
};

type FilterField = "state" | "priority" | "project" | "kind";
interface Filter {
  field: FilterField;
  value: string;
}

const PRIORITY_LABELS: Record<Priority, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

const KIND_LABELS: Record<Kind, string> = {
  bug: "Bug",
  story: "User story",
  task: "Task",
  feature: "Feature",
  manual: "Local",
};

// ---------------------------------------------------------------------------
// Store: one module-level store so the variants share the same items.

interface Pending {
  kind: "subitems" | "ask";
  itemId: string;
  targetStateId: string;
  /** Set once the subitem question is answered. */
  includeSubitems?: boolean;
}

interface Toast {
  id: number;
  title: string;
  writes: string[];
  undo: Item[];
}

interface Store {
  items: Item[];
  view: ViewSettings;
  filters: Filter[];
  pending: Pending | null;
  toast: Toast | null;
  writeLog: string[];
  selectedId: string | null;
  rememberSubitems: "ask" | "include" | "leave";
}

let store: Store = {
  items: SEED,
  view: DEFAULT_VIEW,
  filters: [],
  pending: null,
  toast: null,
  writeLog: [],
  selectedId: "i1",
  rememberSubitems: "ask",
};
const listeners = new Set<() => void>();

function setStore(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((listener) => listener());
}

function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return store;
}

function setView(patch: Partial<ViewSettings>) {
  setStore({ view: { ...store.view, ...patch } });
}

function stateById(id: string) {
  return WORKFLOW.find((state) => state.id === id) ?? WORKFLOW[0]!;
}

function openSubitems(item: Item, items = store.items) {
  return items.filter((other) => other.parentId === item.id && !other.archived);
}

function label(item: Item) {
  return item.externalId ? `#${item.externalId}` : `LOC-${item.id.slice(1)}`;
}

/** Moving an item between workflow states, with the done, Ask and subitem rules. */
const actions = {
  requestMove(itemId: string, targetStateId: string) {
    const item = store.items.find((other) => other.id === itemId);
    if (!item || item.stateId === targetStateId) return;
    const target = stateById(targetStateId);
    if (
      target.done &&
      openSubitems(item).length > 0 &&
      store.rememberSubitems === "ask"
    ) {
      setStore({ pending: { kind: "subitems", itemId, targetStateId } });
      return;
    }
    actions.continueMove({
      kind: "subitems",
      itemId,
      targetStateId,
      includeSubitems: store.rememberSubitems === "include",
    });
  },
  continueMove(pending: Pending, chosenSourceState?: string) {
    const item = store.items.find((other) => other.id === pending.itemId)!;
    const target = stateById(pending.targetStateId);
    if (
      item.externalId &&
      target.out?.kind === "ask" &&
      chosenSourceState === undefined
    ) {
      setStore({ pending: { ...pending, kind: "ask" } });
      return;
    }
    actions.applyMove(pending, chosenSourceState);
  },
  applyMove(pending: Pending, chosenSourceState?: string) {
    const before = store.items;
    const item = before.find((other) => other.id === pending.itemId)!;
    const target = stateById(pending.targetStateId);
    const from = stateById(item.stateId);
    const sourceStateFor = (moved: Item) =>
      moved.externalId
        ? (chosenSourceState ??
          (target.out?.kind === "default" ? target.out.sourceState : undefined))
        : undefined;
    const moving = new Set([item.id]);
    if (target.done && pending.includeSubitems) {
      openSubitems(item).forEach((sub) => moving.add(sub.id));
    }
    // Leaving done brings back the subitems that closed with the parent.
    if (from.done && !target.done) {
      before
        .filter((other) => other.closedWithParentId === item.id)
        .forEach((sub) => moving.add(sub.id));
    }
    const writes: string[] = [];
    const items = before.map((other) => {
      if (!moving.has(other.id)) return other;
      const sourceState = sourceStateFor(other);
      if (sourceState) writes.push(`${label(other)} → ${sourceState}`);
      return {
        ...other,
        stateId: target.id,
        sourceState: sourceState ?? other.sourceState,
        archived: Boolean(target.done),
        archivedAt: target.done ? NOW : undefined,
        settled: target.done ? false : from.done ? false : other.settled,
        running: target.done ? false : other.running,
        closedWithParentId:
          target.done && other.id !== item.id ? item.id : undefined,
      };
    });
    const extra = moving.size - 1;
    setStore({
      items,
      pending: null,
      toast: {
        id: Date.now(),
        title: target.done
          ? `${item.title} closed${extra ? ` with ${extra} subitem${extra > 1 ? "s" : ""}` : ""}`
          : from.done
            ? `${item.title} reopened in ${target.name}`
            : `Moved to ${target.name}`,
        writes,
        undo: before,
      },
    });
  },
  setPriority(itemId: string, priority: Priority) {
    setStore({
      items: store.items.map((item) =>
        item.id === itemId ? { ...item, priority } : item,
      ),
    });
  },
  reorder(itemId: string, beforeId: string) {
    if (itemId === beforeId) return;
    const items = store.items.filter((item) => item.id !== itemId);
    const index = items.findIndex((item) => item.id === beforeId);
    items.splice(
      index,
      0,
      store.items.find((item) => item.id === itemId)!,
    );
    setStore({ items });
  },
  start(itemId: string) {
    setStore({
      items: store.items.map((item) => ({
        ...item,
        running: item.id === itemId,
      })),
    });
  },
};

// ---------------------------------------------------------------------------
// Derived view: filter, order and group

interface Group {
  key: string;
  label: string;
  icon?: ReactNode;
  stateId?: string;
  items: Item[];
}

function visibleItems(items: Item[], view: ViewSettings, filters: Filter[]) {
  return items.filter((item) => {
    const state = stateById(item.stateId);
    if (item.archived) {
      if (!state.done || view.doneWindow === "none") return false;
      if (
        view.doneWindow === "week" &&
        (item.archivedAt ?? NOW) < NOW - 7 * DAY
      )
        return false;
    }
    if (!view.showSettled && item.settled) return false;
    if (!view.showSubitems && item.parentId) return false;
    return filters.every((filter) => {
      switch (filter.field) {
        case "state":
          return item.stateId === filter.value;
        case "priority":
          return String(item.priority) === filter.value;
        case "project":
          return item.project === filter.value;
        case "kind":
          return item.kind === filter.value;
      }
    });
  });
}

function orderItems(items: Item[], ordering: Ordering) {
  const custom = new Map(store.items.map((item, index) => [item.id, index]));
  const byCustom = (a: Item, b: Item) => custom.get(a.id)! - custom.get(b.id)!;
  return [...items].sort((a, b) => {
    switch (ordering) {
      case "priority":
        return (a.priority || 9) - (b.priority || 9) || byCustom(a, b);
      case "created":
        return b.createdAt - a.createdAt;
      case "title":
        return a.title.localeCompare(b.title);
      default:
        return byCustom(a, b);
    }
  });
}

function groupItems(items: Item[], view: ViewSettings): Group[] {
  const ordered = orderItems(items, view.ordering);
  switch (view.grouping) {
    case "state":
      return WORKFLOW.map((state) => ({
        key: state.id,
        label: state.name,
        icon: <StateIcon state={state} />,
        stateId: state.id,
        items: ordered.filter((item) => item.stateId === state.id),
      })).filter((group) => group.stateId !== "none" || group.items.length);
    case "priority":
      return ([1, 2, 3, 4, 0] as Priority[]).map((priority) => ({
        key: `p${priority}`,
        label: PRIORITY_LABELS[priority],
        icon: <PriorityIcon priority={priority} />,
        items: ordered.filter((item) => item.priority === priority),
      }));
    case "project":
      return [...PROJECTS, undefined].map((project) => ({
        key: project ?? "no-project",
        label: project ?? "No project",
        items: ordered.filter((item) => item.project === project),
      }));
    default:
      return [{ key: "all", label: "All items", items: ordered }];
  }
}

function useDerived() {
  const s = useStore();
  const items = visibleItems(s.items, s.view, s.filters);
  // The board always needs columns.
  const groupView: ViewSettings =
    s.view.layout === "board" && s.view.grouping === "none"
      ? { ...s.view, grouping: "state" }
      : s.view;
  return { s, items, groups: groupItems(items, groupView) };
}

// ---------------------------------------------------------------------------
// Icons

function StateIcon({
  state,
  className,
}: {
  state: WorkflowState;
  className?: string;
}) {
  const index = WORKFLOW.indexOf(state);
  const fill = state.done ? 1 : state.id === "none" ? 0 : (index - 1) / 3;
  const r = 5;
  const circumference = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn("size-3.5 shrink-0", className)}
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke={state.color}
        strokeWidth="1.5"
        strokeDasharray={state.id === "none" ? "2 2" : undefined}
      />
      {state.done ? (
        <>
          <circle cx="7" cy="7" r="6" fill={state.color} />
          <path
            d="M4.3 7.2 6.2 9l3.5-3.8"
            stroke="white"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        </>
      ) : fill > 0 ? (
        <circle
          cx="7"
          cy="7"
          r={r / 2}
          fill="none"
          stroke={state.color}
          strokeWidth={r}
          strokeDasharray={`${(fill * circumference) / 2} ${circumference}`}
          transform="rotate(-90 7 7)"
        />
      ) : null}
    </svg>
  );
}

function PriorityIcon({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  if (priority === 0) {
    return (
      <svg
        viewBox="0 0 14 14"
        className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
        aria-hidden="true"
      >
        {[2, 6, 10].map((x) => (
          <rect
            key={x}
            x={x - 0.5}
            y="6.25"
            width="2.5"
            height="1.5"
            rx="0.5"
            fill="currentColor"
            opacity="0.6"
          />
        ))}
      </svg>
    );
  }
  if (priority === 1) {
    return (
      <svg
        viewBox="0 0 14 14"
        className={cn("size-3.5 shrink-0", className)}
        aria-hidden="true"
      >
        <rect x="1" y="1" width="12" height="12" rx="3" fill="#ea580c" />
        <rect
          x="6.25"
          y="3.5"
          width="1.5"
          height="4.5"
          rx="0.75"
          fill="white"
        />
        <rect
          x="6.25"
          y="9.25"
          width="1.5"
          height="1.5"
          rx="0.75"
          fill="white"
        />
      </svg>
    );
  }
  const bars = 5 - priority; // high 3, medium 2, low 1
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn("size-3.5 shrink-0 text-foreground", className)}
      aria-hidden="true"
    >
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={1.5 + bar * 4}
          y={9 - bar * 3}
          width="3"
          height={3 + bar * 3}
          rx="0.75"
          fill="currentColor"
          opacity={bar < bars ? 0.9 : 0.2}
        />
      ))}
    </svg>
  );
}

function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const Icon = {
    bug: BugIcon,
    story: StoryIcon,
    task: TaskIcon,
    feature: FeatureIcon,
    manual: ManualIcon,
  }[kind];
  const color = {
    bug: "text-red-500",
    story: "text-sky-500",
    task: "text-amber-500",
    feature: "text-violet-500",
    manual: "text-muted-foreground",
  }[kind];
  return <Icon className={cn("size-3.5 shrink-0", color, className)} />;
}

function hours(value?: number) {
  if (value === undefined) return "";
  return `${Number.isInteger(value) ? value : value.toFixed(value * 4 === Math.round(value * 4) ? 2 : 1).replace(/0$/, "")}h`;
}

// ---------------------------------------------------------------------------
// Pickers (shared: they are the same control in every variant)

function StatePicker({
  item,
  children,
  className,
}: {
  item: Item;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = WORKFLOW.filter(
    (state) =>
      state.id !== "none" &&
      state.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex shrink-0 items-center rounded-[var(--control-radius)] hover:bg-[var(--hover-bg)]",
          className,
        )}
        aria-label={`Change state, now ${stateById(item.stateId).name}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 gap-1 rounded-lg p-1"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Change state…"
          className="mb-1 h-8 w-full rounded-md border border-border bg-transparent px-2 text-[13px] outline-none"
        />
        {options.map((state, index) => (
          <button
            key={state.id}
            type="button"
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover-bg)]",
              state.id === item.stateId && "bg-[var(--hover-bg)]",
            )}
            onClick={() => {
              setOpen(false);
              actions.requestMove(item.id, state.id);
            }}
          >
            <StateIcon state={state} />
            <span className="flex-1">{state.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {index + 1}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function PriorityPicker({
  item,
  className,
}: {
  item: Item;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--control-radius)] hover:bg-[var(--hover-bg)]",
          className,
        )}
        aria-label={`Change priority, now ${PRIORITY_LABELS[item.priority]}`}
        onClick={(event) => event.stopPropagation()}
      >
        <PriorityIcon priority={item.priority} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-48 gap-0.5 rounded-lg p-1"
        onClick={(event) => event.stopPropagation()}
      >
        {([0, 1, 2, 3, 4] as Priority[]).map((priority) => (
          <button
            key={priority}
            type="button"
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover-bg)]",
              priority === item.priority && "bg-[var(--hover-bg)]",
            )}
            onClick={() => {
              setOpen(false);
              actions.setPriority(item.id, priority);
            }}
          >
            <PriorityIcon priority={priority} />
            <span className="flex-1">{PRIORITY_LABELS[priority]}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {priority}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ItemMenu({ item }: { item: Item }) {
  const state = stateById(item.stateId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex size-6 items-center justify-center rounded-[var(--control-radius)] text-muted-foreground hover:bg-[var(--hover-bg)]"
        aria-label={`Actions for ${item.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => actions.start(item.id)}>
            Start entry
          </DropdownMenuItem>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Snooze…</DropdownMenuItem>
          <DropdownMenuItem>Settle</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Move to state</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {WORKFLOW.filter((other) => other.id !== "none").map((other) => (
              <DropdownMenuItem
                key={other.id}
                onClick={() => actions.requestMove(item.id, other.id)}
              >
                <StateIcon state={other} />
                {other.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {item.externalId && state.sourceStates.length > 1 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Change source state</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuLabel>
                In {state.name}, in Azure DevOps
              </DropdownMenuLabel>
              {state.sourceStates.map((sourceState) => (
                <DropdownMenuItem
                  key={sourceState}
                  onClick={() =>
                    setStore({
                      items: store.items.map((other) =>
                        other.id === item.id
                          ? { ...other, sourceState }
                          : other,
                      ),
                      toast: {
                        id: Date.now(),
                        title: `Source state set to ${sourceState}`,
                        writes: [`${label(item)} → ${sourceState}`],
                        undo: store.items,
                      },
                    })
                  }
                >
                  {sourceState}
                  {sourceState === item.sourceState ? " ✓" : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Toolbar pieces: layout toggle, Filter, Display

function LayoutToggle() {
  const { view } = useStore();
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {(
        [
          ["list", ListIcon, "List"],
          ["board", BoardIcon, "Board"],
        ] as const
      ).map(([layout, Icon, name]) => (
        <button
          key={layout}
          type="button"
          aria-label={name}
          aria-pressed={view.layout === layout}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-[3px] px-1.5 text-[12px] text-muted-foreground",
            view.layout === layout && "bg-muted text-foreground",
          )}
          onClick={() => setView({ layout })}
        >
          <Icon className="size-3.5" />
          {name}
        </button>
      ))}
    </div>
  );
}

const FILTER_FIELDS: {
  field: FilterField;
  name: string;
  options: { value: string; label: string; icon?: ReactNode }[];
}[] = [
  {
    field: "state",
    name: "State",
    options: WORKFLOW.map((state) => ({
      value: state.id,
      label: state.name,
      icon: <StateIcon state={state} />,
    })),
  },
  {
    field: "priority",
    name: "Priority",
    options: ([1, 2, 3, 4, 0] as Priority[]).map((priority) => ({
      value: String(priority),
      label: PRIORITY_LABELS[priority],
      icon: <PriorityIcon priority={priority} />,
    })),
  },
  {
    field: "project",
    name: "Project",
    options: PROJECTS.map((project) => ({ value: project, label: project })),
  },
  {
    field: "kind",
    name: "Type",
    options: (Object.keys(KIND_LABELS) as Kind[]).map((kind) => ({
      value: kind,
      label: KIND_LABELS[kind],
      icon: <KindIcon kind={kind} />,
    })),
  },
];

function FilterButton({ compact }: { compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? "icon-sm" : "sm"}
            aria-label="Filter"
          />
        }
      >
        <FilterIcon />
        {compact ? null : "Filter"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {FILTER_FIELDS.map((field) => (
          <DropdownMenuSub key={field.field}>
            <DropdownMenuSubTrigger>{field.name}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {field.options.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() =>
                    setStore({
                      filters: [
                        ...store.filters.filter(
                          (filter) => filter.field !== field.field,
                        ),
                        { field: field.field, value: option.value },
                      ],
                    })
                  }
                >
                  {option.icon}
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterChips() {
  const { filters } = useStore();
  if (filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((filter) => {
        const field = FILTER_FIELDS.find(
          (item) => item.field === filter.field,
        )!;
        const option = field.options.find(
          (item) => item.value === filter.value,
        );
        return (
          <span
            key={filter.field}
            className="inline-flex h-6 items-center overflow-hidden rounded-md border border-border text-[12px]"
          >
            <span className="px-2 text-muted-foreground">{field.name}</span>
            <span className="border-l border-border px-2 text-muted-foreground">
              is
            </span>
            <span className="flex items-center gap-1 border-l border-border px-2">
              {option?.icon}
              {option?.label}
            </span>
            <button
              type="button"
              aria-label={`Remove ${field.name} filter`}
              className="flex h-full items-center border-l border-border px-1 hover:bg-[var(--hover-bg)]"
              onClick={() =>
                setStore({
                  filters: store.filters.filter(
                    (item) => item.field !== filter.field,
                  ),
                })
              }
            >
              <CloseIcon className="size-3" />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        className="px-1 text-[12px] text-muted-foreground hover:text-foreground"
        onClick={() => setStore({ filters: [] })}
      >
        Clear
      </button>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "h-6 rounded-[3px] px-2 text-[12px] text-muted-foreground",
            value === option.value && "bg-background text-foreground shadow-sm",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function DisplayButton({ compact }: { compact?: boolean }) {
  const { view } = useStore();
  const row = (name: string, control: ReactNode) => (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-muted-foreground">{name}</span>
      {control}
    </div>
  );
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? "icon-sm" : "sm"}
            aria-label="Display options"
          />
        }
      >
        <DisplayIcon />
        {compact ? null : "Display"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 rounded-lg p-3">
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ["list", ListIcon, "List"],
              ["board", BoardIcon, "Board"],
            ] as const
          ).map(([layout, Icon, name]) => (
            <button
              key={layout}
              type="button"
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-1 rounded-md border border-border text-[12px] text-muted-foreground",
                view.layout === layout &&
                  "border-foreground/40 bg-muted text-foreground",
              )}
              onClick={() => setView({ layout })}
            >
              <Icon className="size-4" />
              {name}
            </button>
          ))}
        </div>
        {row(
          "Grouping",
          <select
            className="h-7 rounded-md border border-border bg-transparent px-1.5 text-[13px]"
            value={view.grouping}
            onChange={(event) =>
              setView({ grouping: event.target.value as Grouping })
            }
          >
            <option value="state">Workflow state</option>
            <option value="priority">Priority</option>
            <option value="project">Project</option>
            <option value="none" disabled={view.layout === "board"}>
              No grouping
            </option>
          </select>,
        )}
        {row(
          "Ordering",
          <select
            className="h-7 rounded-md border border-border bg-transparent px-1.5 text-[13px]"
            value={view.ordering}
            onChange={(event) =>
              setView({ ordering: event.target.value as Ordering })
            }
          >
            <option value="custom">Custom</option>
            <option value="priority">Priority</option>
            <option value="created">Created</option>
            <option value="title">Title</option>
          </select>,
        )}
        <div className="h-px bg-border" />
        {row(
          "Done items",
          <Segmented
            value={view.doneWindow}
            onChange={(doneWindow) => setView({ doneWindow })}
            options={[
              { value: "week", label: "Past week" },
              { value: "all", label: "All" },
              { value: "none", label: "None" },
            ]}
          />,
        )}
        {row(
          "Show settled items",
          <Switch
            size="sm"
            checked={view.showSettled}
            onCheckedChange={(showSettled) => setView({ showSettled })}
          />,
        )}
        {row(
          "Show subitems",
          <Switch
            size="sm"
            checked={view.showSubitems}
            onCheckedChange={(showSubitems) => setView({ showSubitems })}
          />,
        )}
        <div className="h-px bg-border" />
        <div className="text-[12px] text-muted-foreground">
          Display properties
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["id", "ID"],
              ["priority", "Priority"],
              ["project", "Project"],
              ["estimate", "Estimate"],
              ["sourceState", "Source state"],
            ] as [PropertyKey, string][]
          ).map(([key, name]) => (
            <button
              key={key}
              type="button"
              className={cn(
                "h-6 rounded-md border border-border px-2 text-[12px] text-muted-foreground",
                view.properties[key] &&
                  "border-foreground/30 bg-muted text-foreground",
              )}
              onClick={() =>
                setView({
                  properties: {
                    ...view.properties,
                    [key]: !view.properties[key],
                  },
                })
              }
            >
              {name}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NewItemButton({ compact }: { compact?: boolean }) {
  return (
    <Button size="sm" aria-label="New backlog item">
      <PlusIcon data-icon="inline-start" />
      {compact ? null : "New backlog item"}
    </Button>
  );
}

function UnmappedNotice() {
  const unmapped = store.items.filter((item) => item.stateId === "none");
  if (unmapped.length === 0) return null;
  return (
    <span className="text-[12px] text-muted-foreground">
      1 source state not mapped ·{" "}
      <a className="underline underline-offset-2" href="#workflow">
        Map in Settings
      </a>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared bits of a row or card

function ParentLine({ item }: { item: Item }) {
  const parent = store.items.find((other) => other.id === item.parentId);
  if (!parent) return null;
  return (
    <span className="truncate text-[12px] text-muted-foreground">
      ↳ {parent.title}
    </span>
  );
}

function SettledMarker() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[var(--control-radius)] bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
      <SettledIcon className="size-3" />
      Settled
    </span>
  );
}

function RunningDot() {
  return (
    <span
      className="size-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_color-mix(in_srgb,#10b981_25%,transparent)]"
      aria-label="Running"
    />
  );
}

function SubitemProgress({ item }: { item: Item }) {
  const subitems = store.items.filter((other) => other.parentId === item.id);
  if (subitems.length === 0) return null;
  const done = subitems.filter((sub) => stateById(sub.stateId).done).length;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
      <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
        <circle
          cx="6"
          cy="6"
          r="5"
          fill="none"
          stroke="currentColor"
          opacity="0.3"
          strokeWidth="1.5"
        />
        <circle
          cx="6"
          cy="6"
          r="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={`${(done / subitems.length) * 31.4} 31.4`}
          transform="rotate(-90 6 6)"
        />
      </svg>
      {done}/{subitems.length}
    </span>
  );
}

/** HTML5 drag for the prototype only; the real page uses lib/table-drag.ts. */
function dragProps(item: Item) {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData("text/plain", item.id);
      event.dataTransfer.effectAllowed = "move";
    },
  };
}

function dropProps(
  onDropItem: (itemId: string) => void,
  setOver?: (over: boolean) => void,
) {
  return {
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setOver?.(true);
    },
    onDragLeave: () => setOver?.(false),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setOver?.(false);
      const itemId = event.dataTransfer.getData("text/plain");
      if (itemId) onDropItem(itemId);
    },
  };
}

function dropOnGroup(group: Group) {
  return (itemId: string) => {
    if (group.stateId) actions.requestMove(itemId, group.stateId);
  };
}

/** Within a column with custom order, a drop on a card reorders; elsewhere it moves. */
function dropOnCard(group: Group, card: Item) {
  return (itemId: string) => {
    const item = store.items.find((other) => other.id === itemId)!;
    if (item.stateId === card.stateId || !group.stateId) {
      if (store.view.ordering === "custom") actions.reorder(itemId, card.id);
      return;
    }
    actions.requestMove(itemId, group.stateId);
  };
}

// ---------------------------------------------------------------------------
// Variant A: Linear classic

function VariantA() {
  const { s, groups } = useDerived();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5">
        <h1 className="font-heading text-[17px] font-medium">Backlog</h1>
        <span className="ml-1 font-mono text-[12px] text-muted-foreground">
          {s.items.filter((item) => !item.archived).length}
        </span>
        <div className="ml-3">
          <LayoutToggle />
        </div>
        <div className="flex-1" />
        <UnmappedNotice />
        <FilterButton />
        <DisplayButton />
        <NewItemButton />
      </header>
      {s.filters.length ? (
        <div className="border-b border-border px-5 py-2">
          <FilterChips />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {s.view.layout === "list" ? (
          <ListA groups={groups} />
        ) : (
          <BoardA groups={groups} />
        )}
      </div>
    </div>
  );
}

function ListA({ groups }: { groups: Group[] }) {
  const { view } = useStore();
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="pb-24" data-focus-scope>
      {groups.map((group) => (
        <section
          key={group.key}
          {...dropProps(dropOnGroup(group), (isOver) =>
            setOver(isOver ? group.key : null),
          )}
          className={cn(over === group.key && "bg-[var(--hover-bg)]")}
        >
          <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-border bg-muted/70 px-5 text-[13px] backdrop-blur">
            {group.icon}
            <span className="font-medium">{group.label}</span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {group.items.length}
            </span>
            <div className="flex-1" />
            {group.stateId && !stateById(group.stateId).done ? (
              <button
                type="button"
                aria-label={`New backlog item in ${group.label}`}
                className="inline-flex size-6 items-center justify-center rounded-[var(--control-radius)] text-muted-foreground hover:bg-[var(--hover-bg)]"
              >
                <PlusIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
          {group.items.map((item) => (
            <div
              key={item.id}
              tabIndex={0}
              {...dragProps(item)}
              {...dropProps(dropOnCard(group, item))}
              className={cn(
                "group flex h-10 cursor-default items-center gap-2.5 border-b border-border/60 px-5 text-[13px] hover:bg-[var(--hover-bg)] focus-visible:bg-[var(--hover-bg)] focus-visible:outline-none",
                item.archived && "text-muted-foreground",
              )}
            >
              {view.properties.priority ? <PriorityPicker item={item} /> : null}
              {view.properties.id ? (
                <span className="w-14 shrink-0 font-mono text-[12px] text-muted-foreground">
                  {label(item)}
                </span>
              ) : null}
              <StatePicker item={item} className="size-6 justify-center">
                <StateIcon state={stateById(item.stateId)} />
              </StatePicker>
              <KindIcon kind={item.kind} />
              <span
                className={cn(
                  "min-w-0 shrink truncate",
                  item.archived &&
                    "line-through decoration-muted-foreground/50",
                )}
              >
                {item.title}
              </span>
              {item.parentId ? (
                <span className="max-w-56 min-w-0 shrink-[2]">
                  <ParentLine item={item} />
                </span>
              ) : null}
              <SubitemProgress item={item} />
              {item.running ? <RunningDot /> : null}
              {item.settled ? <SettledMarker /> : null}
              <div className="flex-1" />
              {view.properties.sourceState && item.sourceState ? (
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {item.sourceState}
                </span>
              ) : null}
              {view.properties.project && item.project ? (
                <span className="shrink-0 rounded-full border border-border px-2 py-px text-[12px] text-muted-foreground">
                  {item.project}
                </span>
              ) : null}
              {view.properties.estimate && item.remainingHours !== undefined ? (
                <span className="w-12 shrink-0 text-right font-mono text-[12px] text-muted-foreground">
                  {hours(item.remainingHours)}
                </span>
              ) : (
                <span className="w-12 shrink-0" />
              )}
              <span className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                <ItemMenu item={item} />
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function BoardA({ groups }: { groups: Group[] }) {
  const { view } = useStore();
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4 pb-20">
      {groups.map((group) => (
        <section
          key={group.key}
          {...dropProps(dropOnGroup(group), (isOver) =>
            setOver(isOver ? group.key : null),
          )}
          className={cn(
            "flex w-[280px] shrink-0 flex-col rounded-lg bg-muted/50",
            over === group.key && "ring-2 ring-ring/40",
          )}
        >
          <div className="flex h-10 shrink-0 items-center gap-2 px-3 text-[13px]">
            {group.icon}
            <span className="font-medium">{group.label}</span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {group.items.length}
            </span>
            <div className="flex-1" />
            {group.stateId && !stateById(group.stateId).done ? (
              <button
                type="button"
                aria-label={`New backlog item in ${group.label}`}
                className="inline-flex size-6 items-center justify-center rounded-[var(--control-radius)] text-muted-foreground hover:bg-[var(--hover-bg)]"
              >
                <PlusIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {group.items.map((item) => (
              <article
                key={item.id}
                tabIndex={0}
                {...dragProps(item)}
                {...dropProps(dropOnCard(group, item))}
                className={cn(
                  "group flex cursor-grab flex-col gap-1.5 rounded-md border border-border bg-card p-2.5 text-[13px] shadow-[var(--shadow-sm)] hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-ring",
                  (item.archived || item.settled) && "opacity-75",
                )}
              >
                <div className="flex items-center gap-1.5">
                  {view.properties.id ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {label(item)}
                    </span>
                  ) : null}
                  <div className="flex-1" />
                  {item.running ? <RunningDot /> : null}
                  <span className="opacity-0 group-hover:opacity-100">
                    <ItemMenu item={item} />
                  </span>
                </div>
                <div className="flex items-start gap-1.5">
                  <StatePicker item={item} className="mt-0.5">
                    <StateIcon state={stateById(item.stateId)} />
                  </StatePicker>
                  <span className="line-clamp-2 leading-snug">
                    {item.title}
                  </span>
                </div>
                {item.parentId ? <ParentLine item={item} /> : null}
                <div className="flex flex-wrap items-center gap-1.5">
                  {view.properties.priority ? (
                    <span className="rounded-[var(--control-radius)] border border-border">
                      <PriorityPicker item={item} className="size-5" />
                    </span>
                  ) : null}
                  <KindIcon kind={item.kind} />
                  {item.settled ? <SettledMarker /> : null}
                  <SubitemProgress item={item} />
                  {view.properties.project && item.project ? (
                    <span className="rounded-full border border-border px-1.5 text-[11px] text-muted-foreground">
                      {item.project}
                    </span>
                  ) : null}
                  {view.properties.sourceState && item.sourceState ? (
                    <span className="text-[11px] text-muted-foreground">
                      {item.sourceState}
                    </span>
                  ) : null}
                  <div className="flex-1" />
                  {view.properties.estimate &&
                  item.remainingHours !== undefined ? (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {hours(item.remainingHours)}
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant B: Table and peek

function VariantB() {
  const { s, groups } = useDerived();
  const selected = s.items.find((item) => item.id === s.selectedId) ?? null;
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-col gap-2 border-b border-border px-5 pt-4 pb-3">
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-[22px] font-medium">Backlog</h1>
            <div className="flex-1" />
            <NewItemButton />
          </div>
          <div className="flex items-center gap-1">
            <Segmented
              value={s.view.layout}
              onChange={(layout) => setView({ layout })}
              options={[
                { value: "list", label: "List" },
                { value: "board", label: "Board" },
              ]}
            />
            <span className="mx-2 h-4 w-px bg-border" />
            <FilterButton />
            <DisplayButton />
            <div className="ml-2 min-w-0 flex-1">
              <FilterChips />
            </div>
            <UnmappedNotice />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {s.view.layout === "list" ? <ListB groups={groups} /> : <BoardB />}
        </div>
      </div>
      {selected ? <PeekB item={selected} /> : null}
    </div>
  );
}

function ListB({ groups }: { groups: Group[] }) {
  const { view, selectedId } = useStore();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <thead className="sticky top-0 z-10 bg-background">
        <tr className="h-8 border-b border-border text-left text-[11px] tracking-wide text-muted-foreground uppercase">
          <th className="w-10 pl-5 font-medium">Pri</th>
          <th className="font-medium">Backlog item</th>
          <th className="w-32 font-medium">State</th>
          {view.properties.project ? (
            <th className="w-32 font-medium">Project</th>
          ) : null}
          {view.properties.estimate ? (
            <th className="w-24 pr-2 text-right font-medium">Left / logged</th>
          ) : null}
          <th className="w-10" />
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <Fragment key={group.key}>
            <tr
              className="h-8 border-b border-border bg-muted/50"
              {...dropProps(dropOnGroup(group))}
            >
              <td colSpan={6} className="pl-3">
                <button
                  type="button"
                  className="flex items-center gap-2 text-[12px]"
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (!next.delete(group.key)) next.add(group.key);
                      return next;
                    })
                  }
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 transition-transform",
                      !collapsed.has(group.key) && "rotate-90",
                    )}
                  />
                  {group.icon}
                  <span className="font-medium">{group.label}</span>
                  <span className="font-mono text-muted-foreground">
                    {group.items.length}
                  </span>
                </button>
              </td>
            </tr>
            {collapsed.has(group.key)
              ? null
              : group.items.map((item) => (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    {...dragProps(item)}
                    {...dropProps(dropOnCard(group, item))}
                    onClick={() => setStore({ selectedId: item.id })}
                    className={cn(
                      "group h-12 border-b border-border/60 hover:bg-[var(--hover-bg)]",
                      selectedId === item.id &&
                        "bg-[var(--highlight-bg)] hover:bg-[var(--highlight-bg)]",
                      item.archived && "text-muted-foreground",
                    )}
                  >
                    <td className="pl-4">
                      <PriorityPicker item={item} />
                    </td>
                    <td className="min-w-0 overflow-hidden py-1">
                      <div
                        className={cn(
                          "flex min-w-0 items-center gap-2",
                          item.parentId && "pl-5",
                        )}
                      >
                        <KindIcon kind={item.kind} />
                        <span className="truncate font-medium">
                          {item.title}
                        </span>
                        {item.running ? <RunningDot /> : null}
                        {item.settled ? <SettledMarker /> : null}
                        <SubitemProgress item={item} />
                      </div>
                      <div
                        className={cn(
                          "flex min-w-0 gap-2 pl-5.5 text-[12px] text-muted-foreground",
                          item.parentId && "pl-10.5",
                        )}
                      >
                        {view.properties.id ? (
                          <span className="font-mono">{label(item)}</span>
                        ) : null}
                        {item.parentId ? <ParentLine item={item} /> : null}
                      </div>
                    </td>
                    <td>
                      <StatePicker
                        item={item}
                        className="gap-1.5 px-1.5 py-1 whitespace-nowrap"
                      >
                        <StateIcon state={stateById(item.stateId)} />
                        <span className="text-[13px]">
                          {stateById(item.stateId).name}
                        </span>
                      </StatePicker>
                      {view.properties.sourceState && item.sourceState ? (
                        <div className="pl-7 text-[11px] text-muted-foreground">
                          {item.sourceState}
                        </div>
                      ) : null}
                    </td>
                    {view.properties.project ? (
                      <td className="truncate text-[12px] text-muted-foreground">
                        {item.project}
                      </td>
                    ) : null}
                    {view.properties.estimate ? (
                      <td className="pr-2 text-right font-mono text-[12px]">
                        {item.remainingHours !== undefined
                          ? hours(item.remainingHours)
                          : "–"}
                        <span className="text-muted-foreground">
                          {" "}
                          / {hours(item.loggedHours)}
                        </span>
                      </td>
                    ) : null}
                    <td className="pr-3">
                      <span className="opacity-0 group-hover:opacity-100">
                        <ItemMenu item={item} />
                      </span>
                    </td>
                  </tr>
                ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function BoardB() {
  const { items, s } = useDerived();
  const [doneOpen, setDoneOpen] = useState(false);
  const columns = WORKFLOW.filter(
    (state) =>
      state.id !== "none" || items.some((item) => item.stateId === "none"),
  );
  const lanes = [...PROJECTS, undefined];
  const ordered = orderItems(items, s.view.ordering);
  return (
    <div className="min-w-max p-4 pb-20">
      <div className="sticky top-0 z-10 flex gap-2 bg-background pb-2 pl-36">
        {columns.map((state) =>
          state.done && !doneOpen ? (
            <button
              key={state.id}
              type="button"
              className="flex w-10 items-center justify-center rounded-md bg-muted/60"
              onClick={() => setDoneOpen(true)}
              aria-label="Show Done column"
            >
              <StateIcon state={state} />
            </button>
          ) : (
            <div
              key={state.id}
              className="flex w-60 items-center gap-2 px-1 text-[13px]"
            >
              <StateIcon state={state} />
              <span className="font-medium">{state.name}</span>
              <span className="font-mono text-[12px] text-muted-foreground">
                {items.filter((item) => item.stateId === state.id).length}
              </span>
              {state.done ? (
                <button
                  type="button"
                  className="ml-auto text-[12px] text-muted-foreground"
                  onClick={() => setDoneOpen(false)}
                >
                  Fold
                </button>
              ) : null}
            </div>
          ),
        )}
      </div>
      {lanes.map((lane) => {
        const laneItems = ordered.filter((item) => item.project === lane);
        if (laneItems.length === 0) return null;
        return (
          <div
            key={lane ?? "none"}
            className="flex gap-2 border-t border-border py-2"
          >
            <div className="w-34 shrink-0 pt-1 text-[12px] font-medium">
              {lane ?? "No project"}
              <div className="font-mono text-[11px] font-normal text-muted-foreground">
                {laneItems.length} items
              </div>
            </div>
            {columns.map((state) => {
              const cell = laneItems.filter(
                (item) => item.stateId === state.id,
              );
              const group: Group = {
                key: state.id,
                label: state.name,
                stateId: state.id,
                items: cell,
              };
              if (state.done && !doneOpen) {
                return (
                  <div
                    key={state.id}
                    {...dropProps(dropOnGroup(group))}
                    className="flex w-10 items-start justify-center rounded-md bg-muted/40 pt-2 font-mono text-[11px] text-muted-foreground"
                  >
                    {cell.length || ""}
                  </div>
                );
              }
              return (
                <div
                  key={state.id}
                  {...dropProps(dropOnGroup(group))}
                  className="flex min-h-12 w-60 flex-col gap-1.5 rounded-md bg-muted/40 p-1.5"
                >
                  {cell.map((item) => (
                    <article
                      key={item.id}
                      tabIndex={0}
                      {...dragProps(item)}
                      {...dropProps(dropOnCard(group, item))}
                      onClick={() => setStore({ selectedId: item.id })}
                      className={cn(
                        "flex cursor-grab items-start gap-1.5 rounded-[var(--control-radius)] border border-border bg-card px-2 py-1.5 text-[12px]",
                        s.selectedId === item.id && "border-ring",
                        (item.archived || item.settled) && "opacity-70",
                      )}
                    >
                      <PriorityPicker item={item} className="size-5" />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 leading-snug">
                          {item.title}
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                          {label(item)}
                          {item.parentId ? <span>· subitem</span> : null}
                          {item.settled ? <span>· settled</span> : null}
                          {item.running ? <RunningDot /> : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function PeekB({ item }: { item: Item }) {
  const state = stateById(item.stateId);
  const subitems = store.items.filter((other) => other.parentId === item.id);
  const prop = (name: string, value: ReactNode) => (
    <div className="grid grid-cols-[96px_1fr] items-center gap-2 text-[13px]">
      <span className="text-muted-foreground">{name}</span>
      <span className="min-w-0">{value}</span>
    </div>
  );
  return (
    <aside className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-[var(--surface-low)] p-4 pb-24">
      <div className="flex items-center gap-2">
        <KindIcon kind={item.kind} />
        <span className="font-mono text-[12px] text-muted-foreground">
          {label(item)}
        </span>
        <div className="flex-1" />
        <ItemMenu item={item} />
        <button
          type="button"
          aria-label="Close"
          className="inline-flex size-6 items-center justify-center rounded-[var(--control-radius)] hover:bg-[var(--hover-bg)]"
          onClick={() => setStore({ selectedId: null })}
        >
          <CloseIcon className="size-3.5" />
        </button>
      </div>
      <h2 className="font-heading text-[18px] leading-snug">{item.title}</h2>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => actions.start(item.id)}>
          <PlayIcon data-icon="inline-start" />
          {item.running ? "Running" : "Start entry"}
        </Button>
        <Button size="sm" variant="outline">
          Open page
        </Button>
      </div>
      <div className="flex flex-col gap-2.5">
        {prop(
          "State",
          <StatePicker item={item} className="gap-1.5 px-1.5 py-1">
            <StateIcon state={state} />
            {state.name}
          </StatePicker>,
        )}
        {item.externalId
          ? prop(
              "Source state",
              <span className="text-muted-foreground">
                {item.sourceState}
                {state.sourceStates.length > 1
                  ? ` (one of ${state.sourceStates.join(", ")})`
                  : ""}
              </span>,
            )
          : null}
        {prop(
          "Priority",
          <span className="flex items-center gap-1">
            <PriorityPicker item={item} />
            {PRIORITY_LABELS[item.priority]}
          </span>,
        )}
        {prop(
          "Lifecycle",
          item.archived ? "Archived" : item.settled ? "Settled" : "Active",
        )}
        {prop("Project", item.project ?? "–")}
        {prop("Task", item.task ?? "–")}
        {prop(
          "Estimate",
          <span className="font-mono text-[12px]">
            {hours(item.remainingHours) || "–"} left · {hours(item.loggedHours)}{" "}
            logged
          </span>,
        )}
      </div>
      {subitems.length ? (
        <div className="flex flex-col gap-1">
          <div className="text-[12px] text-muted-foreground">Subitems</div>
          {subitems.map((sub) => (
            <button
              key={sub.id}
              type="button"
              className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-[13px] hover:bg-[var(--hover-bg)]"
              onClick={() => setStore({ selectedId: sub.id })}
            >
              <StateIcon state={stateById(sub.stateId)} />
              <span className="truncate">{sub.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Variant C: Time first

function VariantC() {
  const { s, items, groups } = useDerived();
  const [railState, setRailState] = useState<string | null>(null);
  const shownGroups = railState
    ? groups.filter((group) => group.stateId === railState)
    : groups;
  const running = s.items.find((item) => item.running);
  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border p-3">
        <div className="px-2 pb-2 text-[11px] tracking-wide text-muted-foreground uppercase">
          Workflow
        </div>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-[var(--hover-bg)]",
            railState === null && "bg-muted",
          )}
          onClick={() => setRailState(null)}
        >
          <span className="flex-1 text-left">All states</span>
          <span className="font-mono text-[12px] text-muted-foreground">
            {items.length}
          </span>
        </button>
        {WORKFLOW.map((state) => {
          const count = items.filter(
            (item) => item.stateId === state.id,
          ).length;
          if (state.id === "none" && count === 0) return null;
          return (
            <button
              key={state.id}
              type="button"
              {...dropProps((itemId) => actions.requestMove(itemId, state.id))}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-[var(--hover-bg)]",
                railState === state.id && "bg-muted",
              )}
              onClick={() => setRailState(state.id)}
            >
              <StateIcon state={state} />
              <span className="flex-1 text-left">{state.name}</span>
              <span className="font-mono text-[12px] text-muted-foreground">
                {count}
              </span>
            </button>
          );
        })}
        <div className="mt-3 px-2 text-[11px] leading-relaxed text-muted-foreground">
          Drop an item on a state to move it.
        </div>
        <div className="flex-1" />
        <a
          href="#archive"
          className="px-2 text-[12px] text-muted-foreground hover:text-foreground"
        >
          Archive
        </a>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
          <h1 className="font-heading text-[19px] font-medium">
            {railState ? stateById(railState).name : "Backlog"}
          </h1>
          {running ? (
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[12px] text-emerald-700 dark:text-emerald-300">
              <RunningDot />
              Running on {label(running)}
            </span>
          ) : null}
          <div className="flex-1" />
          <FilterChips />
          <FilterButton compact />
          <DisplayButton compact />
          <LayoutToggle />
          <NewItemButton compact />
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {s.view.layout === "list" ? (
            <ListC groups={shownGroups} />
          ) : (
            <BoardC groups={groups} />
          )}
        </div>
      </div>
    </div>
  );
}

function EstimateBar({ item }: { item: Item }) {
  if (!item.originalHours) return null;
  const done = Math.min(1, item.loggedHours / item.originalHours);
  const over = item.loggedHours > item.originalHours;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            over ? "bg-amber-500" : "bg-foreground/50",
          )}
          style={{ width: `${done * 100}%` }}
        />
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">
        {hours(item.loggedHours)} / {hours(item.originalHours)}
      </span>
    </div>
  );
}

function ListC({ groups }: { groups: Group[] }) {
  const { view } = useStore();
  return (
    <div className="flex flex-col gap-5 p-5 pb-24">
      {groups.map((group) => (
        <section key={group.key} {...dropProps(dropOnGroup(group))}>
          <div className="mb-1.5 flex items-center gap-2 text-[13px]">
            {group.icon}
            <span className="font-heading text-[15px]">{group.label}</span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {group.items.length}
            </span>
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">
              {hours(
                group.items.reduce(
                  (sum, item) => sum + (item.remainingHours ?? 0),
                  0,
                ),
              )}{" "}
              left
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            {group.items.length === 0 ? (
              <div className="px-4 py-3 text-[12px] text-muted-foreground">
                Nothing here. Drop an item to move it.
              </div>
            ) : null}
            {group.items.map((item) => (
              <div
                key={item.id}
                tabIndex={0}
                {...dragProps(item)}
                {...dropProps(dropOnCard(group, item))}
                className={cn(
                  "group flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-[var(--hover-bg)]",
                  item.running && "bg-emerald-500/5",
                  item.archived && "text-muted-foreground",
                )}
              >
                <PriorityPicker item={item} />
                <StatePicker item={item} className="size-6 justify-center">
                  <StateIcon state={stateById(item.stateId)} />
                </StatePicker>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex min-w-0 items-center gap-2 text-[13px]">
                    <span className="truncate">{item.title}</span>
                    {item.settled ? <SettledMarker /> : null}
                    <SubitemProgress item={item} />
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                    <KindIcon kind={item.kind} className="size-3" />
                    {view.properties.id ? (
                      <span className="font-mono">{label(item)}</span>
                    ) : null}
                    {item.parentId ? (
                      <ParentLine item={item} />
                    ) : view.properties.project && item.project ? (
                      <span className="truncate">
                        ·{" "}
                        {[item.project, item.task].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                    {view.properties.sourceState && item.sourceState ? (
                      <span>· {item.sourceState}</span>
                    ) : null}
                  </div>
                </div>
                {view.properties.estimate ? <EstimateBar item={item} /> : null}
                {!item.archived ? (
                  <Button
                    size="sm"
                    variant={item.running ? "secondary" : "ghost"}
                    className={cn(
                      !item.running && "opacity-0 group-hover:opacity-100",
                    )}
                    onClick={() => actions.start(item.id)}
                  >
                    <PlayIcon data-icon="inline-start" />
                    {item.running ? "Running" : "Start"}
                  </Button>
                ) : null}
                <ItemMenu item={item} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BoardC({ groups }: { groups: Group[] }) {
  const { view } = useStore();
  const [over, setOver] = useState<string | null>(null);
  const open = groups.filter(
    (group) => !group.stateId || !stateById(group.stateId).done,
  );
  const done = groups.filter(
    (group) => group.stateId && stateById(group.stateId).done,
  );
  return (
    <div className="flex h-full gap-4 overflow-x-auto p-5 pb-20">
      {open.map((group) => (
        <section
          key={group.key}
          {...dropProps(dropOnGroup(group), (isOver) =>
            setOver(isOver ? group.key : null),
          )}
          className={cn(
            "flex w-[300px] shrink-0 flex-col gap-2 rounded-lg",
            over === group.key && "bg-[var(--hover-bg)]",
          )}
        >
          <div
            className="flex items-center gap-2 border-b-2 pb-2 text-[13px]"
            style={{ borderColor: stateById(group.stateId ?? "none").color }}
          >
            {group.icon}
            <span className="font-heading text-[15px]">{group.label}</span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {group.items.length}
            </span>
            <div className="flex-1" />
            <span className="font-mono text-[11px] text-muted-foreground">
              {hours(
                group.items.reduce(
                  (sum, item) => sum + (item.remainingHours ?? 0),
                  0,
                ),
              )}
            </span>
            <button
              type="button"
              aria-label={`New backlog item in ${group.label}`}
              className="inline-flex size-6 items-center justify-center rounded-[var(--control-radius)] text-muted-foreground hover:bg-[var(--hover-bg)]"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {group.items.map((item) => (
              <article
                key={item.id}
                tabIndex={0}
                {...dragProps(item)}
                {...dropProps(dropOnCard(group, item))}
                className={cn(
                  "group flex cursor-grab flex-col gap-2 rounded-lg border border-border bg-card p-3 text-[13px] hover:shadow-[var(--shadow-md)]",
                  item.running && "border-emerald-500/50",
                  item.settled && "border-dashed",
                )}
              >
                <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <KindIcon kind={item.kind} />
                  {view.properties.id ? (
                    <span className="font-mono">{label(item)}</span>
                  ) : null}
                  {view.properties.sourceState && item.sourceState ? (
                    <span>· {item.sourceState}</span>
                  ) : null}
                  <div className="flex-1" />
                  <PriorityPicker item={item} className="size-5" />
                  <ItemMenu item={item} />
                </div>
                <div className="leading-snug font-medium">{item.title}</div>
                {item.parentId ? <ParentLine item={item} /> : null}
                {view.properties.project && item.project && !item.parentId ? (
                  <div className="truncate text-[12px] text-muted-foreground">
                    {[item.project, item.task].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  {view.properties.estimate ? (
                    <EstimateBar item={item} />
                  ) : null}
                  <SubitemProgress item={item} />
                  {item.settled ? <SettledMarker /> : null}
                  <div className="flex-1" />
                  <Button
                    size="icon-sm"
                    variant={item.running ? "secondary" : "ghost"}
                    aria-label={item.running ? "Running" : "Start entry"}
                    className={cn(
                      !item.running && "opacity-0 group-hover:opacity-100",
                    )}
                    onClick={() => actions.start(item.id)}
                  >
                    {item.running ? <RunningDot /> : <PlayIcon />}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {done.map((group) => (
        <section
          key={group.key}
          {...dropProps(dropOnGroup(group), (isOver) =>
            setOver(isOver ? group.key : null),
          )}
          className={cn(
            "flex w-44 shrink-0 flex-col gap-2 rounded-lg border-2 border-dashed border-border p-3 transition-colors",
            over === group.key && "border-emerald-500 bg-emerald-500/5",
          )}
        >
          <div className="flex items-center gap-2 text-[13px]">
            {group.icon}
            <span className="font-heading text-[15px]">{group.label}</span>
          </div>
          <div className="text-[12px] text-muted-foreground">
            Drop here to close an item. {group.items.length} closed this week.
          </div>
          {group.items.map((item) => (
            <div
              key={item.id}
              {...dragProps(item)}
              className="cursor-grab truncate text-[12px] text-muted-foreground line-through"
            >
              {item.title}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs, toast and the floating switcher

function SubitemsDialog() {
  const { pending, items } = useStore();
  const [remember, setRemember] = useState(false);
  if (pending?.kind !== "subitems") return null;
  const item = items.find((other) => other.id === pending.itemId)!;
  const subs = openSubitems(item);
  const answer = (includeSubitems: boolean) => {
    if (remember) {
      setStore({ rememberSubitems: includeSubitems ? "include" : "leave" });
    }
    actions.continueMove({ ...pending, includeSubitems });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && setStore({ pending: null })}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close {subs.length} open subitems too?</DialogTitle>
          <DialogDescription>
            “{item.title}” has {subs.length} open subitems. Moving it to{" "}
            {stateById(pending.targetStateId).name} archives it.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1 text-[13px]">
          {subs.map((sub) => (
            <li key={sub.id} className="flex items-center gap-2">
              <StateIcon state={stateById(sub.stateId)} />
              <span className="font-mono text-[12px] text-muted-foreground">
                {label(sub)}
              </span>
              <span className="truncate">{sub.title}</span>
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Checkbox
            checked={remember}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          Remember my choice
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>
            Only this item
          </Button>
          <Button onClick={() => answer(true)}>Include subitems</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AskDialog() {
  const { pending, items } = useStore();
  if (pending?.kind !== "ask") return null;
  const item = items.find((other) => other.id === pending.itemId)!;
  const target = stateById(pending.targetStateId);
  return (
    <Dialog open onOpenChange={(open) => !open && setStore({ pending: null })}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Which Azure DevOps state?</DialogTitle>
          <DialogDescription>
            {target.name} stands for more than one state in Ajour (Azure
            DevOps). {label(item)} is written after the Undo window.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {target.sourceStates.map((sourceState) => (
            <Button
              key={sourceState}
              variant="outline"
              className="justify-start"
              onClick={() => actions.continueMove(pending, sourceState)}
            >
              {sourceState}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => actions.continueMove(pending, "")}
          >
            Move without writing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UndoToast() {
  const { toast } = useStore();
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setStore({
        toast: null,
        writeLog: [...toast.writes, ...store.writeLog].slice(0, 6),
      });
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="fixed right-4 bottom-16 z-50 flex w-80 flex-col gap-1 rounded-lg border border-border bg-popover p-3 text-[13px] shadow-[var(--shadow-popup)]">
      <div className="flex items-center gap-2">
        <span className="flex-1">{toast.title}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setStore({ items: toast.undo, toast: null })}
        >
          Undo
        </Button>
      </div>
      {toast.writes.length ? (
        <span className="text-[12px] text-muted-foreground">
          Writes to Azure DevOps when this closes: {toast.writes.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

const VARIANTS = [
  { key: "A", name: "Linear classic" },
  { key: "B", name: "Table and peek" },
  { key: "C", name: "Time first" },
] as const;
type VariantKey = (typeof VARIANTS)[number]["key"];

function readVariant(): VariantKey {
  const value = new URLSearchParams(window.location.search).get("proto");
  return VARIANTS.some((variant) => variant.key === value)
    ? (value as VariantKey)
    : "A";
}

function Switcher({
  variant,
  onChange,
}: {
  variant: VariantKey;
  onChange: (variant: VariantKey) => void;
}) {
  const { items, writeLog, rememberSubitems } = useStore();
  function cycle(step: number) {
    const index = VARIANTS.findIndex((item) => item.key === variant);
    onChange(VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!.key);
  }
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable]") ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        // Arrow keys move focus between rows and cards once one is focused.
        target?.closest("[tabindex='0']")
      )
        return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (import.meta.env.PROD) return null;
  return createPortal(
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
        onClick={() =>
          setStore({
            items: SEED,
            filters: [],
            view: DEFAULT_VIEW,
            writeLog: [],
            rememberSubitems: "ask",
          })
        }
      >
        Reset
      </button>
      <span className="mx-1 h-4 w-px bg-white/25" />
      <span className="max-w-[46vw] truncate pr-2 text-white/70 tabular-nums">
        {WORKFLOW.map(
          (state) =>
            `${state.name} ${items.filter((item) => item.stateId === state.id).length}`,
        ).join(" · ")}
        {" · "}subitems on close: {rememberSubitems}
        {writeLog[0] ? ` · sent ${writeLog.slice(0, 2).join(", ")}` : ""}
      </span>
    </div>,
    document.body,
  );
}

export function BacklogViewsPrototype() {
  const [variant, setVariant] = useState<VariantKey>(readVariant);
  const change = (next: VariantKey) => {
    const url = new URL(window.location.href);
    url.searchParams.set("proto", next);
    window.history.replaceState(window.history.state, "", url);
    setVariant(next);
  };
  const content = useMemo(
    () => ({ A: <VariantA />, B: <VariantB />, C: <VariantC /> })[variant],
    [variant],
  );
  return (
    <div className="backlog-page-stack flex-col bg-background text-foreground">
      {content}
      <SubitemsDialog />
      <AskDialog />
      <UndoToast />
      <Switcher variant={variant} onChange={change} />
    </div>
  );
}

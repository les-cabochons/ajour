/**
 * PROTOTYPE, throwaway. Never merge to main.
 *
 * Question: what is the narrow view for, and how do you move around in it?
 * (wayfinder ticket "Narrow view", issue #13)
 *
 * Shown only when the window is narrower than PROTOTYPE_NARROW_MAX_WIDTH.
 * Switch with `?narrow=` or the floating bar:
 *   current: today's narrow layout, for comparison
 *   A: bottom tab bar. The whole app, mobile style.
 *   B: companion. Running entry card first, today's entries, everything else in a drawer.
 *   C: top switcher. Segmented Time / Backlog / Projects in the titlebar, Settings in "…".
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import {
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiFolderChartLine as FolderKanban,
  RiListCheck3 as ListTodo,
  RiMenuLine as Menu,
  RiMoreLine as More,
  RiPlayFill as Play,
  RiSettings3Line as Settings,
  RiStopFill as Stop,
  RiTimerLine as Timer,
} from "@remixicon/react";
import { BrandLogo } from "@/components/brand-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatClockDuration } from "@/domain/time/duration";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { cn, todayIsoDate } from "@/lib/utils";

export const PROTOTYPE_NARROW_MAX_WIDTH = 760;

export type NarrowVariant = "current" | "A" | "B" | "C";

const VARIANTS: { key: NarrowVariant; name: string }[] = [
  { key: "current", name: "Today's narrow layout" },
  { key: "A", name: "Bottom tab bar" },
  { key: "B", name: "Companion" },
  { key: "C", name: "Top switcher" },
];
const VARIANT_KEY = "ajour.prototype.narrow-variant";
const VARIANT_EVENT = "ajour-prototype-narrow-variant";

const sections = [
  { to: "/time/$date", label: "Time", icon: Timer, match: "/time/" },
  { to: "/backlog", label: "Backlog", icon: ListTodo, match: "/backlog" },
  {
    to: "/projects",
    label: "Projects",
    icon: FolderKanban,
    match: "/projects",
  },
  { to: "/settings", label: "Settings", icon: Settings, match: "/settings" },
] as const;

function readVariant(): NarrowVariant {
  const fromUrl = new URLSearchParams(window.location.search).get("narrow");
  if (VARIANTS.some((variant) => variant.key === fromUrl)) {
    localStorage.setItem(VARIANT_KEY, fromUrl!);
    return fromUrl as NarrowVariant;
  }
  const stored = localStorage.getItem(VARIANT_KEY);
  return VARIANTS.some((variant) => variant.key === stored)
    ? (stored as NarrowVariant)
    : "current";
}

function writeVariant(variant: NarrowVariant) {
  localStorage.setItem(VARIANT_KEY, variant);
  window.dispatchEvent(new Event(VARIANT_EVENT));
}

/** The prototype variant, or "current" when the window is wide or in production. */
export function useNarrowPrototypeVariant(): {
  variant: NarrowVariant;
  isNarrow: boolean;
} {
  const [variant, setVariant] = useState<NarrowVariant>(() =>
    import.meta.env.PROD ? "current" : readVariant(),
  );
  const [isNarrow, setIsNarrow] = useState(
    () => window.innerWidth <= PROTOTYPE_NARROW_MAX_WIDTH,
  );
  useEffect(() => {
    if (import.meta.env.PROD) return;
    const updateVariant = () => setVariant(readVariant());
    const updateWidth = () =>
      setIsNarrow(window.innerWidth <= PROTOTYPE_NARROW_MAX_WIDTH);
    window.addEventListener(VARIANT_EVENT, updateVariant);
    window.addEventListener("resize", updateWidth);
    return () => {
      window.removeEventListener(VARIANT_EVENT, updateVariant);
      window.removeEventListener("resize", updateWidth);
    };
  }, []);
  return { variant: isNarrow ? variant : "current", isNarrow };
}

export interface NarrowPrototypeProps {
  variant: Exclude<NarrowVariant, "current">;
  pathname: string;
  selectedTimeDate: string;
  /** The real date picker and timer bar from the titlebar. */
  datePicker: ReactNode;
  timerBar: ReactNode;
}

function Content() {
  return (
    <main className="app-content-shell min-h-0 flex-1">
      <ScrollArea className="app-content-scroll-area">
        <div className="page-container">
          <Outlet />
        </div>
      </ScrollArea>
    </main>
  );
}

function sectionLinkProps(
  section: (typeof sections)[number],
  selectedTimeDate: string,
) {
  return {
    to: section.to,
    params:
      section.to === "/time/$date" ? { date: selectedTimeDate } : undefined,
  } as const;
}

/* ── A: bottom tab bar ── */

function VariantA(props: NarrowPrototypeProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        {props.datePicker}
        {props.timerBar}
      </div>
      <Content />
      <nav
        className="grid h-14 shrink-0 grid-cols-4 border-t border-border bg-[var(--surface-low)]"
        aria-label="Primary navigation"
      >
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = props.pathname.startsWith(section.match);
          return (
            <Link
              key={section.to}
              {...sectionLinkProps(section, props.selectedTimeDate)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground",
                isActive && "font-medium text-foreground",
              )}
            >
              <Icon className="size-5" />
              <span>{section.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/* ── B: companion ── */

function RunningCard() {
  const state = useLocalState();
  const projects = useLocalProjects();
  const timer = state.timers[0] ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!timer) {
    return (
      <div className="m-3 flex items-center justify-between rounded-2xl border border-border bg-[var(--surface-low)] p-4">
        <div>
          <div className="text-sm font-medium">Nothing running</div>
          <div className="text-xs text-muted-foreground">
            Start an entry, then pick its task.
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            localStore.startTimer({
              localDate: todayIsoDate(),
              accumulatedDurationMs: 0,
            })
          }
          className="flex size-12 items-center justify-center rounded-full bg-foreground text-background"
          aria-label="Start entry"
        >
          <Play className="size-6" />
        </button>
      </div>
    );
  }

  const project = projects.find((item) => item._id === timer.projectId);
  const task = project?.tasks.find((item) => item._id === timer.taskId);
  const elapsed =
    timer.accumulatedDurationMs + Math.max(0, now - timer.startedAt);
  return (
    <div className="m-3 flex items-center justify-between rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {project ? getLocalProjectDisplayName(project) : "No project"}
          {task ? ` · ${task.name}` : ""}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {timer.note || "No note"}
        </div>
        <div className="mt-1 font-mono text-2xl font-semibold">
          {formatClockDuration(elapsed)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => localStore.saveTimer(timer._id)}
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
        aria-label="Stop"
      >
        <Stop className="size-6" />
      </button>
    </div>
  );
}

function VariantB(props: NarrowPrototypeProps) {
  const [open, setOpen] = useState(false);
  const isTime = props.pathname.startsWith("/time/");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="flex size-8 items-center justify-center rounded-md hover:bg-muted"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex-1">{props.datePicker}</div>
        {isTime ? null : props.timerBar}
      </div>
      {isTime ? <RunningCard /> : null}
      <Content />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-3">
          <SheetHeader className="p-1">
            <SheetTitle>
              <BrandLogo />
            </SheetTitle>
          </SheetHeader>
          <nav
            className="flex flex-col gap-0.5"
            aria-label="Primary navigation"
          >
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = props.pathname.startsWith(section.match);
              return (
                <Link
                  key={section.to}
                  {...sectionLinkProps(section, props.selectedTimeDate)}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted",
                    isActive && "bg-muted font-medium text-foreground",
                  )}
                >
                  <Icon className="size-5" />
                  {section.label}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ── C: top switcher with overflow ── */

function VariantC(props: NarrowPrototypeProps) {
  const navigate = useNavigate();
  const primary = sections.slice(0, 3);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
        <nav
          className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
          aria-label="Primary navigation"
        >
          {primary.map((section) => {
            const Icon = section.icon;
            const isActive = props.pathname.startsWith(section.match);
            return (
              <Link
                key={section.to}
                {...sectionLinkProps(section, props.selectedTimeDate)}
                aria-label={section.label}
                title={section.label}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground",
                  isActive &&
                    "bg-background font-medium text-foreground shadow-sm",
                )}
              >
                <Icon className="size-4" />
                {isActive ? section.label : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {props.timerBar}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More"
              className="flex size-8 items-center justify-center rounded-md hover:bg-muted"
            >
              <More className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <DropdownMenuItem
                onClick={() => void navigate({ to: "/settings" })}
              >
                <Settings /> Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <Content />
    </div>
  );
}

export function NarrowPrototype(props: NarrowPrototypeProps) {
  if (props.variant === "A") return <VariantA {...props} />;
  if (props.variant === "B") return <VariantB {...props} />;
  return <VariantC {...props} />;
}

/** Floating variant switcher, shown only when the window is narrow. Dev builds only. */
export function NarrowPrototypeSwitcher({
  variant,
  isNarrow,
}: {
  variant: NarrowVariant;
  isNarrow: boolean;
}) {
  const stored = isNarrow ? variant : readVariant();
  const index = Math.max(
    0,
    VARIANTS.findIndex((item) => item.key === stored),
  );
  const cycle = useCallback(
    (step: number) => {
      writeVariant(
        VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!.key,
      );
    },
    [index],
  );
  if (import.meta.env.PROD || !isNarrow) return null;
  const current = VARIANTS[index]!;
  return (
    <div className="fixed bottom-16 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-full bg-fuchsia-600 px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-white shadow-lg">
      <button
        type="button"
        onClick={() => cycle(-1)}
        aria-label="Previous variant"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span>
        Narrow {current.key}: {current.name}
      </span>
      <button type="button" onClick={() => cycle(1)} aria-label="Next variant">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

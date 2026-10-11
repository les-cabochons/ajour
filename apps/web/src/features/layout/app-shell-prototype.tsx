/**
 * PROTOTYPE, throwaway. Never merge to main.
 *
 * Question: how should the app shell behave on desktop widths?
 * (wayfinder ticket "App shell and collapsible sidebar", issue #12)
 *
 * Three structurally different shells, switchable with `?variant=` or the floating bar:
 *   current: today's shell, for comparison
 *   A: collapsible rail. Sidebar toggles 200px / 52px, settings nest inside the shell.
 *   B: hidden sidebar. Sidebar hides fully from a titlebar toggle, settings replace it.
 *   C: top navigation. No app sidebar, sections are tabs in the titlebar.
 *
 * The variant is kept in localStorage because app navigation rewrites the URL search.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import {
  RiArrowLeftLine as ArrowLeft,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiBugLine as Bug,
  RiDownloadLine as Download,
  RiFolderChartLine as FolderKanban,
  RiInboxLine as Inbox,
  RiListCheck3 as ListTodo,
  RiPuzzle2Line as Puzzle,
  RiSettings3Line as Settings,
  RiSideBarLine as SidebarIcon,
  RiTimerLine as Timer,
} from "@remixicon/react";
import { BrandLogo } from "@/components/brand-logo";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type ShellVariant = "current" | "A" | "B" | "C";

const VARIANTS: { key: ShellVariant; name: string }[] = [
  { key: "current", name: "Today's shell" },
  { key: "A", name: "Collapsible rail" },
  { key: "B", name: "Hidden sidebar" },
  { key: "C", name: "Top navigation" },
];
const VARIANT_KEY = "ajour.prototype.shell-variant";
const RAIL_KEY = "ajour.prototype.sidebar-collapsed";
const HIDDEN_KEY = "ajour.prototype.sidebar-hidden";
const VARIANT_EVENT = "ajour-prototype-shell-variant";

const sections = [
  { to: "/time/$date", label: "Time", icon: Timer, match: "/time/" },
  { to: "/backlog", label: "Backlog", icon: ListTodo, match: "/backlog" },
  {
    to: "/projects",
    label: "Projects",
    icon: FolderKanban,
    match: "/projects",
  },
] as const;

const settingsItems = [
  { to: "/settings/general", label: "General", icon: Settings },
  { to: "/settings/plugins", label: "Plugins", icon: Puzzle },
  { to: "/settings/backlog", label: "Backlog", icon: ListTodo },
  { to: "/settings/projects", label: "Projects", icon: FolderKanban },
  { to: "/settings/time-entries", label: "Time entries", icon: Download },
  { to: "/settings/sync-review", label: "Sync review", icon: Inbox },
  { to: "/settings/debug", label: "Debug", icon: Bug },
] as const;

function readVariant(): ShellVariant {
  const fromUrl = new URLSearchParams(window.location.search).get("variant");
  if (VARIANTS.some((variant) => variant.key === fromUrl)) {
    localStorage.setItem(VARIANT_KEY, fromUrl!);
    return fromUrl as ShellVariant;
  }
  const stored = localStorage.getItem(VARIANT_KEY);
  return VARIANTS.some((variant) => variant.key === stored)
    ? (stored as ShellVariant)
    : "current";
}

function writeVariant(variant: ShellVariant) {
  localStorage.setItem(VARIANT_KEY, variant);
  const url = new URL(window.location.href);
  url.searchParams.set("variant", variant);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(VARIANT_EVENT));
}

/** Current prototype variant. Always "current" in production builds. */
export function useShellPrototypeVariant(): ShellVariant {
  const [variant, setVariant] = useState<ShellVariant>(() =>
    import.meta.env.PROD ? "current" : readVariant(),
  );
  useEffect(() => {
    if (import.meta.env.PROD) return;
    const update = () => setVariant(readVariant());
    window.addEventListener(VARIANT_EVENT, update);
    return () => window.removeEventListener(VARIANT_EVENT, update);
  }, []);
  return variant;
}

function usePersistedFlag(key: string) {
  const [value, setValue] = useState(() => localStorage.getItem(key) === "1");
  const update = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        localStorage.setItem(key, resolved ? "1" : "0");
        return resolved;
      });
    },
    [key],
  );
  return [value, update] as const;
}

/** Cmd/Ctrl+B and Cmd/Ctrl+\ toggle the sidebar, like Linear and VS Code. */
function useSidebarShortcut(onToggle: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "b" || event.key === "\\")
      ) {
        event.preventDefault();
        onToggle();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onToggle]);
}

function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

export interface ShellPrototypeProps {
  variant: Exclude<ShellVariant, "current">;
  pathname: string;
  selectedTimeDate: string;
  isSettingsActive: boolean;
  onLeaveSettings: () => void;
  /** The real titlebar controls: date picker and timer bar. */
  titlebarControls: ReactNode;
}

function PageContent({ isSettingsActive }: { isSettingsActive: boolean }) {
  return (
    <main className="app-content-shell min-h-0 flex-1">
      <ScrollArea className="app-content-scroll-area">
        {isSettingsActive ? (
          <Outlet />
        ) : (
          <div className="page-container">
            <Outlet />
          </div>
        )}
      </ScrollArea>
    </main>
  );
}

function SectionLink({
  section,
  pathname,
  selectedTimeDate,
  collapsed = false,
  className,
}: {
  section: (typeof sections)[number];
  pathname: string;
  selectedTimeDate: string;
  collapsed?: boolean;
  className?: string;
}) {
  const Icon = section.icon;
  const isActive = pathname.startsWith(section.match);
  return (
    <Link
      to={section.to}
      params={
        section.to === "/time/$date" ? { date: selectedTimeDate } : undefined
      }
      title={section.label}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        isActive && "bg-muted font-medium text-foreground",
        collapsed && "justify-center px-0",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{section.label}</span>}
    </Link>
  );
}

function SettingsLinks({
  pathname,
  className,
}: {
  pathname: string;
  className?: string;
}) {
  return (
    <nav
      className={cn("flex flex-col gap-0.5", className)}
      aria-label="Settings"
    >
      {settingsItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            replace
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
              isActive && "bg-muted font-medium text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Titlebar({
  leading,
  trailing,
  children,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      {leading}
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        {children}
      </div>
      {trailing}
    </div>
  );
}

/* ── Variant A: collapsible rail, settings nested in the shell ── */

function VariantA(props: ShellPrototypeProps) {
  const [collapsedByUser, setCollapsed] = usePersistedFlag(RAIL_KEY);
  const width = useWindowWidth();
  // HIG: collapse to the rail on its own when the window gets narrow.
  const collapsed = collapsedByUser || width < 1100;
  const toggle = useCallback(
    () => setCollapsed((value) => !value),
    [setCollapsed],
  );
  useSidebarShortcut(toggle);

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-border bg-[var(--surface-low)] p-2 transition-[width] duration-150",
          collapsed ? "w-[52px]" : "w-[200px]",
        )}
        aria-label="Primary navigation"
      >
        <div
          className={cn(
            "mb-3 flex h-8 items-center",
            collapsed ? "justify-center" : "justify-between pl-1",
          )}
        >
          {collapsed ? null : <BrandLogo linked />}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <SidebarIcon className="size-4" />
          </button>
        </div>
        <nav className="flex flex-col gap-0.5">
          {sections.map((section) => (
            <SectionLink
              key={section.to}
              section={section}
              pathname={props.pathname}
              selectedTimeDate={props.selectedTimeDate}
              collapsed={collapsed}
            />
          ))}
        </nav>
        <div className="mt-auto">
          <Link
            to="/settings"
            title="Settings"
            aria-current={props.isSettingsActive ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
              props.isSettingsActive && "bg-muted font-medium text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <Settings className="size-4 shrink-0" />
            {collapsed ? null : <span>Settings</span>}
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Titlebar>{props.titlebarControls}</Titlebar>
        {props.isSettingsActive ? (
          <div className="flex min-h-0 flex-1">
            <SettingsLinks
              pathname={props.pathname}
              className="w-[190px] shrink-0 border-r border-border p-2"
            />
            <PageContent isSettingsActive />
          </div>
        ) : (
          <PageContent isSettingsActive={false} />
        )}
      </div>
    </div>
  );
}

/* ── Variant B: sidebar hides fully, settings replace it with a clear way back ── */

function VariantB(props: ShellPrototypeProps) {
  const [hidden, setHidden] = usePersistedFlag(HIDDEN_KEY);
  const toggle = useCallback(() => setHidden((value) => !value), [setHidden]);
  useSidebarShortcut(toggle);
  const { isSettingsActive, onLeaveSettings } = props;

  useEffect(() => {
    if (!isSettingsActive) return;
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        event.key === "Escape" &&
        !target?.closest("input, textarea, [contenteditable], [role=dialog]")
      ) {
        onLeaveSettings();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSettingsActive, onLeaveSettings]);

  const toggleButton = (
    <button
      type="button"
      onClick={toggle}
      title={hidden ? "Show sidebar (⌘B)" : "Hide sidebar (⌘B)"}
      aria-label={hidden ? "Show sidebar" : "Hide sidebar"}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
    >
      <SidebarIcon className="size-4" />
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {hidden ? null : (
        <aside
          className="flex w-[200px] shrink-0 flex-col border-r border-border bg-[var(--surface-low)] p-2"
          aria-label={isSettingsActive ? "Settings" : "Primary navigation"}
        >
          <div className="mb-3 flex h-8 items-center pl-1">
            <BrandLogo linked />
          </div>
          {isSettingsActive ? (
            <>
              <button
                type="button"
                onClick={onLeaveSettings}
                className="mb-2 flex h-8 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                <span>Back to Ajour</span>
                <kbd className="ml-auto text-[10px] text-muted-foreground">
                  Esc
                </kbd>
              </button>
              <div className="mb-1 px-2.5 text-xs font-medium text-muted-foreground">
                Settings
              </div>
              <SettingsLinks pathname={props.pathname} />
            </>
          ) : (
            <>
              <nav className="flex flex-col gap-0.5">
                {sections.map((section) => (
                  <SectionLink
                    key={section.to}
                    section={section}
                    pathname={props.pathname}
                    selectedTimeDate={props.selectedTimeDate}
                  />
                ))}
              </nav>
              <div className="mt-auto">
                <Link
                  to="/settings"
                  className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Settings className="size-4" />
                  <span>Settings</span>
                </Link>
              </div>
            </>
          )}
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Titlebar leading={toggleButton}>{props.titlebarControls}</Titlebar>
        <PageContent isSettingsActive={isSettingsActive} />
      </div>
    </div>
  );
}

/* ── Variant C: no app sidebar, sections are titlebar tabs ── */

function VariantC(props: ShellPrototypeProps) {
  const settingsButton = props.isSettingsActive ? (
    <button
      type="button"
      onClick={props.onLeaveSettings}
      className="flex h-8 shrink-0 items-center rounded-md bg-foreground px-3 text-sm font-medium text-background"
    >
      Done
    </button>
  ) : (
    <Link
      to="/settings"
      title="Settings"
      aria-label="Settings"
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
    >
      <Settings className="size-4" />
    </Link>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Titlebar
        leading={
          <div className="flex shrink-0 items-center gap-4">
            <BrandLogo linked />
            {props.isSettingsActive ? (
              <span className="text-sm font-medium">Settings</span>
            ) : (
              <nav
                className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
                aria-label="Primary navigation"
              >
                {sections.map((section) => (
                  <SectionLink
                    key={section.to}
                    section={section}
                    pathname={props.pathname}
                    selectedTimeDate={props.selectedTimeDate}
                    className="h-7 bg-transparent px-3 aria-[current=page]:bg-background aria-[current=page]:shadow-sm"
                  />
                ))}
              </nav>
            )}
          </div>
        }
        trailing={settingsButton}
      >
        {props.isSettingsActive ? <span /> : props.titlebarControls}
      </Titlebar>
      {props.isSettingsActive ? (
        <div className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 gap-6 px-4 pt-4">
          <SettingsLinks
            pathname={props.pathname}
            className="w-[190px] shrink-0"
          />
          <PageContent isSettingsActive />
        </div>
      ) : (
        <PageContent isSettingsActive={false} />
      )}
    </div>
  );
}

export function ShellPrototype(props: ShellPrototypeProps) {
  if (props.variant === "A") return <VariantA {...props} />;
  if (props.variant === "B") return <VariantB {...props} />;
  return <VariantC {...props} />;
}

/** Floating variant switcher. Dev builds only. */
export function ShellPrototypeSwitcher({ variant }: { variant: ShellVariant }) {
  const index = VARIANTS.findIndex((item) => item.key === variant);
  const cycle = useCallback(
    (step: number) => {
      const next =
        VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!;
      writeVariant(next.key);
    },
    [index],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        !event.altKey ||
        target?.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cycle]);

  if (import.meta.env.PROD) return null;
  const current = VARIANTS[index] ?? VARIANTS[0]!;
  return (
    <div className="fixed bottom-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-full bg-fuchsia-600 px-2 py-1 text-xs font-semibold text-white shadow-lg">
      <button
        type="button"
        onClick={() => cycle(-1)}
        aria-label="Previous variant"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span>
        Shell prototype {current.key} ({current.name}) · Alt+←/→
      </span>
      <button type="button" onClick={() => cycle(1)} aria-label="Next variant">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiFolderChartLine as FolderKanban,
  RiListCheck3 as ListTodo,
  RiSearchLine as SearchIcon,
  RiSettings3Line as Settings,
  RiSideBarLine as SidebarIcon,
  RiTimerLine as Timer,
  RiGitPullRequestLine as PullRequestIcon,
} from "@remixicon/react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  ShortcutTooltipLabel,
  TooltipButton,
} from "@/components/tooltip-button";
import { selectSidebarBacklogItems } from "@/domain/backlog/backlog-item-lifecycle";
import { isPullRequestReturned } from "@/domain/pull-requests/pull-request-lifecycle";
import { formatClockDuration } from "@/domain/time/duration";
import { openCommandPalette } from "@/features/command-palette/command-palette";
import { SidebarBacklogList } from "@/features/layout/sidebar-backlog-list";
import {
  SidebarPullRequests,
  useSidebarPullRequests,
} from "@/features/layout/sidebar-pull-requests";
import { TimerDock, useRunningEntry } from "@/features/layout/timer-dock";
import type { AppSidebarState } from "@/lib/app-sidebar";
import { useLocalState } from "@/lib/local-hooks";
import {
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  resolveSidebarWidth,
  updateSidebarLayout,
  useSidebarLayout,
} from "@/lib/sidebar-layout";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/** How far past the minimum width the pointer goes before the sidebar hides. */
const SNAP_DISTANCE = 48;
const KEYBOARD_STEP = 16;

/**
 * The sidebar's right edge. Dragging resizes the sidebar from 200px to 400px.
 * Past the minimum it hides, keeping the width it had for next time, as in VS
 * Code. A double-click resets the width to the density's default.
 */
function SidebarResizeHandle({
  onStateChange,
}: {
  onStateChange: (state: AppSidebarState) => void;
}) {
  const layout = useSidebarLayout();
  const leftRef = useRef(0);
  // The width before the drag, so hiding keeps it for next time.
  const startWidthRef = useRef<number | undefined>(undefined);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    leftRef.current =
      event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    startWidthRef.current = layout.width;
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const width = event.clientX - leftRef.current;

    if (width < SIDEBAR_MIN_WIDTH - SNAP_DISTANCE) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      updateSidebarLayout({ width: startWidthRef.current });
      onStateChange("hidden");
      return;
    }
    updateSidebarLayout({ width: clampSidebarWidth(width) });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowLeft"
        ? -KEYBOARD_STEP
        : event.key === "ArrowRight"
          ? KEYBOARD_STEP
          : 0;
    if (step) {
      event.preventDefault();
      updateSidebarLayout({
        width: clampSidebarWidth(resolveSidebarWidth(layout) + step),
      });
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={resolveSidebarWidth(layout)}
      tabIndex={0}
      className="ajour-sidebar-resize-handle"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onDoubleClick={() => updateSidebarLayout({ width: undefined })}
      onKeyDown={handleKeyDown}
    />
  );
}

export function isAppNavigationItemActive(
  pathname: string,
  to: "/time/$date" | "/backlog" | "/projects" | "/settings" | "/pull-requests",
) {
  if (to === "/time/$date") {
    return pathname.startsWith("/time/");
  }

  if (to === "/projects") {
    return pathname === "/projects" || pathname.startsWith("/projects/");
  }

  if (to === "/settings") {
    return pathname.startsWith("/settings");
  }
  if (to === "/pull-requests")
    return pathname === to || pathname.startsWith(`${to}/`);

  return pathname === to;
}

/** The sidebar toggle, beside the logo and in the titlebar while the sidebar is hidden. */
export function SidebarToggleButton({
  label,
  onToggle,
  className,
}: {
  label: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <TooltipButton
      label={label}
      shortcut="app.toggle-sidebar"
      side="bottom"
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("ajour-app-sidebar-toggle", className)}
          onClick={onToggle}
        />
      }
    >
      <SidebarIcon />
    </TooltipButton>
  );
}

/** The live value at the end of a navigation row. */
function NavigationCount({
  value,
  highlighted = false,
}: {
  value?: string | number;
  highlighted?: boolean;
}) {
  if (value === undefined) return null;
  return (
    <span
      className={cn(
        "ml-auto shrink-0 text-[11px] font-normal tabular-nums",
        highlighted
          ? "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground px-1.5 font-semibold text-background"
          : "text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

/**
 * The app sidebar on desktop widths: the timer dock, navigation with live
 * counts, then the work list. It shows beside the page, or over it in narrow
 * desktop windows (`overlay`), where it cannot be resized. `useAppSidebar`
 * owns whether it shows.
 */
export function AppNavigationSidebar({
  pathname,
  selectedTimeDate,
  overlay = false,
  onToggle,
  onStateChange,
}: {
  pathname: string;
  selectedTimeDate: string;
  overlay?: boolean;
  onToggle: () => void;
  onStateChange: (state: AppSidebarState) => void;
}) {
  const state = useLocalState();
  const now = useNow();
  const isSettingsActive = isAppNavigationItemActive(pathname, "/settings");
  const pullRequests = useSidebarPullRequests();
  const { todayTotalMs } = useRunningEntry(30_000);
  const listed = useMemo(
    () => selectSidebarBacklogItems(state, now),
    [state, now],
  );
  const returnedPullRequests = pullRequests.items.filter((item) =>
    isPullRequestReturned(item, pullRequests.now),
  ).length;

  const items = [
    {
      to: "/time/$date",
      label: "Time",
      icon: Timer,
      shortcut: "go.time",
      count: formatClockDuration(todayTotalMs),
    },
    {
      to: "/backlog",
      label: "Backlog",
      icon: ListTodo,
      shortcut: "go.backlog",
      count: listed.length,
    },
    ...(pullRequests.enabled
      ? [
          {
            to: "/pull-requests",
            label: "Pull requests",
            icon: PullRequestIcon,
            shortcut: undefined,
            count: returnedPullRequests || pullRequests.items.length,
            highlighted: returnedPullRequests > 0,
          } as const,
        ]
      : []),
    {
      to: "/projects",
      label: "Projects",
      icon: FolderKanban,
      shortcut: "go.projects",
      count: undefined,
    },
  ] as const;

  return (
    <Sidebar
      className={cn(
        "ajour-shell-sidebar ajour-app-navigation-sidebar",
        overlay && "ajour-shell-sidebar-overlay",
      )}
      innerClassName="ajour-shell-sidebar-inner"
      collapsible="none"
      role="navigation"
      aria-label="Primary navigation"
    >
      <div
        className="ajour-sidebar-window-drag-region desktop-drag-region"
        aria-hidden="true"
      />
      <SidebarHeader className="ajour-app-sidebar-header">
        <BrandLogo linked />
        <span className="ml-auto flex items-center gap-0.5">
          <TooltipButton
            label="Search"
            shortcut="app.command-palette"
            side="bottom"
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="ajour-app-sidebar-toggle"
                onClick={openCommandPalette}
              />
            }
          >
            <SearchIcon />
          </TooltipButton>
          <SidebarToggleButton label="Hide sidebar" onToggle={onToggle} />
        </span>
      </SidebarHeader>

      <TimerDock upNext={listed[0]} />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = isAppNavigationItemActive(pathname, item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      className="ajour-app-sidebar-button h-[30px]"
                      tooltip={{
                        children: (
                          <ShortcutTooltipLabel
                            label={item.label}
                            shortcut={item.shortcut}
                          />
                        ),
                      }}
                      render={
                        <Link
                          to={item.to}
                          params={
                            item.to === "/time/$date"
                              ? { date: selectedTimeDate }
                              : undefined
                          }
                          aria-label={item.label}
                          aria-current={isActive ? "page" : undefined}
                        />
                      }
                      isActive={isActive}
                    >
                      <Icon />
                      <span>{item.label}</span>
                      <NavigationCount
                        value={item.count}
                        highlighted={
                          "highlighted" in item ? item.highlighted : false
                        }
                      />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarBacklogList pathname={pathname}>
          <SidebarPullRequests pathname={pathname} />
        </SidebarBacklogList>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="ajour-app-sidebar-button h-[30px]"
              tooltip={{
                children: (
                  <ShortcutTooltipLabel
                    label="Settings"
                    shortcut="app.settings"
                  />
                ),
              }}
              render={
                <Link
                  to="/settings"
                  aria-label="Settings"
                  aria-current={isSettingsActive ? "page" : undefined}
                />
              }
              isActive={isSettingsActive}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      {overlay ? null : <SidebarResizeHandle onStateChange={onStateChange} />}
    </Sidebar>
  );
}

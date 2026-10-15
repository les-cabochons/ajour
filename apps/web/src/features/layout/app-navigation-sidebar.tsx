import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiPlayLine as PlayIcon,
  RiSearchLine as SearchIcon,
  RiSettings3Line as Settings,
  RiSideBarLine as SidebarIcon,
} from "@remixicon/react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  ShortcutTooltipLabel,
  TooltipButton,
} from "@/components/tooltip-button";
import {
  selectSidebarBacklogItems,
  selectUpNextBacklogItem,
} from "@/domain/backlog/backlog-item-lifecycle";
import { isPullRequestReturned } from "@/domain/pull-requests/pull-request-lifecycle";
import { getAppSection } from "@/features/layout/app-section";
import { openCommandPalette } from "@/features/command-palette/command-palette";
import { SidebarBacklogList } from "@/features/layout/sidebar-backlog-list";
import {
  SidebarPullRequests,
  useSidebarPullRequests,
} from "@/features/layout/sidebar-pull-requests";
import {
  SidebarViewSwitcher,
  type SidebarViewOption,
} from "@/features/layout/sidebar-view-switcher";
import {
  startBlankEntry,
  TimerDock,
  TodayTotal,
} from "@/features/layout/timer-dock";
import type { AppSidebarState } from "@/lib/app-sidebar";
import { useLocalState } from "@/lib/local-hooks";
import { isDesktopShell } from "@/lib/runtime";
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

/** The sidebar toggle, beside the logo and in the titlebar while the sidebar is hidden. */
export function SidebarToggleButton({
  label,
  onToggle,
  side = "bottom",
  className,
}: {
  label: string;
  onToggle: () => void;
  /** Where the tooltip shows. */
  side?: "bottom" | "right";
  className?: string;
}) {
  return (
    <TooltipButton
      label={label}
      shortcut="app.toggle-sidebar"
      side={side}
      render={
        <Button
          variant="ghost"
          size="icon"
          className={cn("ajour-app-sidebar-toggle", className)}
          onClick={onToggle}
        />
      }
    >
      <SidebarIcon />
    </TooltipButton>
  );
}

/**
 * The app sidebar on desktop widths, from the top: the sidebar toggle and the
 * logo beside the macOS traffic lights (in the corner elsewhere), the view
 * switcher with Start (while nothing runs) and Search, the timer dock, then
 * the work list. It shows beside the page, or over it in narrow
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
  const isSettingsActive = getAppSection(pathname) === "settings";
  const pullRequests = useSidebarPullRequests();
  const listed = useMemo(
    () => selectSidebarBacklogItems(state, now),
    [state, now],
  );
  const returnedPullRequests = pullRequests.items.filter((item) =>
    isPullRequestReturned(item, pullRequests.now),
  ).length;

  const views: SidebarViewOption[] = [
    { view: "time", count: <TodayTotal /> },
    { view: "backlog", count: listed.length },
    ...(pullRequests.enabled
      ? [
          {
            view: "pull-requests",
            count: pullRequests.items.length,
            highlighted: returnedPullRequests > 0,
          } as const,
        ]
      : []),
    { view: "projects" },
  ];

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
      <SidebarHeader
        className={cn(
          "ajour-app-sidebar-header",
          isDesktopShell && "desktop-drag-region",
        )}
      >
        {/* The toggle opens under the pointer that showed the sidebar. Its
            tooltip shows on the right, so it does not cover the switcher. */}
        <SidebarToggleButton
          label="Hide sidebar"
          onToggle={onToggle}
          side="right"
          className={cn(isDesktopShell && "desktop-no-drag")}
        />
        <BrandLogo linked className={cn(isDesktopShell && "desktop-no-drag")} />
      </SidebarHeader>

      <div className="flex shrink-0 items-center justify-between gap-1 px-2 pb-1">
        <SidebarViewSwitcher
          pathname={pathname}
          selectedTimeDate={selectedTimeDate}
          options={views}
        />
        <span className="ml-auto flex items-center gap-0.5">
          {/* An empty entry, unlike the dock's start for the Up next item. */}
          {state.timers.length === 0 ? (
            <TooltipButton
              label="Start"
              shortcut="entry.stop-or-start"
              side="bottom"
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="ajour-app-sidebar-toggle"
                  onClick={startBlankEntry}
                />
              }
            >
              <PlayIcon />
            </TooltipButton>
          ) : null}
          <TooltipButton
            label="Search"
            shortcut="app.command-palette"
            side="bottom"
            render={
              <Button
                variant="ghost"
                size="icon"
                className="ajour-app-sidebar-toggle"
                onClick={openCommandPalette}
              />
            }
          >
            <SearchIcon />
          </TooltipButton>
        </span>
      </div>

      <TimerDock upNext={selectUpNextBacklogItem(listed)} />

      <SidebarContent>
        <SidebarBacklogList pathname={pathname}>
          <SidebarPullRequests pathname={pathname} />
        </SidebarBacklogList>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="ajour-app-sidebar-button"
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
                  // The sidebar is wide-only, where /settings only redirects.
                  to="/settings/general"
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

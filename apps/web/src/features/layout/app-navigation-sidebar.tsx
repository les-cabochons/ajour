import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
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
import { selectSidebarBacklogItems } from "@/domain/backlog/backlog-item-lifecycle";
import { createSidebarMatcher } from "@/domain/backlog/sidebar-filter";
import { isPullRequestReturned } from "@/domain/pull-requests/pull-request-lifecycle";
import { getSectionPathname } from "@/features/backlog/backlog-item-search";
import { getAppSection } from "@/features/layout/app-section";
import { SidebarBacklogList } from "@/features/layout/sidebar-backlog-list";
import {
  SidebarPullRequests,
  useSidebarPullRequests,
} from "@/features/layout/sidebar-pull-requests";
import {
  SidebarFilterMenu,
  SidebarSearch,
} from "@/features/layout/sidebar-search";
import {
  SidebarViewSwitcher,
  type SidebarViewOption,
} from "@/features/layout/sidebar-view-switcher";
import {
  NewEntryButton,
  TimerDock,
  TodayTotal,
} from "@/features/layout/timer-dock";
import type { AppSidebarState } from "@/lib/app-sidebar";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { isDesktopShell } from "@/lib/runtime";
import { useSidebarSearch } from "@/lib/sidebar-search";
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
 * switcher with Search, the project filter and New entry, the
 * timer dock, then the work list, narrowed by the search and the filter. Search
 * expands into a search box in place of the switcher. It shows beside the
 * page. `useAppSidebar` owns whether it shows.
 */
export function AppNavigationSidebar({
  pathname,
  selectedTimeDate,
  onToggle,
  onStateChange,
}: {
  pathname: string;
  selectedTimeDate: string;
  onToggle: () => void;
  onStateChange: (state: AppSidebarState) => void;
}) {
  const state = useLocalState();
  const now = useNow();
  const layout = useSidebarLayout();
  const isSettingsActive = getAppSection(pathname) === "settings";
  // A backlog item opened from Time or Projects keeps that view selected.
  const sectionPathname = useRouterState({
    select: (router) =>
      getSectionPathname(router.location.pathname, router.location.search),
  });
  const { open: searchOpen, query } = useSidebarSearch();
  const matcher = useMemo(
    () =>
      createSidebarMatcher(
        { query, projectId: layout.projectId },
        state.projects,
      ),
    [query, layout.projectId, state.projects],
  );
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
      className="ajour-shell-sidebar ajour-app-navigation-sidebar"
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
        {searchOpen ? null : (
          <SidebarViewSwitcher
            pathname={sectionPathname}
            selectedTimeDate={selectedTimeDate}
            options={views}
          />
        )}
        <span
          className={cn(
            "flex items-center gap-0.5",
            searchOpen ? "min-w-0 flex-1" : "ml-auto",
          )}
        >
          <SidebarSearch />
          <SidebarFilterMenu
            projects={state.projects}
            projectId={layout.projectId}
            onChange={(projectId) => updateSidebarLayout({ projectId })}
            ordering={state.backlogSortMode}
            onOrderingChange={(mode) => localStore.setBacklogSortMode(mode)}
          />
          <NewEntryButton className="ajour-app-sidebar-toggle border-0" />
        </span>
      </div>

      <TimerDock />

      <SidebarContent>
        <SidebarBacklogList pathname={pathname} matcher={matcher}>
          <SidebarPullRequests pathname={pathname} matcher={matcher} />
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
      <SidebarResizeHandle onStateChange={onStateChange} />
    </Sidebar>
  );
}

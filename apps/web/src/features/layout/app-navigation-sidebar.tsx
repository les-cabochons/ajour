import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiFolderChartLine as FolderKanban,
  RiListCheck3 as ListTodo,
  RiSettings3Line as Settings,
  RiSideBarLine as SidebarIcon,
  RiTimerLine as Timer,
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
import type { AppSidebarState } from "@/lib/app-sidebar";
import { SidebarBacklogList } from "@/features/layout/sidebar-backlog-list";
import {
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  resolveSidebarWidth,
  updateSidebarLayout,
  useSidebarLayout,
} from "@/lib/sidebar-layout";

/** How far past an edge the pointer goes before the sidebar snaps open or closed. */
const SNAP_DISTANCE = 48;
const RAIL_WIDTH = 52;
const KEYBOARD_STEP = 16;

/**
 * The sidebar's right edge. Dragging resizes the expanded sidebar from 200px
 * to 400px. Past the minimum it snaps to the rail, and dragging the rail's
 * edge outward expands it again, as in VS Code. A double-click resets the
 * width to the density's default.
 */
function SidebarResizeHandle({
  state,
  onStateChange,
}: {
  state: AppSidebarState;
  onStateChange: (state: AppSidebarState) => void;
}) {
  const layout = useSidebarLayout();
  const leftRef = useRef(0);
  // The width before the drag, so a snap to the rail keeps it for next time.
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

    if (state === "rail") {
      if (width > RAIL_WIDTH + SNAP_DISTANCE) {
        event.currentTarget.releasePointerCapture(event.pointerId);
        onStateChange("expanded");
      }
      return;
    }

    if (width < SIDEBAR_MIN_WIDTH - SNAP_DISTANCE) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      updateSidebarLayout({ width: startWidthRef.current });
      onStateChange("rail");
      return;
    }
    updateSidebarLayout({ width: clampSidebarWidth(width) });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (state !== "expanded") return;
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
      aria-valuenow={
        state === "expanded" ? resolveSidebarWidth(layout) : RAIL_WIDTH
      }
      tabIndex={0}
      className="ajour-sidebar-resize-handle"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onDoubleClick={() =>
        state === "expanded" && updateSidebarLayout({ width: undefined })
      }
      onKeyDown={handleKeyDown}
    />
  );
}

const primaryItems = [
  { to: "/time/$date", label: "Time", icon: Timer, shortcut: "go.time" },
  { to: "/backlog", label: "Backlog", icon: ListTodo, shortcut: "go.backlog" },
  {
    to: "/projects",
    label: "Projects",
    icon: FolderKanban,
    shortcut: "go.projects",
  },
] as const;

export function isAppNavigationItemActive(
  pathname: string,
  to: "/time/$date" | "/backlog" | "/projects" | "/settings",
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

  return pathname === to;
}

function SidebarToggleButton({
  state,
  onToggle,
}: {
  state: AppSidebarState;
  onToggle: () => void;
}) {
  const label = state === "expanded" ? "Collapse sidebar" : "Expand sidebar";
  return (
    <TooltipButton
      label={label}
      shortcut="app.toggle-sidebar"
      side="right"
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          className="ajour-app-sidebar-toggle"
          onClick={onToggle}
        />
      }
    >
      <SidebarIcon />
    </TooltipButton>
  );
}

/**
 * The app sidebar on desktop widths. It stays visible on every page, Settings
 * included. `state` comes from `useAppSidebar`; when the window is too narrow
 * the rail is forced and the toggle gives way to the logo mark.
 */
export function AppNavigationSidebar({
  pathname,
  selectedTimeDate,
  state,
  isRailForced,
  onToggle,
  onStateChange,
}: {
  pathname: string;
  selectedTimeDate: string;
  state: AppSidebarState;
  isRailForced: boolean;
  onToggle: () => void;
  onStateChange: (state: AppSidebarState) => void;
}) {
  const isSettingsActive = isAppNavigationItemActive(pathname, "/settings");
  const showsLogo = state === "expanded" || isRailForced;
  const showsToggle = !isRailForced;

  return (
    <Sidebar
      className="ajour-shell-sidebar ajour-app-navigation-sidebar"
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
        {showsLogo ? <BrandLogo linked /> : null}
        {showsToggle ? (
          <SidebarToggleButton state={state} onToggle={onToggle} />
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryItems.map((item) => {
                const Icon = item.icon;
                const isActive = isAppNavigationItemActive(pathname, item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      className="ajour-app-sidebar-button"
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
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {state === "expanded" ? (
          <SidebarBacklogList pathname={pathname} />
        ) : null}
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
      {isRailForced ? null : (
        <SidebarResizeHandle state={state} onStateChange={onStateChange} />
      )}
    </Sidebar>
  );
}

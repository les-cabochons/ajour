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
}: {
  pathname: string;
  selectedTimeDate: string;
  state: AppSidebarState;
  isRailForced: boolean;
  onToggle: () => void;
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
    </Sidebar>
  );
}

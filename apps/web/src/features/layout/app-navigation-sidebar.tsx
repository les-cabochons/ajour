import { Link } from "@tanstack/react-router";
import {
  RiFolderChartLine as FolderKanban,
  RiListCheck3 as ListTodo,
  RiSettings3Line as Settings,
  RiTimerLine as Timer,
} from "@remixicon/react";
import { BrandLogo } from "@/components/brand-logo";
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

const primaryItems = [
  { to: "/time/$date", label: "Time", icon: Timer },
  { to: "/backlog", label: "Backlog", icon: ListTodo },
  { to: "/projects", label: "Projects", icon: FolderKanban },
] as const;

export function isAppNavigationItemActive(
  pathname: string,
  to: "/time/$date" | "/backlog" | "/projects" | "/settings",
) {
  if (to === "/time/$date") {
    return pathname.startsWith("/time/") || pathname.startsWith("/review/");
  }

  if (to === "/projects") {
    return pathname === "/projects" || pathname.startsWith("/projects/");
  }

  if (to === "/settings") {
    return pathname.startsWith("/settings");
  }

  return pathname === to;
}

export function isSettingsReturnPath(pathname: string) {
  return (
    isAppNavigationItemActive(pathname, "/time/$date") ||
    isAppNavigationItemActive(pathname, "/backlog") ||
    isAppNavigationItemActive(pathname, "/projects")
  );
}

export function AppNavigationSidebar({
  pathname,
  selectedTimeDate,
}: {
  pathname: string;
  selectedTimeDate: string;
}) {
  return (
    <Sidebar
      className="harday-shell-sidebar harday-app-navigation-sidebar"
      innerClassName="harday-shell-sidebar-inner"
      collapsible="none"
      role="navigation"
      aria-label="Primary navigation"
    >
      <div
        className="harday-sidebar-window-drag-region desktop-drag-region"
        aria-hidden="true"
      />
      <SidebarHeader className="harday-app-sidebar-header">
        <BrandLogo linked />
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
                      className="harday-app-sidebar-button"
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
                          title={item.label}
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
              className="harday-app-sidebar-button"
              render={
                <Link
                  to="/settings"
                  aria-label="Settings"
                  aria-current={
                    isAppNavigationItemActive(pathname, "/settings")
                      ? "page"
                      : undefined
                  }
                  title="Settings"
                />
              }
              isActive={isAppNavigationItemActive(pathname, "/settings")}
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

import { Link } from "@tanstack/react-router";
import {
  RiBugLine as Bug,
  RiDownloadLine as Download,
  RiFolderChartLine as FolderKanban,
  RiInboxLine as Inbox,
  RiListCheck3 as ListTodo,
  RiPuzzle2Line as Puzzle,
  RiSettings3Line as Settings,
} from "@remixicon/react";
import {
  CustomSidebar,
  CustomSidebarMenuButton,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/custom-sidebar";

const settingsItems = [
  { to: "/settings/general", label: "General", icon: Settings },
  { to: "/settings/plugins", label: "Plugins", icon: Puzzle },
  { to: "/settings/backlog", label: "Backlog", icon: ListTodo },
  { to: "/settings/projects", label: "Projects", icon: FolderKanban },
  { to: "/settings/time-entries", label: "Time entries", icon: Download },
  { to: "/settings/sync-review", label: "Sync review", icon: Inbox },
  // Debug exists only in development builds.
  ...(import.meta.env.DEV
    ? ([{ to: "/settings/debug", label: "Debug", icon: Bug }] as const)
    : []),
] as const;

/**
 * The list of settings pages, shown as a second column next to the app
 * sidebar, like the Projects list. The app sidebar stays visible in Settings,
 * so there is no Back control.
 */
export function SettingsNavigation({ pathname }: { pathname: string }) {
  return (
    <CustomSidebar
      className="ajour-settings-navigation"
      role="navigation"
      aria-label="Settings sections"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <CustomSidebarMenuButton
                      render={
                        <Link
                          to={item.to}
                          replace
                          aria-current={isActive ? "page" : undefined}
                        />
                      }
                      isActive={isActive}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </CustomSidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </CustomSidebar>
  );
}

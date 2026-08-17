import { Link } from "@tanstack/react-router";
import {
  RiArrowLeftLine as ArrowLeft,
  RiBugLine as Bug,
  RiDownloadLine as Download,
  RiFolderChartLine as FolderKanban,
  RiInboxLine as Inbox,
  RiListCheck3 as ListTodo,
  RiPuzzle2Line as Puzzle,
  RiSettings3Line as Settings,
} from "@remixicon/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const settingsItems = [
  { to: "/settings/general", label: "General", icon: Settings },
  { to: "/settings/plugins", label: "Plugins", icon: Puzzle },
  { to: "/settings/backlog", label: "Backlog", icon: ListTodo },
  { to: "/settings/projects", label: "Projects", icon: FolderKanban },
  { to: "/settings/export", label: "Time Logs", icon: Download },
  { to: "/settings/imports", label: "Sync Review", icon: Inbox },
  { to: "/settings/debug", label: "Debug", icon: Bug },
] as const;

export function SettingsNavigationSidebar({
  pathname,
  onBack,
}: {
  pathname: string;
  onBack: () => void;
}) {
  return (
    <Sidebar
      className="harday-shell-sidebar harday-settings-navigation-sidebar"
      innerClassName="harday-shell-sidebar-inner"
      collapsible="none"
      role="navigation"
      aria-label="Settings sections"
    >
      <div
        className="harday-sidebar-window-drag-region desktop-drag-region"
        aria-hidden="true"
      />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      className="harday-app-sidebar-button"
                      render={
                        <Link
                          to={item.to}
                          replace
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
              className="harday-app-sidebar-button harday-settings-back-button"
              aria-label="Back"
              title="Back"
              onClick={onBack}
            >
              <ArrowLeft />
              <span>Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

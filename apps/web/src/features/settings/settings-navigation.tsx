import { Link } from "@tanstack/react-router";
import {
  RiBugLine as Bug,
  RiDownloadLine as Download,
  RiFolderChartLine as FolderKanban,
  RiInboxLine as Inbox,
  RiListCheck3 as ListTodo,
  RiPuzzle2Line as Puzzle,
  RiSettings3Line as Settings,
  RiFlowChart as Workflow,
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

/**
 * Wide windows show the settings pages in a column next to the app sidebar.
 * The narrow view shows them as a full-width list that opens Settings.
 */
export type SettingsNavigationView = "wide" | "narrow";

/**
 * The settings pages in display order. The narrow view has no Projects
 * sidebar, so its Projects entry opens the full Projects section, where
 * project import and export is an action. Wide windows keep the separate
 * import and export page.
 */
export function getSettingsPages(view: SettingsNavigationView) {
  return [
    { to: "/settings/general", label: "General", icon: Settings },
    { to: "/settings/plugins", label: "Plugins", icon: Puzzle },
    { to: "/settings/backlog", label: "Backlog", icon: ListTodo },
    { to: "/settings/workflow", label: "Workflow", icon: Workflow },
    view === "narrow"
      ? { to: "/projects", label: "Projects", icon: FolderKanban }
      : { to: "/settings/projects", label: "Projects", icon: FolderKanban },
    { to: "/settings/time-entries", label: "Time entries", icon: Download },
    { to: "/settings/sync-review", label: "Sync review", icon: Inbox },
    // Debug exists only in development builds.
    ...(import.meta.env.DEV
      ? [{ to: "/settings/debug", label: "Debug", icon: Bug }]
      : []),
  ] as const;
}

/**
 * The list of settings pages. In wide windows it is a second column next to
 * the app sidebar, like the Projects list, and switching pages replaces the
 * history entry. In the narrow view it fills the page, and each page it
 * opens has a back arrow to it.
 */
export function SettingsNavigation({
  pathname,
  view,
}: {
  pathname: string;
  view: SettingsNavigationView;
}) {
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
              {getSettingsPages(view).map((item) => {
                const Icon = item.icon;
                const isActive = pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <CustomSidebarMenuButton
                      render={
                        <Link
                          to={item.to}
                          replace={view === "wide"}
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

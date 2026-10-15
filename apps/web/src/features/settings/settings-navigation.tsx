import { Link } from "@tanstack/react-router";
import {
  RiArrowLeftLine as ArrowLeft,
  RiArrowRightSLine as ChevronRight,
  RiBugLine as Bug,
  RiDownloadLine as Download,
  RiFolderChartLine as FolderKanban,
  RiInboxLine as Inbox,
  RiListCheck3 as ListTodo,
  RiPuzzle2Line as Puzzle,
  RiRobot2Line as Agents,
  RiSettings3Line as Settings,
  RiTerminalBoxLine as Terminal,
  RiGitPullRequestLine as PullRequestIcon,
  RiFlowChart as Workflow,
} from "@remixicon/react";
import {
  CustomSidebarMenuButton,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/custom-sidebar";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/ui/sidebar";
import { useCodeHostConnections } from "@/lib/code-host-connections";

/**
 * Wide windows show the settings pages in the app's left column, in place of
 * the app sidebar. The narrow view shows them as a full-width list that opens
 * Settings.
 */
export type SettingsNavigationView = "wide" | "narrow";

/**
 * The settings pages in display order, grouped under a heading. The narrow
 * view has no Projects sidebar, so its Projects entry opens the full
 * Projects section, where project import and export is an action. Wide
 * windows keep the separate import and export page.
 */
export function getSettingsGroups(
  view: SettingsNavigationView,
  hasCodeHost = false,
) {
  return [
    {
      label: "App",
      pages: [
        { to: "/settings/general", label: "General", icon: Settings },
        { to: "/settings/plugins", label: "Plugins", icon: Puzzle },
        { to: "/settings/mcp", label: "MCP", icon: Agents },
        { to: "/settings/agents", label: "Agents", icon: Terminal },
        // Debug exists only in development builds.
        ...(import.meta.env.DEV
          ? [{ to: "/settings/debug", label: "Debug", icon: Bug } as const]
          : []),
      ],
    },
    {
      label: "Work",
      pages: [
        { to: "/settings/backlog", label: "Backlog", icon: ListTodo },
        ...(view === "narrow" && hasCodeHost
          ? [
              {
                to: "/pull-requests",
                label: "Pull requests",
                icon: PullRequestIcon,
              } as const,
            ]
          : []),
        { to: "/settings/workflow", label: "Workflow", icon: Workflow },
        view === "narrow"
          ? { to: "/projects", label: "Projects", icon: FolderKanban }
          : { to: "/settings/projects", label: "Projects", icon: FolderKanban },
      ],
    },
    {
      label: "Data",
      pages: [
        { to: "/settings/time-entries", label: "Time entries", icon: Download },
        { to: "/settings/sync-review", label: "Sync review", icon: Inbox },
      ],
    },
  ] as const;
}

/** The settings pages in display order, without their groups. */
export function getSettingsPages(
  view: SettingsNavigationView,
  hasCodeHost = false,
) {
  return getSettingsGroups(view, hasCodeHost).flatMap((group) => group.pages);
}

/**
 * The list of settings pages. In wide windows the app shell shows it in place
 * of the app sidebar, full height, headed by Back to app (`onBack`), and
 * switching pages replaces the history entry. In the narrow view it fills the
 * page as headed sections of full-width rows, and each page it opens has a
 * back arrow to it.
 */
export function SettingsNavigation({
  pathname,
  view,
  onBack,
}: {
  pathname: string;
  view: SettingsNavigationView;
  onBack?: () => void;
}) {
  const { groups: codeHosts } = useCodeHostConnections();
  const groups = getSettingsGroups(view, codeHosts.length > 0);

  if (view === "narrow") {
    return (
      <nav className="settings-narrow-nav" aria-label="Settings sections">
        {groups.map((group) => (
          <section
            key={group.label}
            className="settings-narrow-nav-group"
            aria-labelledby={`settings-group-${group.label}`}
          >
            <h2
              id={`settings-group-${group.label}`}
              className="settings-narrow-nav-heading"
            >
              {group.label}
            </h2>
            <ul className="settings-narrow-nav-list">
              {group.pages.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link to={item.to} className="settings-narrow-nav-link">
                      <Icon className="settings-narrow-nav-icon" />
                      <span className="settings-narrow-nav-label">
                        {item.label}
                      </span>
                      <ChevronRight
                        className="settings-narrow-nav-chevron"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
    );
  }

  return (
    <Sidebar
      className="ajour-shell-sidebar ajour-settings-navigation"
      innerClassName="ajour-shell-sidebar-inner"
      collapsible="none"
      role="navigation"
      aria-label="Settings sections"
    >
      <div
        className="ajour-sidebar-window-drag-region desktop-drag-region"
        aria-hidden="true"
      />
      <SidebarHeader className="ajour-app-sidebar-header">
        <Button
          variant="ghost"

          className="text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft />
          Back to app
        </Button>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="ajour-settings-navigation-label">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.pages.map((item) => {
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
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

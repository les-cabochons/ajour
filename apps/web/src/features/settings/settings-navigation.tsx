import { Link } from "@tanstack/react-router";
import {
  RiArrowRightSLine as ChevronRight,
  RiBugLine as Bug,
  RiCalendarLine as CalendarIcon,
  RiDownloadLine as Download,
  RiFolderChartLine as FolderKanban,
  RiInboxLine as Inbox,
  RiKey2Line as Vault,
  RiListCheck3 as ListTodo,
  RiPuzzle2Line as Puzzle,
  RiRobot2Line as Agents,
  RiSettings3Line as Settings,
  RiSparkling2Line as Sparkle,
  RiTerminalBoxLine as Terminal,
  RiPulseLine as Diagnostics,
  RiFlowChart as Workflow,
  RiGitForkLine as Worktree,
} from "@remixicon/react";
import { useCalendarSources } from "@/lib/calendar-suggestions";
import { hasWorktrees } from "@/lib/worktrees";
import { hasLocalLogsBridge } from "./use-local-logs";

/**
 * Wide windows show the settings pages in the settings window's left column
 * (`SettingsWindow`). The narrow view shows them as a full-width list that
 * opens each page.
 */
export type SettingsNavigationView = "wide" | "narrow";

/**
 * The settings pages in display order, grouped under a heading. The narrow
 * view has no Projects sidebar, so its Projects entry opens the full
 * Projects section, where project import and export is an action. Wide
 * windows keep the separate import and export page. Deck is not a settings
 * page: the narrow view reaches it from the bottom switcher. Diagnostics is
 * listed only where the local log file is reachable: the desktop app's bridge.
 * Worktrees is listed only where hand offs run: the desktop app too.
 */
export function getSettingsGroups(
  view: SettingsNavigationView,
  hasCalendar = false,
  hasDiagnostics = false,
  hasWorktreesPage = false,
) {
  return [
    {
      label: "App",
      pages: [
        { to: "/settings/general", label: "General", icon: Settings },
        { to: "/settings/plugins", label: "Plugins", icon: Puzzle },
        { to: "/settings/vault", label: "Vault", icon: Vault },
        { to: "/settings/mcp", label: "MCP", icon: Agents },
        { to: "/settings/agents", label: "Agents", icon: Terminal },
        ...(hasDiagnostics
          ? [
              {
                to: "/settings/diagnostics",
                label: "Diagnostics",
                icon: Diagnostics,
              } as const,
            ]
          : []),
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
        { to: "/settings/workflow", label: "Workflow", icon: Workflow },
        view === "narrow"
          ? { to: "/projects", label: "Projects", icon: FolderKanban }
          : { to: "/settings/projects", label: "Projects", icon: FolderKanban },
        ...(hasWorktreesPage
          ? [
              {
                to: "/settings/worktrees",
                label: "Worktrees",
                icon: Worktree,
              } as const,
            ]
          : []),
        ...(hasCalendar
          ? [
              {
                to: "/settings/calendar",
                label: "Calendar",
                icon: CalendarIcon,
              } as const,
            ]
          : []),
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

/**
 * Settings pages no group lists. What's new opens from the version at the
 * foot of the Settings window, from the gear's menu while an update waits,
 * and from the command palette.
 */
export const unlistedSettingsPages = [
  { to: "/settings/whats-new", label: "What's new", icon: Sparkle },
] as const;

/** The settings pages in display order, without their groups. */
export function getSettingsPages(
  view: SettingsNavigationView,
  hasCalendar = false,
  hasDiagnostics = false,
  hasWorktreesPage = false,
) {
  return getSettingsGroups(
    view,
    hasCalendar,
    hasDiagnostics,
    hasWorktreesPage,
  ).flatMap((group) => group.pages);
}

/**
 * The narrow view's list of settings pages, at /settings: headed sections of
 * full-width rows, and each page it opens has a back arrow to it.
 */
export function SettingsNavigation() {
  const calendars = useCalendarSources();
  const groups = getSettingsGroups(
    "narrow",
    calendars.length > 0,
    hasLocalLogsBridge(),
    hasWorktrees(),
  );

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

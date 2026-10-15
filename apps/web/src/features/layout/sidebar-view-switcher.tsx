import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiArrowDownSLine as ChevronIcon,
  RiCheckLine as CheckIcon,
  RiFolderChartLine as FolderKanban,
  RiGitPullRequestLine as PullRequestIcon,
  RiListCheck3 as ListTodo,
  RiTimerLine as Timer,
} from "@remixicon/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** A page group the sidebar's view switcher opens. */
export type AppView = "time" | "backlog" | "pull-requests" | "projects";

/**
 * The view a page belongs to, such as Backlog for a backlog item's page.
 * Settings and unknown paths belong to none.
 */
export function getAppView(pathname: string): AppView | undefined {
  const within = (root: string) =>
    pathname === root || pathname.startsWith(`${root}/`);

  if (pathname.startsWith("/time/")) return "time";
  if (within("/backlog")) return "backlog";
  if (within("/pull-requests")) return "pull-requests";
  if (within("/projects")) return "projects";
  return undefined;
}

/** One line of the switcher's menu. */
export interface SidebarViewOption {
  view: AppView;
  /** The live value at the end of the line, such as today's total. */
  count?: ReactNode;
  /** Draws the count as a badge, as for returned pull requests. */
  highlighted?: boolean;
}

const VIEW_DETAILS = {
  time: { label: "Time", icon: Timer },
  backlog: { label: "Backlog", icon: ListTodo },
  "pull-requests": { label: "Pull requests", icon: PullRequestIcon },
  projects: { label: "Projects", icon: FolderKanban },
} as const;

/** The link a view's menu line renders. Base UI adds the item's props to it. */
function viewLink(view: AppView, selectedTimeDate: string) {
  switch (view) {
    case "time":
      return <Link to="/time/$date" params={{ date: selectedTimeDate }} />;
    case "backlog":
      return <Link to="/backlog" />;
    case "pull-requests":
      return <Link to="/pull-requests" />;
    case "projects":
      return <Link to="/projects" />;
  }
}

function ViewCount({
  value,
  highlighted = false,
}: {
  value?: ReactNode;
  highlighted?: boolean;
}) {
  if (value === undefined) return null;
  return (
    <span
      className={cn(
        "ml-auto shrink-0 font-mono text-xs tabular-nums",
        highlighted
          ? "flex h-[18px] min-w-[18px] items-center justify-center rounded-[var(--radius-sm)] bg-primary px-1.5 font-medium text-primary-foreground"
          : "text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

/**
 * The sidebar's view switcher, like ChatGPT's: the current view's name opens a
 * menu of the views with their live counts. Time opens on the day the
 * titlebar shows.
 */
export function SidebarViewSwitcher({
  pathname,
  selectedTimeDate,
  options,
}: {
  pathname: string;
  selectedTimeDate: string;
  options: SidebarViewOption[];
}) {
  const current = getAppView(pathname);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Switch view, ${current ? VIEW_DETAILS[current].label : "none"} open`}
        className="flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-base font-semibold outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring data-[popup-open]:bg-foreground/5"
      >
        <span className="truncate">
          {current ? VIEW_DETAILS[current].label : "Views"}
        </span>
        <ChevronIcon className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        {options.map((option) => {
          const { label, icon: Icon } = VIEW_DETAILS[option.view];
          const isCurrent = option.view === current;
          return (
            <DropdownMenuLinkItem
              key={option.view}
              render={viewLink(option.view, selectedTimeDate)}
              aria-current={isCurrent ? "page" : undefined}
            >
              <Icon className="text-muted-foreground" />
              <span>{label}</span>
              <ViewCount value={option.count} highlighted={option.highlighted} />
              <CheckIcon
                className={cn("text-foreground", !isCurrent && "invisible")}
              />
            </DropdownMenuLinkItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

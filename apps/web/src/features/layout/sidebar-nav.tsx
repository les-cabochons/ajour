import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiFolderChartLine as FolderKanban,
  RiGitPullRequestLine as PullRequestIcon,
  RiListCheck3 as ListTodo,
  RiTimerLine as Timer,
} from "@remixicon/react";
import { getAppSection, type AppView } from "@/features/layout/app-section";
import { cn } from "@/lib/utils";

/** One row of the nav. */
export interface SidebarViewOption {
  view: AppView;
  /** The live value at the end of the row, such as today's total. */
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

/** What every row's link shares; the view picks the route. */
interface ViewLinkProps {
  className: string;
  "aria-current"?: "page";
  children: ReactNode;
}

/**
 * The link a view's row renders. Time opens on the day the titlebar shows.
 * The router marks a link `aria-current` on its exact route only; the row's
 * own `aria-current` covers the pages inside a view, such as a backlog item
 * opened from Time, which `getSectionPathname` assigns.
 */
function ViewLink({
  view,
  selectedTimeDate,
  ...props
}: ViewLinkProps & { view: AppView; selectedTimeDate: string }) {
  const shared = { "data-view": view, activeOptions: { exact: true } };
  switch (view) {
    case "time":
      return (
        <Link
          to="/time/$date"
          params={{ date: selectedTimeDate }}
          {...shared}
          {...props}
        />
      );
    case "backlog":
      return <Link to="/backlog" {...shared} {...props} />;
    case "pull-requests":
      return <Link to="/pull-requests" {...shared} {...props} />;
    case "projects":
      return <Link to="/projects" {...shared} {...props} />;
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
 * The sidebar's nav, like Things' lists: one 28px row per view with its icon,
 * name and live count, always in view, so every view is one click and the
 * counts need no menu. The open view's row carries the active background and
 * `aria-current`. A Settings page selects none.
 */
export function SidebarNav({
  pathname,
  selectedTimeDate,
  options,
}: {
  pathname: string;
  selectedTimeDate: string;
  options: SidebarViewOption[];
}) {
  const section = getAppSection(pathname);
  const current = section === "settings" ? undefined : section;
  return (
    <ul className="flex shrink-0 flex-col gap-px px-2 pb-1">
      {options.map((option) => {
        const { label, icon: Icon } = VIEW_DETAILS[option.view];
        const isCurrent = option.view === current;
        return (
          <li key={option.view}>
            <ViewLink
              view={option.view}
              selectedTimeDate={selectedTimeDate}
              aria-current={isCurrent ? "page" : undefined}
              className={cn(
                "flex h-7 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring",
                isCurrent && "bg-[var(--app-sidebar-active-bg)] font-medium",
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{label}</span>
              <ViewCount
                value={option.count}
                highlighted={option.highlighted}
              />
            </ViewLink>
          </li>
        );
      })}
    </ul>
  );
}

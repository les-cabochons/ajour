import { Link } from "@tanstack/react-router";
import {
  RiArrowLeftLine as ArrowLeft,
  RiCalendarCheckLine as CommitIcon,
  RiListCheck3 as ListTodo,
  RiSettings3Line as Settings,
  RiTimerLine as Timer,
} from "@remixicon/react";
import { buttonVariants } from "@/components/ui/button";
import { getAppSection } from "@/features/layout/app-section";
import {
  getNarrowBackLink,
  isNarrowSettingsSection,
} from "@/features/layout/narrow-navigation";
import { useOpenCommitPage } from "@/features/time/use-open-commit-page";
import { cn } from "@/lib/utils";

const sections = [
  {
    to: "/time/$date",
    label: "Time",
    icon: Timer,
    isActive: (pathname: string) => getAppSection(pathname) === "time",
  },
  {
    to: "/backlog",
    label: "Backlog",
    icon: ListTodo,
    isActive: (pathname: string) => getAppSection(pathname) === "backlog",
  },
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
    // Projects lives inside Settings in the narrow view.
    isActive: isNarrowSettingsSection,
  },
] as const;

/**
 * The narrow view's primary navigation: a segmented toggle for Time, Backlog
 * and Settings that floats at the bottom left. Every item shows its icon and
 * name; the active one is filled. After a hairline, Commit opens the Commit
 * page for the week on screen. It is an action, not a section, so it is
 * never active.
 */
export function NarrowSectionSwitcher({
  pathname,
  selectedTimeDate,
}: {
  pathname: string;
  selectedTimeDate: string;
}) {
  const openCommitPage = useOpenCommitPage(selectedTimeDate);
  return (
    <nav className="ajour-narrow-switcher" aria-label="Primary navigation">
      {sections.map((section) => {
        const Icon = section.icon;
        const isActive = section.isActive(pathname);
        const linkProps = {
          to: section.to,
          params:
            section.to === "/time/$date"
              ? { date: selectedTimeDate }
              : undefined,
          "aria-current": isActive ? ("page" as const) : undefined,
          className: "ajour-narrow-switcher-item",
        };

        // Every destination shows its name, so none has to be recognized by
        // its icon alone (council round 2).
        return (
          <Link key={section.to} {...linkProps}>
            <Icon aria-hidden />
            <span>{section.label}</span>
          </Link>
        );
      })}
      <span className="ajour-narrow-switcher-divider" aria-hidden="true" />
      <button
        type="button"
        aria-label="Commit week"
        className="ajour-narrow-switcher-item"
        onClick={() => openCommitPage()}
      >
        <CommitIcon aria-hidden />
        <span>Commit</span>
      </button>
    </nav>
  );
}

/** The back arrow above a narrow-view page inside Settings, or nothing on other pages. */
export function NarrowBackBar({ pathname }: { pathname: string }) {
  const backLink = getNarrowBackLink(pathname);
  if (!backLink) {
    return null;
  }

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border px-2">
      <Link
        to={backLink.to}
        aria-label={`Back to ${backLink.label}`}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "gap-1.5 text-muted-foreground hover:text-foreground",
        )}
      >
        <ArrowLeft className="size-4" />
        {backLink.label === "Projects" ? "Back to Projects" : backLink.label}
      </Link>
    </div>
  );
}

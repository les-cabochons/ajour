import { Link } from "@tanstack/react-router";
import {
  RiArrowLeftLine as ArrowLeft,
  RiListCheck3 as ListTodo,
  RiSettings3Line as Settings,
  RiTimerLine as Timer,
} from "@remixicon/react";
import { buttonVariants } from "@/components/ui/button";
import { TooltipButton } from "@/components/tooltip-button";
import { getAppSection } from "@/features/layout/app-section";
import {
  getNarrowBackLink,
  isNarrowSettingsSection,
} from "@/features/layout/narrow-navigation";
import { isDesktopShell } from "@/lib/runtime";
import { cn } from "@/lib/utils";

const sections = [
  {
    view: "time",
    to: "/time/$date",
    label: "Time",
    icon: Timer,
    shortcut: "go.time",
  },
  {
    view: "backlog",
    to: "/backlog",
    label: "Backlog",
    icon: ListTodo,
    shortcut: "go.backlog",
  },
] as const;

/**
 * The narrow view's primary navigation: a segmented switcher in the titlebar.
 * The active section shows its label, the other only its icon. Projects and
 * Settings are reached from the cog.
 */
export function NarrowSectionSwitcher({
  pathname,
  selectedTimeDate,
}: {
  pathname: string;
  selectedTimeDate: string;
}) {
  return (
    <nav
      className={cn(
        "ajour-narrow-switcher",
        isDesktopShell && "desktop-no-drag",
      )}
      aria-label="Primary navigation"
    >
      {sections.map((section) => {
        const Icon = section.icon;
        const isActive = getAppSection(pathname) === section.view;
        const linkProps = {
          to: section.to,
          params:
            section.to === "/time/$date"
              ? { date: selectedTimeDate }
              : undefined,
          "aria-current": isActive ? ("page" as const) : undefined,
          className: "ajour-narrow-switcher-item",
        };

        if (isActive) {
          return (
            <Link key={section.to} aria-label={section.label} {...linkProps}>
              <Icon />
              <span>{section.label}</span>
            </Link>
          );
        }

        return (
          <TooltipButton
            key={section.to}
            label={section.label}
            shortcut={section.shortcut}
            render={<Link {...linkProps} />}
          >
            <Icon />
          </TooltipButton>
        );
      })}
    </nav>
  );
}

/** The cog at the trailing edge of the narrow titlebar. Projects lives inside Settings there. */
export function NarrowSettingsButton({ pathname }: { pathname: string }) {
  const isActive = isNarrowSettingsSection(pathname);
  return (
    <TooltipButton
      label="Settings"
      shortcut="app.settings"
      render={
        <Link
          to="/settings"
          aria-current={isActive ? "page" : undefined}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "shrink-0 text-muted-foreground",
            isActive && "bg-muted text-foreground",
            isDesktopShell && "desktop-no-drag",
          )}
        />
      }
    >
      <Settings className="size-4" />
    </TooltipButton>
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

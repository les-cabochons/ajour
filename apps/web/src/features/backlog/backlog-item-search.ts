import { defaultParseSearch } from "@tanstack/react-router";
import type { PageBackLink } from "@/components/page-header";
import type { HostedBacklogItemActionId } from "@/features/backlog/backlog-item-actions";
import { getAppSection, type AppSection } from "@/features/layout/app-section";

/** The search params of the backlog item page at /backlog/$itemId. */
export interface BacklogItemSearch {
  action?: HostedBacklogItemActionId;
  /** The page the item was opened from, when outside Backlog. */
  from?: string;
}

const hostedActionIds: readonly HostedBacklogItemActionId[] = [
  "edit",
  "add-subitem",
];

/**
 * The sections an item page can return to, with their back link names.
 * Backlog is the default, and Settings has no sidebar to open an item from.
 */
const originLabels: Partial<Record<AppSection, string>> = {
  time: "Time",
  projects: "Projects",
  "pull-requests": "Pull requests",
};

/** A valid `from`, split for the back link and the section switchers. */
function resolveOrigin(value: unknown) {
  if (typeof value !== "string") return undefined;
  const end = value.search(/[?#]/);
  const pathname = end === -1 ? value : value.slice(0, end);
  const search = end === -1 ? "" : value.slice(end).replace(/#.*$/, "");
  const section = getAppSection(pathname);
  const label = section ? originLabels[section] : undefined;
  return label ? { href: value, pathname, search, label } : undefined;
}

/**
 * Validates the search params of /backlog/$itemId. The URL is outside input,
 * so an `action` the page cannot host is dropped instead of reaching it.
 */
export function parseBacklogItemSearch(
  search: Record<string, unknown>,
): BacklogItemSearch {
  const action = hostedActionIds.find((id) => id === search.action);
  const from = parseBacklogItemOrigin(search.from);
  return { ...(action ? { action } : {}), ...(from ? { from } : {}) };
}

/**
 * The page a backlog item was opened from, as an in-app href such as
 * `/time/2026-10-15?view=week`, or undefined. Only a page of Time, Projects
 * or Pull requests counts, which also drops external URLs.
 */
export function parseBacklogItemOrigin(value: unknown): string | undefined {
  return resolveOrigin(value)?.href;
}

/**
 * The `from` to give an item page opened at `location`: the current page,
 * or the origin of the item page already open, so moving between items keeps
 * the way back. Undefined on Backlog pages.
 */
export function getBacklogItemOriginFor(location: {
  pathname: string;
  href: string;
  search: { from?: unknown };
}): string | undefined {
  return location.pathname.startsWith("/backlog/")
    ? parseBacklogItemOrigin(location.search.from)
    : parseBacklogItemOrigin(location.href);
}

/**
 * The path the section switchers read. An item page opened from another
 * section reads as its origin, so the sidebar stays on Time or Projects.
 */
export function getSectionPathname(
  pathname: string,
  search: { from?: unknown },
): string {
  if (!pathname.startsWith("/backlog/")) return pathname;
  return resolveOrigin(search.from)?.pathname ?? pathname;
}

/** The item page's back link: to the page it was opened from, or to Backlog. */
export function getBacklogItemBackLink(from: string | undefined): PageBackLink {
  const origin = resolveOrigin(from);
  if (!origin) return { label: "Backlog", to: "/backlog" };
  return {
    label: origin.label,
    to: origin.pathname,
    search: defaultParseSearch(origin.search),
  };
}

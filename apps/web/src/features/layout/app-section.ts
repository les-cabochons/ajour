/**
 * The part of the app a page belongs to. The sidebar's view switcher and the
 * narrow titlebar highlight it, and the shell reads it for Time and Settings.
 */
export type AppSection =
  "time" | "backlog" | "pull-requests" | "projects" | "settings";

/** A section the sidebar's view switcher opens. Settings has its own button. */
export type AppView = Exclude<AppSection, "settings">;

/**
 * The section of a page, counting the pages inside it, such as Backlog for a
 * backlog item's page. Unknown paths belong to none.
 */
export function getAppSection(pathname: string): AppSection | undefined {
  const within = (root: string) =>
    pathname === root || pathname.startsWith(`${root}/`);

  if (pathname.startsWith("/time/")) return "time";
  if (within("/backlog")) return "backlog";
  if (within("/pull-requests")) return "pull-requests";
  if (within("/projects")) return "projects";
  if (within("/settings")) return "settings";
  return undefined;
}

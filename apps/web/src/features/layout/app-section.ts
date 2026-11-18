/**
 * The part of the app a page belongs to. The sidebar's nav and the
 * narrow titlebar highlight it, and the shell reads it for Time and Settings.
 */
export type AppSection = "time" | "backlog" | "deck" | "projects" | "settings";

/** A section the sidebar's nav opens. Settings has its own button. */
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
  if (within("/deck")) return "deck";
  if (within("/projects")) return "projects";
  if (within("/settings")) return "settings";
  return undefined;
}

/**
 * Whether a section nav entry shows now. An entry with
 * `requiresCodeHost: true`, as Deck's in the sidebar's nav and in the narrow
 * switcher, shows only while a code host plugin is enabled.
 */
export function isSectionEntryShown(
  entry: object,
  hasCodeHost: boolean,
): boolean {
  return (
    hasCodeHost ||
    !("requiresCodeHost" in entry && entry.requiresCodeHost === true)
  );
}

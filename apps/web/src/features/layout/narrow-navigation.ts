/**
 * Page hierarchy of the narrow view, below 768px. There are no sidebars, so
 * Settings opens on its list of pages and Projects lives inside Settings:
 *
 * Settings list (/settings)
 * ├── each settings page (/settings/...)
 * └── Projects list (/projects)
 *     ├── project detail (/projects/$projectId)
 *     ├── archive (/projects/archive)
 *     └── project import and export (/settings/projects)
 *
 * See "Narrow view" in agents/ux-spec.md.
 */

export type NarrowBackLink = {
  to: "/settings" | "/projects";
  label: "Settings" | "Projects";
};

const backToSettings: NarrowBackLink = { to: "/settings", label: "Settings" };
const backToProjects: NarrowBackLink = { to: "/projects", label: "Projects" };

function trimTrailingSlash(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/** Where the back arrow of a narrow-view page leads, or null when the page has none. */
export function getNarrowBackLink(pathname: string): NarrowBackLink | null {
  const path = trimTrailingSlash(pathname);

  if (path === "/settings/projects") {
    return backToProjects;
  }

  if (path.startsWith("/settings/")) {
    return backToSettings;
  }

  if (path === "/projects") {
    return backToSettings;
  }

  if (path.startsWith("/projects/")) {
    return backToProjects;
  }

  return null;
}

/** True on Settings and Projects pages, which the titlebar cog leads to in the narrow view. */
export function isNarrowSettingsSection(pathname: string) {
  const path = trimTrailingSlash(pathname);
  return (
    path === "/settings" ||
    path.startsWith("/settings/") ||
    path === "/projects" ||
    path.startsWith("/projects/")
  );
}

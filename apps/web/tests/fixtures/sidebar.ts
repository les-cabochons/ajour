import type { Page } from "@playwright/test";

function primaryNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

/** The nav row's `data-view` for a view's name, such as "Pull requests". */
export function viewSlug(view: string) {
  return view.toLowerCase().replace(/\s+/g, "-");
}

const VIEW_LABELS: Record<string, string> = {
  time: "Time",
  backlog: "Backlog",
  "pull-requests": "Pull requests",
  projects: "Projects",
};

/** The app sidebar's nav: one link per view, always in view. */
export function sidebarNav(page: Page) {
  return primaryNavigation(page).locator("a[data-view]");
}

/** The nav row of one view, by the view's name. */
export function viewLink(page: Page, view: string) {
  return primaryNavigation(page).locator(`a[data-view="${viewSlug(view)}"]`);
}

/** The nav row of the open view. */
export function activeViewLink(page: Page) {
  return primaryNavigation(page).locator("a[data-view][aria-current='page']");
}

/** The views the nav lists, by name, in order. */
export async function viewOptions(page: Page) {
  const slugs = await sidebarNav(page).evaluateAll((links) =>
    links.map((link) => link.getAttribute("data-view") ?? ""),
  );
  return slugs.map((slug) => VIEW_LABELS[slug] ?? slug);
}

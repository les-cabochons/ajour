import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalWorkItem,
} from "@/domain/local-state";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";

/** What narrows the sidebar's work list. See "Search and project filter" in agents/ux-spec.md. */
export interface SidebarFilter {
  /** Typed in the sidebar's search box. Blank matches everything. */
  query: string;
  /** The project picked in the filter menu. Missing means all projects. */
  projectId?: string;
}

/** Decides which sidebar rows show for one filter. */
export interface SidebarMatcher {
  /** True while the query or the project narrows the list. */
  active: boolean;
  workItem: (workItem: Pick<LocalWorkItem, "title" | "projectId">) => boolean;
  pullRequest: (item: {
    facts: Pick<LocalPullRequest["facts"], "title" | "repository">;
  }) => boolean;
}

function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Builds the row tests for `filter`. Every typed word must appear in the
 * item's title or its project's name, display name or code, ignoring case and
 * accents. A pull request matches on its title and repository. Pull requests
 * have no Ajour project, so they hide while a project is picked. A picked
 * project that no longer exists, or is archived, filters nothing.
 */
export function createSidebarMatcher(
  filter: SidebarFilter,
  projects: readonly LocalProject[],
): SidebarMatcher {
  const terms = normalizeSearchText(filter.query).split(/\s+/u).filter(Boolean);
  const projectText = new Map(
    projects.map((project) => [
      project._id,
      normalizeSearchText(
        [project.name, getLocalProjectDisplayName(project), project.code]
          .filter(Boolean)
          .join(" "),
      ),
    ]),
  );
  const projectId = projects.some(
    (project) =>
      project._id === filter.projectId && project.status === "active",
  )
    ? filter.projectId
    : undefined;
  const matchesTerms = (text: string) =>
    terms.every((term) => text.includes(term));

  return {
    active: terms.length > 0 || projectId !== undefined,
    workItem: (workItem) =>
      (!projectId || workItem.projectId === projectId) &&
      matchesTerms(
        `${normalizeSearchText(workItem.title)} ${
          (workItem.projectId && projectText.get(workItem.projectId)) ?? ""
        }`,
      ),
    pullRequest: (item) =>
      !projectId &&
      matchesTerms(
        normalizeSearchText(`${item.facts.title} ${item.facts.repository}`),
      ),
  };
}

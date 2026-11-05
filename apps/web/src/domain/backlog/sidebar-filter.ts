import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalWorkItem,
} from "@/domain/local-state";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";

/** What narrows the sidebar's work list. See "Search and project filter" in docs/agents/ux-spec.md. */
export interface SidebarFilter {
  /** Typed in the sidebar's search box. Blank matches everything. */
  query: string;
  /** The project picked in the filter menu. Missing means all projects. */
  projectId?: string;
  /**
   * The client picked in the filter menu instead of a project: the items of
   * its managed projects (#508). Missing means all projects.
   */
  client?: string;
}

/** Decides which sidebar rows show for one filter. */
export interface SidebarMatcher {
  /** True while the query or the project narrows the list. */
  active: boolean;
  /** The picked project while it narrows the list. Missing for an archived or gone one. */
  projectId?: string;
  workItem: (workItem: Pick<LocalWorkItem, "title" | "projectId">) => boolean;
  pullRequest: (item: {
    facts: Pick<LocalPullRequest["facts"], "title" | "repository">;
  }) => boolean;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Whether the project is an active managed project of `client`. */
function isActiveProjectOf(project: LocalProject, client: string) {
  return (
    project.status === "active" &&
    project.source !== undefined &&
    project.client === client
  );
}

/**
 * The clients the filter menu offers: each client of an active managed
 * project once, sorted by name.
 */
export function getSidebarClients(projects: readonly LocalProject[]) {
  const clients = new Set<string>();
  for (const project of projects) {
    if (project.client && isActiveProjectOf(project, project.client)) {
      clients.add(project.client);
    }
  }
  return [...clients].sort((left, right) => left.localeCompare(right));
}

/**
 * Builds the row tests for `filter`. Every typed word must appear in the
 * item's title or its project's name, display name or code, ignoring case and
 * accents. A pull request matches on its title and repository. Pull requests
 * have no Ajour project, so they hide while a project is picked. A picked
 * project that no longer exists, or is archived, filters nothing. A picked
 * client keeps the items of its active managed projects, and filters nothing
 * once none has it.
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
  const clientProjectIds =
    projectId === undefined && filter.client
      ? new Set(
          projects
            .filter((project) => isActiveProjectOf(project, filter.client!))
            .map((project) => project._id),
        )
      : undefined;
  const clientPicked =
    clientProjectIds !== undefined && clientProjectIds.size > 0;
  const matchesTerms = (text: string) =>
    terms.every((term) => text.includes(term));

  return {
    active: terms.length > 0 || projectId !== undefined || clientPicked,
    projectId,
    workItem: (workItem) =>
      (!projectId || workItem.projectId === projectId) &&
      (!clientPicked ||
        (workItem.projectId !== undefined &&
          clientProjectIds.has(workItem.projectId))) &&
      matchesTerms(
        `${normalizeSearchText(workItem.title)} ${
          (workItem.projectId && projectText.get(workItem.projectId)) ?? ""
        }`,
      ),
    pullRequest: (item) =>
      !projectId &&
      !clientPicked &&
      matchesTerms(
        normalizeSearchText(`${item.facts.title} ${item.facts.repository}`),
      ),
  };
}

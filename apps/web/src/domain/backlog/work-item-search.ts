import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalWorkItem,
} from "@/domain/local-state";

/** What a search box reads on a work item. */
export type SearchableWorkItem = Pick<
  LocalWorkItem,
  "title" | "projectId" | "sourceExternalId"
>;

/** The test a typed query applies to rows. See `createWorkItemSearch`. */
export interface WorkItemSearch {
  /** True while the query has at least one word. */
  active: boolean;
  matches: (item: SearchableWorkItem) => boolean;
  /** The same words against any text, such as a pull request's title. */
  matchesText: (text: string) => boolean;
}

/** Lowercase without accents, so "été" and "ETE" compare equal. */
export function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Builds the test a typed query applies to work items, for the sidebar and
 * the Backlog page alike. Every typed word must appear in the item's title or
 * its project's name, display name or code, or start the item's number as its
 * source shows it (`sourceExternalId`, the 331150 on a row), ignoring case
 * and accents. The number matches from its start only, so "3311" finds
 * 331150 and "150" does not. A blank query matches everything.
 */
export function createWorkItemSearch(
  query: string,
  projects: readonly LocalProject[],
): WorkItemSearch {
  const terms = normalizeSearchText(query).split(/\s+/u).filter(Boolean);
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
  const matchesText = (text: string) =>
    terms.every((term) => text.includes(term));
  return {
    active: terms.length > 0,
    matchesText: (text) => matchesText(normalizeSearchText(text)),
    matches: (item) => {
      if (terms.length === 0) return true;
      const text = `${normalizeSearchText(item.title)} ${
        (item.projectId && projectText.get(item.projectId)) ?? ""
      }`;
      const number = item.sourceExternalId
        ? normalizeSearchText(item.sourceExternalId)
        : undefined;
      return terms.every(
        (term) => text.includes(term) || (number?.startsWith(term) ?? false),
      );
    },
  };
}

import { getWorkItemKey } from "@/domain/backlog/backlog-item-summary";
import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalWorkItem,
} from "@/domain/local-state";

/** What a search box reads on a work item. */
export type SearchableWorkItem = Pick<
  LocalWorkItem,
  "title" | "projectId" | "sourceExternalId"
> &
  Partial<Pick<LocalWorkItem, "source" | "sourceId" | "sourceUrl">>;

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

/** The letters and digits alone, so "weekgrid" finds "Week grid". */
function compact(text: string) {
  return text.replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Builds the test a typed query applies to work items, for the sidebar and
 * the Backlog page alike. Every typed word must appear in the item's title or
 * its project's name, display name or code, or start the item's number as its
 * row shows it, ignoring case and accents. A word also matches the title or
 * project with their spaces and punctuation left out, so "weekgrid" finds
 * "Week grid".
 *
 * The number is the plugin's external id (`sourceExternalId`, the 331150 on a
 * row), or for items synced before Ajour kept it, the number or key their link
 * ends with (`getWorkItemKey`), such as 48190 or HRB-412. It matches from its
 * start only, so "3311" finds 331150 and "150" does not, and a leading "#", as
 * in "#48190", is read as part of the number. A blank query matches everything.
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
      const compactText = compact(text);
      const numbers = [item.sourceExternalId, getWorkItemKey(item)]
        .filter((value): value is string => Boolean(value))
        .map(normalizeSearchText);
      return terms.every((term) => {
        if (text.includes(term)) return true;
        const number = term.replace(/^#/, "");
        if (number && numbers.some((value) => value.startsWith(number))) {
          return true;
        }
        const compactTerm = compact(term);
        return compactTerm !== "" && compactText.includes(compactTerm);
      });
    },
  };
}

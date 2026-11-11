import { createSearchBoxState } from "@/lib/search-box-state";

/**
 * The Backlog page's search box (#652), see `lib/search-box-state.ts`. It is
 * the page's own: the sidebar's query never narrows the page, and the page's
 * never narrows the sidebar.
 */
const backlogSearch = createSearchBoxState();

export const updateBacklogSearch = backlogSearch.update;
export const useBacklogSearch = backlogSearch.use;
export const readBacklogSearch = backlogSearch.get;

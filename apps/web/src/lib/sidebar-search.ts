import {
  createSearchBoxState,
  type SearchBoxState,
} from "@/lib/search-box-state";

/**
 * The sidebar's search box, see `lib/search-box-state.ts`. Unlike the project
 * filter in the sidebar layout, it is never saved.
 */
export type SidebarSearchState = SearchBoxState;

const sidebarSearch = createSearchBoxState();

/** The search as it is now, for code outside React. */
export const getSidebarSearch = sidebarSearch.get;
export const updateSidebarSearch = sidebarSearch.update;
export const useSidebarSearch = sidebarSearch.use;

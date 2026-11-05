/**
 * Where Settings is open. In wide windows Settings is a window over the
 * page: the page keeps its route, and the open settings page rides in the
 * `settings` search key of the page's location, as `general` or
 * `sync-review?item=abc`. The browser shows `/settings/general` meanwhile,
 * through a route mask, so links, bookmarks and Back read as before. The
 * narrow view has no window: there `/settings/...` are the pages themselves.
 */

/** The search key of the page's location that holds the open settings page. */
export const SETTINGS_SEARCH_KEY = "settings";

/** The settings page the window opens on when none is named: `/settings`. */
export const DEFAULT_SETTINGS_PAGE = "general";

/** A settings page's search values, such as Sync review's `item`. */
export type SettingsSearch = Record<string, string>;

export interface SettingsLocation {
  /** The path under `/settings/`, such as `general` or `plugins/jira`. */
  page: string;
  search: SettingsSearch;
}

/** The settings page and search a route or a link names, normalised. */
export function settingsLocationOf(
  page: string,
  search: Record<string, unknown> = {},
): SettingsLocation {
  const trimmed = page.replace(/^\/?settings\/?/, "").replace(/^\/+|\/+$/g, "");
  return {
    page: trimmed || DEFAULT_SETTINGS_PAGE,
    search: stringValues(search),
  };
}

/** The `settings` search value for a location: `sync-review?item=abc`. */
export function encodeSettingsLocation(location: SettingsLocation): string {
  const params = new URLSearchParams(location.search);
  const query = params.toString();
  return query ? `${location.page}?${query}` : location.page;
}

/** The location a `settings` search value names, or null when it names none. */
export function parseSettingsLocation(value: unknown): SettingsLocation | null {
  if (typeof value !== "string" || value === "") return null;
  const separator = value.indexOf("?");
  const page = separator === -1 ? value : value.slice(0, separator);
  const query = separator === -1 ? "" : value.slice(separator + 1);
  if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(page)) return null;
  return {
    page,
    search: Object.fromEntries(new URLSearchParams(query)),
  };
}

/** The route of a settings page, which the browser shows while it is open. */
export function settingsPathname(location: SettingsLocation): string {
  return `/settings/${location.page}`;
}

/** Search values as strings, for a route mask or the window's search. */
function stringValues(search: Record<string, unknown>): SettingsSearch {
  const values: SettingsSearch = {};
  for (const [key, value] of Object.entries(search)) {
    if (key === SETTINGS_SEARCH_KEY) continue;
    if (typeof value === "string" && value !== "") values[key] = value;
    else if (typeof value === "number" || typeof value === "boolean")
      values[key] = String(value);
  }
  return values;
}

/** A page's location, as the app remembers it: its path and search. */
export interface AppLocation {
  pathname: string;
  search: Record<string, unknown>;
}

const defaultAppLocation: AppLocation = {
  pathname: "/time/today",
  search: {},
};

let lastAppLocation: AppLocation = defaultAppLocation;

/**
 * Remembers the page under the settings window, without the window itself,
 * so a `/settings/...` route can open the window over it. Settings routes
 * are never remembered.
 */
export function rememberAppLocation(location: AppLocation) {
  if (
    location.pathname === "/settings" ||
    location.pathname.startsWith("/settings/")
  )
    return;
  const { [SETTINGS_SEARCH_KEY]: _settings, ...search } = location.search;
  lastAppLocation = { pathname: location.pathname, search };
}

/** The last page outside Settings, or today's Time page before any. */
export function getLastAppLocation(): AppLocation {
  return lastAppLocation;
}

/** Test support: forgets the remembered page. */
export function resetLastAppLocation() {
  lastAppLocation = defaultAppLocation;
}

/** The route mask of an open settings window: what the browser shows. */
export function settingsWindowMask(location: SettingsLocation) {
  return { to: settingsPathname(location), search: location.search };
}

/**
 * The navigation that opens the settings window over the current page: the
 * page's own route and search with the `settings` key, masked as the
 * settings route. The router keeps the page mounted, since its route does
 * not change. `search` is applied to the page's search at navigation time.
 */
export function settingsWindowNavigation(location: SettingsLocation) {
  return {
    to: ".",
    search: (search: Record<string, unknown>) => ({
      ...withoutSettings(search),
      [SETTINGS_SEARCH_KEY]: encodeSettingsLocation(location),
    }),
    mask: settingsWindowMask(location),
  };
}

/**
 * The navigation that opens the settings window over `app`, from a
 * `/settings/...` route: a deep link, a bookmark or a link the window does
 * not own. The route is replaced, so Back leaves Settings.
 */
export function settingsWindowRedirect(
  app: AppLocation,
  location: SettingsLocation,
) {
  return {
    to: app.pathname,
    search: {
      ...app.search,
      [SETTINGS_SEARCH_KEY]: encodeSettingsLocation(location),
    },
    mask: settingsWindowMask(location),
    replace: true,
  };
}

/** The page's search without the window: what closing it navigates to. */
export function withoutSettings<Search extends Record<string, unknown>>(
  search: Search,
): Omit<Search, typeof SETTINGS_SEARCH_KEY> {
  const { [SETTINGS_SEARCH_KEY]: _settings, ...rest } = search;
  return rest;
}

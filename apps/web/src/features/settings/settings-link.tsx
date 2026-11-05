import {
  Link,
  useNavigate,
  useRouter,
  useSearch,
  type LinkComponentProps,
} from "@tanstack/react-router";
import { createContext, useCallback, useContext, useMemo } from "react";
import { isNarrowView, useIsNarrowView } from "@/lib/use-narrow-view";
import {
  SETTINGS_SEARCH_KEY,
  parseSettingsLocation,
  settingsLocationOf,
  settingsPathname,
  settingsWindowNavigation,
  withoutSettings,
  type SettingsLocation,
  type SettingsSearch,
} from "@/features/settings/settings-location";

/**
 * Opening and closing Settings. In wide windows Settings is a window over
 * the page (`SettingsWindow`), so a settings link keeps the page's route and
 * sets its `settings` search, masked as the settings route. The narrow view
 * has pages at `/settings/...` instead, so the same link goes there.
 */

/** The settings window's page, from the page's search; null while closed. */
export function useSettingsWindowLocation(): SettingsLocation | null {
  const value = useSearch({
    strict: false,
    select: (search) =>
      (search as Record<string, unknown>)[SETTINGS_SEARCH_KEY],
  });
  return useMemo(() => parseSettingsLocation(value), [value]);
}

/** The settings window's page, read once, as an event handler needs it. */
export function useSettingsWindowLocationReader() {
  const router = useRouter();
  return useCallback(
    () =>
      parseSettingsLocation(
        (router.state.location.search as Record<string, unknown>)[
          SETTINGS_SEARCH_KEY
        ],
      ),
    [router],
  );
}

/**
 * Opens a settings page: the window in wide windows, the page in the narrow
 * view. `replace` switches pages without a history entry, as the window's
 * own navigation does.
 */
export function useOpenSettings() {
  const navigate = useNavigate();
  return useCallback(
    (page: string | SettingsLocation, options: { replace?: boolean } = {}) => {
      const location =
        typeof page === "string" ? settingsLocationOf(page) : page;
      if (isNarrowView()) {
        return navigate({
          to: settingsPathname(location) as never,
          search: location.search as never,
          replace: options.replace,
        });
      }
      const window = settingsWindowNavigation(location);
      return navigate({
        to: window.to as never,
        search: window.search as never,
        mask: window.mask as never,
        replace: options.replace,
      });
    },
    [navigate],
  );
}

/**
 * Closes the settings window: the page keeps its route and the rest of its
 * search. The entry is replaced, so Back does not reopen Settings.
 */
export function useCloseSettings() {
  const navigate = useNavigate();
  return useCallback(
    () =>
      navigate({
        to: ".",
        search: ((search: Record<string, unknown>) =>
          withoutSettings(search)) as never,
        replace: true,
      }),
    [navigate],
  );
}

type SettingsLinkProps = Omit<
  LinkComponentProps<"a">,
  "to" | "search" | "params" | "mask" | "from"
> & {
  /** The path under `/settings/`, such as `general` or `plugins/jira`. */
  page: string;
  /** The page's own search, such as Sync review's `item`. */
  search?: Record<string, unknown>;
};

/** A link to a settings page. Its href is the settings route either way. */
export function SettingsLink({ page, search, ...props }: SettingsLinkProps) {
  const isNarrow = useIsNarrowView();
  const location = useMemo(
    () => settingsLocationOf(page, search),
    [page, search],
  );
  if (isNarrow) {
    return (
      <Link
        to={settingsPathname(location) as never}
        search={location.search as never}
        {...props}
      />
    );
  }
  const window = settingsWindowNavigation(location);
  return (
    <Link
      to={window.to as never}
      search={window.search as never}
      mask={window.mask as never}
      {...props}
    />
  );
}

const SettingsSearchContext = createContext<SettingsSearch | null>(null);

/** Gives the pages inside the settings window their own search. */
export const SettingsSearchProvider = SettingsSearchContext.Provider;

/**
 * A settings page's search: Sync review's `item` and `held`, a plugin page's
 * `connection` and `field`. Inside the window it comes from the window's
 * location; on a narrow-view page, from the route.
 */
export function useSettingsSearch(): Record<string, unknown> {
  const windowSearch = useContext(SettingsSearchContext);
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  return windowSearch ?? routeSearch;
}

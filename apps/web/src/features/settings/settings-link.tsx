import {
  Link,
  useNavigate,
  useRouter,
  useRouterState,
  useSearch,
  type LinkComponentProps,
} from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { isNarrowView, useIsNarrowView } from "@/lib/use-narrow-view";
import {
  SETTINGS_SEARCH_KEY,
  parseSettingsLocation,
  settingsLocationOf,
  settingsPathname,
  settingsWindowMask,
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
  // From the router's location, not a match's search: the two update in
  // different renders, and the mask repair below must see the same moment
  // as the mask.
  const value = useRouterState({
    select: (state) =>
      (state.location.search as Record<string, unknown>)[SETTINGS_SEARCH_KEY],
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
 * view. Opening the window pushes a history entry; switching its page, from
 * its navigation or any link followed while it is open, replaces it, so Back
 * closes the window in one step. `replace` overrides either.
 */
export function useOpenSettings() {
  const navigate = useNavigate();
  const router = useRouter();
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
        // Opening the window pushes an entry; switching its page replaces
        // it, so Back closes the window in one step.
        replace:
          options.replace ??
          hasSettingsWindow(
            router.state.location.search as Record<string, unknown>,
          ),
      });
    },
    [navigate, router],
  );
}

/** True while the settings window is open at `search`. */
function hasSettingsWindow(search: Record<string, unknown>) {
  return parseSettingsLocation(search[SETTINGS_SEARCH_KEY]) !== null;
}

/**
 * Keeps the browser on the settings route while the window is open. A
 * navigation the page behind makes on its own, such as the Time page adding
 * `view=day` as it loads, is built without the mask and would show the page's
 * address with the `settings` key. This puts the mask back, in place.
 */
export function useSettingsWindowMaskRepair(
  windowLocation: SettingsLocation | null,
) {
  const navigate = useNavigate();
  const isMasked = useRouterState({
    select: (state) => state.location.maskedLocation !== undefined,
  });
  useEffect(() => {
    if (!windowLocation || isMasked || isNarrowView()) return;
    void navigate({
      to: ".",
      search: ((search: Record<string, unknown>) => search) as never,
      // A same-address navigation with the same state writes nothing, so
      // the state changes each time to carry the mask into history.
      state: ((state: Record<string, unknown>) => ({
        ...state,
        settingsMask: Number(state.settingsMask ?? 0) + 1,
      })) as never,
      mask: settingsWindowMask(windowLocation) as never,
      replace: true,
    });
  }, [isMasked, navigate, windowLocation]);
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

/**
 * A link to a settings page. Its href is the settings route either way. While
 * the window is open it replaces the history entry unless `replace` says
 * otherwise, as `useOpenSettings` does.
 */
export function SettingsLink({
  page,
  search,
  replace,
  ...props
}: SettingsLinkProps) {
  const isNarrow = useIsNarrowView();
  const windowOpen = useSettingsWindowLocation() !== null;
  const location = useMemo(
    () => settingsLocationOf(page, search),
    [page, search],
  );
  if (isNarrow) {
    return (
      <Link
        to={settingsPathname(location) as never}
        search={location.search as never}
        replace={replace}
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
      replace={replace ?? windowOpen}
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

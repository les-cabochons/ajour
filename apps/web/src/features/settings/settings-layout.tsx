import { Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { CustomSidebarLayout } from "@/components/custom-sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsNavigation } from "@/features/settings/settings-navigation";
import { useIsNarrowView } from "@/lib/use-narrow-view";

/**
 * Settings inside the app shell. Wide windows show the settings pages list,
 * then the page. The narrow view shows only the page; the list is the
 * /settings page itself, and the app shell adds the back arrow to it.
 */
export function SettingsLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isNarrowView = useIsNarrowView();

  return (
    <CustomSidebarLayout className="ajour-settings-layout">
      {isNarrowView ? null : (
        <SettingsNavigation pathname={pathname} view="wide" />
      )}
      <div className="settings-content-shell ajour-settings-content-shell">
        <ScrollArea className="settings-content-scroll-area">
          <div className="settings-content">
            <Outlet />
          </div>
        </ScrollArea>
      </div>
    </CustomSidebarLayout>
  );
}

/** /settings: the list of settings pages in the narrow view, General in wide windows. */
export function SettingsIndex() {
  const isNarrowView = useIsNarrowView();

  if (isNarrowView) {
    return <SettingsNavigation pathname="/settings" view="narrow" />;
  }

  return <Navigate to="/settings/general" replace />;
}

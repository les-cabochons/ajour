import { Navigate, Outlet } from "@tanstack/react-router";
import { CustomSidebarLayout } from "@/components/custom-sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsNavigation } from "@/features/settings/settings-navigation";
import { useIsNarrowView } from "@/lib/use-narrow-view";

/**
 * Settings inside the app shell: the page. In wide windows the app shell shows
 * the settings pages list in place of the app sidebar. The narrow view's list
 * is the /settings page itself, and the app shell adds the back arrow to it.
 */
export function SettingsLayout() {
  return (
    <CustomSidebarLayout className="ajour-settings-layout">
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

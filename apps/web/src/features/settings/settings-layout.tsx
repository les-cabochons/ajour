import { Navigate, Outlet } from "@tanstack/react-router";
import { CustomSidebarLayout } from "@/components/custom-sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsNavigation } from "@/features/settings/settings-navigation";
import { useIsNarrowView } from "@/lib/use-narrow-view";

/**
 * Settings as pages, in the narrow view: the list at /settings, and each page
 * under it with the app shell's back arrow. Wide windows never render these:
 * their /settings routes open `SettingsWindow` over the page instead.
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
    return <SettingsNavigation />;
  }

  return <Navigate to="/settings/general" replace />;
}

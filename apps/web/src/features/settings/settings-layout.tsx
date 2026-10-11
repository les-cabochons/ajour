import { Outlet, useRouterState } from "@tanstack/react-router";
import { CustomSidebarLayout } from "@/components/custom-sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsNavigation } from "@/features/settings/settings-navigation";

/** Settings inside the app shell: the settings pages list, then the page. */
export function SettingsLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <CustomSidebarLayout className="ajour-settings-layout">
      <SettingsNavigation pathname={pathname} />
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

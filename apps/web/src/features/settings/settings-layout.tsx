import { Outlet } from "@tanstack/react-router";
import { ScrollArea } from "@/components/ui/scroll-area";

export function SettingsLayout() {
  return (
    <div className="settings-content-shell harday-settings-content-shell">
      <ScrollArea className="settings-content-scroll-area">
        <div className="settings-content">
          <Outlet />
        </div>
      </ScrollArea>
    </div>
  );
}

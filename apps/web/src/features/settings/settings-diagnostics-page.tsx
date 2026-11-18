import type { ComponentType } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiagnosticsEventsTab } from "./diagnostics-events-tab";
import { DiagnosticsSettingsTab } from "./diagnostics-settings-tab";
import { useOpenSettings, useSettingsSearch } from "./settings-link";
import { hasLocalLogsBridge } from "./use-local-logs";

const DIAGNOSTICS_NEEDS_DESKTOP_APP = "Diagnostics needs the desktop app.";

/**
 * The Diagnostics tabs in display order (#438). A tab with a `panel` is built
 * and shown; one without is hidden until it is built, so nothing on the page
 * is dead. #443 gives Events its panel, #444 Actions and #445 Overview.
 */
export type DiagnosticsTabId = "overview" | "events" | "actions" | "settings";

export const DIAGNOSTICS_TABS: ReadonlyArray<{
  id: DiagnosticsTabId;
  label: string;
  panel?: ComponentType;
}> = [
  { id: "overview", label: "Overview" },
  { id: "events", label: "Events", panel: DiagnosticsEventsTab },
  { id: "actions", label: "Actions" },
  { id: "settings", label: "Settings", panel: DiagnosticsSettingsTab },
];

/** The tab the page opens on. It becomes Overview when that is built (#445). */
const DEFAULT_TAB: DiagnosticsTabId = "settings";

/**
 * The tab the page's `tab` search key names, as a link such as the
 * Overview's sets it; the default tab when it names none that is built.
 */
export function diagnosticsTabOf(
  search: Record<string, unknown>,
): DiagnosticsTabId {
  return (
    DIAGNOSTICS_TABS.find((tab) => tab.panel && tab.id === search.tab)?.id ??
    DEFAULT_TAB
  );
}

/** Settings > Diagnostics: the local log file's viewer and settings (ADR 0014). */
export function SettingsDiagnosticsPage() {
  const tabs = DIAGNOSTICS_TABS.filter((tab) => tab.panel);
  const tab = diagnosticsTabOf(useSettingsSearch());
  const openSettings = useOpenSettings();

  return (
    <section className="settings-section">
      <h1 className="text-lg font-semibold text-foreground">Diagnostics</h1>
      <p className="settings-section-desc mt-1">
        What Ajour records about its own work, on this computer.
      </p>
      {hasLocalLogsBridge() ? (
        <Tabs
          value={tab}
          // Each tab is its own address; a tab chosen here keeps only `tab`.
          onValueChange={(next) =>
            void openSettings(
              { page: "diagnostics", search: { tab: String(next) } },
              { replace: true },
            )
          }
          className="mt-4"
        >
          <TabsList variant="line" aria-label="Diagnostics" className="mb-4">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map(({ id, panel: Panel }) => (
            <TabsContent key={id} value={id}>
              {Panel ? <Panel /> : null}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <p className="settings-section-desc mt-4">
          {DIAGNOSTICS_NEEDS_DESKTOP_APP}
        </p>
      )}
    </section>
  );
}

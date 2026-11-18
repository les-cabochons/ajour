import { useState, type ComponentType } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiagnosticsEventsTab } from "./diagnostics-events-tab";
import { DiagnosticsActionsTab } from "./diagnostics-actions-tab";
import { DiagnosticsOverviewTab } from "./diagnostics-overview-tab";
import { DiagnosticsSettingsTab } from "./diagnostics-settings-tab";
import { useOpenSettings, useSettingsSearch } from "./settings-link";
import { hasLocalLogsBridge, useLocalLogs } from "./use-local-logs";

const DIAGNOSTICS_NEEDS_DESKTOP_APP = "Diagnostics needs the desktop app.";

/**
 * The Diagnostics tabs in display order (#438). A tab with a `panel` is built
 * and shown; one without is hidden until it is built, so nothing on the page
 * is dead.
 */
export type DiagnosticsTabId = "overview" | "events" | "actions" | "settings";

export const DIAGNOSTICS_TABS: ReadonlyArray<{
  id: DiagnosticsTabId;
  label: string;
  panel?: ComponentType;
}> = [
  { id: "overview", label: "Overview", panel: DiagnosticsOverviewTab },
  { id: "events", label: "Events", panel: DiagnosticsEventsTab },
  { id: "actions", label: "Actions", panel: DiagnosticsActionsTab },
  { id: "settings", label: "Settings", panel: DiagnosticsSettingsTab },
];

/** The built tab the page's `tab` search key names, if any. */
function namedTabOf(
  search: Record<string, unknown>,
): DiagnosticsTabId | undefined {
  return DIAGNOSTICS_TABS.find((tab) => tab.panel && tab.id === search.tab)?.id;
}

/**
 * The tab the page's `tab` search key names, as a link such as the
 * Overview's sets it. When it names none that is built, the page opens on
 * Overview once the log folder holds a day file, and on Settings before.
 */
export function diagnosticsTabOf(
  search: Record<string, unknown>,
  { hasData = false }: { hasData?: boolean } = {},
): DiagnosticsTabId {
  return namedTabOf(search) ?? (hasData ? "overview" : "settings");
}

/** Settings > Diagnostics: the local log file's viewer and settings (ADR 0014). */
export function SettingsDiagnosticsPage() {
  const tabs = DIAGNOSTICS_TABS.filter((tab) => tab.panel);
  const search = useSettingsSearch();
  const openSettings = useOpenSettings();
  const { status, error } = useLocalLogs();
  // Whether the log held data when the page opened: read once, so turning
  // logging on from Settings doesn't move the page to Overview.
  const [hasData, setHasData] = useState<boolean | null>(null);
  if (hasData === null && (status || error)) {
    setHasData((status?.file_count ?? 0) > 0);
  }
  const named = namedTabOf(search);
  // Without a tab named, the page waits for logs.status to pick its own.
  const tab =
    named ?? (hasData === null ? null : diagnosticsTabOf(search, { hasData }));

  return (
    <section className="settings-section">
      <h1 className="text-lg font-semibold text-foreground">Diagnostics</h1>
      <p className="settings-section-desc mt-1">
        What Ajour records about its own work, on this computer.
      </p>
      {!hasLocalLogsBridge() ? (
        <p className="settings-section-desc mt-4">
          {DIAGNOSTICS_NEEDS_DESKTOP_APP}
        </p>
      ) : tab === null ? null : (
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
      )}
    </section>
  );
}

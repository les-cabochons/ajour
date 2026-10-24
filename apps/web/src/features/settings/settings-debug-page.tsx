import { useEffect, useState } from "react";
import {
  RiFolderOpenLine as FolderOpen,
  RiResetLeftLine as Reset,
} from "@remixicon/react";
import { AppPanel, MessagePanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import type { DevelopmentPluginSettings } from "@/lib/desktop-bridge";
import { useLocalState } from "@/lib/local-hooks";
import { traceCarrier } from "@/lib/wide-events";

export function SettingsDebugPage() {
  const state = useLocalState();
  const [developmentPlugins, setDevelopmentPlugins] =
    useState<DevelopmentPluginSettings | null>(null);
  const [developmentPluginError, setDevelopmentPluginError] = useState<
    string | null
  >(null);
  const [isUpdatingDevelopmentPlugins, setIsUpdatingDevelopmentPlugins] =
    useState(false);

  useEffect(() => {
    const loadSettings = window.ajourDesktop?.getDevelopmentPluginSettings;
    if (!loadSettings) {
      return;
    }

    void loadSettings(traceCarrier())
      .then(setDevelopmentPlugins)
      .catch((error: unknown) =>
        setDevelopmentPluginError(
          error instanceof Error
            ? error.message
            : "Unable to load development plugin settings.",
        ),
      );
  }, []);

  const chooseDevelopmentPluginDirectory = async () => {
    const chooseDirectory =
      window.ajourDesktop?.selectDevelopmentPluginDirectory;
    if (!chooseDirectory) {
      return;
    }

    setIsUpdatingDevelopmentPlugins(true);
    setDevelopmentPluginError(null);
    try {
      const settings = await chooseDirectory(traceCarrier());
      if (settings) {
        setDevelopmentPlugins(settings);
      }
    } catch (error) {
      setDevelopmentPluginError(
        error instanceof Error
          ? error.message
          : "Unable to configure the development plugin directory.",
      );
    } finally {
      setIsUpdatingDevelopmentPlugins(false);
    }
  };

  const resetDevelopmentPluginDirectories = async () => {
    const clearDirectories =
      window.ajourDesktop?.clearDevelopmentPluginDirectories;
    if (!clearDirectories) {
      return;
    }

    setIsUpdatingDevelopmentPlugins(true);
    setDevelopmentPluginError(null);
    try {
      setDevelopmentPlugins(await clearDirectories(traceCarrier()));
    } catch (error) {
      setDevelopmentPluginError(
        error instanceof Error
          ? error.message
          : "Unable to reset development plugin directories.",
      );
    } finally {
      setIsUpdatingDevelopmentPlugins(false);
    }
  };

  return (
    <div className="settings-sections">
      {developmentPlugins?.available ? (
        <section className="settings-section">
          <h2 className="settings-section-title">
            Development plugin directory
          </h2>
          <p className="settings-section-desc">
            Point the development build at a directory containing a valid
            <code> plugin.json</code>. The internal plugin host restarts when
            this setting changes.
          </p>

          <AppPanel>
            <div className="space-y-1">
              {developmentPlugins.directories.length > 0 ? (
                developmentPlugins.directories.map((directory) => (
                  <code
                    key={directory}
                    className="block font-mono text-xs leading-5 break-all text-foreground"
                  >
                    {directory}
                  </code>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No development plugin directory is active.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isUpdatingDevelopmentPlugins}
                onClick={() => void chooseDevelopmentPluginDirectory()}
              >
                <FolderOpen data-icon="inline-start" />
                Choose directory
              </Button>
              <Button
                variant="outline"

                disabled={isUpdatingDevelopmentPlugins}
                onClick={() => void resetDevelopmentPluginDirectories()}
              >
                <Reset data-icon="inline-start" />
                Use repository defaults
              </Button>
            </div>
          </AppPanel>
        </section>
      ) : null}

      {developmentPluginError ? (
        <MessagePanel tone="warning">{developmentPluginError}</MessagePanel>
      ) : null}

      {/* ── Local storage status ──────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section-title">Local storage status</h2>
        <p className="settings-section-desc">
          Sync should stay limited to committed timesheets, project metadata,
          and any explicitly accepted rules if shared storage returns later.
        </p>

        <div className="space-y-1 text-sm text-foreground">
          <p>{state.timesheetEntries.length} committed timesheet entries</p>
          <p>{state.rules.length} explicit local rules</p>
        </div>
      </section>
    </div>
  );
}

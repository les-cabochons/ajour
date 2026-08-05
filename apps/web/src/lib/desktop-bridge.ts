import type {
  ConnectorPluginInstallResponse,
  ConnectorPluginUninstallResponse,
} from "@timetracker/shared";
import type { LocalAppState, UpdateTrack } from "@/domain/local-state";

export interface DevelopmentPluginSettings {
  available: boolean;
  directories: string[];
}

export interface DesktopUpdateCheckResult {
  track: UpdateTrack;
  currentVersion: string;
  latestVersion: string | null;
  latestTag: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  updateAvailable: boolean;
  checkedAt: string;
}

declare global {
  interface Window {
    timetrackerDesktop?: {
      bootstrapLocalState?: Partial<LocalAppState> | null;
      runtime?: {
        developmentBuild: boolean;
        platform: string;
        version: string;
      };
      setWindowChromeTheme?: (theme: "dark" | "light") => void;
      checkForUpdates?: (
        track: UpdateTrack,
      ) => Promise<DesktopUpdateCheckResult>;
      openUpdateRelease?: (releaseUrl: string) => Promise<void>;
      installConnectorPlugin?: () => Promise<
        ConnectorPluginInstallResponse | null
      >;
      uninstallConnectorPlugin?: (
        pluginId: string,
      ) => Promise<ConnectorPluginUninstallResponse>;
      getDevelopmentPluginSettings?: () => Promise<DevelopmentPluginSettings>;
      selectDevelopmentPluginDirectory?: () => Promise<DevelopmentPluginSettings | null>;
      clearDevelopmentPluginDirectories?: () => Promise<DevelopmentPluginSettings>;
    };
  }
}

export {};

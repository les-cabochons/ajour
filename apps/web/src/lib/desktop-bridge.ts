import type {
  CatalogConnectorDownloadResponse,
  ConnectorPluginInstallResponse,
  ConnectorPluginUninstallResponse,
  PluginCatalogResponse,
  PluginCatalogSettings,
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
        automaticUpdatesEnabled: boolean;
        developmentBuild: boolean;
        platform: string;
        version: string;
      };
      setWindowChromeTheme?: (theme: "dark" | "light") => void;
      checkForUpdates?: (
        track: UpdateTrack,
      ) => Promise<DesktopUpdateCheckResult>;
      configureAutomaticUpdates?: (track: UpdateTrack) => Promise<void>;
      openUpdateRelease?: (releaseUrl: string) => Promise<void>;
      installConnectorPlugin?: () => Promise<
        ConnectorPluginInstallResponse | null
      >;
      getPluginCatalog?: () => Promise<PluginCatalogResponse>;
      getPluginCatalogSettings?: () => Promise<PluginCatalogSettings>;
      configurePluginCatalog?: (
        settings: PluginCatalogSettings,
      ) => Promise<PluginCatalogSettings>;
      onPluginCatalogUpdated?: (
        callback: (catalog: PluginCatalogResponse) => void,
      ) => () => void;
      downloadCatalogPlugin?: (
        pluginId: string,
      ) => Promise<CatalogConnectorDownloadResponse>;
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

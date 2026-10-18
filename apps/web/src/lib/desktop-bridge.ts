import type {
  CatalogPluginDownloadResponse,
  PluginInstallResponse,
  PluginUninstallResponse,
  PluginCatalogResponse,
  PluginCatalogSettings,
} from "@ajour/shared";
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

/**
 * One item of the desktop app menu, as `apps/desktop/electron/app-menu.cjs`
 * describes it. Action items name a shortcut registry action; role items run an
 * Electron role in the main process.
 */
export type DesktopAppMenuItem =
  | { type: "separator" }
  | {
      type: "action";
      id: string;
      label: string;
      action: string;
      accelerator?: string;
    }
  | {
      type: "role";
      id: string;
      label: string;
      role: string;
      accelerator?: string;
    };

export interface DesktopAppMenu {
  id: string;
  label: string;
  items: DesktopAppMenuItem[];
}

declare global {
  interface Window {
    ajourDesktop?: {
      bootstrapLocalState?: Partial<LocalAppState> | null;
      runtime?: {
        automaticUpdatesEnabled: boolean;
        developmentBuild: boolean;
        platform: string;
        version: string;
      };
      /** The app menu. Windows draws it in the title bar. */
      appMenu?: DesktopAppMenu[];
      /** Runs `callback` with the action id of each app menu item the user picks. */
      onMenuAction?: (callback: (action: string) => void) => () => void;
      /** Runs a role item of the app menu, such as Copy, in the main process. */
      runMenuItem?: (itemId: string) => void;
      setWindowChromeTheme?: (theme: "dark" | "light") => void;
      checkForUpdates?: (
        track: UpdateTrack,
      ) => Promise<DesktopUpdateCheckResult>;
      configureAutomaticUpdates?: (track: UpdateTrack) => Promise<void>;
      openUpdateRelease?: (releaseUrl: string) => Promise<void>;
      installPlugin?: () => Promise<PluginInstallResponse | null>;
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
      ) => Promise<CatalogPluginDownloadResponse>;
      uninstallPlugin?: (pluginId: string) => Promise<PluginUninstallResponse>;
      getDevelopmentPluginSettings?: () => Promise<DevelopmentPluginSettings>;
      selectDevelopmentPluginDirectory?: () => Promise<DevelopmentPluginSettings | null>;
      clearDevelopmentPluginDirectories?: () => Promise<DevelopmentPluginSettings>;
    };
  }
}

export {};

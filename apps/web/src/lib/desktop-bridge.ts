import type {
  CatalogPluginDownloadResponse,
  PluginInstallResponse,
  PluginUninstallResponse,
  PluginCatalogResponse,
  PluginCatalogSettings,
} from "@ajour/shared";
import type {
  LocalAppState,
  ThemeMode,
  UpdateTrack,
} from "@/domain/local-state";
import type { LaunchContext } from "../../../../packages/wide-events/index.ts";

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

export interface DesktopUpdateState {
  status:
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "confirming"
    | "downloading"
    | "installing"
    | "error";
  track: UpdateTrack | null;
  result: DesktopUpdateCheckResult | null;
  progress: number | null;
  error: string | null;
  canInstall: boolean;
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

/**
 * One item of a native right-click menu, as
 * `apps/desktop/electron/context-menu.cjs` reads it. `accelerator` is an
 * Electron accelerator that only labels the item.
 */
export type DesktopContextMenuItem =
  | { type: "separator" }
  | {
      type: "item";
      id: string;
      label: string;
      enabled: boolean;
      accelerator?: string;
      /** macOS shows it before the label. */
      icon?: "trash" | "archive";
    };

export interface DesktopAppMenu {
  id: string;
  label: string;
  items: DesktopAppMenuItem[];
}

declare global {
  interface Window {
    ajourDesktop?: {
      // The synchronous answers below are null when the main process could
      // not produce them.
      bootstrapLocalState?: Partial<LocalAppState> | null;
      runtime?: {
        automaticUpdatesEnabled: boolean;
        developmentBuild: boolean;
        platform: string;
        version: string;
        /**
         * The main process's launch: its ID, build and device, which the
         * renderer's wide events report. Absent before #308.
         */
        launch?: LaunchContext;
      } | null;
      /** The app menu. Windows draws it in the title bar. */
      appMenu?: DesktopAppMenu[] | null;
      /** Runs `callback` with the action id of each app menu item the user picks. */
      onMenuAction?: (callback: (action: string) => void) => () => void;
      /** Runs a role item of the app menu, such as Copy, in the main process. */
      runMenuItem?: (itemId: string) => void;
      /**
       * Pops up a native right-click menu at `position`, in CSS pixels from the
       * window's top left. Resolves with the picked item's id, or null.
       */
      showContextMenu?: (
        items: DesktopContextMenuItem[],
        position: { x: number; y: number },
      ) => Promise<string | null>;
      /** Runs the page's Cut or Copy, as the Edit menu does. */
      runEditCommand?: (command: "cut" | "copy") => void;
      /** Makes native menus and the window chrome follow the app's theme. */
      setThemeSource?: (mode: ThemeMode) => void;
      setWindowChromeTheme?: (theme: "dark" | "light") => void;
      checkForUpdates?: (track: UpdateTrack) => Promise<DesktopUpdateState>;
      getUpdateState?: () => Promise<DesktopUpdateState>;
      onUpdateStateChanged?: (
        callback: (state: DesktopUpdateState) => void,
      ) => () => void;
      updateAndRestart?: (
        track: UpdateTrack,
        version: string,
      ) => Promise<DesktopUpdateState>;
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

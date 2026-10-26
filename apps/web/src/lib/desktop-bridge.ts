import type {
  CatalogPluginDownloadResponse,
  PluginInstallResponse,
  PluginUninstallResponse,
  PluginCatalogResponse,
  PluginCatalogSettings,
  PluginSourceInspection,
} from "@ajour/shared";
import type { LaunchContext } from "@ajour/wide-events";
import type { ForwardedBatch } from "@ajour/wide-events/forwarding.ts";
import type {
  LocalLogSettings,
  LocalLogStatus,
} from "@ajour/wide-events/local-log-file.ts";
import type {
  LocalAppState,
  ThemeMode,
  UpdateTrack,
} from "@/domain/local-state";

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

/**
 * What a call through the bridge may pass last: the active unit's
 * `traceparent` (`traceCarrier()` in lib/wide-events.ts), so the main
 * process's IPC event joins the renderer's trace. The preload passes it on
 * only when it holds a string.
 */
export interface TraceCarrier {
  traceparent: string;
}

/** The local log file's settings, state and folder, from the main process (ADR 0014). */
export type DesktopLogsStatus = LocalLogStatus & { settings: LocalLogSettings };

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
         * renderer's wide events report. Older main processes omit it, and
         * each field is checked before use (lib/wide-events.ts).
         */
        launch?: LaunchContext;
        /**
         * Whether main was writing the local log file when the page loaded. The preload reads it;
         * the page subscribes with `onWideEventsForwarding`.
         */
        wideEventsForwarding?: boolean;
      } | null;
      /** The app menu. Windows draws it in the title bar. */
      appMenu?: DesktopAppMenu[] | null;
      /** Runs `callback` with the action id of each app menu item the user picks. */
      onMenuAction?: (callback: (action: string) => void) => () => void;
      /** Runs a role item of the app menu, such as Copy, in the main process. */
      runMenuItem?: (itemId: string, trace?: TraceCarrier) => void;
      /**
       * Pops up a native right-click menu at `position`, in CSS pixels from the
       * window's top left. Resolves with the picked item's id, or null.
       */
      showContextMenu?: (
        items: DesktopContextMenuItem[],
        position: { x: number; y: number },
        trace?: TraceCarrier,
      ) => Promise<string | null>;
      /** Runs the page's Cut or Copy, as the Edit menu does. */
      runEditCommand?: (command: "cut" | "copy", trace?: TraceCarrier) => void;
      /** Makes native menus and the window chrome follow the app's theme. */
      setThemeSource?: (mode: ThemeMode, trace?: TraceCarrier) => void;
      setWindowChromeTheme?: (
        theme: "dark" | "light",
        trace?: TraceCarrier,
      ) => void;
      checkForUpdates?: (
        track: UpdateTrack,
        trace?: TraceCarrier,
      ) => Promise<DesktopUpdateState>;
      getUpdateState?: (trace?: TraceCarrier) => Promise<DesktopUpdateState>;
      onUpdateStateChanged?: (
        callback: (state: DesktopUpdateState) => void,
      ) => () => void;
      updateAndRestart?: (
        track: UpdateTrack,
        version: string,
        trace?: TraceCarrier,
      ) => Promise<DesktopUpdateState>;
      configureAutomaticUpdates?: (
        track: UpdateTrack,
        trace?: TraceCarrier,
      ) => Promise<void>;
      openUpdateRelease?: (
        releaseUrl: string,
        trace?: TraceCarrier,
      ) => Promise<void>;
      installPlugin?: (
        trace?: TraceCarrier,
      ) => Promise<PluginInstallResponse | null>;
      getPluginCatalog?: (
        trace?: TraceCarrier,
      ) => Promise<PluginCatalogResponse>;
      getPluginCatalogSettings?: (
        trace?: TraceCarrier,
      ) => Promise<PluginCatalogSettings>;
      configurePluginCatalog?: (
        settings: PluginCatalogSettings,
        trace?: TraceCarrier,
      ) => Promise<PluginCatalogSettings>;
      onPluginCatalogUpdated?: (
        callback: (catalog: PluginCatalogResponse) => void,
      ) => () => void;
      /** Null when the person cancels the unsigned plugin warning. */
      downloadCatalogPlugin?: (
        pluginId: string,
        sourceUrl: string | undefined,
        trace?: TraceCarrier,
      ) => Promise<CatalogPluginDownloadResponse | null>;
      inspectPluginSource?: (
        url: string,
        trace?: TraceCarrier,
      ) => Promise<PluginSourceInspection>;
      /** Adds the source, or approves its key; `keyFingerprint` is what the person saw. */
      addPluginSource?: (
        url: string,
        keyFingerprint: string | null,
        trace?: TraceCarrier,
      ) => Promise<PluginCatalogResponse>;
      removePluginSource?: (
        url: string,
        trace?: TraceCarrier,
      ) => Promise<PluginCatalogResponse>;
      uninstallPlugin?: (
        pluginId: string,
        trace?: TraceCarrier,
      ) => Promise<PluginUninstallResponse>;
      getDevelopmentPluginSettings?: (
        trace?: TraceCarrier,
      ) => Promise<DevelopmentPluginSettings>;
      selectDevelopmentPluginDirectory?: (
        trace?: TraceCarrier,
      ) => Promise<DevelopmentPluginSettings | null>;
      clearDevelopmentPluginDirectories?: (
        trace?: TraceCarrier,
      ) => Promise<DevelopmentPluginSettings>;
      getLogsStatus?: (trace?: TraceCarrier) => Promise<DesktopLogsStatus>;
      /** Saves the local log file's settings. Those left out stay. */
      configureLogs?: (
        settings: Partial<LocalLogSettings>,
        trace?: TraceCarrier,
      ) => Promise<DesktopLogsStatus>;
      /** Delete all logs: the folder goes. */
      deleteAllLogs?: (trace?: TraceCarrier) => Promise<DesktopLogsStatus>;
      /** Shows the log folder in the file manager. Main opens it; the path never reaches the page. */
      openLogsFolder?: (trace?: TraceCarrier) => Promise<void>;
      /**
       * Sends a batch of the renderer's wide events to the local log file,
       * one way: it never waits for main (#440).
       */
      forwardWideEvents?: (batch: ForwardedBatch) => void;
      /**
       * Runs `callback` at once with whether main is writing the local log
       * file, then each time that changes: the user turns logging on or off,
       * or a failed write stops it. Returns how to stop.
       */
      onWideEventsForwarding?: (
        callback: (forwarding: boolean) => void,
      ) => () => void;
    };
  }
}

export {};

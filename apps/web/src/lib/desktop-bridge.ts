import type { DeckClone, DeckCloneSource } from "@ajour/shared/deck";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import type {
  CatalogPluginDownloadResponse,
  PluginInstallResponse,
  PluginUninstallResponse,
  PluginCatalogResponse,
  PluginCatalogSettings,
  PluginSourceInspection,
} from "@ajour/shared";
import type {
  Envelope,
  Kind,
  LaunchContext,
  Outcome,
  Runtime,
} from "@ajour/wide-events";
import type {
  InstructionFileId,
  InstructionAction,
  InstructionFileState,
  InstructionPreview,
} from "@ajour/shared/agent-instructions";
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
import type { RunningEntryTrayState } from "@/domain/time/running-entry";
import { traceCarrier } from "@/lib/wide-events";

export interface DevelopmentPluginSettings {
  available: boolean;
  directories: string[];
}

/**
 * Settings › General › Terminal: the terminal app that opens plugin commands,
 * and the ones main found installed on this computer. Linux has none.
 */
export interface DesktopTerminalApps {
  value: string | undefined;
  /** The installed terminals, each with its own icon as a data URL when main could read it. */
  choices: { value: string; label: string; icon?: string }[];
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

/** A release What's new lists, newest first, with GitHub's notes. */
export interface DesktopReleaseNote {
  tagName: string;
  packageVersion: string;
  name: string;
  releaseUrl: string;
  publishedAt: string;
  /** The release's Markdown body, capped by the desktop app. */
  body: string;
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

/**
 * The running entry for the desktop tray icon, or nothing running. Main
 * counts the time from it (`apps/desktop/electron/keep-running.cjs`).
 */
export interface DesktopTrayState {
  entry: RunningEntryTrayState | null;
}

/** What the tray menu asks the window to do: stop the entry it showed. */
export interface DesktopTrayAction {
  action: "stop";
  timerId: string;
}

/** Desktop settings main stores, which it needs before the window exists. */
export interface DesktopWindowSettings {
  /** Closing the window hides it, and Ajour keeps running until Quit. */
  keepRunning: boolean;
}

/**
 * One WSL distro under the ajour command (#604). Main lists them on
 * Windows x64, with the command installed; the renderer passes back only a
 * distro's name. `wslVersion` is the WSL it runs on, not ajour's version.
 */
export type DesktopCliWslDistro =
  | {
      name: string;
      wslVersion: 1;
      /** The Linux ajour can't start in WSL 1 (#611): no Add. */
      status: "unsupported";
      /** How to convert it to WSL 2. */
      reason: string;
    }
  | { name: string; wslVersion: 2; status: "not-added" }
  | {
      name: string;
      wslVersion: 2;
      status: "adding";
      phase: "downloading" | "checking" | "linking";
      /** The download's percent while `downloading`. */
      progress: number | null;
    }
  | {
      name: string;
      wslVersion: 2;
      status: "added";
      /** After an Add in this launch: open a new terminal, or fix the PATH. */
      hint?: string;
    }
  /** Remove deleting `~/.local/bin/ajour` in the distro (#605). */
  | { name: string; wslVersion: 2; status: "removing" }
  | {
      name: string;
      wslVersion: 2;
      /**
       * An added distro while the Linux build follows the app (#606): its
       * link stays, and finds the new build once it's swapped in.
       */
      status: "updating";
      /** The download's percent, then its last. */
      progress: number | null;
    }
  | {
      name: string;
      wslVersion: 2;
      status: "error";
      /** Why the last Add, Remove or follow failed, as a sentence. */
      error: string;
      /** In the record: its link still works. */
      added: boolean;
      /**
       * The operation that failed, which Retry repeats. `follow`: the Linux
       * build couldn't follow the app (#606), and the installed one works.
       */
      operation: "add" | "remove" | "follow";
    };

/**
 * The ajour command, as main's controller reports it
 * (`apps/desktop/electron/cli-command.cjs`, #568). The renderer only reads
 * it and asks for an install: it never passes a path or a URL.
 */
export interface DesktopCliCommandState {
  /** The WSL distros, when there is any to add the command to. */
  wsl?: {
    /** The Linux build's version, which the added distros run. */
    version?: string;
    /** The version the Linux build follows to, also after it failed (#606). */
    pending?: string;
    distros: DesktopCliWslDistro[];
  };
  operation?: "remove";
  /** Version being followed, also after a failed update. */
  pending?: string;
  status:
    | "unsupported"
    | "not-installed"
    | "installing"
    | "installed"
    | "removing"
    | "error";
  /** Why it can't install here: a development build, or a system without it yet. */
  reason?: "development_build" | "unsupported_platform";
  /** The installed version, also while a new install runs or after one failed. */
  version?: string;
  binaryPath?: string;
  /** Where it is installed: the folder on the PATH on Windows. */
  location?: string;
  /** The step an install is on. */
  phase?: "downloading" | "checking" | "linking";
  /** The download's percent while `downloading`. */
  progress: number | null;
  /** Why the last install failed, as a sentence. */
  error: string | null;
  /** Installed in this launch: a terminal opened before doesn't see it yet. */
  newlyInstalled?: boolean;
  /** After Remove: the WSL distros' links it couldn't delete, as a sentence (#605). */
  notice?: string;
}

/** The local log file's settings, state and folder, from the main process (ADR 0014). */
export type DesktopLogsStatus = LocalLogStatus & { settings: LocalLogSettings };

/**
 * An event the local log file holds: the envelope and the fields its
 * catalog entry declares, as main's query service read it (#442).
 */
export type LoggedEvent = Envelope & Record<string, unknown>;

/**
 * What the diagnostics viewer asks main for. Every key is optional, and
 * main refuses one it doesn't know or a value outside its format: times are
 * ISO 8601 UTC, `from` inclusive and `to` exclusive, on `started_at`.
 * `outcome: "problems"` is anything that didn't end `ok` or `noop`.
 */
export interface DesktopLogFilter {
  from?: string;
  to?: string;
  launch_id?: string;
  runtime?: Runtime | Runtime[];
  kind?: Kind | Kind[];
  outcome?: Outcome | Outcome[] | "problems";
  name?: string;
  name_prefix?: string;
  trace_id?: string;
  connection_id?: string;
  plugin_id?: string;
  /**
   * One `outcome_reason`, or several; null for the events without one.
   * logs.query and logs.tail only, as `plugin_version`.
   */
  outcome_reason?: string | string[] | null;
  /** The plugin's `version`. */
  plugin_version?: string;
}

/** A page of results: at most `limit` (1 to 500, 100 by default), after `cursor`. */
export interface DesktopLogPage {
  limit?: number;
  /** The `next_cursor` of the page before. */
  cursor?: string | null;
}

/** What a read read: day files, days with none, and lines that weren't events. */
export interface DesktopLogReadStats {
  file_count: number;
  missing_file_count: number;
  skipped_line_count: number;
}

/** logs.query: newest first. */
export interface DesktopLogQueryResult extends DesktopLogReadStats {
  events: LoggedEvent[];
  /** Null on the last page. */
  next_cursor: string | null;
  /** The events that passed the filter, on every page. */
  match_count: number;
}

export interface DesktopLogTraceNode {
  event: LoggedEvent;
  /** 0 for a root. */
  depth: number;
  /** The spans whose parent it is, in the order they started. */
  children: DesktopLogTraceNode[];
  /** The failed span deepest in the tree: at most one per trace. */
  deepest_failure: boolean;
  /** A root whose parent span is in no day file. */
  missing_parent: boolean;
}

/** logs.trace: every event of one trace, from any runtime, as a tree. */
export interface DesktopLogTrace extends DesktopLogReadStats {
  trace_id: string;
  roots: DesktopLogTraceNode[];
  event_count: number;
  /** In the order their first span started. */
  runtimes: Runtime[];
  deepest_failure_span_id: string | null;
}

/**
 * Which actions logs.actions lists: all of them, those with a span that
 * didn't end `ok` or `noop`, or those that took their name's p95 or longer.
 */
export type DesktopLogActionView = "all" | "failed" | "slow";

/** logs.actions filters on the common fields only: main refuses the others. */
export type DesktopLogActionsFilter = Omit<
  DesktopLogFilter,
  "outcome_reason" | "plugin_version"
> & { show?: DesktopLogActionView };

/** One action: a trace root, with what its trace holds. */
export interface DesktopLogAction {
  event: LoggedEvent;
  span_count: number;
  problem_count: number;
  runtimes: Runtime[];
  slow: boolean;
  /** Its name's p95 among the roots in the range; null with too few of them. */
  p95_ms: number | null;
}

export interface DesktopLogActions extends DesktopLogReadStats {
  show: DesktopLogActionView;
  /** Newest first. */
  actions: DesktopLogAction[];
  next_cursor: string | null;
  match_count: number;
}

/** An outcome main counts as a problem: anything not `ok` or `noop`. */
export type ProblemOutcome = Exclude<Outcome, "ok" | "noop">;

/** A sync's start and how it ended: a failed one's, its innermost failed hop's. */
export interface DesktopLogSyncEnd {
  started_at: string;
  outcome: Outcome;
  outcome_reason?: string;
}

/** The Overview's range: this launch, 24 hours or 7 days. */
export type DesktopLogRange = "launch" | "24h" | "7d";

/** logs.aggregate: the Overview's figures over a range. */
export interface DesktopLogOverview extends DesktopLogReadStats {
  range: DesktopLogRange;
  from: string;
  to: string;
  /** Most first. */
  counts: {
    name: string;
    outcome: Outcome;
    outcome_reason?: string;
    count: number;
  }[];
  /**
   * The problems among the counts, most first, then the latest: at most 50,
   * each with when its last one started and where they happened (its
   * connection, else its plugin), at most 3 places, most first.
   */
  problems: {
    name: string;
    outcome: ProblemOutcome;
    outcome_reason?: string;
    count: number;
    last_at: string;
    places: { connection_id?: string; plugin_id?: string; count: number }[];
  }[];
  /**
   * Each connection's backlog syncs, one per trace. Connections with a
   * failed sync first, the latest failure first.
   */
  syncs: {
    connection_id: string;
    sync_count: number;
    failed_count: number;
    last: DesktopLogSyncEnd;
    last_failure?: DesktopLogSyncEnd;
  }[];
  /** Plugin operations' timeouts, crashes and capacity refusals, by plugin and version. */
  plugin_problems: {
    plugin_id: string;
    plugin_version?: string;
    outcome: ProblemOutcome;
    outcome_reason?: string;
    count: number;
    last_at: string;
  }[];
  /** One per hour of the range, oldest first, with each problem outcome's count. */
  problems_per_hour: {
    hour: string;
    counts: Partial<Record<ProblemOutcome, number>>;
  }[];
  durations: { name: string; count: number; p50_ms: number; p95_ms: number }[];
  latest_launch: LoggedEvent | null;
  crash_count: number;
  /** Newest first, the first 100. */
  crashes: LoggedEvent[];
}

/** What a tail follows: a filter without a range. */
export type DesktopLogTailFilter = Omit<DesktopLogFilter, "from" | "to">;

declare global {
  interface Window {
    ajourDesktop?: {
      listAgentInstructions?: () => Promise<InstructionFileState[]>;
      previewAgentInstructions?: (
        id: InstructionFileId,
        action: InstructionAction,
      ) => Promise<InstructionPreview>;
      applyAgentInstructions?: (
        id: InstructionFileId,
        token: string,
      ) => Promise<void>;
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
      getWindowSettings?: (
        trace?: TraceCarrier,
      ) => Promise<DesktopWindowSettings>;
      configureWindowSettings?: (
        settings: DesktopWindowSettings,
        trace?: TraceCarrier,
      ) => Promise<DesktopWindowSettings>;
      /** Sends the running entry to the tray icon, one way. */
      setTrayState?: (state: DesktopTrayState, trace?: TraceCarrier) => void;
      trayPanelCommand?: (
        command: "ready" | "hide" | "open-main",
        trace?: TraceCarrier,
      ) => void;
      onTrayPanel?: (
        callback: (command: "open" | "show" | "hide") => void,
      ) => () => void;
      /** Runs `callback` with each action the tray menu asks for. */
      onTrayAction?: (
        callback: (action: DesktopTrayAction) => void,
      ) => () => void;
      /** The terminal app that opens plugin commands, and the installed ones to pick from. */
      getTerminalApp?: () => Promise<DesktopTerminalApps>;
      /** Saves an installed terminal app as the choice, and resolves with it. */
      setTerminalApp?: (value: string) => Promise<string>;
      getCliCommand?: (trace?: TraceCarrier) => Promise<DesktopCliCommandState>;
      /** Installs the ajour command of the app's own version, and resolves with how it ended. */
      installCliCommand?: (
        trace?: TraceCarrier,
      ) => Promise<DesktopCliCommandState>;
      addCliCommandWsl?: (
        options: { distro: string },
        trace?: TraceCarrier,
      ) => Promise<DesktopCliCommandState>;
      /** Removes the command from one WSL distro; main checks the name (#605). */
      removeCliCommandWsl?: (
        options: { distro: string },
        trace?: TraceCarrier,
      ) => Promise<DesktopCliCommandState>;
      removeCliCommand?: () => Promise<DesktopCliCommandState>;
      onCliCommandChanged?: (
        callback: (state: DesktopCliCommandState) => void,
      ) => () => void;
      checkForUpdates?: (
        track: UpdateTrack,
        trace?: TraceCarrier,
      ) => Promise<DesktopUpdateState>;
      getUpdateState?: (trace?: TraceCarrier) => Promise<DesktopUpdateState>;
      getReleaseNotes?: (
        track: UpdateTrack,
        trace?: TraceCarrier,
      ) => Promise<DesktopReleaseNote[]>;
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
      chooseFolder?: (projectId: string) => Promise<RepositoryFolder | null>;
      /**
       * Opens the native folder dialog to choose a repository's clone
       * (#795). Null when cancelled; `refused` says why the folder isn't one.
       */
      chooseDeckClone?: (request: {
        pluginId: string;
        connectionId: string;
        repository: string;
        clone: DeckCloneSource;
      }) => Promise<{ clone: DeckClone } | { refused: string } | null>;
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
      // The diagnostics viewer's reads of the local log file (#442).
      queryLogs?: (
        filter: DesktopLogFilter,
        page?: DesktopLogPage,
        trace?: TraceCarrier,
      ) => Promise<DesktopLogQueryResult>;
      getLogTrace?: (
        traceId: string,
        trace?: TraceCarrier,
      ) => Promise<DesktopLogTrace>;
      listLogActions?: (
        filter: DesktopLogActionsFilter,
        page?: DesktopLogPage,
        trace?: TraceCarrier,
      ) => Promise<DesktopLogActions>;
      aggregateLogs?: (
        options: { range: DesktopLogRange },
        trace?: TraceCarrier,
      ) => Promise<DesktopLogOverview>;
      /**
       * Runs `callback` with the events main writes from now on that pass
       * the filter, as they are written. Resolves with how to stop, once
       * main follows it. A reload ends every tail.
       */
      tailLogs?: (
        filter: DesktopLogTailFilter | undefined,
        callback: (events: LoggedEvent[]) => void,
        trace?: TraceCarrier,
      ) => Promise<() => void>;
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

type DesktopBridge = NonNullable<Window["ajourDesktop"]>;

/** The viewer's bridge method, which only the desktop app has. */
function logsBridge<Name extends keyof DesktopBridge>(
  name: Name,
): NonNullable<DesktopBridge[Name]> {
  const method = window.ajourDesktop?.[name];
  if (!method) {
    throw new Error("Diagnostics are available in the desktop app.");
  }
  return method as NonNullable<DesktopBridge[Name]>;
}

/** The local log file's events that pass `filter`, newest first, one page. */
export function queryLogs(
  filter: DesktopLogFilter = {},
  page?: DesktopLogPage,
) {
  return logsBridge("queryLogs")(filter, page, traceCarrier());
}

/** Every event of a trace, from any runtime, as a tree of spans. */
export function getLogTrace(traceId: string) {
  return logsBridge("getLogTrace")(traceId, traceCarrier());
}

/** The actions, one row per trace root, newest first. */
export function listLogActions(
  filter: DesktopLogActionsFilter = {},
  page?: DesktopLogPage,
) {
  return logsBridge("listLogActions")(filter, page, traceCarrier());
}

/** The Overview's figures over this launch, 24 hours or 7 days. */
export function aggregateLogs(range: DesktopLogRange) {
  return logsBridge("aggregateLogs")({ range }, traceCarrier());
}

/** Follows the events main writes that pass `filter`. Resolves with how to stop. */
export function tailLogs(
  filter: DesktopLogTailFilter | undefined,
  onEvents: (events: LoggedEvent[]) => void,
) {
  return logsBridge("tailLogs")(filter, onEvents, traceCarrier());
}

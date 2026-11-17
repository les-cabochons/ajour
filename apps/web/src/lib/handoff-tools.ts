import { useEffect, useSyncExternalStore } from "react";
import type { PluginsOverview } from "@ajour/shared/plugins";
import type { HandOffActionTool } from "@/domain/actions/object-actions";
import {
  getHandoffToolNote,
  getHandoffToolRefusal,
  getHandoffToolsChoice,
  listHandoffTools,
  type DetectedTools,
  type HandoffTool,
} from "@/domain/handoffs/handoffs";
import {
  detectHandoffTools,
  getCachedPluginsOverview,
  getPluginsOverview,
  subscribePluginsOverview,
} from "@/lib/app-api";

/**
 * The coding tools a hand off can go to, on this computer: the tools of the
 * active handoff plugins that the user turned on on the plugin's page, with
 * what each plugin's `detectTools` found. Tools that are off are neither
 * listed nor detected; `useAllHandoffTools` still names them for the
 * handoffs they started. Only the desktop app runs plugins, so the web
 * build lists none and shows no hand off anywhere.
 */

const EMPTY: readonly HandoffTool[] = [];
/** A detection younger than this is reused when a menu or page asks again. */
const DETECTION_MAX_AGE_MS = 60_000;

let detections = new Map<string, DetectedTools>();
const detectedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let snapshot: {
  overview: PluginsOverview | null;
  detections: Map<string, DetectedTools>;
  all: readonly HandoffTool[];
  tools: readonly HandoffTool[];
} = { overview: null, detections, all: EMPTY, tools: EMPTY };

function isDesktop() {
  return typeof window !== "undefined" && Boolean(window.ajourDesktop);
}

function current() {
  if (!isDesktop()) return snapshot;
  const overview = getCachedPluginsOverview();
  if (snapshot.overview !== overview || snapshot.detections !== detections) {
    const all = listHandoffTools(overview, detections);
    const tools = all.filter((tool) => tool.enabled);
    snapshot = {
      overview,
      detections,
      all: all.length ? all : EMPTY,
      tools: tools.length ? tools : EMPTY,
    };
  }
  return snapshot;
}

/** The tools that are on now, for row menus that build their actions on demand. */
export function getHandoffTools(): readonly HandoffTool[] {
  return isDesktop() ? current().tools : EMPTY;
}

/** Every tool of the active plugins, on or off, to name a handoff's tool. */
function getAllHandoffTools(): readonly HandoffTool[] {
  return isDesktop() ? current().all : EMPTY;
}

let choice: {
  overview: PluginsOverview | null;
  value: ReturnType<typeof getHandoffToolsChoice>;
} = { overview: null, value: undefined };

/**
 * Where *Choose your tools* leads, while handoff plugins are active and no
 * tool is on (`getHandoffToolsChoice`); undefined otherwise.
 */
export function getHandoffToolsChoiceNow() {
  if (!isDesktop()) return undefined;
  const overview = getCachedPluginsOverview();
  if (choice.overview !== overview)
    choice = { overview, value: getHandoffToolsChoice(overview) };
  return choice.value;
}

let actionTools: {
  tools: readonly HandoffTool[];
  value: readonly HandOffActionTool[];
} = { tools: EMPTY, value: [] };

/**
 * The tools as row menus list them: Hand off to <tool>, each with why not,
 * or, for a tool that doesn't follow state, that it only starts the thread.
 */
export function getHandOffActionTools(): readonly HandOffActionTool[] {
  const tools = getHandoffTools();
  if (actionTools.tools !== tools)
    actionTools = {
      tools,
      value: tools.map((tool) => {
        const refusal = getHandoffToolRefusal(tool);
        const note = getHandoffToolNote(tool);
        return {
          key: tool.key,
          label: tool.label,
          ...(refusal ? { disabledReason: refusal } : {}),
          ...(!refusal && note ? { hint: note } : {}),
        };
      }),
    };
  return actionTools.value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const unsubscribe = subscribePluginsOverview(listener);
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

/**
 * Asks each handoff plugin which of its tools this computer has, for the
 * item's project. Detection is the plugin's own call, so it runs at most once
 * a minute per plugin unless `force` or the plugin's detection was forgotten.
 */
export function detectHandoffToolsFor(projectId: string, force = false) {
  const plugins = new Set(getHandoffTools().map((tool) => tool.pluginId));
  return Promise.all(
    [...plugins].map((pluginId) => {
      const running = inFlight.get(pluginId);
      if (running) return running;
      if (
        !force &&
        Date.now() - (detectedAt.get(pluginId) ?? -Infinity) <
          DETECTION_MAX_AGE_MS
      )
        return Promise.resolve();
      const task: Promise<void> = detectHandoffTools(pluginId, projectId)
        .then(
          (result) => result.tools,
          (error: unknown): DetectedTools => {
            // A plugin that can't answer offers none of its tools, with why.
            const reason =
              error instanceof Error ? error.message : "Detection failed.";
            return getHandoffTools()
              .filter((tool) => tool.pluginId === pluginId)
              .map((tool) => ({ id: tool.toolId, available: false, reason }));
          },
        )
        .then((tools) => {
          // A detection forgotten while it ran answered for an old pick.
          if (inFlight.get(pluginId) !== task) return;
          detections = new Map(detections).set(pluginId, tools);
          detectedAt.set(pluginId, Date.now());
          listeners.forEach((listener) => listener());
        })
        .finally(() => {
          if (inFlight.get(pluginId) === task) inFlight.delete(pluginId);
        });
      inFlight.set(pluginId, task);
      return task;
    }),
  );
}

/**
 * Forgets the plugin's detection, so the next ask runs it again: its answer
 * depends on the connection each tool picked and on which tools are on,
 * which the plugin's page just changed. Its tools read as not yet detected
 * until then, and a detection still running is not kept.
 */
export function forgetHandoffToolDetection(pluginId: string) {
  detectedAt.delete(pluginId);
  inFlight.delete(pluginId);
  if (!detections.has(pluginId)) return;
  detections = new Map(detections);
  detections.delete(pluginId);
  listeners.forEach((listener) => listener());
}

/**
 * The tools that are on, kept current. With `projectId`, detects them for
 * that project when the caller mounts.
 */
export function useHandoffTools(projectId?: string): readonly HandoffTool[] {
  const tools = useSyncExternalStore(subscribe, getHandoffTools, () => EMPTY);
  // Which tools are on: turning one on detects it.
  const enabled = tools.map((tool) => tool.key).join(" ");
  useEffect(() => {
    if (!isDesktop()) return;
    if (!getCachedPluginsOverview())
      void getPluginsOverview().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (projectId && enabled) void detectHandoffToolsFor(projectId);
  }, [projectId, enabled]);
  return tools;
}

/** Every tool of the active plugins, on or off, kept current. */
export function useAllHandoffTools(): readonly HandoffTool[] {
  return useSyncExternalStore(subscribe, getAllHandoffTools, () => EMPTY);
}

const noChoice = () => undefined;

/** Where *Choose your tools* leads now, kept current. */
export function useHandoffToolsChoice() {
  return useSyncExternalStore(subscribe, getHandoffToolsChoiceNow, noChoice);
}

/** Test seam: forgets every detection. */
export function resetHandoffToolDetections() {
  detections = new Map();
  detectedAt.clear();
  inFlight.clear();
  listeners.forEach((listener) => listener());
}

const LAST_TOOL_KEY = "ajour.handoff-last-tool";
const NOTICES_KEY = "ajour.handoff-notices";
const lastToolListeners = new Set<() => void>();

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice then lasts only for this session.
  }
}

let lastTool: string | undefined;
let lastToolRead = false;

function getLastHandoffTool() {
  if (!lastToolRead) {
    lastToolRead = true;
    lastTool = read(LAST_TOOL_KEY) ?? undefined;
  }
  return lastTool;
}

function subscribeLastTool(listener: () => void) {
  lastToolListeners.add(listener);
  return () => {
    lastToolListeners.delete(listener);
  };
}
const noLastTool = () => undefined;

/** The tool last handed off to on this device, which the split button names. */
export function useLastHandoffTool() {
  return useSyncExternalStore(
    subscribeLastTool,
    getLastHandoffTool,
    noLastTool,
  );
}

export function setLastHandoffTool(key: string) {
  lastTool = key;
  lastToolRead = true;
  write(LAST_TOOL_KEY, key);
  lastToolListeners.forEach((listener) => listener());
}

function readNotices(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(NOTICES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Whether this device already showed the notice that a hand off sends the
 * item's text to the tool's model provider (ADR 0004). Shown once per tool.
 */
export function hasSeenHandoffNotice(toolKey: string) {
  return readNotices().includes(toolKey);
}

export function markHandoffNoticeSeen(toolKey: string) {
  const seen = readNotices();
  if (!seen.includes(toolKey))
    write(NOTICES_KEY, JSON.stringify([...seen, toolKey]));
}

/** Test seam: forgets the last tool, which tests clear from storage. */
export function resetLastHandoffTool() {
  lastTool = undefined;
  lastToolRead = false;
  lastToolListeners.forEach((listener) => listener());
}

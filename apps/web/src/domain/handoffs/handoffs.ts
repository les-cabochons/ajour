import type {
  DetectToolsResult,
  Handoff,
  HandoffStartRoute,
} from "@ajour/shared/handoffs";
import {
  isCapabilityActive,
  type PluginsOverview,
} from "@ajour/shared/plugins";
import { itemKeySchema } from "@ajour/shared/handoff-threads";
import type { LocalProject, LocalWorkItem } from "@/domain/local-state";
import { getWorkItemKey } from "@/domain/backlog/backlog-item-summary";
import { syncAge } from "@/domain/backlog/sync-freshness";
import {
  getWorkItemLookupKeys,
  getWorkItemParentKey,
} from "@/domain/backlog/work-item-hierarchy";

/**
 * Handoffs as the window shows them, from "Hand off to a coding tool" in
 * docs/agents/ux-spec.md: the tools a hand off can go to, the item fields it
 * sends, the state chip of each thread and the mark on backlog rows.
 */

/** A tool of an active handoff plugin, with what detection found on this computer. */
export interface HandoffTool {
  /** `pluginId:toolId`, unique across plugins. */
  key: string;
  pluginId: string;
  toolId: string;
  label: string;
  iconSvg: string;
  /** Undefined until the plugin's tools were detected on this computer. */
  available: boolean | undefined;
  /** Why the tool can't run here, in the plugin's words. */
  reason?: string;
  /** False for a tool that only starts threads: its handoffs stay Started. */
  followsState: boolean;
}

export type DetectedTools = DetectToolsResult["tools"];

export function handoffToolKey(pluginId: string, toolId: string) {
  return `${pluginId}:${toolId}`;
}

/** Tool ids hold no colon, so a key splits at its last one. */
export function parseHandoffToolKey(key: string) {
  const at = key.lastIndexOf(":");
  if (at <= 0 || at === key.length - 1) return undefined;
  return { pluginId: key.slice(0, at), toolId: key.slice(at + 1) };
}

/**
 * Every tool of the plugins whose handoff capability is on, in manifest
 * order. A tool detection didn't list counts as missing.
 */
export function listHandoffTools(
  overview: PluginsOverview | null | undefined,
  detections: ReadonlyMap<string, DetectedTools>,
): HandoffTool[] {
  if (!overview?.pluginsEnabled) return [];
  return overview.connectionGroups.flatMap((group) => {
    const capability = group.plugin.capabilities.handoff;
    if (!capability || group.missing || !isCapabilityActive(group, "handoff"))
      return [];
    const detected = detections.get(group.plugin.id);
    return capability.tools.map((tool) => {
      const found = detected?.find((candidate) => candidate.id === tool.id);
      return {
        key: handoffToolKey(group.plugin.id, tool.id),
        pluginId: group.plugin.id,
        toolId: tool.id,
        label: tool.label,
        iconSvg: tool.iconSvg,
        followsState: tool.followsState !== false,
        available: detected ? (found?.available ?? false) : undefined,
        ...(detected && !found?.available
          ? { reason: found?.reason ?? `${tool.label} isn't on this computer.` }
          : {}),
      };
    });
  });
}

/** Why a tool can't take a hand off now, or undefined when it can. */
export function getHandoffToolRefusal(tool: HandoffTool) {
  return tool.available === false ? tool.reason : undefined;
}

/**
 * A tool's secondary line in the hand-off menus: why it can't run, else, for
 * a tool that doesn't follow state, that it only starts the thread.
 */
export function getHandoffToolNote(tool: HandoffTool) {
  return (
    getHandoffToolRefusal(tool) ??
    (tool.followsState ? undefined : "Starts a thread; doesn't report progress")
  );
}

/**
 * The split button's tool: the one last handed off to on this device while
 * it can still run, else the first that can.
 */
export function pickHandoffTool(
  tools: readonly HandoffTool[],
  lastKey: string | undefined,
): HandoffTool | undefined {
  const usable = tools.filter((tool) => tool.available !== false);
  return usable.find((tool) => tool.key === lastKey) ?? usable[0];
}

/** Why an item can't be handed off at all, whatever the tool. */
export function getHandoffItemRefusal(item: {
  projectId?: string;
  status: LocalWorkItem["status"];
}) {
  if (item.status === "archived") return "Restore the item first";
  if (!item.projectId) return "Add the item to a project first";
  return undefined;
}

/**
 * The item's key as a hand off sends it: the source's own id, such as
 * `PAY-12` or `acme/api#12`. A local item has none.
 */
export function getHandoffItemKey(
  item: Pick<LocalWorkItem, "sourceExternalId">,
) {
  return item.sourceExternalId ?? "";
}

/**
 * The keys a thread's title may name the item by, in brackets: the key a
 * hand off sends and the key the item shows (`getWorkItemKey`). A GitHub
 * issue answers to `acme/api#12` and to `12`, which `[#12]` names too; a
 * Jira issue or an Azure DevOps work item shows its own id. A local item
 * has none, and a key no title's brackets could hold (`itemKeySchema`),
 * such as a source id with a bracket, is left out.
 */
export function getHandoffItemKeys(
  item: Pick<
    LocalWorkItem,
    "source" | "sourceExternalId" | "sourceUrl" | "sourceId"
  >,
): string[] {
  if (item.source === "manual") return [];
  return [
    ...new Set(
      [getHandoffItemKey(item), getWorkItemKey(item) ?? ""].filter(
        (key) => itemKeySchema.safeParse(key).success,
      ),
    ),
  ];
}

/** The item fields a hand off sends; the API fills the templates from them. */
export function getHandoffItem(
  item: LocalWorkItem,
  workItems: readonly LocalWorkItem[],
): HandoffStartRoute["item"] {
  const parentKey = getWorkItemParentKey(item);
  const parent = parentKey
    ? workItems.find((candidate) =>
        getWorkItemLookupKeys(candidate).includes(parentKey),
      )
    : undefined;
  return {
    key: getHandoffItemKey(item),
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    url: item.sourceUrl ?? "",
    type: item.sourceWorkItemType ?? "",
    ...(parent
      ? { parent: { key: parent.sourceExternalId ?? "", title: parent.title } }
      : {}),
  };
}

export function getHandoffProjectName(
  item: Pick<LocalWorkItem, "projectId">,
  projects: readonly LocalProject[],
) {
  return projects.find((project) => project._id === item.projectId)?.name ?? "";
}

/** A backlog row's mark: only threads that run or wait for the user show one. */
export type HandoffMark = "working" | "needs-you";

/**
 * One mark per work item, for every backlog row at once. Needs you outranks
 * Working, since it asks for the user. A paused handoff's state is stale, so
 * it marks nothing.
 */
export function getHandoffMarks(
  records: readonly Handoff[],
): ReadonlyMap<string, HandoffMark> {
  const marks = new Map<string, HandoffMark>();
  for (const record of records) {
    if (record.paused) continue;
    if (record.state === "needs-you") marks.set(record.workItemId, "needs-you");
    else if (record.state === "working" && !marks.has(record.workItemId))
      marks.set(record.workItemId, "working");
  }
  return marks;
}

export function sameHandoffMarks(
  left: ReadonlyMap<string, HandoffMark>,
  right: ReadonlyMap<string, HandoffMark>,
) {
  if (left.size !== right.size) return false;
  for (const [id, mark] of left) if (right.get(id) !== mark) return false;
  return true;
}

export type HandoffChipTone =
  "success" | "warning" | "neutral" | "danger" | "muted";

const CHIPS: Record<
  Handoff["state"],
  { label: string; tone: HandoffChipTone }
> = {
  working: { label: "Working", tone: "success" },
  "needs-you": { label: "Needs you", tone: "warning" },
  ready: { label: "Ready", tone: "neutral" },
  done: { label: "Done", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  gone: { label: "Gone", tone: "muted" },
  unknown: { label: "Unknown", tone: "muted" },
  started: { label: "Started", tone: "muted" },
};

/**
 * A handoff's state chip: green Working, amber Needs you, neutral Ready and
 * Done, red Failed, muted Unknown, Gone and Started. A paused handoff is
 * muted and says why. `detail` is the tooltip: the tool's own label for the
 * state, or, for a started one, when it started and that the tool doesn't
 * report progress. `context` names the tool and the time for that.
 */
export function getHandoffChip(
  record: Handoff,
  context: { toolLabel?: string; now?: number } = {},
): {
  label: string;
  tone: HandoffChipTone;
  detail?: string;
} {
  if (record.paused)
    return { label: "Paused", tone: "muted", detail: record.paused.reason };
  if (record.state === "started") {
    const tool = context.toolLabel ?? record.toolId;
    const age = syncAge(record.startedAt, context.now ?? record.startedAt);
    return {
      ...CHIPS.started,
      detail: `Started in ${tool} ${age}. ${tool} doesn't report progress here; open it there to follow it.`,
    };
  }
  const native = getHandoffNativeLabel(record);
  return { ...CHIPS[record.state], ...(native ? { detail: native } : {}) };
}

/** The tool's own words for the state: its label, else its status. */
export function getHandoffNativeLabel(record: Handoff) {
  for (const key of ["label", "status"] as const) {
    const value = record.native[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const last = record.history.at(-1);
  return last?.label ?? last?.status;
}

/** Newest change first, so the thread that moved last leads the card. */
export function sortHandoffs(records: readonly Handoff[]) {
  return [...records].sort((left, right) => right.changedAt - left.changedAt);
}

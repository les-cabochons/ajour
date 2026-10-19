import type {
  LocalAppState,
  LocalSettleRule,
  LocalWorkItem,
} from "@/domain/local-state";
import { isPriorityLevel } from "@/domain/backlog/priority";

/**
 * Settle rules, from "Settle rules" in docs/agents/ux-spec.md. Each source project
 * of a connection either asks with the settle dialog, the default, or applies
 * a fixed state, priority or both. Manual items have no rule.
 */

/** A source project seen in syncs, listed in Settings > Backlog. */
export interface SettleRuleSourceProject {
  source: string;
  connectionId: string;
  connectionLabel: string;
  sourceProjectName: string;
  /** An item of the project, to ask its plugin which states exist. */
  sampleSourceId: string;
}

type SettleRuleKey = Pick<
  LocalSettleRule,
  "source" | "connectionId" | "sourceProjectName"
>;

function sameProject(left: SettleRuleKey, right: SettleRuleKey) {
  return (
    left.source === right.source &&
    left.connectionId === right.connectionId &&
    left.sourceProjectName === right.sourceProjectName
  );
}

/** The Apply rule of the item's source project, or undefined to ask. */
export function findSettleRule(
  rules: readonly LocalSettleRule[] | undefined,
  workItem: LocalWorkItem,
): LocalSettleRule | undefined {
  if (
    workItem.source === "manual" ||
    !workItem.sourceConnectionId ||
    !workItem.sourceProjectName
  ) {
    return undefined;
  }

  const key = {
    source: workItem.source,
    connectionId: workItem.sourceConnectionId,
    sourceProjectName: workItem.sourceProjectName,
  };
  return rules?.find((rule) => sameProject(rule, key));
}

/** Sets an Apply rule, replacing the project's previous one. */
export function applySettleRule(
  state: LocalAppState,
  rule: LocalSettleRule,
): LocalAppState {
  return {
    ...state,
    settleRules: [
      ...(state.settleRules ?? []).filter(
        (current) => !sameProject(current, rule),
      ),
      rule,
    ],
  };
}

/** Puts the project back to Ask. */
export function askSettleRule(
  state: LocalAppState,
  key: SettleRuleKey,
): LocalAppState {
  if (!state.settleRules?.some((rule) => sameProject(rule, key))) {
    return state;
  }

  return {
    ...state,
    settleRules: state.settleRules.filter((rule) => !sameProject(rule, key)),
  };
}

/** The source projects seen in syncs, by connection, then by name. */
export function listSettleRuleSourceProjects(
  workItems: readonly LocalWorkItem[],
): SettleRuleSourceProject[] {
  const projects = new Map<string, SettleRuleSourceProject>();
  for (const workItem of workItems) {
    if (
      workItem.source === "manual" ||
      !workItem.sourceId ||
      !workItem.sourceConnectionId ||
      !workItem.sourceProjectName
    ) {
      continue;
    }

    const key = [
      workItem.source,
      workItem.sourceConnectionId,
      workItem.sourceProjectName,
    ].join("\n");
    const existing = projects.get(key);
    // Prefer an active item: its plugin is the likeliest to list states.
    if (!existing || workItem.status === "active") {
      projects.set(key, {
        source: workItem.source,
        connectionId: workItem.sourceConnectionId,
        connectionLabel:
          workItem.sourceConnectionLabel ?? workItem.sourceConnectionId,
        sourceProjectName: workItem.sourceProjectName,
        sampleSourceId: workItem.sourceId,
      });
    }
  }

  return Array.from(projects.values()).sort(
    (left, right) =>
      left.connectionLabel.localeCompare(right.connectionLabel) ||
      left.sourceProjectName.localeCompare(right.sourceProjectName),
  );
}

/** Keeps the well-formed rules of persisted state. */
export function normalizeSettleRules(value: unknown): LocalSettleRule[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate): LocalSettleRule[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const rule = candidate as Partial<LocalSettleRule>;
    if (
      typeof rule.source !== "string" ||
      typeof rule.connectionId !== "string" ||
      typeof rule.sourceProjectName !== "string"
    ) {
      return [];
    }

    const state =
      rule.state &&
      typeof rule.state.name === "string" &&
      rule.state.name.trim() &&
      typeof rule.state.done === "boolean"
        ? { name: rule.state.name, done: rule.state.done }
        : undefined;
    // Rules held raw source values before plugins sent levels. A
    // rule that only set such a value goes back to Ask, so it never settles
    // without the write the user chose.
    const priority = isPriorityLevel(rule.priority) ? rule.priority : undefined;
    if (rule.priority !== undefined && priority === undefined && !state) {
      return [];
    }
    return [
      {
        source: rule.source,
        connectionId: rule.connectionId,
        sourceProjectName: rule.sourceProjectName,
        state,
        priority,
      },
    ];
  });
}

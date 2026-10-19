import { useEffect, useState } from "react";
import { fillTemplate } from "@ajour/shared/agent-task-templates";
import type { AgentTaskPlacement } from "@ajour/shared";
import type { AgentTaskStatus } from "@ajour/shared/agent-runs";
import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/disabled-reason";
import {
  openAgentPanel,
  useAgentBridgeState,
} from "@/features/agents/agent-bridge-state";
import {
  refreshAgentRunner,
  useAgentRunner,
  type AgentRunnerState,
} from "@/lib/agent-runner";
import { startAgentRun } from "@/lib/app-api";

/** The task's week link for `weekOf`, or undefined when it is not https. */
export function weekLinkFor(task: AgentTaskStatus, weekOf: string) {
  if (!task.weekLink) return undefined;
  try {
    const values = Object.fromEntries(
      Object.entries(task.values).map(([id, value]) => [
        `settings.${id}`,
        String(value),
      ]),
    );
    const url = new URL(
      fillTemplate(task.weekLink, { ...values, weekOf, sessionId: "" }),
    );
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Whether an active plugin has a task for a placement, or `loading` until Ajour knows. */
export type AgentTaskPresence = "loading" | "present" | "absent";

/**
 * Whether an active plugin has a task for `placement`, such as one that
 * sits alongside Submit week. `loading` while the overview loads on a cold start.
 * Without the local API (the web build) or with a failed overview there is
 * no task; the page always keeps its own button: `AgentTaskButtons`
 * shows nothing then either.
 */
export function getAgentTaskPresence(
  state: AgentRunnerState,
  placement: AgentTaskPlacement,
): AgentTaskPresence {
  if (state.kind === "loading") return "loading";
  return state.kind === "ready" &&
    state.overview.tasks.some((task) => task.placement === placement)
    ? "present"
    : "absent";
}

/** `getAgentTaskPresence` for the current agent runner overview. */
export function useAgentTaskPresence(placement: AgentTaskPlacement) {
  return getAgentTaskPresence(useAgentRunner(), placement);
}

/** Why an action waits while an agent run is going. */
export const AGENT_RUN_GOING_REASON = "An agent task is already running.";

/**
 * Whether an agent run is going. The API's current run covers a CLI that
 * outlives its ended session.
 */
export function isAgentRunGoing(
  state: AgentRunnerState,
  sessions: readonly { runId?: string; state: string }[],
) {
  return (
    (state.kind === "ready" && state.overview.currentRun !== null) ||
    sessions.some(
      (session) =>
        session.runId &&
        (session.state === "active" || session.state === "stalled"),
    )
  );
}

/** `isAgentRunGoing` for the current overview and agent sessions. */
export function useAgentRunGoing() {
  const state = useAgentRunner();
  const { snapshot } = useAgentBridgeState();
  return isAgentRunGoing(state, snapshot?.sessions ?? []);
}

/**
 * The Commit page's plugin agent tasks for one placement and the week on
 * screen: one button each, disabled with the reason while the task cannot
 * run, a run is going, a start is in flight, or the week is not ready
 * (`disabledReason`, such as "Commit your changes first"). With `primary`,
 * an enabled button is the primary one, as Submit week is once nothing is
 * left to commit. `onStartingChange` tells the page while a start is in
 * flight. The week links sit in the week summary, see `AgentTaskWeekLinks`.
 */
export function AgentTaskButtons({
  weekOf,
  placement,
  disabledReason,
  primary = false,
  onStartingChange,
}: {
  weekOf: string;
  placement: AgentTaskPlacement;
  disabledReason?: string;
  primary?: boolean;
  onStartingChange?: (starting: boolean) => void;
}) {
  const state = useAgentRunner();
  const running = useAgentRunGoing();
  const [error, setError] = useState<string | null>(null);
  // True from the click until the API answers, so a second click cannot send a second request.
  const [starting, setStarting] = useState(false);

  // The overview loads once per page load, so a CLI or plugin installed since
  // then shows up when the page opens.
  useEffect(() => {
    void refreshAgentRunner();
  }, []);

  if (state.kind !== "ready") return null;
  const tasks = state.overview.tasks.filter(
    (task) => task.placement === placement,
  );
  if (tasks.length === 0) return null;

  const start = async (task: AgentTaskStatus) => {
    if (starting) return;
    setError(null);
    setStarting(true);
    onStartingChange?.(true);
    try {
      await startAgentRun({
        pluginId: task.pluginId,
        taskId: task.taskId,
        weekOf,
      });
      openAgentPanel();
      await refreshAgentRunner();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setStarting(false);
      onStartingChange?.(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tasks.map((task) => {
        const reason = running
          ? AGENT_RUN_GOING_REASON
          : (task.blockers[0] ?? disabledReason);
        const button = (
          <Button
            variant={primary && !reason ? "default" : "outline"}
            disabled={Boolean(reason) || starting}
            onClick={() => void start(task)}
          >
            {task.label}
          </Button>
        );
        return (
          <div key={`${task.pluginId}/${task.taskId}`} className="contents">
            <DisabledReason label={task.label} reason={reason}>
              {button}
            </DisabledReason>
          </div>
        );
      })}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Muted links to the week in each task's external tool, for the Commit
 * page's week summary. Tasks that share a link show it once. A task whose link does not fill to https shows none.
 */
export function AgentTaskWeekLinks({ weekOf }: { weekOf: string }) {
  const state = useAgentRunner();
  if (state.kind !== "ready") return null;
  const seen = new Set<string>();
  const links = state.overview.tasks.flatMap((task) => {
    const url = weekLinkFor(task, weekOf);
    // A plugin's tasks often share one link.
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ key: `${task.pluginId}/${task.taskId}`, url, task }];
  });
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map(({ key, url, task }) => (
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground hover:underline"
        >
          Open the week in {task.pluginName}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ))}
    </div>
  );
}

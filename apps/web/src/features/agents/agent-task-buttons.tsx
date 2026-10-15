import { useEffect, useState } from "react";
import { fillTemplate } from "@ajour/shared/agent-task-templates";
import type { AgentTaskStatus } from "@ajour/shared/agent-runs";
import { RiExternalLinkLine as ExternalLink } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  openAgentPanel,
  useAgentBridgeState,
} from "@/features/agents/agent-bridge-state";
import { refreshAgentRunner, useAgentRunner } from "@/lib/agent-runner";
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

/**
 * The Commit page's plugin agent tasks for the week on screen: one button
 * each, disabled with the reason while the task cannot run or a run is
 * going or a start is in flight. The week links sit in the week summary,
 * see `AgentTaskWeekLinks`.
 */
export function AgentTaskButtons({ weekOf }: { weekOf: string }) {
  const state = useAgentRunner();
  const { snapshot } = useAgentBridgeState();
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
    (task) => task.placement === "submit-week",
  );
  if (tasks.length === 0) return null;
  // The API's current run covers a CLI that outlives its ended session.
  const running =
    state.overview.currentRun !== null ||
    (snapshot?.sessions ?? []).some(
      (session) =>
        session.runId &&
        (session.state === "active" || session.state === "stalled"),
    );

  const start = async (task: AgentTaskStatus) => {
    if (starting) return;
    setError(null);
    setStarting(true);
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
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tasks.map((task) => {
        const reason = running
          ? "An agent task is already running."
          : task.blockers[0];
        const button = (
          <Button
            variant="outline"
            disabled={Boolean(reason) || starting}
            onClick={() => void start(task)}
          >
            {task.label}
          </Button>
        );
        return (
          <div key={`${task.pluginId}/${task.taskId}`} className="contents">
            {reason ? (
              // A disabled button gets no pointer events, so the wrapper
              // carries the tooltip.
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      tabIndex={0}
                      aria-label={`${task.label}: ${reason}`}
                    />
                  }
                >
                  {button}
                </TooltipTrigger>
                <TooltipContent>{reason}</TooltipContent>
              </Tooltip>
            ) : (
              button
            )}
          </div>
        );
      })}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Muted links to the week in each task's external tool, for the Commit
 * page's week summary. A task whose link does not fill to https shows none.
 */
export function AgentTaskWeekLinks({ weekOf }: { weekOf: string }) {
  const state = useAgentRunner();
  if (state.kind !== "ready") return null;
  const links = state.overview.tasks.flatMap((task) => {
    const url =
      task.placement === "submit-week" ? weekLinkFor(task, weekOf) : undefined;
    return url ? [{ key: `${task.pluginId}/${task.taskId}`, url, task }] : [];
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

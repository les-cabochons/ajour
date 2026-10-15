import { useEffect, useState } from "react";
import { fillTemplate } from "@ajour/shared/agent-task-templates";
import type { AgentTaskStatus } from "@ajour/shared/agent-runs";
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
 * The Submit page's plugin agent tasks for the week on screen: one button
 * each, disabled with the reason while the task cannot run or a run is
 * going, and the task's week link.
 */
export function AgentTaskButtons({ weekOf }: { weekOf: string }) {
  const state = useAgentRunner();
  const { snapshot } = useAgentBridgeState();
  const [error, setError] = useState<string | null>(null);

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
  const running = (snapshot?.sessions ?? []).some(
    (session) =>
      session.runId &&
      (session.state === "active" || session.state === "stalled"),
  );

  const start = async (task: AgentTaskStatus) => {
    setError(null);
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
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tasks.map((task) => {
        const reason = running
          ? "An agent task is already running."
          : task.blockers[0];
        const link = weekLinkFor(task, weekOf);
        const button = (
          <Button
            variant="outline"
            disabled={Boolean(reason)}
            onClick={() => void start(task)}
          >
            {task.label}
          </Button>
        );
        return (
          <div
            key={`${task.pluginId}/${task.taskId}`}
            className="flex items-center gap-2"
          >
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
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="text-sm underline"
              >
                Open the week in {task.pluginName}
              </a>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

import { memo, useMemo } from "react";
import { RiAddLine, RiPlayFill, RiStopFill } from "@remixicon/react";
import { Value } from "@/components/ui/value";
import { getBacklogItemActions } from "@/domain/actions/object-actions";
import { selectSidebarBacklogItems } from "@/domain/backlog/backlog-item-lifecycle";
import { createSidebarMatcher } from "@/domain/backlog/sidebar-filter";
import { getWorkflowStateFills } from "@/domain/backlog/workflow-state-fill";
import {
  getLocalProjectDisplayName,
  type LocalWorkItem,
} from "@/domain/local-state";
import { formatCompactDuration } from "@/domain/time/duration";
import { findWorkItemTimer } from "@/domain/time/running-entry";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import { stateDotStyle } from "@/features/backlog/state-dot";
import { getWorkItemEntryValues } from "@/features/backlog/work-item-timer-comment";
import { TrackButton } from "@/features/layout/compact-timer-controls";
import type { TimeEntryEditorTarget } from "@/features/time/time-entry-editor-form";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { ProjectIcon } from "@/lib/project-icons";
import { openModifiedSourceClick } from "@/lib/source-navigation";
import { useSidebarLayout } from "@/lib/sidebar-layout";
import { useNow, useTodayIsoDate } from "@/lib/use-now";

export const PanelTasks = memo(function PanelTasks({
  query,
  onEdit,
  onOpenTask,
}: {
  query: string;
  onEdit: (target: TimeEntryEditorTarget) => void;
  onOpenTask: (id: string) => void;
}) {
  const state = useLocalState();
  const layout = useSidebarLayout();
  const now = useNow();
  const today = useTodayIsoDate();
  const items = useMemo(() => {
    const matcher = createSidebarMatcher(
      { query, projectId: layout.projectId, client: layout.client },
      state.projects,
    );
    return selectSidebarBacklogItems(state, now)
      .filter(matcher.workItem)
      .slice(0, 6);
  }, [state, now, query, layout.projectId, layout.client]);
  const fills = getWorkflowStateFills(state.workflowStates);

  function track(
    item: LocalWorkItem,
    kind: "timer" | "entry",
    expectedTimerId?: string,
  ) {
    const current = localStore
      .snapshot()
      .workItems.find((value) => value._id === item._id);
    if (!current) return;
    const active = findWorkItemTimer(localStore.snapshot().timers, current._id);
    if (kind === "timer" && expectedTimerId && active?._id !== expectedTimerId)
      return;
    const isRunning = Boolean(expectedTimerId);
    const action =
      kind === "entry" ? "new-entry" : isRunning ? "stop-entry" : "start-entry";
    const allowed = getBacklogItemActions(current, {
      isRunning,
      subitemCount: 0,
      isSubitem: Boolean(current.parentWorkItemId),
    }).find((value) => value.id === action);
    if (!allowed || allowed.disabledReason) return;
    if (kind === "entry")
      onEdit({
        kind: "create",
        localDate: today,
        initialValues: getWorkItemEntryValues(current),
      });
    else runBacklogItemAction(current, action, () => {});
  }

  return (
    <ul aria-label="Sidebar tasks" className="m-0 list-none px-1 py-1">
      {items.map((item) => {
        const project = state.projects.find(
          (value) => value._id === item.projectId,
        );
        const workflow = state.workflowStates.find(
          (value) => value._id === item.workflowStateId,
        );
        const timer = findWorkItemTimer(state.timers, item._id);
        const running = Boolean(timer);
        return (
          <li
            key={item._id}
            className="relative flex h-20 items-center gap-1 rounded-md px-2 focus-within:bg-foreground/5 hover:bg-foreground/5"
          >
            <a
              href={`/backlog/${encodeURIComponent(item._id)}`}
              className="min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={item.title}
              onClick={(event) => {
                if (openModifiedSourceClick(event, item.sourceUrl)) return;
                event.preventDefault();
                onOpenTask(item._id);
              }}
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {project ? (
                  <ProjectIcon
                    icon={project.icon}
                    color={project.color}
                    className="size-3 shrink-0"
                  />
                ) : null}
                <span className="truncate">
                  {project ? getLocalProjectDisplayName(project) : "No project"}
                </span>
              </span>
              <span className="mt-1 block truncate text-sm font-medium">
                {item.title}
              </span>
              <span className="mt-1 flex h-4 items-center gap-1.5 text-xs text-muted-foreground">
                {workflow ? (
                  <>
                    <span
                      className="backlog-state-dot size-2.5"
                      style={stateDotStyle(
                        workflow.color,
                        fills.get(workflow._id),
                      )}
                    />
                    {workflow.name}
                  </>
                ) : null}
              </span>
            </a>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Value tone="muted" className="h-4">
                {item.remainingEstimateHours === undefined
                  ? ""
                  : formatCompactDuration(
                      item.remainingEstimateHours * 3_600_000,
                    )}
              </Value>
              <div className="flex">
                <TrackButton
                  label="Add time"
                  onClick={() => track(item, "entry")}
                >
                  <RiAddLine />
                </TrackButton>
                <TrackButton
                  label={running ? "Stop timer" : "Start timer"}
                  onClick={() => track(item, "timer", timer?._id)}
                >
                  {running ? <RiStopFill /> : <RiPlayFill />}
                </TrackButton>
              </div>
            </div>
          </li>
        );
      })}
      {!items.length ? (
        <li className="px-2 py-6 text-xs text-muted-foreground">
          {query ? "No matching tasks." : "No tasks in your sidebar."}
        </li>
      ) : null}
    </ul>
  );
});

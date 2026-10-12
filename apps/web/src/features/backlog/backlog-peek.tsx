import {
  RiCloseLine,
  RiExternalLinkLine,
  RiPencilLine,
  RiPlayLine,
} from "@remixicon/react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { TooltipButton } from "@/components/tooltip-button";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getDirectChildWorkItems } from "@/domain/backlog/work-item-hierarchy";
import {
  getLocalProjectDisplayName,
  type LocalAppState,
  type LocalWorkItem,
} from "@/domain/local-state";
import type { BacklogItemActionId } from "@/domain/actions/object-actions";
import {
  BacklogPriorityPicker,
  BacklogStatePicker,
  getBacklogSurfaceActions,
  patchBacklogItemWithUndo,
} from "@/features/backlog/backlog-item-surface";
import {
  changeSourceStateWithUndo,
  getOtherSourceStates,
} from "@/features/backlog/backlog-item-moves";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";

export function BacklogPeek({
  item,
  state,
  now,
  onClose,
  onOpen,
  onAction,
  onSelect,
}: {
  item: LocalWorkItem;
  state: LocalAppState;
  now: number;
  onClose: () => void;
  onOpen: () => void;
  onAction: (action: BacklogItemActionId) => void;
  onSelect: (item: LocalWorkItem) => void;
}) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !document.querySelector(
          '[data-slot="dropdown-menu-content"], [data-slot="popover-content"], [role="dialog"]',
        )
      ) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const project = state.projects.find((p) => p._id === item.projectId);
  const actions = getBacklogSurfaceActions(item, state, now);
  const startAction = actions.find((action) => action.id === "start-entry");
  const children = getDirectChildWorkItems(item, state.workItems);
  const reference = parseWorkItemReference(item.sourceId) ?? item.sourceId;
  return (
    <div className="backlog-peek" aria-label={`Peek ${item.title}`}>
      <div className="flex items-center justify-between gap-2 border-b p-4">
        <span className="truncate text-xs text-muted-foreground">
          {[item.sourceWorkItemType, reference].filter(Boolean).join(" · ") ||
            "Backlog item"}
        </span>
        <div className="flex items-center gap-1">
          <ObjectActionsButton
            label={`Actions for ${item.title}`}
            actions={actions}
            onAction={onAction}
          />
          <TooltipButton
            label="Close peek"
            render={<Button variant="ghost" size="icon-sm" />}
            onClick={onClose}
          >
            <RiCloseLine className="size-4" />
          </TooltipButton>
        </div>
      </div>
      <div className="space-y-5 p-4">
        <h2 className="text-base leading-6 font-semibold">{item.title}</h2>
        <div className="flex flex-wrap gap-2">
          {item.status !== "archived" && (
            <Button
              size="sm"
              disabled={Boolean(startAction?.disabledReason)}
              onClick={() => onAction("start-entry")}
            >
              <RiPlayLine className="size-4" />
              Start entry
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onOpen}>
            <RiExternalLinkLine className="size-4" />
            Open page
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={item.status === "archived"}
            onClick={() => onAction("edit")}
          >
            <RiPencilLine className="size-4" />
            Edit
          </Button>
        </div>
        <dl className="backlog-peek-properties">
          <dt>State</dt>
          <dd>
            <BacklogStatePicker item={item} state={state} full />
          </dd>
          {item.sourceStatusLabel && (
            <>
              <dt>Source state</dt>
              <dd>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Change source state of ${item.title}`}
                  disabled={getOtherSourceStates(item).length === 0}
                  onClick={() => void changeSourceStateWithUndo(item)}
                >
                  {item.sourceStatusLabel}
                </Button>
              </dd>
            </>
          )}
          <dt>Priority</dt>
          <dd>
            <BacklogPriorityPicker item={item} full />
          </dd>
          <dt>Lifecycle</dt>
          <dd className="capitalize">
            {item.status}
            {item.status === "settled" && item.settledAt
              ? ` · ${new Date(item.settledAt).toLocaleDateString()}`
              : ""}
          </dd>
          <dt>Project</dt>
          <dd>
            <SearchableSelect
              value={item.projectId ?? ""}
              options={state.projects
                .filter(
                  (p) => p.status === "active" || p._id === item.projectId,
                )
                .map((p) => ({
                  value: p._id,
                  label: getLocalProjectDisplayName(p),
                }))}
              placeholder="No project"
              emptyMessage="No projects"
              ariaLabel="Peek project"
              clearLabel="No project"
              onChange={(value) =>
                patchBacklogItemWithUndo(
                  item,
                  { projectId: value || undefined, taskId: undefined },
                  "Project changed",
                )
              }
            />
          </dd>
          <dt>Task</dt>
          <dd>
            <SearchableSelect
              value={item.taskId ?? ""}
              options={(project?.tasks ?? [])
                .filter((t) => t.status === "active" || t._id === item.taskId)
                .map((t) => ({ value: t._id, label: t.name }))}
              placeholder="No task"
              emptyMessage="No tasks"
              ariaLabel="Peek task"
              clearLabel="No task"
              disabled={!project}
              onChange={(value) =>
                patchBacklogItemWithUndo(
                  item,
                  { taskId: value || undefined },
                  "Task changed",
                )
              }
            />
          </dd>
          {(
            [
              ["Original estimate", item.originalEstimateHours],
              ["Remaining estimate", item.remainingEstimateHours],
              ["Completed estimate", item.completedEstimateHours],
            ] as const
          ).map(([label, value]) => (
            <div className="contents" key={label}>
              <dt>{label}</dt>
              <dd>{value === undefined ? "No estimate" : `${value}h`}</dd>
            </div>
          ))}
        </dl>
        {item.note && (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {item.note}
          </p>
        )}
        {children.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold">
              Subitems ·{" "}
              {children.filter((i) => i.status === "archived").length}/
              {children.length}
            </h3>
            <div className="space-y-1">
              {children.map((child) => (
                <Button
                  key={child._id}
                  variant="ghost"
                  className="h-auto w-full justify-start py-2 text-left text-xs"
                  onClick={() => onSelect(child)}
                >
                  <span className="line-clamp-2">{child.title}</span>
                </Button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

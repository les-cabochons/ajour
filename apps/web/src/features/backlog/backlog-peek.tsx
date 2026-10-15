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
import { Markdown } from "@/components/markdown";
import { PropertyList, PropertyRow } from "@/components/property-list";
import { SectionHeading } from "@/components/section-heading";
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
      <div className="flex h-11 items-center justify-between gap-2 border-b px-4">
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
            render={<Button variant="ghost" size="icon" />}
            onClick={onClose}
          >
            <RiCloseLine className="size-4" />
          </TooltipButton>
        </div>
      </div>
      <div className="space-y-5 p-4">
        <h2 className="text-lg leading-6 font-semibold">{item.title}</h2>
        <div className="flex flex-wrap gap-2">
          {item.status !== "archived" && (
            <TooltipButton
              label={
                startAction?.disabledReason
                  ? `Start entry. ${startAction.disabledReason}`
                  : "Start entry"
              }
              aria-label="Start entry"
              aria-description={startAction?.disabledReason}
              aria-disabled={Boolean(startAction?.disabledReason)}
              render={<Button className="aria-disabled:opacity-50" />}
              onClick={() => {
                if (!startAction?.disabledReason) onAction("start-entry");
              }}
            >
              <RiPlayLine className="size-4" />
              Start entry
            </TooltipButton>
          )}
          <Button variant="outline" onClick={onOpen}>
            <RiExternalLinkLine className="size-4" />
            Open page
          </Button>
          <Button
            variant="ghost"

            disabled={item.status === "archived"}
            onClick={() => onAction("edit")}
          >
            <RiPencilLine className="size-4" />
            Edit
          </Button>
        </div>
        <PropertyList>
          <PropertyRow label="State">
            <BacklogStatePicker item={item} state={state} full />
          </PropertyRow>
          {item.sourceStatusLabel && (
            <PropertyRow label="Source state">
              <Button
                variant="ghost"
                aria-label={`Change source state of ${item.title}`}
                disabled={getOtherSourceStates(item).length === 0}
                onClick={() => void changeSourceStateWithUndo(item)}
              >
                {item.sourceStatusLabel}
              </Button>
            </PropertyRow>
          )}
          <PropertyRow label="Priority">
            <BacklogPriorityPicker item={item} full />
          </PropertyRow>
          <PropertyRow label="Lifecycle">
            <span className="capitalize">
              {item.status}
              {item.status === "settled" && item.settledAt
                ? ` · ${new Date(item.settledAt).toLocaleDateString()}`
                : ""}
            </span>
          </PropertyRow>
          <PropertyRow label="Project">
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
              onChange={(value) => {
                if (value === (item.projectId ?? "")) return;
                patchBacklogItemWithUndo(
                  item,
                  { projectId: value || undefined, taskId: undefined },
                  "Project changed",
                );
              }}
            />
          </PropertyRow>
          <PropertyRow label="Task">
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
          </PropertyRow>
          {(
            [
              ["Original estimate", item.originalEstimateHours],
              ["Remaining estimate", item.remainingEstimateHours],
              ["Completed estimate", item.completedEstimateHours],
            ] as const
          ).map(([label, value]) => (
            <PropertyRow key={label} label={label}>
              <span
                className={
                  value === undefined
                    ? "text-muted-foreground"
                    : "font-mono text-xs"
                }
              >
                {value === undefined ? "No estimate" : `${value}h`}
              </span>
            </PropertyRow>
          ))}
        </PropertyList>
        {item.note && (
          <Markdown className="text-muted-foreground">{item.note}</Markdown>
        )}
        {children.length > 0 && (
          <section>
            <SectionHeading
              trailing={`${children.filter((i) => i.status === "archived").length}/${children.length}`}
            >
              Subitems
            </SectionHeading>
            <div className="backlog-item-rows">
              {children.map((child) => (
                <button
                  key={child._id}
                  type="button"
                  className="backlog-item-row text-left"
                  onClick={() => onSelect(child)}
                >
                  <span className="backlog-item-row-title">{child.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

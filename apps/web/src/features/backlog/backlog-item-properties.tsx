import type { ReactNode } from "react";
import { PropertyList, PropertyRow } from "@/components/property-list";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getLocalProjectDisplayName,
  type LocalAppState,
  type LocalWorkItem,
} from "@/domain/local-state";
import {
  BacklogPriorityPicker,
  BacklogStatePicker,
  patchBacklogItemWithUndo,
} from "@/features/backlog/backlog-item-surface";
import {
  changeSourceStateWithUndo,
  getOtherSourceStates,
} from "@/features/backlog/backlog-item-moves";

/**
 * A backlog item's properties, each changed in place with Undo: state, source
 * state, priority, project and task. The peek and the item page show the same
 * rows; `children` adds rows after them.
 */
export function BacklogItemProperties({
  item,
  state,
  children,
}: {
  item: LocalWorkItem;
  state: LocalAppState;
  children?: ReactNode;
}) {
  const project = state.projects.find((p) => p._id === item.projectId);
  return (
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
        <span className="capitalize">{item.status}</span>
      </PropertyRow>
      <PropertyRow label="Project">
        <SearchableSelect
          value={item.projectId ?? ""}
          options={state.projects
            .filter((p) => p.status === "active" || p._id === item.projectId)
            .map((p) => ({
              value: p._id,
              label: getLocalProjectDisplayName(p),
            }))}
          placeholder="No project"
          emptyMessage="No projects"
          ariaLabel="Project"
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
          ariaLabel="Task"
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
      {children}
    </PropertyList>
  );
}

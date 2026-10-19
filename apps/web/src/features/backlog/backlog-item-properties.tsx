import { useMemo, type ReactNode } from "react";
import { PropertyList, PropertyRow } from "@/components/property-list";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { getTimelogMismatch } from "@/domain/backlog/description-timelog";
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
import {
  FrontmatterRows,
  FrontmatterSections,
  useFrontmatterFields,
} from "@/features/backlog/frontmatter-properties";
import { useLinkQuestion } from "@/features/backlog/description-links";
import { TimelogButton } from "@/features/backlog/timelog-button";

/** Project and task lists outgrow their narrow fields, so names fit. */
const LONG_NAME_LIST_WIDTH = 320;

/**
 * A backlog item's properties, each changed in place with Undo: state, source
 * state, priority, project and task, then the "Keep when missing from sync"
 * switch for synced items. The peek and the item page show the same rows;
 * `children` adds rows before the switch. The description's frontmatter
 * follows: plain values as rows, lists and nested keys as sections. A button
 * after Project offers the description's timelog while the item's project or
 * task differs from it.
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
  const { description, projectId, taskId } = item;
  const timelogMismatch = useMemo(
    () =>
      getTimelogMismatch(state.projects, { description, projectId, taskId }),
    [state.projects, description, projectId, taskId],
  );
  const frontmatterFields = useFrontmatterFields(description);
  // One question for every frontmatter link in the card.
  const linkQuestion = useLinkQuestion();
  return (
    <div className="flex flex-col gap-3">
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
            popoverMinWidth={LONG_NAME_LIST_WIDTH}
            onChange={(value) => {
              if (value === (item.projectId ?? "")) return;
              patchBacklogItemWithUndo(
                item,
                { projectId: value || undefined, taskId: undefined },
                "Project changed",
              );
            }}
          />
          {timelogMismatch && item.status !== "archived" ? (
            <TimelogButton workItemId={item._id} mismatch={timelogMismatch} />
          ) : null}
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
            popoverMinWidth={LONG_NAME_LIST_WIDTH}
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
        <FrontmatterRows
          fields={frontmatterFields}
          onLinkClick={linkQuestion.ask}
        />
      </PropertyList>
      <FrontmatterSections
        fields={frontmatterFields}
        onLinkClick={linkQuestion.ask}
      />
      {linkQuestion.dialog}
      {item.source !== "manual" ? (
        <label className="flex items-center gap-2.5 border-t pt-3 text-sm">
          <Switch
            size="sm"
            checked={item.keepWhenMissingFromSync ?? false}
            // An archived item is read-only until Restore.
            disabled={item.status === "archived"}
            onCheckedChange={(keepWhenMissingFromSync) =>
              patchBacklogItemWithUndo(
                item,
                { keepWhenMissingFromSync },
                keepWhenMissingFromSync
                  ? "Kept when missing from sync"
                  : "Archived when missing from sync",
              )
            }
          />
          Keep when missing from sync
        </label>
      ) : null}
    </div>
  );
}

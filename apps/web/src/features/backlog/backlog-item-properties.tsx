import { useMemo, type ReactNode } from "react";
import { PropertyList, PropertyRow } from "@/components/property-list";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { PickerChevron } from "@/components/picker-chevron";
import { BacklogItemSourceSection } from "@/features/backlog/backlog-item-source-section";
import { useLinkQuestion } from "@/features/backlog/description-links";
import {
  FrontmatterRows,
  FrontmatterSections,
  useFrontmatterFields,
} from "@/features/backlog/frontmatter-properties";
import { TimelogButton } from "@/features/backlog/timelog-button";
import {
  createTaskFromPicker,
  describeCreateTaskRow,
} from "@/features/projects/task-creation";
import { localStore } from "@/lib/local-store";

/** Project and task lists outgrow their narrow fields, so names fit. */
const LONG_NAME_LIST_WIDTH = 320;

/**
 * A backlog item's properties, each changed in place with Undo: state,
 * priority, project and task, then Missing from sync for synced items. The
 * peek and the item page show the same rows; `children` adds rows before
 * Missing from sync. The description's frontmatter follows: plain values as
 * rows, then the source section of a synced item (#653) and the frontmatter's
 * lists and nested keys as sections. A button after Project offers the
 * description's timelog while the item's project or task differs from it.
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
      getTimelogMismatch(
        state.projects,
        { description, projectId, taskId },
        state.projectSources,
      ),
    [state.projects, state.projectSources, description, projectId, taskId],
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
            placeholder="Pick a project"
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
            placeholder={project ? "Pick a task" : "Pick a project first"}
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
            create={
              project
                ? {
                    label: (text) => describeCreateTaskRow(project, text),
                    // The item saves at once, so one Undo takes back both.
                    onCreate: (text) =>
                      void createTaskFromPicker({
                        projectId: project._id,
                        name: text,
                        oneUndo: { workItemId: item._id },
                        onCreated: (taskId) =>
                          localStore.updateWorkItemWithUndo(item._id, {
                            taskId,
                          }),
                      }),
                  }
                : undefined
            }
          />
        </PropertyRow>
        {children}
        {item.source !== "manual" ? (
          <PropertyRow label="Missing from sync">
            <MissingFromSyncPicker item={item} />
          </PropertyRow>
        ) : null}
        <FrontmatterRows
          fields={frontmatterFields}
          onLinkClick={linkQuestion.ask}
        />
      </PropertyList>
      <BacklogItemSourceSection item={item} />
      <FrontmatterSections
        fields={frontmatterFields}
        onLinkClick={linkQuestion.ask}
      />
      {linkQuestion.dialog}
    </div>
  );
}

/**
 * What an automatic sync does with the item once it stops coming back, for
 * example after it is reassigned: archive it, the default, or keep it.
 */
function MissingFromSyncPicker({ item }: { item: LocalWorkItem }) {
  const keep = item.keepWhenMissingFromSync ?? false;
  // Says what happens, so it never reads as the Archive command below it.
  const label = keep ? "Keep in backlog" : "Archive automatically";
  // The value column is narrow: the short form shows, the menu says it all.
  const shown = keep ? "Keep" : "Auto-archive";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="property-picker min-w-0 justify-start"
            // An archived item is read-only until Restore.
            disabled={item.status === "archived"}
            aria-label={`Missing from sync: ${label}`}
          />
        }
      >
        <span className="min-w-0 truncate">{shown}</span>
        <PickerChevron />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Missing from sync</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={keep ? "keep" : "archive"}
            onValueChange={(value) => {
              const keepWhenMissingFromSync = value === "keep";
              if (keepWhenMissingFromSync === keep) return;
              patchBacklogItemWithUndo(
                item,
                { keepWhenMissingFromSync },
                keepWhenMissingFromSync
                  ? "Kept when missing from sync"
                  : "Archived when missing from sync",
              );
            }}
          >
            <DropdownMenuRadioItem value="archive" closeOnClick>
              Archive automatically
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="keep" closeOnClick>
              Keep in backlog
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

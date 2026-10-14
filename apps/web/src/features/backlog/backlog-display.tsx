import {
  RiListCheck,
  RiLayoutColumnLine,
  RiEqualizerLine,
  RiFilterLine,
  RiCloseLine,
} from "@remixicon/react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OptionSelect } from "@/components/ui/option-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  BACKLOG_ORDERINGS,
  type BacklogFilterField,
  type BacklogProperty,
} from "@/domain/backlog/backlog-view";
import { PRIORITY_LEVELS } from "@/domain/backlog/priority";
import {
  getLocalProjectDisplayName,
  type BacklogSortMode,
  type LocalAppState,
} from "@/domain/local-state";
import {
  updateBacklogView,
  type BacklogViewPreferences,
} from "@/lib/backlog-view-settings";
import { localStore } from "@/lib/local-store";

function Option({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="w-40">{children}</span>
    </div>
  );
}

/** A 28px select for the popover's options. */
export function BacklogLayoutToggle({
  view,
}: {
  view: BacklogViewPreferences;
}) {
  return (
    <ToggleGroup
      value={[view.layout]}
      onValueChange={(values) => {
        const layout = values[0];
        if (layout === "list" || layout === "board")
          updateBacklogView({ layout });
      }}
      aria-label="Backlog layout"
    >
      <ToggleGroupItem value="list" aria-label="List layout">
        <RiListCheck className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="board" aria-label="Board layout">
        <RiLayoutColumnLine className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
export function BacklogDisplay({
  view,
  ordering,
  narrow,
}: {
  view: BacklogViewPreferences;
  ordering: BacklogSortMode;
  narrow: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" />}>
        <RiEqualizerLine className="size-4" />
        Display
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 gap-3 rounded-lg"
        aria-label="Backlog display options"
      >
        {!narrow && (
          <Option label="Layout">
            <BacklogLayoutToggle view={view} />
          </Option>
        )}
        <Option label="Grouping">
          <OptionSelect<BacklogViewPreferences["grouping"]>
            label="Grouping"
            value={
              !narrow && view.layout === "board" && view.grouping === "none"
                ? "state"
                : view.grouping
            }
            onChange={(grouping) => updateBacklogView({ grouping })}
            options={[
              { value: "state", label: "Workflow state" },
              { value: "priority", label: "Priority" },
              { value: "project", label: "Project" },
              ...(narrow || view.layout === "list"
                ? [{ value: "none" as const, label: "None" }]
                : []),
            ]}
          />
        </Option>
        {!narrow && view.layout === "board" && view.grouping !== "project" && (
          <Option label="Swimlanes">
            <OptionSelect<"none" | "project">
              label="Swimlanes"
              value={view.swimlanes}
              onChange={(swimlanes) => updateBacklogView({ swimlanes })}
              options={[
                { value: "none", label: "None" },
                { value: "project", label: "Project" },
              ]}
            />
          </Option>
        )}
        <Option label="Ordering">
          <OptionSelect<BacklogSortMode>
            label="Ordering"
            value={ordering}
            onChange={(mode) => localStore.setBacklogSortMode(mode)}
            options={[
              ...BACKLOG_ORDERINGS.map((o) => ({
                value: o.value as BacklogSortMode,
                label: o.label,
              })),
              ...(ordering === "priority_desc"
                ? [
                    {
                      value: "priority_desc" as BacklogSortMode,
                      label: "Priority descending",
                    },
                  ]
                : []),
            ]}
          />
        </Option>
        <Option label="Done items">
          <OptionSelect<BacklogViewPreferences["doneWindow"]>
            label="Done items"
            value={view.doneWindow}
            onChange={(doneWindow) => updateBacklogView({ doneWindow })}
            options={[
              { value: "week", label: "Past week" },
              { value: "all", label: "All" },
              { value: "none", label: "None" },
            ]}
          />
        </Option>
        <div className="flex flex-col gap-3 border-t pt-3">
          {(
            [
              ["showSettled", "Show settled items"],
              ["showSubitems", "Show subitems"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={view[key]}
                onCheckedChange={(checked) =>
                  updateBacklogView({ [key]: checked })
                }
              />
              {label}
            </label>
          ))}
        </div>
        <fieldset className="border-t pt-3">
          <legend className="text-xs text-muted-foreground">
            Display properties
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {(
              Object.entries({
                id: "ID",
                priority: "Priority",
                project: "Project",
                estimate: "Estimate",
                sourceState: "Source state",
              }) as [BacklogProperty, string][]
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={view.properties[key]}
                  onCheckedChange={(checked) =>
                    updateBacklogView({
                      properties: { ...view.properties, [key]: checked },
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
const FIELDS: Record<BacklogFilterField, string> = {
  state: "State",
  priority: "Priority",
  project: "Project",
  task: "Task",
  sourceProject: "Source project",
  connection: "Connection",
  type: "Type",
  hasEstimate: "Has estimate",
  running: "Running",
};
export function getBacklogFilterOptions(
  state: LocalAppState,
  field: BacklogFilterField,
) {
  const unique = (values: { value: string; label: string }[]) => [
    ...new Map(values.map((option) => [option.value, option])).values(),
  ];
  switch (field) {
    case "state":
      return [
        { value: "", label: "No state" },
        ...state.workflowStates.map((s) => ({ value: s._id, label: s.name })),
      ];
    case "priority":
      return [
        { value: "", label: "No priority" },
        ...PRIORITY_LEVELS.map((p) => ({
          value: String(p.level),
          label: p.name,
        })),
      ];
    case "project":
      return [
        { value: "", label: "No project" },
        ...state.projects.map((p) => ({
          value: p._id,
          label: getLocalProjectDisplayName(p),
        })),
      ];
    case "task":
      return [
        { value: "", label: "No task" },
        ...state.projects.flatMap((p) =>
          p.tasks.map((t) => ({
            value: t._id,
            label: `${getLocalProjectDisplayName(p)} / ${t.name}`,
          })),
        ),
      ];
    case "sourceProject":
      return unique(
        state.workItems
          .filter((i) => i.sourceProjectName)
          .map((i) => ({
            value: i.sourceProjectName!,
            label: i.sourceProjectName!,
          })),
      );
    case "connection":
      return unique(
        state.workItems
          .filter((i) => i.sourceConnectionId)
          .map((i) => ({
            value: i.sourceConnectionId!,
            label: i.sourceConnectionLabel ?? i.sourceConnectionId!,
          })),
      );
    case "type":
      return unique(
        state.workItems
          .filter((i) => i.sourceWorkItemType)
          .map((i) => ({
            value: i.sourceWorkItemType!,
            label: i.sourceWorkItemType!,
          })),
      );
    default:
      return [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ];
  }
}
export function BacklogFilters({
  state,
  view,
}: {
  state: LocalAppState;
  view: BacklogViewPreferences;
}) {
  const [field, setField] = useState<BacklogFilterField>("state");
  const [open, setOpen] = useState(false);
  const options = getBacklogFilterOptions(state, field);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="ghost" />}>
          <RiFilterLine className="size-4" />
          Filter
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="gap-3 rounded-lg"
          aria-label="Add backlog filter"
        >
          <OptionSelect<BacklogFilterField>
            label="Filter property"
            value={field}
            onChange={setField}
            options={(
              Object.entries(FIELDS) as [BacklogFilterField, string][]
            ).map(([value, label]) => ({ value, label }))}
          />
          <SearchableSelect
            value=""
            options={options.map((option) => ({
              ...option,
              value: JSON.stringify(option.value),
            }))}
            ariaLabel="Filter value"
            placeholder="Choose a value"
            emptyMessage="No values"
            onChange={(encoded) => {
              const value = JSON.parse(encoded) as string;
              if (
                !view.filters.some(
                  (f) => f.field === field && f.value === value,
                )
              )
                updateBacklogView({
                  filters: [...view.filters, { field, value }],
                });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {view.filters.map((filter, index) => {
        const label =
          getBacklogFilterOptions(state, filter.field).find(
            (o) => o.value === filter.value,
          )?.label ?? filter.value;
        return (
          <Button
            key={`${filter.field}:${filter.value}`}
            variant="outline"

            size="sm"
            onClick={() =>
              updateBacklogView({
                filters: view.filters.filter((_, i) => i !== index),
              })
            }
            aria-label={`Remove filter ${FIELDS[filter.field]}: ${label}`}
          >
            {FIELDS[filter.field]} · {label}
            <RiCloseLine className="size-3" />
          </Button>
        );
      })}
      {view.filters.length > 1 && (
        <Button
          variant="ghost"

          onClick={() => updateBacklogView({ filters: [] })}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

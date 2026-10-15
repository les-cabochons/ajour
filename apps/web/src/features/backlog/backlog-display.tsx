import {
  RiListCheck,
  RiLayoutColumnLine,
  RiEqualizerLine,
  RiFilter3Line,
  RiCloseLine,
  RiArrowLeftLine,
} from "@remixicon/react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ARCHIVED_STATE_FILTER,
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
        { value: ARCHIVED_STATE_FILTER, label: "Archived" },
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
/** Checkable values of one field. Picking one toggles its filter. */
function FilterValueList({
  state,
  view,
  field,
}: {
  state: LocalAppState;
  view: BacklogViewPreferences;
  field: BacklogFilterField;
}) {
  return (
    <Command
      className="rounded-none bg-transparent p-0"
      filter={(_value, search, keywords = []) =>
        keywords.join(" ").toLowerCase().includes(search.toLowerCase()) ? 1 : 0
      }
    >
      <CommandInput
        autoFocus
        aria-label={`${FIELDS[field]} values`}
        placeholder={`Search ${FIELDS[field].toLowerCase()}...`}
      />
      <CommandList className="max-h-[min(18rem,45vh)] p-1">
        <CommandEmpty>No values</CommandEmpty>
        {getBacklogFilterOptions(state, field).map((option) => {
          const active = view.filters.some(
            (f) => f.field === field && f.value === option.value,
          );
          return (
            <CommandItem
              key={option.value}
              // cmdk needs a non-empty value; "" means "No state" and such.
              value={JSON.stringify(option.value)}
              keywords={[option.label]}
              data-checked={active ? "true" : undefined}
              onSelect={() =>
                updateBacklogView({
                  filters: active
                    ? view.filters.filter(
                        (f) => f.field !== field || f.value !== option.value,
                      )
                    : [...view.filters, { field, value: option.value }],
                })
              }
            >
              {option.label}
            </CommandItem>
          );
        })}
      </CommandList>
    </Command>
  );
}

/**
 * The filter row: a Filter button that lists the fields, then one chip per
 * filtered field. A chip names its values, opens them for editing, and its ×
 * removes every value of the field. Values stay open while the user picks, so
 * several values and fields add up in one visit.
 */
export function BacklogFilters({
  state,
  view,
}: {
  state: LocalAppState;
  view: BacklogViewPreferences;
}) {
  const [field, setField] = useState<BacklogFilterField | null>(null);
  const fields = [...new Set(view.filters.map((filter) => filter.field))];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover onOpenChange={(open) => !open && setField(null)}>
        <PopoverTrigger render={<Button variant="ghost" />}>
          <RiFilter3Line className="size-4" />
          Filter
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64 gap-0 overflow-hidden p-0"
          aria-label="Add backlog filter"
        >
          {field ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="m-1 self-start text-muted-foreground"
                onClick={() => setField(null)}
              >
                <RiArrowLeftLine data-icon="inline-start" />
                {FIELDS[field]}
              </Button>
              <FilterValueList state={state} view={view} field={field} />
            </>
          ) : (
            <Command className="rounded-none bg-transparent p-0">
              <CommandInput autoFocus placeholder="Filter by..." />
              <CommandList className="max-h-[min(18rem,45vh)] p-1">
                <CommandEmpty>No fields</CommandEmpty>
                {(Object.entries(FIELDS) as [BacklogFilterField, string][]).map(
                  ([value, label]) => (
                    <CommandItem
                      key={value}
                      value={value}
                      keywords={[label]}
                      onSelect={() => setField(value)}
                    >
                      {label}
                    </CommandItem>
                  ),
                )}
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
      {fields.map((chipField) => {
        const options = getBacklogFilterOptions(state, chipField);
        const values = view.filters
          .filter((filter) => filter.field === chipField)
          .map(
            (filter) =>
              options.find((o) => o.value === filter.value)?.label ??
              filter.value,
          )
          .join(", ");
        return (
          <span key={chipField} className="backlog-filter-chip">
            <Popover>
              <PopoverTrigger
                render={<Button variant="ghost" size="sm" />}
                aria-label={`Edit ${FIELDS[chipField]} filter`}
              >
                <span className="text-muted-foreground">
                  {FIELDS[chipField]}
                </span>
                <span className="max-w-60 truncate">{values}</span>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-64 gap-0 overflow-hidden p-0"
                aria-label={`${FIELDS[chipField]} filter`}
              >
                <FilterValueList state={state} view={view} field={chipField} />
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${FIELDS[chipField]} filter`}
              onClick={() =>
                updateBacklogView({
                  filters: view.filters.filter((f) => f.field !== chipField),
                })
              }
            >
              <RiCloseLine />
            </Button>
          </span>
        );
      })}
      {fields.length > 1 && (
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

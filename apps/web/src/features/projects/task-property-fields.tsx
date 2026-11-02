import { useEffect, useId, useState } from "react";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { OptionSelect, type SelectOption } from "@/components/ui/option-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { LocalProjectTask, TaskCommitAs } from "@/domain/local-state";
import {
  applyCommitsAsChoice,
  getCommitsAsChoice,
  getMappedTaskName,
  getTaskNameField,
  PLUGIN_PROPERTY_MAX_LENGTH,
  resolveTaskPluginProperties,
  setPluginPropertyDraft,
  type CommitsAsChoice,
  type PluginProperties,
  type TaskPropertyPlugin,
} from "@/domain/projects/plugin-properties";
import { listTaskPropertyPlugins } from "@/lib/plugin-project-properties";

/**
 * The active plugins that add task properties, loaded once. Empty while
 * they load, when the overview fails and without the local API.
 */
export function useTaskPropertyPlugins(): TaskPropertyPlugin[] {
  const [plugins, setPlugins] = useState<TaskPropertyPlugin[]>([]);
  useEffect(() => {
    let active = true;
    void listTaskPropertyPlugins()
      .then((next) => active && setPlugins(next))
      // The overview call's own event records the failure.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return plugins;
}

const COMMITS_AS_OPTIONS: SelectOption<CommitsAsChoice>[] = [
  { value: "own", label: "Its own name" },
  { value: "another", label: "Another task…" },
  { value: "waiting", label: "Not known yet" },
  { value: "local", label: "Local only" },
];

/** What the plugin sections change on the task draft. */
export type TaskPropertyPatch = Pick<
  LocalProjectTask,
  "commitAs" | "pluginProperties"
>;

/**
 * One section per plugin that adds task properties, below the task
 * editor's own fields. A field that defaults to the task's name becomes
 * Commits as: Its own name, Another task… (one of the project's other
 * tasks, picked under it), Not known yet or Local only. In a Local only
 * project it only says so. Other fields are plain text.
 */
export function TaskPropertyFields({
  plugins,
  taskName,
  otherTaskNames,
  pluginProperties,
  commitAs,
  projectLocalOnly = false,
  onChange,
}: {
  plugins: TaskPropertyPlugin[];
  /** The name in the draft, the default of a field that defaults to it. */
  taskName: string;
  /** The names of the project's other active tasks, in list order. */
  otherTaskNames: string[];
  pluginProperties: PluginProperties | undefined;
  commitAs: TaskCommitAs | undefined;
  /** The project is Local only, so its tasks are never committed. */
  projectLocalOnly?: boolean;
  onChange: (patch: Partial<TaskPropertyPatch>) => void;
}) {
  const idPrefix = useId();
  // Another task… with no task picked yet reads back as Its own name, so the
  // section remembers the pick until a task is chosen or the choice changes.
  const [pickingAnother, setPickingAnother] = useState<string[]>([]);
  return plugins.map((plugin) => (
    // A plain border on the fieldset would draw through its legend.
    <div key={plugin.pluginId} className="border-t border-border pt-4">
      <FieldSet className="gap-4">
        <FieldLegend variant="label" className="text-xs text-muted-foreground">
          {plugin.capability.section}
        </FieldLegend>
        {resolveTaskPluginProperties(
          { name: taskName.trim(), pluginProperties },
          plugin,
        ).map(({ field, value, defaultValue, isDefault }) => {
          const id = `${idPrefix}-${plugin.pluginId}-${field.id}`;
          if (field.defaultFrom === "name") {
            if (projectLocalOnly) {
              return (
                <Field key={field.id}>
                  <FieldLabel>Commits as</FieldLabel>
                  <FieldDescription>
                    The project is local only, so this task is never committed.
                  </FieldDescription>
                </Field>
              );
            }
            const task = { name: taskName.trim(), pluginProperties, commitAs };
            const saved = getCommitsAsChoice(task, plugin);
            const choice =
              saved === "own" && pickingAnother.includes(plugin.pluginId)
                ? "another"
                : saved;
            const choose = (next: CommitsAsChoice, mappedName = "") => {
              setPickingAnother((current) =>
                next === "another"
                  ? [...new Set([...current, plugin.pluginId])]
                  : current.filter((id) => id !== plugin.pluginId),
              );
              onChange(applyCommitsAsChoice(task, plugin, next, mappedName));
            };
            return (
              <Field key={field.id}>
                <FieldLabel htmlFor={id}>Commits as</FieldLabel>
                <OptionSelect
                  id={id}
                  size="default"
                  value={choice}
                  options={COMMITS_AS_OPTIONS}
                  onChange={(next) => choose(next)}
                />
                {choice === "another" ? (
                  // The select names itself with ariaLabel, as in the backlog editor.
                  <SearchableSelect
                    value={isDefault ? "" : value}
                    options={taskNameOptions(
                      otherTaskNames,
                      isDefault ? "" : value,
                    )}
                    onChange={(name) => choose(name ? "another" : "own", name)}
                    placeholder="Pick a task"
                    emptyMessage="No matching tasks"
                    ariaLabel={field.label}
                  />
                ) : null}
                {field.helpText ? (
                  <FieldDescription>{field.helpText}</FieldDescription>
                ) : null}
              </Field>
            );
          }
          // The draft keeps text as typed; the editor trims it on save.
          const set = (next: string) =>
            onChange({
              pluginProperties: setPluginPropertyDraft(
                { pluginProperties },
                plugin.pluginId,
                field.id,
                next,
              ),
            });
          return (
            <Field key={field.id}>
              <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
              <Input
                id={id}
                value={isDefault ? "" : value}
                maxLength={PLUGIN_PROPERTY_MAX_LENGTH}
                placeholder={defaultValue || "None"}
                onChange={(event) => set(event.target.value)}
              />
              {field.helpText ? (
                <FieldDescription>{field.helpText}</FieldDescription>
              ) : null}
            </Field>
          );
        })}
      </FieldSet>
    </div>
  ));
}

/**
 * The project's other task names, plus the saved value when no task has it
 * any more, such as after a rename, so the field still shows it.
 */
function taskNameOptions(otherTaskNames: string[], saved: string) {
  const names = [...new Set(otherTaskNames)];
  if (saved && !names.includes(saved)) names.unshift(saved);
  return names.map((name) => ({ value: name, label: name }));
}

/**
 * What a task commits as, after its name in the task list: "Not known yet"
 * in amber, "Local" for a Local only task, or "→ 07 Run" for each plugin
 * whose tool knows the task by another name. Screen readers hear the
 * field's label instead of the arrow, such as "Workday task: 07 Run". A
 * Local only project's tasks show nothing, since the project says it.
 */
export function TaskMappingHints({
  task,
  plugins,
  projectLocalOnly = false,
}: {
  task: Pick<LocalProjectTask, "name" | "pluginProperties" | "commitAs">;
  plugins: TaskPropertyPlugin[];
  projectLocalOnly?: boolean;
}) {
  if (projectLocalOnly) return null;
  if (task.commitAs === "waiting") {
    return <Chip tone="warning">Not known yet</Chip>;
  }
  if (task.commitAs === "local") return <Chip>Local</Chip>;
  return plugins.map((plugin) => {
    const name = getMappedTaskName(task, plugin);
    if (!name) return null;
    const label = getTaskNameField(plugin)?.label ?? plugin.capability.section;
    return (
      <span
        key={plugin.pluginId}
        className="project-task-mapping"
        title={`${label}: ${name}`}
      >
        <span aria-hidden="true">→ </span>
        <span className="sr-only">{label}: </span>
        {name}
      </span>
    );
  });
}

import { useEffect, useId, useState } from "react";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { LocalProjectTask } from "@/domain/local-state";
import {
  getMappedTaskName,
  PLUGIN_PROPERTY_MAX_LENGTH,
  resolveTaskPluginProperties,
  setPluginProperty,
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

/**
 * One section per plugin that adds task properties, below the task
 * editor's own fields. A field that defaults to the task's name picks one
 * of the project's other tasks, such as the Workday task a local task
 * commits as; clearing it brings the task's own name back. Other fields
 * are plain text.
 */
export function TaskPropertyFields({
  plugins,
  taskName,
  otherTaskNames,
  pluginProperties,
  onChange,
}: {
  plugins: TaskPropertyPlugin[];
  /** The name in the draft, the default of a field that defaults to it. */
  taskName: string;
  /** The names of the project's other active tasks, in list order. */
  otherTaskNames: string[];
  pluginProperties: PluginProperties | undefined;
  onChange: (next: PluginProperties | undefined) => void;
}) {
  const idPrefix = useId();
  return plugins.map((plugin) => (
    <FieldSet key={plugin.pluginId} className="gap-4">
      <FieldLegend variant="label" className="mb-0">
        {plugin.capability.section}
      </FieldLegend>
      {resolveTaskPluginProperties(
        { name: taskName.trim(), pluginProperties },
        plugin,
      ).map(({ field, value, defaultValue, isDefault }) => {
        const id = `${idPrefix}-${plugin.pluginId}-${field.id}`;
        const set = (next: string) =>
          onChange(
            setPluginProperty(
              { pluginProperties },
              plugin.pluginId,
              field.id,
              next,
            ),
          );
        const placeholder = defaultValue || "None";
        return (
          <Field key={field.id}>
            {/* The select names itself with ariaLabel, as in the backlog editor. */}
            <FieldLabel htmlFor={field.defaultFrom === "name" ? undefined : id}>
              {field.label}
            </FieldLabel>
            {field.defaultFrom === "name" ? (
              <SearchableSelect
                value={isDefault ? "" : value}
                options={taskNameOptions(
                  otherTaskNames,
                  isDefault ? "" : value,
                )}
                onChange={set}
                placeholder={placeholder}
                clearLabel={`Same name${defaultValue ? `: ${defaultValue}` : ""}`}
                emptyMessage="No matching tasks"
                ariaLabel={field.label}
              />
            ) : (
              <Input
                id={id}
                value={isDefault ? "" : value}
                maxLength={PLUGIN_PROPERTY_MAX_LENGTH}
                placeholder={placeholder}
                onChange={(event) => set(event.target.value)}
              />
            )}
            {field.helpText ? (
              <FieldDescription>{field.helpText}</FieldDescription>
            ) : null}
          </Field>
        );
      })}
    </FieldSet>
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
 * "→ 07 Run" after a task's name, for each plugin whose tool knows the task
 * by another name. Screen readers hear the field's label instead of the
 * arrow, such as "Workday task: 07 Run".
 */
export function TaskMappingHints({
  task,
  plugins,
}: {
  task: Pick<LocalProjectTask, "name" | "pluginProperties">;
  plugins: TaskPropertyPlugin[];
}) {
  return plugins.map((plugin) => {
    const name = getMappedTaskName(task, plugin);
    if (!name) return null;
    const label =
      plugin.capability.fields.find((field) => field.defaultFrom === "name")
        ?.label ?? plugin.capability.section;
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

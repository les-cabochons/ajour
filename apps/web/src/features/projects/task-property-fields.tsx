import { useEffect, useId, useRef } from "react";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type {
  LocalProject,
  LocalProjectTask,
  TaskCommitAs,
} from "@/domain/local-state";
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
import { normalizeTaskImportName } from "@/domain/projects/task-import";
import { COMMITS_AS_OPTIONS } from "@/features/projects/commits-as";
import {
  createTaskFromPicker,
  describeCreateTaskRow,
} from "@/features/projects/task-creation";
import { localStore } from "@/lib/local-store";

/** What the plugin sections change on the task draft. */
export type TaskPropertyPatch = Pick<
  LocalProjectTask,
  "commitAs" | "pluginProperties"
> & {
  /** Another task… waits for a task in this plugin's field. */
  choosingAnotherTask: { pluginId: string; fieldId: string } | undefined;
};

/**
 * One section per plugin that adds task properties, below the task
 * editor's own fields. The plugin's first field that defaults to the task's
 * name becomes Commits as: Its own name, Another task… (one of the
 * project's other tasks, picked under it, where a name the project lacks
 * can be created), Not known yet or Local only. In
 * a Local only project it only says so. Another field that defaults to the
 * name picks one of the project's other tasks, or "Same name". Other fields
 * are plain text.
 */
export function TaskPropertyFields({
  plugins,
  taskName,
  otherTaskNames,
  pluginProperties,
  commitAs,
  choosingAnotherTask,
  commitsAsError,
  projectLocalOnly = false,
  project,
  editorSession,
  onChange,
}: {
  plugins: TaskPropertyPlugin[];
  /** The name in the draft, the default of a field that defaults to it. */
  taskName: string;
  /** The names of the project's other active tasks, in list order. */
  otherTaskNames: string[];
  pluginProperties: PluginProperties | undefined;
  commitAs: TaskCommitAs | undefined;
  /** Another task… picked, waiting for a task. Part of the draft. */
  choosingAnotherTask?: { pluginId: string; fieldId: string };
  /** "Pick the task it commits as." while Another task… has no task. */
  commitsAsError?: string | null;
  /** The project is Local only, so its tasks are never committed. */
  projectLocalOnly?: boolean;
  /** The task's project, where Another task… creates a task it lacks. */
  project?: Pick<LocalProject, "_id" | "tasks" | "team">;
  /** The task the editor edits, or "new", so an Undo never reaches another task's draft. */
  editorSession?: string;
  onChange: (patch: Partial<TaskPropertyPatch>) => void;
}) {
  const idPrefix = useId();
  // The draft now, for the Undo of a task created from Another task….
  const latest = useRef({
    taskName,
    pluginProperties,
    commitAs,
    onChange,
    editorSession,
  });
  latest.current = {
    taskName,
    pluginProperties,
    commitAs,
    onChange,
    editorSession,
  };
  // The Undo of a created task may come after the editor closed or moved to
  // another task: then it must not touch the open draft.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return plugins.map((plugin) => {
    const commitsAsField = getTaskNameField(plugin);
    return (
      // A plain border on the fieldset would draw through its legend.
      <div key={plugin.pluginId} className="border-t border-border pt-4">
        <FieldSet className="gap-4">
          <FieldLegend
            variant="label"
            className="text-xs text-muted-foreground"
          >
            {plugin.capability.section}
          </FieldLegend>
          {resolveTaskPluginProperties(
            { name: taskName.trim(), pluginProperties },
            plugin,
          ).map(({ field, value, defaultValue, isDefault }) => {
            const id = `${idPrefix}-${plugin.pluginId}-${field.id}`;
            const picked = isDefault ? "" : value;
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
            if (field.id === commitsAsField?.id) {
              if (projectLocalOnly) {
                return (
                  <Field key={field.id}>
                    <FieldLabel>Commits as</FieldLabel>
                    <FieldDescription>
                      The project is local only, so this task is never
                      committed.
                    </FieldDescription>
                  </Field>
                );
              }
              const task = {
                name: taskName.trim(),
                pluginProperties,
                commitAs,
              };
              const choosing =
                choosingAnotherTask?.pluginId === plugin.pluginId;
              const choice = choosing
                ? "another"
                : getCommitsAsChoice(task, plugin);
              const choose = (next: CommitsAsChoice, mappedName = "") => {
                // Another task… with no task yet changes nothing saved: the
                // draft waits for a task, and Save stays blocked meanwhile.
                if (next === "another" && !mappedName) {
                  onChange({
                    choosingAnotherTask: {
                      pluginId: plugin.pluginId,
                      fieldId: field.id,
                    },
                  });
                  return;
                }
                onChange({
                  ...applyCommitsAsChoice(task, plugin, next, mappedName),
                  choosingAnotherTask: undefined,
                });
              };
              /**
               * Creates the typed task and maps this one to it. Undo maps it
               * back while the draft still maps to the created task.
               */
              const createTarget = (projectId: string, text: string) => {
                const createdInSession = editorSession;
                let createdName = "";
                void createTaskFromPicker({
                  projectId,
                  name: text,
                  onCreated: (taskId) => {
                    createdName =
                      localStore
                        .snapshot()
                        .projects.find((item) => item._id === projectId)
                        ?.tasks.find((item) => item._id === taskId)?.name ?? "";
                    if (createdName) choose("another", createdName);
                  },
                  onUndone: () => {
                    const now = latest.current;
                    if (
                      !mounted.current ||
                      now.editorSession !== createdInSession
                    ) {
                      return;
                    }
                    const draft = {
                      name: now.taskName.trim(),
                      pluginProperties: now.pluginProperties,
                      commitAs: now.commitAs,
                    };
                    if (getMappedTaskName(draft, plugin) !== createdName) {
                      return;
                    }
                    // The draft as it was before the create: its mapping,
                    // what it committed as, and whether Another task… waited.
                    now.onChange({
                      commitAs: task.commitAs,
                      pluginProperties: setPluginPropertyDraft(
                        draft,
                        plugin.pluginId,
                        field.id,
                        picked,
                      ),
                      choosingAnotherTask: choosing
                        ? { pluginId: plugin.pluginId, fieldId: field.id }
                        : undefined,
                    });
                  },
                });
              };
              return (
                <Field key={field.id} data-invalid={Boolean(commitsAsError)}>
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
                      value={choosing && !picked ? "" : picked}
                      options={taskNameOptions(otherTaskNames, picked)}
                      onChange={(name) =>
                        name ? choose("another", name) : undefined
                      }
                      placeholder="Pick a task"
                      emptyMessage="No matching tasks"
                      ariaLabel={field.label}
                      create={
                        project
                          ? {
                              // The edited task's own name is no other task.
                              label: (text) =>
                                normalizeTaskImportName(text) ===
                                normalizeTaskImportName(taskName)
                                  ? null
                                  : describeCreateTaskRow(project, text),
                              onCreate: (text) =>
                                createTarget(project._id, text),
                            }
                          : undefined
                      }
                    />
                  ) : null}
                  {choosing && commitsAsError ? (
                    <span className="field-error">{commitsAsError}</span>
                  ) : null}
                  {field.helpText ? (
                    <FieldDescription>{field.helpText}</FieldDescription>
                  ) : null}
                </Field>
              );
            }
            return (
              <Field key={field.id}>
                {/* The select names itself with ariaLabel, as in the backlog editor. */}
                <FieldLabel
                  htmlFor={field.defaultFrom === "name" ? undefined : id}
                >
                  {field.label}
                </FieldLabel>
                {field.defaultFrom === "name" ? (
                  <SearchableSelect
                    value={picked}
                    options={taskNameOptions(otherTaskNames, picked)}
                    onChange={set}
                    // The task's own name is a value; "Same name" says where an
                    // empty field comes from, as the clear option does.
                    placeholder="Same name"
                    clearLabel={`Same name${defaultValue ? `: ${defaultValue}` : ""}`}
                    emptyMessage="No matching tasks"
                    ariaLabel={field.label}
                  />
                ) : (
                  <Input
                    id={id}
                    value={picked}
                    maxLength={PLUGIN_PROPERTY_MAX_LENGTH}
                    placeholder="None"
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
      </div>
    );
  });
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

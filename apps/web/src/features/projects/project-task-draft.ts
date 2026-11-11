import type { DraftConflictView } from "@/components/draft-conflict-notice";
import {
  findDraftConflicts,
  keepMineInDraft,
  reconcileDraft,
  useTheirsInDraft,
  type DraftFieldGroup,
  type ReconciledDraft,
} from "@/domain/draft-reconcile";
import type { ProjectTaskEditorFields } from "@/features/projects/project-task-editor";

/** A kept task draft, with the task's fields it started from. */
export type KeptTaskDraft = ReconciledDraft<ProjectTaskEditorFields>;

/** Commit settings change together: the plugin's task name and its properties. */
const GROUPS: readonly DraftFieldGroup<ProjectTaskEditorFields>[] = [
  ["commitAs", "pluginProperties"],
];

const LABELS: Partial<Record<keyof ProjectTaskEditorFields, string>> = {
  name: "Name",
  billable: "Billable",
  budget: "Budget",
  adjustment: "Adjustment",
  pinnedSlot: "Shortcut",
  commitAs: "Commit settings",
  pluginProperties: "Commit settings",
};

/** What the form never asks the user to decide: it is not a saved value. */
const TRANSIENT = new Set<keyof ProjectTaskEditorFields>([
  "choosingAnotherTask",
]);

function withoutTransient(
  fields: ProjectTaskEditorFields,
): ProjectTaskEditorFields {
  return { ...fields, choosingAnotherTask: undefined };
}

/**
 * The draft to resume for a saved task, brought up to the task as it is now:
 * a field the user did not change takes the task's value, and a field both
 * changed stays as typed, in conflict. A new task has no saved task beneath.
 */
export function resumeTaskDraft(
  kept: KeptTaskDraft | undefined,
  current: ProjectTaskEditorFields,
  isNew: boolean,
): ReconciledDraft<ProjectTaskEditorFields> {
  if (!kept) return { fields: current, base: current };
  if (isNew) return { fields: kept.fields, base: current };
  return reconcileDraft(kept, current, GROUPS);
}

/** The changed fields of a saved task's draft that the user must settle. */
export function getTaskDraftConflicts(
  draft: ReconciledDraft<ProjectTaskEditorFields>,
  current: ProjectTaskEditorFields,
) {
  return findDraftConflicts(
    { fields: withoutTransient(draft.fields), base: draft.base },
    withoutTransient(current),
    GROUPS,
  ).filter((group) => !group.every((key) => TRANSIENT.has(key)));
}

function describe(value: unknown) {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function describeTaskConflicts(
  groups: readonly DraftFieldGroup<ProjectTaskEditorFields>[],
  draft: ProjectTaskEditorFields,
  current: ProjectTaskEditorFields,
): DraftConflictView[] {
  return groups.map((group) => ({
    id: group.join(","),
    label: LABELS[group[0]!] ?? String(group[0]),
    theirs: group.map((key) => describe(current[key])).join(" "),
    mine: group.map((key) => describe(draft[key])).join(" "),
  }));
}

/** Settles one conflicting group, in favour of the draft or of the task now. */
export function settleTaskConflict(
  draft: ReconciledDraft<ProjectTaskEditorFields>,
  current: ProjectTaskEditorFields,
  group: DraftFieldGroup<ProjectTaskEditorFields>,
  keep: "mine" | "theirs",
) {
  return (keep === "mine" ? keepMineInDraft : useTheirsInDraft)(
    draft,
    current,
    group,
  );
}

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  RiHashtag as CodeIcon,
  RiPencilLine as EditIcon,
} from "@remixicon/react";
import {
  dropComposerDraft,
  getComposerDraft,
  keepComposerDraft,
} from "@/lib/composer-drafts";
import {
  DraftConflictNotice,
  type DraftConflictView,
} from "@/components/draft-conflict-notice";
import {
  findDraftConflicts,
  keepMineInDraft,
  reconcileDraft,
  useTheirsInDraft,
  type DraftFieldGroup,
  type ReconciledDraft,
} from "@/domain/draft-reconcile";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldWarning,
} from "@/components/ui/field";
import { recordsEqual } from "@/domain/records-equal";
import { getDuplicateProjectNameWarning } from "@/domain/projects/project-names";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import type { LocalProject } from "@/domain/local-state";
import { isManagedProject } from "@/domain/projects/project-transitions";
import { LockHint } from "@/features/projects/project-source-ui";
import {
  createProjectFormFields,
  getProjectFormErrors,
  getProjectFormValues,
  setProjectFormName,
  type ProjectFormFields,
  type ProjectFormValues,
} from "@/features/projects/project-form";
import { ProjectIconField } from "@/features/projects/project-icon-field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PROJECT_ICON_PRESETS, ProjectIcon } from "@/lib/project-icons";

/** A kept draft, with the project's fields it started from. */
type KeptProjectDraft = ReconciledDraft<ProjectFormFields>;

/** The name and the display name that follows it change together, as the code does. */
const DRAFT_FIELD_GROUPS: readonly DraftFieldGroup<ProjectFormFields>[] = [
  ["name", "displayName"],
  ["code", "savedCode"],
];

const CONFLICT_LABELS: Partial<Record<keyof ProjectFormFields, string>> = {
  name: "Full name",
  code: "Code",
  color: "Color",
  icon: "Icon",
};

function describeProjectField(
  key: keyof ProjectFormFields,
  fields: ProjectFormFields,
) {
  if (key === "icon") {
    return fields.icon.kind === "upload"
      ? "an uploaded icon"
      : fields.icon.name;
  }
  return String(fields[key] ?? "");
}

/**
 * The project form, opened by "New project" and by Edit in the project's action set.
 * Save: the Save button or Enter in a text field. Escape closes it and keeps the
 * draft for the next opening of the same project, or of New project; Cancel or ×
 * discard it. Clicking outside does nothing, so a stray click never loses the draft.
 *
 * Mount it only while open: the draft is seeded once, from `project` when editing.
 */
export function ProjectFormDialog({
  project,
  sourceLabel,
  onClose,
  onSubmit,
}: {
  /** The project to edit, or undefined to create one. */
  project?: LocalProject;
  /** What the user calls the project's source, when it is managed. */
  sourceLabel?: string;
  onClose: () => void;
  onSubmit: (values: ProjectFormValues) => void;
}) {
  const [draftKey] = useState(() => `project:${project?._id ?? "new"}`);
  const [seed] = useState(() => createProjectFormFields(project));
  const [kept] = useState(() => getComposerDraft<KeptProjectDraft>(draftKey));
  // A kept draft of a saved project is brought up to the project as it is
  // now: a field the user did not change takes its value, and a field both
  // changed stays as typed, in conflict.
  const [resumed] = useState(() =>
    !kept
      ? { fields: seed, base: seed }
      : project
        ? reconcileDraft(kept, seed, DRAFT_FIELD_GROUPS)
        : { fields: kept.fields, base: seed },
  );
  const [fields, setFields] = useState(resumed.fields);
  const [base, setBase] = useState(resumed.base);
  // The project as it is now, so a save in another window reaches the open form.
  const { projects } = useLocalState();
  const savedProject = project
    ? (projects.find((candidate) => candidate._id === project._id) ?? project)
    : undefined;
  const currentFields = useMemo(
    () => (savedProject ? createProjectFormFields(savedProject) : undefined),
    [savedProject],
  );
  // A field the user did not change follows the project while the form stays
  // open; a field both changed stays as typed, in conflict, until settled.
  useEffect(() => {
    if (!currentFields) return;
    const next = reconcileDraft(
      { fields, base },
      currentFields,
      DRAFT_FIELD_GROUPS,
    );
    if (!recordsEqual(next.fields, fields)) setFields(next.fields);
    if (!recordsEqual(next.base, base)) setBase(next.base);
  }, [base, currentFields, fields]);
  const conflictGroups = currentFields
    ? findDraftConflicts({ fields, base }, currentFields, DRAFT_FIELD_GROUPS)
    : [];
  const conflicts = conflictGroups.map((group): DraftConflictView => ({
    id: group.join(","),
    label: CONFLICT_LABELS[group[0]!] ?? String(group[0]),
    theirs: describeProjectField(group[0]!, currentFields!),
    mine: describeProjectField(group[0]!, fields),
  }));

  /** Settles a changed field: the draft's version stays, or the project's now. */
  function settleConflict(id: string, keep: "mine" | "theirs") {
    const group = conflictGroups.find(
      (candidate) => candidate.join(",") === id,
    );
    if (!group || !currentFields) return;
    const settle = keep === "mine" ? keepMineInDraft : useTheirsInDraft;
    const settled = settle({ fields, base }, currentFields, group);
    setFields(settled.fields);
    setBase(settled.base);
  }
  // The full name's error shows once the user typed in it, not on a new form.
  const [nameEdited, setNameEdited] = useState(Boolean(kept));
  // The draft is kept while it differs from what the form opened on, until
  // it is saved or discarded.
  const changed = !recordsEqual(fields, currentFields ?? seed);
  useEffect(() => {
    if (changed) {
      keepComposerDraft(draftKey, { fields, base } satisfies KeptProjectDraft);
    } else dropComposerDraft(draftKey);
  }, [base, changed, draftKey, fields]);

  /** Cancel and ×: the draft is discarded. */
  function discard() {
    dropComposerDraft(draftKey);
    onClose();
  }
  const values = getProjectFormValues(fields);
  const errors = getProjectFormErrors(fields);
  const nameWarning = getDuplicateProjectNameWarning(
    projects,
    fields.name,
    project?._id,
  );
  const isCreate = !project;
  // A managed project's source sets its full name and code (#506).
  const sourceOwned = project ? isManagedProject(project) : false;
  const lockId = useId();

  function update(patch: Partial<ProjectFormFields>) {
    setFields((current) => ({ ...current, ...patch }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // The project as the store holds it this moment: a save from another
    // window can land between the last render and this press.
    const latest = project
      ? localStore
          .snapshot()
          .projects.find((candidate) => candidate._id === project._id)
      : undefined;
    const latestFields = latest ? createProjectFormFields(latest) : undefined;
    const draft = latestFields
      ? reconcileDraft({ fields, base }, latestFields, DRAFT_FIELD_GROUPS)
      : { fields, base };
    const latestConflicts = latestFields
      ? findDraftConflicts(draft, latestFields, DRAFT_FIELD_GROUPS)
      : [];
    if (!recordsEqual(draft.fields, fields)) setFields(draft.fields);
    if (!recordsEqual(draft.base, base)) setBase(draft.base);
    const latestValues = getProjectFormValues(draft.fields);
    if (latestValues && latestConflicts.length === 0) {
      dropComposerDraft(draftKey);
      onSubmit(latestValues);
    }
  }

  const iconLabel =
    fields.icon.kind === "upload"
      ? "Uploaded favicon"
      : (PROJECT_ICON_PRESETS.find(
          (preset) =>
            fields.icon.kind === "preset" && preset.name === fields.icon.name,
        )?.label ?? "Preset");

  return (
    // A modal dialog, centered in the window at every width, as every
    // composer.
    <Dialog
      open
      disablePointerDismissal
      // Escape keeps the draft; × discards it.
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "escape-key") onClose();
        else discard();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl gap-4 overflow-y-auto">
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          // ⌘/Ctrl+Enter creates from any field, as in every composer.
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }
          }}
        >
          <DialogHeader className="sr-only">
            {/* The composer says what it makes by itself; its title only
                names the dialog for assistive tech (forms council round 13). */}
            <DialogTitle className="sr-only">
              {isCreate ? "New project" : "Edit project"}
            </DialogTitle>
          </DialogHeader>

          {/* A composer, as Linear's new project: the icon as an avatar
              beside the name and short name to write in, then the code and
              color as chips (forms council rounds 6 and 13). */}
          <DraftConflictNotice
            conflicts={conflicts}
            onKeepMine={(id) => settleConflict(id, "mine")}
            onUseTheirs={(id) => settleConflict(id, "theirs")}
          />

          <FieldGroup className="composer gap-2">
            {/* The icon is the project's avatar, beside its name, tinted
                in its color, as a workspace logo (forms council round 13). */}
            <div className="project-form-identity">
              <Popover>
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className="project-form-avatar"
                      style={
                        { "--project-color": fields.color } as CSSProperties
                      }
                      aria-label={`Project icon: ${iconLabel}`}
                    />
                  }
                >
                  <ProjectIcon
                    icon={fields.icon}
                    color={fields.color}
                    className="size-5"
                  />
                  <span aria-hidden className="project-form-avatar-badge">
                    <EditIcon className="size-2.5" />
                  </span>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80">
                  <ProjectIconField
                    icon={fields.icon}
                    color={fields.color}
                    onChange={(icon) => update({ icon })}
                  />
                </PopoverContent>
              </Popover>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Field>
                  <FieldLabel htmlFor="project-form-name" className="sr-only">
                    Full name
                  </FieldLabel>
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      id="project-form-name"
                      className="composer-title"
                      autoComplete="off"
                      autoFocus={!sourceOwned}
                      placeholder="Project name"
                      readOnly={sourceOwned}
                      aria-describedby={
                        sourceOwned ? `${lockId}-name` : undefined
                      }
                      value={fields.name}
                      aria-invalid={
                        nameEdited && errors.name ? true : undefined
                      }
                      onChange={(event) => {
                        setNameEdited(true);
                        setFields((current) =>
                          setProjectFormName(current, event.target.value),
                        );
                      }}
                    />
                    {sourceOwned ? (
                      <LockHint label={sourceLabel} id={`${lockId}-name`} />
                    ) : null}
                  </span>
                </Field>
                <Field>
                  <FieldLabel
                    htmlFor="project-form-display-name"
                    className="sr-only"
                  >
                    Display name
                  </FieldLabel>
                  <input
                    id="project-form-display-name"
                    className="composer-subtitle"
                    // A managed project's full name is read-only, so the
                    // display name takes the focus.
                    autoFocus={sourceOwned}
                    autoComplete="off"
                    placeholder="Add a short name for lists…"
                    value={fields.displayName}
                    onChange={(event) =>
                      update({ displayName: event.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
            <div className="composer-chips pt-2">
              <div className="composer-chip composer-estimate">
                <CodeIcon aria-hidden className="size-3.5 shrink-0" />
                <label htmlFor="project-form-code">Code</label>
                <input
                  id="project-form-code"
                  className="composer-estimate-input composer-code-input"
                  autoComplete="off"
                  placeholder="ATL"
                  readOnly={sourceOwned}
                  aria-describedby={sourceOwned ? `${lockId}-code` : undefined}
                  value={fields.code}
                  aria-invalid={errors.code ? true : undefined}
                  onChange={(event) => update({ code: event.target.value })}
                />
                {sourceOwned ? (
                  <LockHint label={sourceLabel} id={`${lockId}-code`} />
                ) : null}
              </div>
              <ColorField
                id="project-form-color"
                label="Project color"
                className="composer-color"
                value={fields.color}
                onChange={(color) => update({ color })}
                trailing={<span>Color</span>}
              />
            </div>
            {nameEdited && errors.name ? (
              <span role="alert" className="field-error">
                {errors.name}
              </span>
            ) : null}
            {errors.code ? (
              <span role="alert" className="field-error">
                {errors.code}
              </span>
            ) : null}
            {sourceOwned ? null : <FieldWarning>{nameWarning}</FieldWarning>}
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={discard}>
              Cancel
            </Button>
            <Button type="submit" disabled={!values || conflicts.length > 0}>
              {isCreate ? "Create project" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

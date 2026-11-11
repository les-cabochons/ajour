import { useId, useState, type CSSProperties, type FormEvent } from "react";
import {
  RiHashtag as CodeIcon,
  RiPencilLine as EditIcon,
} from "@remixicon/react";
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
import { getDuplicateProjectNameWarning } from "@/domain/projects/project-names";
import { useLocalState } from "@/lib/local-hooks";
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

/**
 * The project form, opened by "New project" and by Edit in the project's action set.
 * Save: the Save button or Enter in a text field. Escape, Cancel or × discard the draft.
 * Clicking outside does nothing, so a stray click never loses the draft.
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
  const [fields, setFields] = useState(() => createProjectFormFields(project));
  // The full name's error shows once the user typed in it, not on a new form.
  const [nameEdited, setNameEdited] = useState(false);
  const values = getProjectFormValues(fields);
  const errors = getProjectFormErrors(fields);
  const { projects } = useLocalState();
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
    if (values) {
      onSubmit(values);
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
      onOpenChange={(open) => !open && onClose()}
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
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!values}>
              {isCreate ? "Create project" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

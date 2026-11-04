import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import type { LocalProject } from "@/domain/local-state";
import {
  createProjectFormFields,
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
  onClose,
  onSubmit,
}: {
  /** The project to edit, or undefined to create one. */
  project?: LocalProject;
  onClose: () => void;
  onSubmit: (values: ProjectFormValues) => void;
}) {
  const [fields, setFields] = useState(() => createProjectFormFields(project));
  const values = getProjectFormValues(fields);
  const isCreate = !project;

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
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl gap-4 overflow-y-auto">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <DialogHeader className="gap-1">
            <DialogTitle>
              {isCreate ? "New project" : "Edit project"}
            </DialogTitle>
          </DialogHeader>

          {/* A composer, as Linear's new project: the icon, then the name
              and short name to write in, then the code and color as chips
              (forms council round 6). */}
          <FieldGroup className="composer gap-2">
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="composer-icon"
                    aria-label={`Project icon: ${iconLabel}`}
                  />
                }
              >
                <ProjectIcon
                  icon={fields.icon}
                  color={fields.color}
                  className="size-4"
                />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80">
                <ProjectIconField
                  icon={fields.icon}
                  color={fields.color}
                  onChange={(icon) => update({ icon })}
                />
              </PopoverContent>
            </Popover>
            <Field>
              <FieldLabel htmlFor="project-form-name" className="sr-only">
                Full name
              </FieldLabel>
              <input
                id="project-form-name"
                className="composer-title"
                autoFocus
                autoComplete="off"
                placeholder="Project name"
                value={fields.name}
                onChange={(event) =>
                  setFields((current) =>
                    setProjectFormName(current, event.target.value),
                  )
                }
              />
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
                autoComplete="off"
                placeholder="Add a short name for lists…"
                value={fields.displayName}
                onChange={(event) =>
                  update({ displayName: event.target.value })
                }
              />
            </Field>
            <div className="composer-chips pt-2">
              <div className="composer-chip composer-estimate">
                <label htmlFor="project-form-code">Code</label>
                <input
                  id="project-form-code"
                  className="composer-estimate-input"
                  autoComplete="off"
                  placeholder="ATL"
                  value={fields.code}
                  onChange={(event) => update({ code: event.target.value })}
                />
              </div>
              <ColorField
                id="project-form-color"
                label="Project color"
                className="composer-color"
                value={fields.color}
                onChange={(color) => update({ color })}
              />
            </div>
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

import { useState, type FormEvent } from "react";
import {
  RiFolderAddLine as FolderPlus,
  RiSaveLine as Save,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { LocalProject } from "@/domain/local-state";
import {
  createProjectFormFields,
  getProjectFormValues,
  setProjectFormName,
  type ProjectFormFields,
  type ProjectFormValues,
} from "@/features/projects/project-form";
import { ProjectIconField } from "@/features/projects/project-icon-field";

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
            <DialogDescription>
              Name, display name, code, icon and color.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="project-form-name">Full name</FieldLabel>
              <Input
                id="project-form-name"
                autoFocus
                placeholder="Full name"
                value={fields.name}
                onChange={(event) =>
                  setFields((current) =>
                    setProjectFormName(current, event.target.value),
                  )
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-form-display-name">
                Display name
              </FieldLabel>
              <Input
                id="project-form-display-name"
                placeholder="Display name"
                value={fields.displayName}
                onChange={(event) =>
                  update({ displayName: event.target.value })
                }
              />
            </Field>
            <ProjectIconField
              icon={fields.icon}
              color={fields.color}
              onChange={(icon) => update({ icon })}
            />
            <div className="grid gap-3 desktop:grid-cols-[1fr_110px]">
              <Field>
                <FieldLabel htmlFor="project-form-code">Code</FieldLabel>
                <Input
                  id="project-form-code"
                  placeholder="Code"
                  value={fields.code}
                  onChange={(event) => update({ code: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="project-form-color">Color</FieldLabel>
                <ColorField
                  id="project-form-color"
                  label="Project color"
                  className="w-full"
                  value={fields.color}
                  onChange={(color) => update({ color })}
                />
              </Field>
            </div>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!values}>
              {isCreate ? (
                <FolderPlus data-icon="inline-start" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {isCreate ? "Create project" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

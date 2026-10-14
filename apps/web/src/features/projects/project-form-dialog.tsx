import { useRef, useState, type FormEvent } from "react";
import {
  RiFolderAddLine as FolderPlus,
  RiSaveLine as Save,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
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
import type { ProjectIconName } from "@/domain/projects/project-icon";
import {
  createProjectFormFields,
  getProjectFormValues,
  setProjectFormName,
  type ProjectFormFields,
  type ProjectFormValues,
} from "@/features/projects/project-form";
import {
  PROJECT_ICON_PRESETS,
  prepareUploadedProjectIcon,
  ProjectIcon,
} from "@/lib/project-icons";
import { cn } from "@/lib/utils";

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
            <ProjectIconField fields={fields} onChange={setFields} />
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
                <label className="project-color-picker">
                  <span
                    className="project-color-picker-swatch"
                    style={{ backgroundColor: fields.color }}
                    aria-hidden="true"
                  />
                  <input
                    id="project-form-color"
                    className="project-color-picker-input"
                    aria-label="Project color"
                    type="color"
                    value={fields.color}
                    onChange={(event) => update({ color: event.target.value })}
                  />
                </label>
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

/** Icon presets, a favicon upload, and whether an upload keeps its own colors. */
function ProjectIconField({
  fields,
  onChange,
}: {
  fields: ProjectFormFields;
  onChange: React.Dispatch<React.SetStateAction<ProjectFormFields>>;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);

  const handlePresetSelect = (name: ProjectIconName) => {
    setIconError(null);
    onChange((current) => ({ ...current, icon: { kind: "preset", name } }));
  };

  const handleUploadChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setIsProcessingUpload(true);
    setIconError(null);

    try {
      const nextIconSrc = await prepareUploadedProjectIcon(file);
      onChange((current) => ({
        ...current,
        icon: {
          kind: "upload",
          src: nextIconSrc.src,
          maskSrc: nextIconSrc.maskSrc,
          colorMode:
            current.icon.kind === "upload" &&
            current.icon.colorMode === "native"
              ? "native"
              : "tinted",
        },
      }));
    } catch (error) {
      setIconError(
        error instanceof Error
          ? error.message
          : "The favicon could not be used.",
      );
    } finally {
      setIsProcessingUpload(false);
    }
  };

  const handleUploadPickerOpen = () => {
    const input = uploadInputRef.current;
    if (!input) {
      return;
    }

    input.value = "";

    const pickerInput = input as HTMLInputElement & {
      showPicker?: () => void;
    };

    if (typeof pickerInput.showPicker === "function") {
      try {
        pickerInput.showPicker();
        return;
      } catch {
        // Fall back to click() for environments that expose showPicker
        // but still reject it for this interaction path.
      }
    }

    input.click();
  };

  return (
    <div className="project-icon-field">
      <div className="project-icon-field-copy">
        <span className="project-icon-field-label">Project icon</span>
        <p className="project-icon-field-hint">
          Pick a preset or upload a favicon-sized icon. Uploaded icons can use
          the project color or keep their native colors.
        </p>
      </div>

      <div className="project-icon-field-toolbar">
        <div className="project-icon-preview">
          <ProjectIcon
            icon={fields.icon}
            color={fields.color}
            className="size-5"
          />
          <span className="project-icon-preview-label">
            {fields.icon.kind === "upload" ? "Uploaded favicon" : "Preset"}
          </span>
        </div>

        <input
          id="project-form-icon-upload"
          ref={uploadInputRef}
          type="file"
          accept=".png,.svg,.ico,image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
          className="sr-only"
          onChange={(event) => {
            void handleUploadChange(event);
          }}
        />
        <Button
          type="button"
          variant={fields.icon.kind === "upload" ? "default" : "outline"}

          disabled={isProcessingUpload}
          onClick={handleUploadPickerOpen}
        >
          {isProcessingUpload ? "Preparing icon" : "Upload favicon"}
        </Button>
        <Button
          type="button"
          variant={
            fields.icon.kind === "upload" && fields.icon.colorMode === "native"
              ? "default"
              : "outline"
          }

          disabled={fields.icon.kind !== "upload"}
          onClick={() =>
            onChange((current) => {
              if (current.icon.kind !== "upload") {
                return current;
              }

              return {
                ...current,
                icon: {
                  ...current.icon,
                  colorMode:
                    current.icon.colorMode === "native" ? "tinted" : "native",
                },
              };
            })
          }
        >
          Keep native colors
        </Button>
      </div>

      <div className="project-icon-preset-grid" role="list">
        {PROJECT_ICON_PRESETS.map((preset) => {
          const isSelected =
            fields.icon.kind === "preset" && fields.icon.name === preset.name;

          return (
            <TooltipButton
              key={preset.name}
              role="listitem"
              className={cn(
                "project-icon-preset-button",
                isSelected && "is-selected",
              )}
              label={preset.label}
              aria-label={`Use ${preset.label} icon`}
              onClick={() => handlePresetSelect(preset.name)}
            >
              <ProjectIcon
                icon={{ kind: "preset", name: preset.name }}
                color={fields.color}
                className="size-4"
              />
            </TooltipButton>
          );
        })}
      </div>

      {iconError ? <span className="field-error">{iconError}</span> : null}
    </div>
  );
}

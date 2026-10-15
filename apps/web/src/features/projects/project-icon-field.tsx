import { useRef, useState } from "react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import type {
  LocalProjectIcon,
  ProjectIconName,
} from "@/domain/projects/project-icon";
import {
  PROJECT_ICON_PRESETS,
  prepareUploadedProjectIcon,
  ProjectIcon,
} from "@/lib/project-icons";
import { cn } from "@/lib/utils";

/**
 * Icon presets, a favicon upload, and whether an upload keeps its own colors.
 * The project form and the project page's Icon property share it.
 */
export function ProjectIconField({
  icon,
  color,
  onChange,
}: {
  icon: LocalProjectIcon;
  /** Tints the presets and the preview like the project. */
  color: string;
  onChange: (icon: LocalProjectIcon) => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);

  const handlePresetSelect = (name: ProjectIconName) => {
    setIconError(null);
    onChange({ kind: "preset", name });
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
      onChange({
        kind: "upload",
        src: nextIconSrc.src,
        maskSrc: nextIconSrc.maskSrc,
        colorMode:
          icon.kind === "upload" && icon.colorMode === "native"
            ? "native"
            : "tinted",
      });
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
          <ProjectIcon icon={icon} color={color} className="size-5" />
          <span className="project-icon-preview-label">
            {icon.kind === "upload" ? "Uploaded favicon" : "Preset"}
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
          variant={icon.kind === "upload" ? "default" : "outline"}

          disabled={isProcessingUpload}
          onClick={handleUploadPickerOpen}
        >
          {isProcessingUpload ? "Preparing icon" : "Upload favicon"}
        </Button>
        <Button
          type="button"
          variant={
            icon.kind === "upload" && icon.colorMode === "native"
              ? "default"
              : "outline"
          }

          disabled={icon.kind !== "upload"}
          onClick={() => {
            if (icon.kind === "upload") {
              onChange({
                ...icon,
                colorMode: icon.colorMode === "native" ? "tinted" : "native",
              });
            }
          }}
        >
          Keep native colors
        </Button>
      </div>

      <div className="project-icon-preset-grid" role="list">
        {PROJECT_ICON_PRESETS.map((preset) => {
          const isSelected =
            icon.kind === "preset" && icon.name === preset.name;

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
                color={color}
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

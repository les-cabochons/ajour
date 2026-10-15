import { useRef, useState, type ReactNode } from "react";
import {
  RiArchiveLine as ArchiveIcon,
  RiDownloadLine as Download,
  RiInboxUnarchiveLine as RestoreIcon,
} from "@remixicon/react";
import {
  PropertyAction,
  PropertyActions,
  PropertyList,
  PropertyRow,
} from "@/components/property-list";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getLocalProjectDisplayName,
  type LocalProject,
} from "@/domain/local-state";
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  getProjectPatch,
  setProjectFormName,
  type ProjectFormFields,
} from "@/features/projects/project-form";
import { ProjectIconField } from "@/features/projects/project-icon-field";
import { localStore } from "@/lib/local-store";
import { PROJECT_ICON_PRESETS, ProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";

/*
 * The project page edits in place, like the backlog item page: each field
 * saves on Enter, when focus leaves it, or when a picker changes, with the
 * Undo toast. Escape puts the saved value back. An archived project is
 * read-only until Restore.
 */

/** The color and icon pickers read as values until hovered, aligned with the text rows. */
const PICKER_CLASS_NAME =
  "-ml-[calc(0.625rem+1px)] h-(--control-height) border-transparent bg-transparent shadow-none hover:border-(--field-border) hover:bg-(--field-bg)";

/** Saves one in-place edit with Undo. Invalid or unchanged edits save nothing. */
function patchProject(
  project: LocalProject,
  change: (fields: ProjectFormFields) => ProjectFormFields,
  title: string,
) {
  const values = getProjectPatch(project, change);
  if (!values) return;
  offerUndo(localStore.updateProjectWithUndo(project._id, values), {
    title,
    subject: "project",
  });
}

/**
 * A line of text that turns into a field on click. Enter or blur saves,
 * Escape cancels. `renderValue` draws the resting text, such as the title.
 */
function InlineText({
  value,
  label,
  placeholder,
  readOnly,
  className,
  inputClassName,
  onSave,
  renderValue,
}: {
  value: string;
  /** The field's accessible name, such as "Code". */
  label: string;
  /** Shown muted while the value is empty. */
  placeholder: string;
  readOnly: boolean;
  className?: string;
  inputClassName?: string;
  onSave: (value: string) => void;
  renderValue?: (props: {
    className: string;
    onClick?: () => void;
  }) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  // Enter saves and unmounts the input, whose blur then must not save twice.
  const closedRef = useRef(false);

  function close(save: boolean, next: string) {
    if (closedRef.current) return;
    closedRef.current = true;
    if (save) onSave(next);
    setEditing(false);
  }

  if (!editing || readOnly) {
    const targetClassName = cn(!readOnly && "project-inline-target", className);
    const open = readOnly
      ? undefined
      : () => {
          closedRef.current = false;
          setEditing(true);
        };
    if (renderValue) {
      return renderValue({ className: targetClassName, onClick: open });
    }
    return (
      <button
        type="button"
        aria-label={`Edit ${label.toLowerCase()}, ${value || "empty"}`}
        disabled={readOnly}
        className={cn(
          "-mx-1 min-w-0 truncate px-1 text-left disabled:cursor-default",
          !value && "text-muted-foreground",
          targetClassName,
        )}
        onClick={open}
      >
        {value || placeholder}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      className={cn("-mx-1 h-7 px-1", inputClassName)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => close(true, event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          close(true, event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          close(false, value);
        }
      }}
    />
  );
}

/** The project's display name. Click it to rename; empty falls back to the full name. */
export function ProjectTitle({
  project,
  readOnly,
}: {
  project: LocalProject;
  readOnly: boolean;
}) {
  const displayName = getLocalProjectDisplayName(project);
  return (
    <InlineText
      value={displayName}
      label="Display name"
      placeholder={project.name}
      readOnly={readOnly}
      inputClassName="project-detail-title h-auto py-0.5"
      onSave={(value) =>
        patchProject(
          project,
          (fields) => ({ ...fields, displayName: value }),
          "Project renamed",
        )
      }
      // The heading holds a button so Tab and Enter reach the rename too.
      renderValue={({ className, onClick }) => (
        <h1 className="project-detail-title">
          {onClick ? (
            <button
              type="button"
              className={cn("max-w-full truncate text-left", className)}
              onClick={onClick}
            >
              {displayName}
            </button>
          ) : (
            displayName
          )}
        </h1>
      )}
    />
  );
}

/**
 * The project page's Properties card: full name, code, color and icon change
 * in place. Import tasks… and Archive or Restore sit at its bottom, in place
 * of the "…" menu the page had.
 */
export function ProjectPropertiesCard({
  project,
  isImporting,
  onImport,
  onArchive,
  onRestore,
}: {
  project: LocalProject;
  isImporting: boolean;
  /** Opens the Excel file picker. */
  onImport: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const isArchived = project.status === "archived";
  const iconLabel =
    project.icon.kind === "upload"
      ? "Uploaded favicon"
      : (PROJECT_ICON_PRESETS.find((preset) => {
          const { icon } = project;
          return icon.kind === "preset" && preset.name === icon.name;
        })?.label ?? "Preset");

  return (
    <section className="project-properties-card" aria-label="Properties">
      <PropertyList>
        <PropertyRow label="Full name">
          <InlineText
            value={project.name}
            label="Full name"
            placeholder="Full name"
            readOnly={isArchived}
            onSave={(value) =>
              patchProject(
                project,
                (fields) => setProjectFormName(fields, value),
                "Project renamed",
              )
            }
          />
        </PropertyRow>
        <PropertyRow label="Code">
          <InlineText
            value={project.code ?? ""}
            label="Code"
            placeholder="None"
            readOnly={isArchived}
            onSave={(value) =>
              patchProject(
                project,
                (fields) => ({ ...fields, code: value }),
                "Project code changed",
              )
            }
          />
        </PropertyRow>
        <PropertyRow label="Color">
          {isArchived ? (
            <ColorSwatch color={project.color} />
          ) : (
            <ColorField
              label="Project color"
              className={PICKER_CLASS_NAME}
              value={project.color}
              onChange={(color) =>
                patchProject(
                  project,
                  (fields) => ({ ...fields, color }),
                  "Project color changed",
                )
              }
            />
          )}
        </PropertyRow>
        <PropertyRow label="Icon">
          {isArchived ? (
            <>
              <ProjectIcon
                icon={project.icon}
                color={project.color}
                className="size-4"
              />
              {iconLabel}
            </>
          ) : (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    className={PICKER_CLASS_NAME}
                    aria-label={`Project icon: ${iconLabel}`}
                  />
                }
              >
                <ProjectIcon
                  icon={project.icon}
                  color={project.color}
                  className="size-4"
                />
                {iconLabel}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <ProjectIconField
                  icon={project.icon}
                  color={project.color}
                  onChange={(icon) =>
                    patchProject(
                      project,
                      (fields) => ({ ...fields, icon }),
                      "Project icon changed",
                    )
                  }
                />
              </PopoverContent>
            </Popover>
          )}
        </PropertyRow>
        <PropertyRow label="Status">
          {isArchived ? "Archived" : "Active"}
        </PropertyRow>
      </PropertyList>
      <PropertyActions>
        <PropertyAction
          disabled={isArchived || isImporting}
          title={isArchived ? "Restore the project first" : undefined}
          onClick={onImport}
        >
          <Download aria-hidden="true" />
          {isImporting ? "Importing tasks…" : "Import tasks…"}
        </PropertyAction>
        {isArchived ? (
          <PropertyAction onClick={onRestore}>
            <RestoreIcon aria-hidden="true" />
            Restore
          </PropertyAction>
        ) : (
          <PropertyAction onClick={onArchive}>
            <ArchiveIcon aria-hidden="true" />
            Archive
          </PropertyAction>
        )}
      </PropertyActions>
    </section>
  );
}

/** A read-only color, for an archived project. */
function ColorSwatch({ color }: { color: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="color-field-swatch"
        style={{ background: color }}
      />
      <span className="font-mono text-xs">{color}</span>
    </>
  );
}

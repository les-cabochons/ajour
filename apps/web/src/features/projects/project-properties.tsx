import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ProjectPropertyField } from "@ajour/shared";
import {
  RiArchiveLine as ArchiveIcon,
  RiArrowRightSLine as ChevronIcon,
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
import {
  PLUGIN_PROPERTY_MAX_LENGTH,
  resolvePluginProperties,
  setPluginProperty,
  type ProjectPropertyPlugin,
} from "@/domain/projects/plugin-properties";
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  getProjectPatch,
  setProjectFormName,
  type ProjectFormFields,
} from "@/features/projects/project-form";
import { ProjectIconField } from "@/features/projects/project-icon-field";
import {
  ProjectTeamAction,
  ProjectTeamRow,
} from "@/features/projects/project-team-ui";
import { localStore } from "@/lib/local-store";
import { listProjectPropertyPlugins } from "@/lib/plugin-project-properties";
import { subscribePluginsOverview } from "@/lib/app-api";
import {
  listTeamConnections,
  teamConnectionsOf,
  type TeamConnectionChoice,
} from "@/lib/team-sync";
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
 * While `value` is empty, a non-empty `defaultValue` shows muted in its
 * place, as the value the field falls back to.
 */
function InlineText({
  value,
  defaultValue,
  label,
  placeholder,
  readOnly,
  className,
  inputClassName,
  maxLength,
  onSave,
  renderValue,
}: {
  value: string;
  /** Shown muted while `value` is empty, such as a plugin property's default. */
  defaultValue?: string;
  /** The field's accessible name, such as "Code". */
  label: string;
  /** Shown muted while the value is empty. */
  placeholder: string;
  readOnly: boolean;
  className?: string;
  inputClassName?: string;
  /** Longest text the field accepts while editing. */
  maxLength?: number;
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
    const showsDefault = !value && Boolean(defaultValue);
    return (
      <button
        type="button"
        aria-label={
          showsDefault
            ? `Edit ${label.toLowerCase()}, default ${defaultValue}`
            : `Edit ${label.toLowerCase()}, ${value || "empty"}`
        }
        disabled={readOnly}
        className={cn(
          "-mx-1 min-w-0 truncate px-1 text-left disabled:cursor-default",
          !value && "text-muted-foreground",
          targetClassName,
        )}
        onClick={open}
      >
        {value || defaultValue || placeholder}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      aria-label={label}
      defaultValue={value}
      maxLength={maxLength}
      placeholder={defaultValue || placeholder}
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

/** Saves one plugin property with Undo. Unchanged values save nothing. */
function patchPluginProperty(
  project: LocalProject,
  plugin: ProjectPropertyPlugin,
  field: ProjectPropertyField,
  value: string,
) {
  const current = resolvePluginProperties(project, plugin).find(
    (property) => property.field.id === field.id,
  );
  if (value.trim() === (current && !current.isDefault ? current.value : ""))
    return;
  const pluginProperties = setPluginProperty(
    project,
    plugin.pluginId,
    field.id,
    value,
  );
  offerUndo(
    localStore.updateProjectWithUndo(project._id, { pluginProperties }),
    { title: `${field.label} changed`, subject: "project" },
  );
}

/**
 * The properties one plugin adds, under its section title. Collapsed on
 * each visit; the title toggles it.
 */
function PluginPropertySection({
  project,
  plugin,
  readOnly,
}: {
  project: LocalProject;
  plugin: ProjectPropertyPlugin;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const contentId = `${project._id}-${plugin.pluginId}-properties`;
  return (
    <div className="flex flex-col gap-2.5 border-t pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        className="flex items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <ChevronIcon
          aria-hidden="true"
          className={cn("size-4", open && "rotate-90")}
        />
        {plugin.capability.section}
      </button>
      {open ? (
        <PropertyList id={contentId}>
          {resolvePluginProperties(project, plugin).map((property) => (
            <PropertyRow key={property.field.id} label={property.field.label}>
              <InlineText
                value={property.isDefault ? "" : property.value}
                defaultValue={property.defaultValue}
                label={property.field.label}
                placeholder="None"
                readOnly={readOnly}
                maxLength={PLUGIN_PROPERTY_MAX_LENGTH}
                onSave={(value) =>
                  patchPluginProperty(project, plugin, property.field, value)
                }
              />
            </PropertyRow>
          ))}
        </PropertyList>
      ) : null}
    </div>
  );
}

/**
 * The project page's Properties card: full name, code, color and icon change
 * in place. Each active plugin that adds project properties gets a collapsed
 * section below them. Import tasks… and Archive or Restore sit at its
 * bottom, in place of the "…" menu the page had.
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
  const [plugins, setPlugins] = useState<ProjectPropertyPlugin[]>([]);
  const [teams, setTeams] = useState<TeamConnectionChoice[]>([]);
  useEffect(() => {
    let active = true;
    // A failed overview shows no plugin sections and no team actions; the
    // rest of the card works.
    void listProjectPropertyPlugins()
      .then((next) => active && setPlugins(next))
      .catch((error: unknown) => {
        console.warn("Plugin project properties unavailable.", error);
      });
    void listTeamConnections()
      .then((next) => active && setTeams(next))
      .catch(() => undefined);
    // A team connection removed, added or turned off elsewhere shows here.
    const unsubscribe = subscribePluginsOverview((overview) => {
      if (active) setTeams(teamConnectionsOf(overview));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
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
        <ProjectTeamRow project={project} teams={teams} />
      </PropertyList>
      {plugins.map((plugin) => (
        <PluginPropertySection
          key={plugin.pluginId}
          project={project}
          plugin={plugin}
          readOnly={isArchived}
        />
      ))}
      <PropertyActions>
        <PropertyAction
          disabled={isArchived || isImporting}
          title={isArchived ? "Restore the project first" : undefined}
          onClick={onImport}
        >
          <Download aria-hidden="true" />
          {isImporting ? "Importing tasks…" : "Import tasks…"}
        </PropertyAction>
        <ProjectTeamAction
          project={project}
          teams={teams}
          disabled={isArchived && !project.team}
        />
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

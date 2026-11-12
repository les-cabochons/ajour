import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ProjectPropertyField } from "@ajour/shared";
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
  PropertySection,
} from "@/components/property-list";
import { Button } from "@/components/ui/button";
import { ColorField } from "@/components/ui/color-field";
import { FieldWarning } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect, type SelectOption } from "@/components/ui/option-select";
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
  formatProjectDates,
  getProjectEndedOn,
} from "@/domain/projects/project-dates";
import { isManagedProject } from "@/domain/projects/project-transitions";
import {
  getDuplicateProjectNameWarning,
  normalizeProjectCode,
  PROJECT_NAME_ERROR,
} from "@/domain/projects/project-names";
import {
  getTaskNameField,
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
  LockedValue,
  OpenInSourceAction,
} from "@/features/projects/project-source-ui";
import { useTaskPropertyPlugins } from "@/features/projects/commits-as";
import {
  ProjectTeamAction,
  ProjectTeamRow,
} from "@/features/projects/project-team-ui";
import { localStore } from "@/lib/local-store";
import { useLocalState } from "@/lib/local-hooks";
import { useTodayIsoDate } from "@/lib/use-now";
import { listProjectPropertyPlugins } from "@/lib/plugin-project-properties";
import { subscribePluginsOverview } from "@/lib/app-api";
import {
  listTeamConnections,
  teamConnectionsOf,
  type TeamConnectionChoice,
} from "@/lib/team-sync";
import { PROJECT_ICON_PRESETS, ProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";
import { PickerChevron } from "@/components/picker-chevron";
import { RiPencilLine, RiRefreshLine } from "@remixicon/react";

/*
 * The project page edits in place, like the backlog item page: each field
 * saves on Enter, when focus leaves it, or when a picker changes, with the
 * Undo toast. Escape puts the saved value back. An archived project is
 * read-only until Restore.
 */

/** The color and icon pickers read as values until hovered, aligned with the text rows. */
const PICKER_CLASS_NAME =
  "-ml-[calc(0.625rem+1px)] h-(--control-height) w-[calc(100%+0.625rem+1px)] justify-start border-transparent bg-transparent shadow-none hover:border-(--field-border) hover:bg-(--field-bg)";

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
 * While `value` is empty, the field and its resting text show `placeholder`,
 * which says what to type or where an empty value comes from, never a value
 * (styles/projects.css). A non-empty `defaultValue`, the value the field
 * falls back to, is named in the accessible label only. `validate` refuses a value
 * with a sentence: the field stays open with the typed text and says why
 * under it. `warn` says something about the typed text that doesn't block
 * saving, such as a name another project has.
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
  validate,
  warn,
  onSave,
  renderValue,
}: {
  value: string;
  /** The value an empty field falls back to, such as a plugin property's default. */
  defaultValue?: string;
  /** The field's accessible name, such as "Code". */
  label: string;
  /** Shown while the value is empty: what to type, such as "Add", or where an empty value comes from, such as "Same as full name". */
  placeholder: string;
  readOnly: boolean;
  className?: string;
  inputClassName?: string;
  /** Longest text the field accepts while editing. */
  maxLength?: number;
  validate?: (value: string) => string | null;
  warn?: (value: string) => string | null;
  onSave: (value: string) => void;
  renderValue?: (props: {
    className: string;
    onClick?: () => void;
  }) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  // Enter saves and unmounts the input, whose blur then must not save twice.
  const closedRef = useRef(false);

  function close(save: boolean, next: string) {
    if (closedRef.current) return;
    if (save) {
      const refusal = validate?.(next) ?? null;
      if (refusal) {
        setError(refusal);
        return;
      }
    }
    closedRef.current = true;
    setError(null);
    if (save) onSave(next);
    setEditing(false);
  }

  if (!editing || readOnly) {
    const targetClassName = cn(!readOnly && "project-inline-target", className);
    const open = readOnly
      ? undefined
      : () => {
          closedRef.current = false;
          setDraft(value);
          setError(null);
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
          "-mx-1 flex w-full min-w-0 items-center gap-1 px-1 text-left disabled:cursor-default",
          !value && "text-muted-foreground",
          targetClassName,
        )}
        onClick={open}
      >
        <span
          className="min-w-0 truncate"
          data-placeholder={value ? undefined : ""}
        >
          {value || placeholder}
        </span>
        {/* A pencil says the value edits in place (council round 10). */}
        {readOnly ? null : (
          <RiPencilLine
            aria-hidden
            className="ml-auto size-3 shrink-0 text-muted-foreground"
          />
        )}
      </button>
    );
  }

  const warning = error ? null : (warn?.(draft) ?? null);
  return (
    <span className="flex w-full min-w-0 flex-col gap-1">
      <Input
        autoFocus
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        className={cn("-mx-1 h-7 px-1", inputClassName)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          if (error) setError(null);
        }}
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
      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      ) : null}
      <FieldWarning>{warning}</FieldWarning>
    </span>
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
      placeholder="Same as full name"
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
              className={cn("max-w-full text-left", className)}
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
 * What an empty plugin property says: the Ajour field it falls back to, as
 * the task editor's "Same name", or "Add" when it has none. Never the
 * fallback's value, which would read as a saved one.
 */
function getPluginPropertyPlaceholder(field: ProjectPropertyField) {
  if (field.defaultFrom === "fullName") return "Same as full name";
  if (field.defaultFrom === "code") return "Same as code";
  return "Add";
}

const LOCAL_ONLY_OPTIONS: SelectOption<"commits" | "local">[] = [
  { value: "commits", label: "Commits" },
  { value: "local", label: "Local only" },
];

/** Makes the project Local only, or commit again, with Undo. */
function setLocalOnly(project: LocalProject, localOnly: boolean) {
  if (Boolean(project.localOnly) === localOnly) return;
  offerUndo(
    localStore.updateProjectWithUndo(project._id, {
      localOnly: localOnly || undefined,
    }),
    {
      title: localOnly ? "Project set to local only" : "Project set to commit",
      subject: "project",
    },
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
  return (
    <PropertySection
      title={plugin.capability.section}
      open={open}
      onOpenChange={setOpen}
    >
      <PropertyList>
        {resolvePluginProperties(project, plugin).map((property) => (
          <PropertyRow key={property.field.id} label={property.field.label}>
            <InlineText
              value={property.isDefault ? "" : property.value}
              defaultValue={property.defaultValue}
              label={property.field.label}
              placeholder={getPluginPropertyPlaceholder(property.field)}
              readOnly={readOnly}
              maxLength={PLUGIN_PROPERTY_MAX_LENGTH}
              onSave={(value) =>
                patchPluginProperty(project, plugin, property.field, value)
              }
            />
          </PropertyRow>
        ))}
      </PropertyList>
    </PropertySection>
  );
}

/**
 * The project page's Properties card: full name, code, color and icon change
 * in place. On a managed project, the full name, code, client and dates are
 * its source's, locked, the client and dates only when the source gave them,
 * and Open in <source> leads the actions. A muted line says when a managed
 * project past its last day ended. Each active
 * plugin that adds project properties gets a collapsed section below them.
 * Import tasks… and Archive or Restore sit at its bottom, in place of the
 * "…" menu the page had.
 */
export function ProjectPropertiesCard({
  project,
  sourceLabel,
  isImporting,
  onImport,
  onArchive,
  onRestore,
  sourceSyncing = false,
  onSyncSource,
}: {
  project: LocalProject;
  /** What the user calls the project's source, for a managed project. */
  sourceLabel?: string;
  isImporting: boolean;
  /** A sync of the managed project's source is running from Sync now. */
  sourceSyncing?: boolean;
  /** Sync now, for a managed project: syncs its source (#686). */
  onSyncSource?: () => void;
  /** Opens the Excel file picker. */
  onImport: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const isArchived = project.status === "archived";
  const managed = isManagedProject(project);
  const { projects } = useLocalState();
  const sourceUrl = project.source?.url;
  const today = useTodayIsoDate();
  const currentYear = Number(today.slice(0, 4));
  const dates = managed ? formatProjectDates(project, currentYear) : undefined;
  const endedOn = managed
    ? getProjectEndedOn(project, today, currentYear)
    : undefined;
  const [plugins, setPlugins] = useState<ProjectPropertyPlugin[]>([]);
  // The first plugin that commits tasks under a name, such as Workday, names
  // the Local only row.
  const committingPlugin = useTaskPropertyPlugins().find((plugin) =>
    getTaskNameField(plugin),
  );
  const [teams, setTeams] = useState<TeamConnectionChoice[]>([]);
  useEffect(() => {
    let active = true;
    // A failed overview shows no plugin sections and no team actions; the
    // rest of the card works.
    void listProjectPropertyPlugins()
      .then((next) => active && setPlugins(next))
      // The overview call's own event records the failure.
      .catch(() => undefined);
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
          {managed ? (
            <LockedValue label={sourceLabel}>{project.name}</LockedValue>
          ) : (
            <InlineText
              value={project.name}
              label="Full name"
              placeholder="Full name"
              readOnly={isArchived}
              validate={(value) => (value.trim() ? null : PROJECT_NAME_ERROR)}
              warn={(value) =>
                getDuplicateProjectNameWarning(projects, value, project._id)
              }
              onSave={(value) =>
                patchProject(
                  project,
                  (fields) => setProjectFormName(fields, value),
                  "Project renamed",
                )
              }
            />
          )}
        </PropertyRow>
        <PropertyRow label="Code">
          {managed ? (
            <LockedValue label={sourceLabel} muted={!project.code}>
              {project.code || "None"}
            </LockedValue>
          ) : (
            <InlineText
              value={project.code ?? ""}
              label="Code"
              placeholder="Add"
              readOnly={isArchived}
              validate={(value) => {
                const code = normalizeProjectCode(value);
                return code.ok ? null : code.error;
              }}
              onSave={(value) =>
                patchProject(
                  project,
                  (fields) => ({ ...fields, code: value }),
                  "Project code changed",
                )
              }
            />
          )}
        </PropertyRow>
        {managed && project.client ? (
          <PropertyRow label="Client">
            <LockedValue label={sourceLabel}>{project.client}</LockedValue>
          </PropertyRow>
        ) : null}
        {dates ? (
          <PropertyRow label="Dates">
            <LockedValue label={sourceLabel}>{dates}</LockedValue>
          </PropertyRow>
        ) : null}
        <PropertyRow label="Color">
          {isArchived ? (
            <ColorSwatch color={project.color} />
          ) : (
            <ColorField
              label="Project color"
              className={PICKER_CLASS_NAME}
              trailing={<PickerChevron />}
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
                <PickerChevron />
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
        {committingPlugin ? (
          <PropertyRow label={committingPlugin.capability.section}>
            {isArchived ? (
              project.localOnly ? (
                "Local only"
              ) : (
                "Commits"
              )
            ) : (
              <OptionSelect
                label={`${committingPlugin.capability.section}: commits or local only`}
                className={PICKER_CLASS_NAME}
                value={project.localOnly ? "local" : "commits"}
                options={LOCAL_ONLY_OPTIONS}
                onChange={(next) => setLocalOnly(project, next === "local")}
              />
            )}
          </PropertyRow>
        ) : null}
        <ProjectTeamRow project={project} teams={teams} />
      </PropertyList>
      {endedOn ? (
        <p className="text-xs text-muted-foreground">Ended on {endedOn}</p>
      ) : null}
      {plugins.map((plugin) => (
        <PluginPropertySection
          key={plugin.pluginId}
          project={project}
          plugin={plugin}
          readOnly={isArchived}
        />
      ))}
      <PropertyActions>
        {sourceUrl ? (
          <OpenInSourceAction url={sourceUrl} label={sourceLabel} />
        ) : null}
        {managed && onSyncSource ? (
          <PropertyAction disabled={sourceSyncing} onClick={onSyncSource}>
            <RiRefreshLine aria-hidden="true" />
            {sourceSyncing ? "Syncing…" : "Sync now"}
          </PropertyAction>
        ) : null}
        {/* A managed project's tasks come from its source. */}
        {managed ? null : (
          <PropertyAction
            disabled={isArchived || isImporting}
            title={isArchived ? "Restore the project first" : undefined}
            onClick={onImport}
          >
            <Download aria-hidden="true" />
            {isImporting ? "Importing tasks…" : "Import tasks…"}
          </PropertyAction>
        )}
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

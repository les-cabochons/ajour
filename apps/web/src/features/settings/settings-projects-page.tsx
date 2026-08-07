import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type { ProjectDataShapePluginManifest } from "@timetracker/shared";
import {
  RiDownloadLine as Download,
  RiFolderChartLine as FolderKanban,
  RiUploadLine as Upload,
} from "@remixicon/react";
import { AppPanel, MessagePanel, SurfaceCallout } from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import {
  exportProjectsWithDataShape,
  getProjectDataShapePlugins,
  importProjectsWithDataShape,
} from "@/lib/app-api";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { ProjectIcon } from "@/lib/project-icons";
import {
  DEFAULT_PROJECT_DATA_SHAPE_ID,
  buildProjectDataShapeExportProjects,
  buildProjectTransferFilename,
  createProjectDataShapeWorkbook,
  createProjectTransferWorkbook,
  downloadProjectTransferWorkbook,
  parseProjectDataShapeWorkbook,
  parseProjectTransferWorkbook,
} from "./settings-projects";

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatProjectImportSummary(result: {
  createdProjectCount: number;
  mergedProjectCount: number;
  addedTaskCount: number;
  updatedTaskCount: number;
}) {
  const parts = [];

  if (result.createdProjectCount > 0) {
    parts.push(formatCount(result.createdProjectCount, "project created"));
  }
  if (result.mergedProjectCount > 0) {
    parts.push(formatCount(result.mergedProjectCount, "project merged"));
  }
  if (result.addedTaskCount > 0) {
    parts.push(formatCount(result.addedTaskCount, "task added"));
  }
  if (result.updatedTaskCount > 0) {
    parts.push(formatCount(result.updatedTaskCount, "task updated"));
  }

  return parts.length > 0 ? `${parts.join(" · ")}.` : "No projects changed.";
}

export function SettingsProjectsPage() {
  const state = useLocalState();
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(() => state.projects.map((project) => project._id));
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [shapePlugins, setShapePlugins] = useState<
    ProjectDataShapePluginManifest[]
  >([]);
  const [isTransferring, setIsTransferring] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getProjectDataShapePlugins()
      .then((plugins) => {
        if (active) {
          setShapePlugins(plugins);
        }
      })
      .catch(() => {
        if (active) {
          setShapePlugins([]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSelectedProjectIds((current) => {
      if (current.length === 0 && state.projects.length > 0) {
        return state.projects.map((project) => project._id);
      }

      const validProjectIds = new Set(state.projects.map((project) => project._id));
      const next = current.filter((projectId) => validProjectIds.has(projectId));
      return next.length === current.length ? current : next;
    });
  }, [state.projects]);

  const sortedProjects = useMemo(
    () =>
      [...state.projects].sort(
        (left, right) =>
          left.status.localeCompare(right.status) ||
          left.name.localeCompare(right.name),
      ),
    [state.projects],
  );

  const selectedProjects = useMemo(
    () => sortedProjects.filter((project) => selectedProjectIds.includes(project._id)),
    [selectedProjectIds, sortedProjects],
  );

  const selectedTaskCount = useMemo(
    () => selectedProjects.reduce((sum, project) => sum + project.tasks.length, 0),
    [selectedProjects],
  );

  const selectedShapePlugin = shapePlugins.find(
    (plugin) => plugin.id === state.userPreferences.projectDataShapeId,
  );
  const selectedShapeId = selectedShapePlugin
    ? selectedShapePlugin.id
    : DEFAULT_PROJECT_DATA_SHAPE_ID;
  const selectedShapeName = selectedShapePlugin?.displayName ?? "Ajour default";

  function handleShapeChange(shapeId: string) {
    localStore.setUserPreferences({ projectDataShapeId: shapeId });
    setSelectedImportFile(null);
    setStatusMessage("");
    setExportError("");
    setError("");
  }

  async function handleExport() {
    if (selectedProjectIds.length === 0) {
      return;
    }

    setIsTransferring(true);
    setExportError("");
    try {
      const workbookBytes = selectedShapePlugin
        ? await exportProjectsWithDataShape(
            selectedShapePlugin.id,
            buildProjectDataShapeExportProjects({
              projects: state.projects,
              projectIds: selectedProjectIds,
            }),
          ).then((result) =>
            createProjectDataShapeWorkbook(
              selectedShapePlugin.capabilities.projectDataShape,
              result.datasets,
            ),
          )
        : await createProjectTransferWorkbook({
            projects: state.projects,
            projectIds: selectedProjectIds,
          });

      downloadProjectTransferWorkbook(
        workbookBytes,
        buildProjectTransferFilename(),
      );
    } catch (nextError) {
      setExportError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to export the workbook.",
      );
    } finally {
      setIsTransferring(false);
    }
  }

  function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedImportFile(event.target.files?.[0] ?? null);
    setError("");
    setStatusMessage("");
  }

  async function handleImport() {
    if (!selectedImportFile) {
      return;
    }

    try {
      setIsTransferring(true);
      const workbookBytes = await selectedImportFile.arrayBuffer();
      const result = selectedShapePlugin
        ? await parseProjectDataShapeWorkbook(
            workbookBytes,
            selectedShapePlugin.capabilities.projectDataShape,
          )
            .then((datasets) =>
              importProjectsWithDataShape(selectedShapePlugin.id, datasets),
            )
            .then((response) =>
              localStore.importProjectDataShapeProjects(response.projects),
            )
        : localStore.importProjectWorkbookRows(
            await parseProjectTransferWorkbook(workbookBytes),
          );
      setStatusMessage(formatProjectImportSummary(result));
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to import the workbook.");
      setStatusMessage("");
    } finally {
      setIsTransferring(false);
    }
  }

  function setProjectSelection(projectId: string, selected: boolean) {
    setSelectedProjectIds((current) =>
      selected
        ? current.includes(projectId)
          ? current
          : [...current, projectId]
        : current.filter((id) => id !== projectId),
    );
  }

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Project Import/Export</h2>
        <p className="settings-section-desc">
          Choose a schema, then export projects and tasks to Excel or import the
          same structured workbook to merge projects by name.
        </p>

        <AppPanel>
          <div className="grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="project-data-shape">Schema</Label>
              <NativeSelect
                id="project-data-shape"
                value={selectedShapeId}
                onChange={(event) => handleShapeChange(event.target.value)}
              >
                <option value={DEFAULT_PROJECT_DATA_SHAPE_ID}>
                  Ajour default
                </option>
                {shapePlugins.map((plugin) => (
                  <option key={plugin.id} value={plugin.id}>
                    {plugin.displayName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <p className="text-sm leading-5 text-foreground/65">
              {selectedShapePlugin?.description ??
                "Ajour's built-in schema is always available, even when no plugins are installed."}
            </p>
          </div>
        </AppPanel>

        <AppPanel>
          <SurfaceCallout icon={FolderKanban} title="Excel workbook export">
            Select the projects to export using the {selectedShapeName} schema.
            Excel controls the file format; the schema controls its fields.
          </SurfaceCallout>

          <div className="flex flex-wrap items-center gap-2 text-sm text-foreground/70">
            <Badge className="bg-muted">{formatCount(selectedProjects.length, "project")} selected</Badge>
            <Badge className="bg-muted">{formatCount(selectedTaskCount, "task")} included</Badge>
          </div>

          {sortedProjects.length === 0 ? (
            <MessagePanel>No projects are available yet.</MessagePanel>
          ) : (
            <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-low)] p-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedProjectIds(sortedProjects.map((project) => project._id))}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedProjectIds([])}
                >
                  Clear
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {sortedProjects.map((project) => {
                  const isSelected = selectedProjectIds.includes(project._id);
                  return (
                    <label
                      key={project._id}
                      className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => setProjectSelection(project._id, checked)}
                        className="mt-1"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <ProjectIcon
                            icon={project.icon}
                            color={project.color}
                            className="size-3.5"
                          />
                          <span className="text-sm font-medium text-foreground">{project.name}</span>
                          {project.code ? <Badge className="bg-muted">{project.code}</Badge> : null}
                          <Badge className="bg-muted">{project.status}</Badge>
                        </div>
                        <p className="text-sm text-foreground/65">
                          {formatCount(project.tasks.length, "task")}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-low)] p-4">
            <div className="space-y-1 text-sm text-foreground/65">
              <p>Filename: {buildProjectTransferFilename()}</p>
              <p>Projects without tasks still export one row so they can be re-imported later.</p>
            </div>

            <Button
              type="button"
              onClick={handleExport}
              disabled={selectedProjectIds.length === 0 || isTransferring}
            >
              <Download className="h-4 w-4" />
              Export to Excel
            </Button>
          </div>
          {exportError ? (
            <MessagePanel tone="warning">{exportError}</MessagePanel>
          ) : null}
        </AppPanel>

        <AppPanel>
          <SurfaceCallout icon={Upload} title="Excel workbook import">
            Import an Excel workbook using the {selectedShapeName} schema
            to merge projects by name, update project metadata, and add missing
            tasks.
          </SurfaceCallout>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <Label>Workbook</Label>
              <Input
                key={selectedShapeId}
                type="file"
                accept=".xlsx"
                onChange={handleImportFileChange}
              />
              <p className="text-sm text-foreground/65">
                {selectedImportFile ? selectedImportFile.name : "Choose a .xlsx file with a Projects sheet."}
              </p>
            </div>

            <Button
              type="button"
              onClick={handleImport}
              disabled={!selectedImportFile || isTransferring}
            >
              <Upload className="h-4 w-4" />
              Import workbook
            </Button>
          </div>

          {statusMessage ? <MessagePanel>{statusMessage}</MessagePanel> : null}
          {error ? <MessagePanel tone="warning">{error}</MessagePanel> : null}
        </AppPanel>
      </section>
    </div>
  );
}

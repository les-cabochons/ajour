import { useEffect, useMemo, useState } from "react";
import type { ProjectDataShapePluginManifest } from "@ajour/shared";
import {
  RiDownloadLine as Download,
  RiUploadLine as Upload,
} from "@remixicon/react";
import {
  AppPanel,
  MessagePanel,
  ResultLine,
  SettingRow,
} from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileField } from "@/components/ui/file-field";
import { OptionSelect } from "@/components/ui/option-select";
import {
  exportProjectsWithDataShape,
  getProjectDataShapePlugins,
  importProjectsWithDataShape,
} from "@/lib/app-api";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { ProjectIcon } from "@/lib/project-icons";
import { readWorkbookSheets } from "@/lib/workbook-sheets";
import {
  DEFAULT_PROJECT_DATA_SHAPE_ID,
  buildProjectDataShapeExportProjects,
  buildProjectTransferFilename,
  createProjectDataShapeWorkbook,
  createProjectTransferWorkbook,
  downloadProjectTransferWorkbook,
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
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(() =>
    state.projects.map((project) => project._id),
  );
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(
    null,
  );
  const [shapePlugins, setShapePlugins] = useState<
    ProjectDataShapePluginManifest[]
  >([]);
  const [isTransferring, setIsTransferring] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [exportMessage, setExportMessage] = useState("");
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

      const validProjectIds = new Set(
        state.projects.map((project) => project._id),
      );
      const next = current.filter((projectId) =>
        validProjectIds.has(projectId),
      );
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
    () =>
      sortedProjects.filter((project) =>
        selectedProjectIds.includes(project._id),
      ),
    [selectedProjectIds, sortedProjects],
  );

  const selectedTaskCount = useMemo(
    () =>
      selectedProjects.reduce((sum, project) => sum + project.tasks.length, 0),
    [selectedProjects],
  );

  const selectedShapePlugin = shapePlugins.find(
    (plugin) => plugin.id === state.userPreferences.projectDataShapeId,
  );
  const selectedShapeId = selectedShapePlugin
    ? selectedShapePlugin.id
    : DEFAULT_PROJECT_DATA_SHAPE_ID;
  const selectedShapeName = selectedShapePlugin?.displayName ?? "Ajour default";
  // A schema without an export layout only imports.
  const selectedShapeExports =
    !selectedShapePlugin ||
    selectedShapePlugin.capabilities.projectDataShape.datasets !== undefined;

  function handleShapeChange(shapeId: string) {
    localStore.setUserPreferences({ projectDataShapeId: shapeId });
    setSelectedImportFile(null);
    setStatusMessage("");
    setExportMessage("");
    setExportError("");
    setError("");
  }

  async function handleExport() {
    if (selectedProjectIds.length === 0) {
      return;
    }

    setIsTransferring(true);
    setExportMessage("");
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

      const filename = buildProjectTransferFilename();
      downloadProjectTransferWorkbook(workbookBytes, filename);
      setExportMessage(
        `Exported ${filename} · ${formatCount(selectedProjects.length, "project")}, ${formatCount(selectedTaskCount, "task")}.`,
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

  function handleImportFileChange(file: File | null) {
    setSelectedImportFile(file);
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
        ? await readWorkbookSheets(workbookBytes)
            .then((sheets) =>
              importProjectsWithDataShape(selectedShapePlugin.id, sheets),
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
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to import the workbook.",
      );
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
        <h2 className="settings-section-title">Import and export projects</h2>
        <p className="settings-section-desc">
          Choose a schema, then export projects and tasks to Excel or import the
          same structured workbook to merge projects by name.
        </p>

        <AppPanel>
          <SettingRow
            label="Schema"
            labelFor="project-data-shape"
            description={
              selectedShapePlugin?.description ??
              "Ajour's built-in schema is always available, even when no plugins are installed."
            }
          >
            <OptionSelect
              id="project-data-shape"
              size="default"
              className="w-60 max-w-full"
              value={selectedShapeId}
              onChange={handleShapeChange}
              options={[
                {
                  value: DEFAULT_PROJECT_DATA_SHAPE_ID,
                  label: "Ajour default",
                },
                ...shapePlugins.map((plugin) => ({
                  value: plugin.id,
                  label: plugin.displayName,
                })),
              ]}
            />
          </SettingRow>
        </AppPanel>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Export projects</h2>
        {selectedShapeExports ? (
          <p className="settings-section-desc">
            Select the projects to export using the {selectedShapeName} schema.
            Excel controls the file format; the schema controls its fields.
          </p>
        ) : (
          <p className="settings-section-desc">
            The {selectedShapeName} schema only imports. To export, choose Ajour
            default.
          </p>
        )}

        {selectedShapeExports ? (
          <AppPanel>
            <SettingRow
              label="Projects"
              description={
                sortedProjects.length === 0
                  ? "No projects are available yet."
                  : `${formatCount(selectedProjects.length, "project")} selected · ${formatCount(selectedTaskCount, "task")} included`
              }
            >
              {sortedProjects.length === 0 ? null : (
                <>
                  <Button
                    type="button"
                    variant="outline"

                    onClick={() =>
                      setSelectedProjectIds(
                        sortedProjects.map((project) => project._id),
                      )
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"

                    onClick={() => setSelectedProjectIds([])}
                  >
                    Clear
                  </Button>
                </>
              )}
            </SettingRow>

            {sortedProjects.length === 0 ? null : (
              <div className="-mx-2 grid gap-x-6 gap-y-1 desktop:grid-cols-2">
                {sortedProjects.map((project) => {
                  const isSelected = selectedProjectIds.includes(project._id);
                  return (
                    <label
                      key={project._id}
                      className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-[var(--hover-bg)]"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          setProjectSelection(project._id, checked)
                        }
                        className="mt-0.5"
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <ProjectIcon
                            icon={project.icon}
                            color={project.color}
                            className="size-3.5 shrink-0"
                          />
                          <span className="truncate text-sm font-medium text-foreground">
                            {project.name}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-tertiary)]">
                          {[
                            project.code,
                            project.status,
                            formatCount(project.tasks.length, "task"),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            <SettingRow
              label="Excel workbook"
              description={
                <>
                  <p>Filename: {buildProjectTransferFilename()}</p>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    Projects without tasks still export one row so they can be
                    re-imported later.
                  </p>
                </>
              }
            >
              <Button
                type="button"
                onClick={handleExport}
                disabled={selectedProjectIds.length === 0 || isTransferring}
              >
                <Download className="h-4 w-4" />
                Export to Excel
              </Button>
            </SettingRow>

            {exportMessage ? <ResultLine>{exportMessage}</ResultLine> : null}
            {exportError ? (
              <MessagePanel tone="warning">{exportError}</MessagePanel>
            ) : null}
          </AppPanel>
        ) : null}
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Import projects</h2>
        <p className="settings-section-desc">
          Import an Excel workbook using the {selectedShapeName} schema to merge
          projects by name, update project metadata, and add missing tasks.
        </p>

        <AppPanel>
          <SettingRow
            label="Workbook"
            labelFor="project-import-file"
            description={
              selectedShapePlugin
                ? `Choose a .xlsx file the ${selectedShapeName} schema reads.`
                : "Choose a .xlsx file with a Projects sheet."
            }
            stacked
          >
            <FileField
              key={selectedShapeId}
              id="project-import-file"
              accept=".xlsx"
              file={selectedImportFile}
              onChange={handleImportFileChange}
              className="flex-[1_1_14rem]"
            />
            <Button
              type="button"
              onClick={handleImport}
              disabled={!selectedImportFile || isTransferring}
            >
              <Upload className="h-4 w-4" />
              Import workbook
            </Button>
          </SettingRow>

          {statusMessage ? <ResultLine>{statusMessage}</ResultLine> : null}
          {error ? <MessagePanel tone="warning">{error}</MessagePanel> : null}
        </AppPanel>
      </section>
    </div>
  );
}

/** A finished export or import, said in plain text under the action. */

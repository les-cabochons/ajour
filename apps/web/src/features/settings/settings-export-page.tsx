import { useMemo, useState, type ChangeEvent } from "react";
import {
  RiDownloadLine as Download,
  RiFileExcel2Line as FileSpreadsheet,
  RiUploadLine as Upload,
} from "@remixicon/react";
import {
  AppPanel,
  MessagePanel,
  SurfaceCallout,
} from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { todayIsoDate } from "@/lib/utils";
import {
  buildTimesheetExportFilename,
  buildTimesheetExportRows,
  createTimesheetExportWorkbook,
  detectTimesheetImportConflicts,
  downloadWorkbookFile,
  parseTimesheetImportWorkbook,
} from "./settings-export";

function getAvailableDateRange(localDates: string[]) {
  const sortedDates = [...localDates].sort((left, right) =>
    left.localeCompare(right),
  );
  const fallbackDate = todayIsoDate();

  return {
    startDate: sortedDates[0] ?? fallbackDate,
    endDate: sortedDates.at(-1) ?? fallbackDate,
  };
}

function formatDecimalHours(value: number) {
  return value.toFixed(2).replace(/\.00$/, "");
}

function formatDraftHours(durationMs: number) {
  return formatDecimalHours(durationMs / (60 * 60 * 1000));
}

export function SettingsExportPage() {
  const state = useLocalState();
  const availableRange = useMemo(
    () =>
      getAvailableDateRange(
        state.timesheetEntries.map((entry) => entry.localDate),
      ),
    [state.timesheetEntries],
  );
  const [startDate, setStartDate] = useState(availableRange.startDate);
  const [endDate, setEndDate] = useState(availableRange.endDate);
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const hasInvalidRange = startDate > endDate;

  const rows = useMemo(
    () =>
      hasInvalidRange
        ? []
        : buildTimesheetExportRows({
            entries: state.timesheetEntries,
            projects: state.projects,
            startDate,
            endDate,
          }),
    [
      endDate,
      hasInvalidRange,
      startDate,
      state.projects,
      state.timesheetEntries,
    ],
  );

  const totalHours = useMemo(
    () => rows.reduce((sum, row) => sum + row.hours, 0),
    [rows],
  );
  const pendingImportCount = state.timesheetImportDrafts.length;
  const pendingConflictCount = state.timesheetImportDrafts.filter(
    (draft) => draft.potentialConflict,
  ).length;
  const pendingReadyCount = pendingImportCount - pendingConflictCount;

  async function handleExport() {
    if (hasInvalidRange || rows.length === 0) {
      return;
    }

    const workbookBytes = await createTimesheetExportWorkbook({
      entries: state.timesheetEntries,
      projects: state.projects,
      startDate,
      endDate,
    });

    downloadWorkbookFile(
      workbookBytes,
      buildTimesheetExportFilename(startDate, endDate),
    );
  }

  function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    setSelectedImportFile(event.target.files?.[0] ?? null);
    setError("");
    setStatusMessage("");
  }

  async function handleReviewImport() {
    if (!selectedImportFile) {
      return;
    }

    try {
      const workbookBytes = await selectedImportFile.arrayBuffer();
      const importedRows = await parseTimesheetImportWorkbook(workbookBytes);
      const reviewedRows = detectTimesheetImportConflicts({
        rows: importedRows,
        entries: state.timesheetEntries,
        projects: state.projects,
      });

      localStore.stageTimesheetImportRows(reviewedRows);
      setStatusMessage(
        `${reviewedRows.length} row${reviewedRows.length === 1 ? "" : "s"} staged for review${
          reviewedRows.some((row) => row.potentialConflict)
            ? ` · ${reviewedRows.filter((row) => row.potentialConflict).length} potential conflict${reviewedRows.filter((row) => row.potentialConflict).length === 1 ? "" : "s"}`
            : ""
        }.`,
      );
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to parse the workbook.",
      );
      setStatusMessage("");
    }
  }

  function handleAddDraft(draftId: string) {
    localStore.commitTimesheetImportDraft(draftId);
  }

  function handleDismissDraft(draftId: string) {
    localStore.dismissTimesheetImportDraft(draftId);
  }

  function handleAddAllReady() {
    localStore.commitReadyTimesheetImportDrafts();
  }

  function handleDismissAll() {
    localStore.dismissAllTimesheetImportDrafts();
  }

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">
          Import and export time entries
        </h2>
        <p className="settings-section-desc">
          Export time entries to Excel or import workbook rows into a staged
          review queue before adding them to your local timesheet.
        </p>

        <AppPanel>
          <SurfaceCallout icon={FileSpreadsheet} title="Excel workbook export">
            {state.timesheetEntries.length === 0
              ? "No time entries are available yet."
              : `Time entries available from ${availableRange.startDate} to ${availableRange.endDate}.`}
          </SurfaceCallout>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>From</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                max={endDate}
              />
            </div>

            <div className="space-y-2">
              <Label>To</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                min={startDate}
              />
            </div>
          </div>

          {hasInvalidRange ? (
            <MessagePanel tone="warning">
              The start day must be on or before the end day.
            </MessagePanel>
          ) : (
            <div className="flex flex-col gap-1 text-sm text-foreground/70">
              <p>
                {rows.length} {rows.length === 1 ? "entry" : "entries"} selected
              </p>
              <p>
                {formatDecimalHours(totalHours)} hours in decimal format will be
                exported.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-low)] p-4">
            <div className="space-y-1 text-sm text-foreground/65">
              <p>
                Filename: {buildTimesheetExportFilename(startDate, endDate)}
              </p>
              <p>
                Rows without an assigned project or task are exported with blank
                cells.
              </p>
            </div>

            <Button
              type="button"
              onClick={handleExport}
              disabled={hasInvalidRange || rows.length === 0}
            >
              <Download className="h-4 w-4" />
              Export to Excel
            </Button>
          </div>
        </AppPanel>

        <AppPanel>
          <SurfaceCallout icon={Upload} title="Excel workbook import">
            Upload the exported workbook format and review every row before it
            is added locally.
          </SurfaceCallout>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <Label>Workbook</Label>
              <Input
                type="file"
                accept=".xlsx"
                onChange={handleImportFileChange}
              />
              <p className="text-sm text-foreground/65">
                {selectedImportFile
                  ? selectedImportFile.name
                  : "Choose a .xlsx file with a Time entries sheet."}
              </p>
            </div>

            <Button
              type="button"
              onClick={handleReviewImport}
              disabled={!selectedImportFile}
            >
              <Upload className="h-4 w-4" />
              Review import
            </Button>
          </div>

          {statusMessage ? <MessagePanel>{statusMessage}</MessagePanel> : null}
          {error ? <MessagePanel tone="warning">{error}</MessagePanel> : null}

          <div className="flex flex-wrap items-center gap-2 text-sm text-foreground/70">
            <Badge className="bg-muted">{pendingImportCount} pending</Badge>
            <Badge className="bg-muted">{pendingReadyCount} ready</Badge>
            <Badge
              className={
                pendingConflictCount > 0
                  ? "bg-[var(--danger-muted)] text-[var(--danger-light)]"
                  : "bg-muted"
              }
            >
              {pendingConflictCount} potential conflict
              {pendingConflictCount === 1 ? "" : "s"}
            </Badge>
          </div>

          {pendingImportCount === 0 ? (
            <MessagePanel>
              No staged workbook rows yet. Upload a workbook and review it
              before importing.
            </MessagePanel>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddAllReady}
                  disabled={pendingReadyCount === 0}
                >
                  Add all ready
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDismissAll}
                >
                  Dismiss all
                </Button>
              </div>

              <div className="space-y-2">
                {state.timesheetImportDrafts.map((draft) => (
                  <div
                    key={draft._id}
                    className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-low)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {draft.localDate}
                          </span>
                          {draft.projectName ? (
                            <Badge className="bg-muted">
                              {draft.projectName}
                            </Badge>
                          ) : null}
                          {draft.taskName ? (
                            <Badge className="bg-muted">{draft.taskName}</Badge>
                          ) : null}
                          <Badge
                            className={
                              draft.potentialConflict
                                ? "bg-[var(--danger-muted)] text-[var(--danger-light)]"
                                : "bg-muted"
                            }
                          >
                            {draft.potentialConflict
                              ? "Potential conflict"
                              : "Ready to add"}
                          </Badge>
                        </div>
                        <div className="text-sm text-foreground/65">
                          {formatDraftHours(draft.durationMs)} hours
                          {draft.note ? ` · ${draft.note}` : ""}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={
                            draft.potentialConflict ? "outline" : "secondary"
                          }
                          onClick={() => handleAddDraft(draft._id)}
                        >
                          Add
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleDismissDraft(draft._id)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </AppPanel>
      </section>
    </div>
  );
}

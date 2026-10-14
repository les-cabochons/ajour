import { useMemo, useState, type ChangeEvent } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { offerUndo } from "@/features/feedback/undo-toast";
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
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
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

    setExportMessage("");
    setExportError("");
    try {
      const workbookBytes = await createTimesheetExportWorkbook({
        entries: state.timesheetEntries,
        projects: state.projects,
        startDate,
        endDate,
      });
      const filename = buildTimesheetExportFilename(startDate, endDate);
      downloadWorkbookFile(workbookBytes, filename);
      setExportMessage(
        `Exported ${filename} · ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`,
      );
    } catch (nextError) {
      setExportError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to export the workbook.",
      );
    }
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
    offerUndo(localStore.dismissTimesheetImportDraft(draftId), {
      title: "Draft dismissed",
      subject: "draft",
    });
  }

  function handleAddAllReady() {
    localStore.commitReadyTimesheetImportDrafts();
  }

  function handleDismissAll() {
    offerUndo(localStore.dismissAllTimesheetImportDrafts(), {
      title: `${pendingImportCount} ${pendingImportCount === 1 ? "draft" : "drafts"} dismissed`,
      subject: "drafts",
    });
  }

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Export time entries</h2>
        <p className="settings-section-desc">
          Export time entries to an Excel workbook.{" "}
          {state.timesheetEntries.length === 0
            ? "No time entries are available yet."
            : `Time entries available from ${availableRange.startDate} to ${availableRange.endDate}.`}
        </p>

        <AppPanel>
          <SettingRow label="Date range" stacked>
            <div className="grid w-full gap-3 desktop:max-w-md desktop:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="time-entries-export-start"
                  className="text-[13px] font-normal text-[var(--text-secondary)]"
                >
                  From
                </Label>
                <Input
                  id="time-entries-export-start"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  max={endDate}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="time-entries-export-end"
                  className="text-[13px] font-normal text-[var(--text-secondary)]"
                >
                  To
                </Label>
                <Input
                  id="time-entries-export-end"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  min={startDate}
                />
              </div>
            </div>
          </SettingRow>

          {hasInvalidRange ? (
            <MessagePanel tone="warning">
              The start day must be on or before the end day.
            </MessagePanel>
          ) : null}

          <SettingRow
            label={`${rows.length} ${rows.length === 1 ? "entry" : "entries"} selected`}
            description={
              <>
                {hasInvalidRange ? null : (
                  <p>
                    {formatDecimalHours(totalHours)} hours in decimal format
                    will be exported.
                  </p>
                )}
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Filename: {buildTimesheetExportFilename(startDate, endDate)}
                  {" · "}Rows without an assigned project or task are exported
                  with blank cells.
                </p>
              </>
            }
          >
            <Button
              type="button"
              onClick={handleExport}
              disabled={hasInvalidRange || rows.length === 0}
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
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Import time entries</h2>
        <p className="settings-section-desc">
          Upload the exported workbook format and review every row in a staged
          queue before it is added to your local timesheet.
        </p>

        <AppPanel>
          <SettingRow
            label="Workbook"
            labelFor="time-entries-import-file"
            description={
              selectedImportFile
                ? selectedImportFile.name
                : "Choose a .xlsx file with a Time entries sheet."
            }
            stacked
          >
            <Input
              id="time-entries-import-file"
              type="file"
              accept=".xlsx"
              onChange={handleImportFileChange}
              className="min-w-0 flex-[1_1_14rem] desktop:max-w-sm"
            />
            <Button
              type="button"
              onClick={handleReviewImport}
              disabled={!selectedImportFile}
            >
              <Upload className="h-4 w-4" />
              Review import
            </Button>
          </SettingRow>

          {statusMessage ? <ResultLine>{statusMessage}</ResultLine> : null}
          {error ? <MessagePanel tone="warning">{error}</MessagePanel> : null}

          <SettingRow
            label="Staged rows"
            description={
              pendingImportCount === 0 ? (
                "No staged workbook rows yet. Upload a workbook and review it before importing."
              ) : (
                <>
                  {pendingImportCount} pending · {pendingReadyCount} ready ·{" "}
                  <span
                    className={
                      pendingConflictCount > 0
                        ? "text-[var(--danger-light)]"
                        : undefined
                    }
                  >
                    {pendingConflictCount} potential conflict
                    {pendingConflictCount === 1 ? "" : "s"}
                  </span>
                </>
              )
            }
          >
            {pendingImportCount === 0 ? null : (
              <>
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
              </>
            )}
          </SettingRow>

          {pendingImportCount === 0 ? null : (
            <div className="flex flex-col gap-4">
              {state.timesheetImportDrafts.map((draft) => {
                const assignment = [draft.projectName, draft.taskName]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div
                    key={draft._id}
                    className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2"
                  >
                    <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium text-foreground">
                          {draft.localDate}
                        </span>
                        {assignment ? (
                          <span className="min-w-0 text-[13px] break-words text-[var(--text-secondary)]">
                            {assignment}
                          </span>
                        ) : null}
                        {draft.potentialConflict ? (
                          <Badge className="bg-[var(--danger-muted)] text-[var(--danger-light)]">
                            Potential conflict
                          </Badge>
                        ) : (
                          <span className="text-xs text-[var(--text-tertiary)]">
                            Ready to add
                          </span>
                        )}
                      </div>
                      <div className="text-[13px] break-words text-[var(--text-secondary)]">
                        {formatDraftHours(draft.durationMs)} hours
                        {draft.note ? ` · ${draft.note}` : ""}
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-2">
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
                );
              })}
            </div>
          )}
        </AppPanel>
      </section>
    </div>
  );
}

/** A finished export or import, said in plain text under the action. */

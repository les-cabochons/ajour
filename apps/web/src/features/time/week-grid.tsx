import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  RiAddLine as Plus,
  RiCalendarLine as CalendarIcon,
} from "@remixicon/react";
import { ObjectContextMenu } from "@/components/object-actions-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/disabled-reason";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ObjectAction,
  TimeEntryActionId,
} from "@/domain/actions/object-actions";
import type { LocalProject, LocalTimesheetEntry } from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import {
  commitWeekGridCellText,
  formatWeekGridCellText,
} from "@/domain/time/week-grid-cell";
import {
  getWeeklyGridAddedRowKey,
  type WeeklyGridAddedRow,
  type WeeklyGridRow,
  type WeeklyTimeProjection,
} from "@/domain/time/weekly-time";
import { ProjectTaskPicker } from "@/features/projects/project-task-picker";
import {
  offerTimeEntryUndo,
  useTimeEntryActions,
  type TimeEntryActionTarget,
} from "@/features/time/time-entry-actions";
import {
  CapacityValue,
  formatWeekDay,
} from "@/features/time/weekly-capacity-value";
import {
  handleItemKeyDown,
  TIME_ENTRY_ACTION_KEYS,
  type ActionKeys,
} from "@/lib/item-keys";
import { localStore } from "@/lib/local-store";
import { leavesContextMenuToSystem } from "@/lib/native-context-menu";
import { ProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";

/** One Grid cell: a row's project and task on one day. The side panel can show it. */
export interface WeekGridCell {
  rowKey: string;
  localDate: string;
  projectId?: string;
  taskId?: string;
  projectName: string;
  taskName: string;
}

/**
 * What a Grid cell opens in the side panel: its saved entry, the running entry, or
 * a new entry for the cell when both ids are empty.
 */
export interface WeekGridOpenRequest {
  entryId?: string;
  timerId?: string;
  cell: WeekGridCell;
}

export function isSameWeekGridCell(
  left?: WeekGridCell | null,
  right?: WeekGridCell | null,
) {
  if (!left || !right) return !left && !right;
  return left.rowKey === right.rowKey && left.localDate === right.localDate;
}

/** "Add another entry for Monday": under the form of an entry opened from a Grid cell. */
export function formatAddAnotherEntryLabel(cell: WeekGridCell) {
  return `Add another entry for ${formatWeekDay(cell.localDate, { weekday: "long" })}`;
}

type WeekGridCellActionId =
  "add-entry" | "open-entries" | "delete-row" | TimeEntryActionId;

/** How long a click waits for a second click before it opens the side panel. */
const DOUBLE_CLICK_DELAY_MS = 250;

const ADD_ENTRY_ACTION: ObjectAction<WeekGridCellActionId> = {
  id: "add-entry",
  label: "Add entry",
  group: "cell",
};
const OPEN_ENTRIES_ACTION: ObjectAction<WeekGridCellActionId> = {
  id: "open-entries",
  label: "Open entries",
  group: "cell",
};

/**
 * Delete row, the row's only action. It ends every cell's menu too, so the
 * focused cell's Shift+Backspace has a menu item that shows the key. A row that
 * holds the running entry keeps it, because the running entry can't be deleted.
 * A submitted week keeps its rows.
 */
function getDeleteRowAction(
  row: WeeklyGridRow,
  lockReason?: string,
): ObjectAction<"delete-row"> {
  return {
    id: "delete-row",
    label: "Delete row",
    destructive: true,
    disabledReason:
      lockReason ??
      (row.holdsRunningEntry ? "Stop the running entry first" : undefined),
  };
}

/** "Internal · Admin", the row's name in its tooltip and the delete row dialog. */
function formatRowName(row: WeeklyGridRow) {
  return `${row.projectName} · ${row.taskName}`;
}

/**
 * A Delete row waiting for the row's entries to be counted. `dayIndex` is the
 * day of the cell that asked, so focus stays in that column after the delete.
 */
interface RowDeleteRequest {
  rowKey: string;
  dayIndex: number;
}

/** "3 entries (1:30)" for the delete row dialog. */
function describeRowEntries(row: WeeklyGridRow) {
  const count = row.entryIds.length;
  return `${count} ${count === 1 ? "entry" : "entries"} (${formatClockDuration(row.totalMs)})`;
}

/** A cell's keys: its entry's keys, and E or Enter lists a cell's several entries. */
const CELL_ACTION_KEYS: ActionKeys<WeekGridCellActionId> = {
  ...TIME_ENTRY_ACTION_KEYS,
  "open-entries": "item.edit",
  "delete-row": "item.delete-row",
};

/**
 * How an in-place edit ends. A number saves and moves that many days (Tab and
 * Shift+Tab move one day, Enter stays). `blur` saves a valid value and keeps the
 * saved hours otherwise.
 */
type CellEditEnd = -1 | 0 | 1 | "blur";

/** What one rendered cell holds, derived from its row. */
interface CellModel {
  cell: WeekGridCell;
  cellId: string;
  dayIndex: number;
  durationMs: number;
  /** Saved entries, without the running entry's saved part. */
  entries: LocalTimesheetEntry[];
  hasRunning: boolean;
  /** Saved entries plus the running entry. */
  count: number;
  /** Empty cells and cells with one saved entry edit their hours in place. */
  canEditInPlace: boolean;
}

function getCellId(rowKey: string, localDate: string) {
  return `${rowKey}@${localDate}`;
}

/**
 * The hours input of a cell being edited in place. Enter saves, Tab and Shift+Tab
 * save and move a day, Escape cancels, and leaving the cell saves a valid value.
 */
function WeekGridCellInput({
  label,
  initialText,
  savedText,
  onEnd,
  onCancel,
}: {
  label: string;
  /** Text typed to start editing, such as a digit. Without it, the saved hours are selected. */
  initialText?: string;
  savedText: string;
  /** Saves the text. Returns an error to keep editing, or null when the edit ended. */
  onEnd: (text: string, end: CellEditEnd) => string | null;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText ?? savedText);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set once the edit ended from a key, so the blur that follows writes nothing.
  const endedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (initialText === undefined) {
      input.select();
    } else {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [initialText]);

  function end(edit: Exclude<CellEditEnd, "blur">) {
    const nextError = onEnd(text, edit);
    setError(nextError);
    endedRef.current = nextError === null;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      end(0);
    } else if (event.key === "Tab") {
      event.preventDefault();
      end(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      endedRef.current = true;
      onCancel();
    }
  }

  return (
    <input
      ref={inputRef}
      className={cn("weekly-grid-cell-input", error && "is-invalid")}
      value={text}
      inputMode="decimal"
      // The default size of 20 characters would widen the day column.
      size={1}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      title={error ?? undefined}
      onChange={(event) => {
        setText(event.target.value);
        setError(null);
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!endedRef.current) {
          endedRef.current = true;
          onEnd(text, "blur");
        }
      }}
    />
  );
}

/**
 * The Week Grid: one row per project and task, one cell per day.
 *
 * A click opens the cell in the side panel: a new entry for an empty cell, the
 * entry of a one-entry cell, or the list of a cell with several entries.
 * Double-click, Enter or a digit edits an empty or one-entry cell in place; see
 * `commitWeekGridCellText` for what the typed hours write. Cells with several
 * entries, or with the running entry, show their total and never edit in place.
 * Right-click lists Add entry, then the cell's entry actions or Open entries.
 * Arrows move between cells, and the entry keys of `lib/item-keys.ts` act on a
 * focused cell; Enter keeps editing in place where it can.
 *
 * Delete row ends the right-click menu of the row name and of every cell, and
 * Shift+Backspace runs it on a focused cell. An empty row goes at once. A row
 * with time asks first, then deletes its entries for the week with an Undo toast.
 */
export function WeekGrid({
  activeCell,
  activeEntryId,
  onAddRow,
  onClosePanel,
  onOpen,
  onOpenCellEntries,
  onRemoveRow,
  onOpenSuggestions,
  projection,
  projects,
  projectsById,
  lockReason,
  runningTimerId,
  showCapacityWarning,
  suggestionCounts,
  today,
  weekDates,
}: {
  /** The cell shown in the side panel, highlighted in the Grid. */
  activeCell?: WeekGridCell | null;
  /** The entry open in the editor; its cell is highlighted. */
  activeEntryId?: string;
  onAddRow: (row: WeeklyGridAddedRow) => void;
  /** Saves and closes the side panel. Returns false when its draft is invalid and stays open. */
  onClosePanel: () => boolean;
  onOpen: (request: WeekGridOpenRequest) => void;
  onOpenCellEntries: (cell: WeekGridCell) => void;
  /** Forgets a row added with "+ Add row", so it stops showing while empty. */
  onRemoveRow: (rowKey: string) => void;
  /** Opens the Calendar side panel on a day. */
  onOpenSuggestions?: (localDate: string) => void;
  projection: WeeklyTimeProjection;
  projects: LocalProject[];
  projectsById: Map<string, LocalProject>;
  /**
   * Set when the week is submitted: cells open read-only in the side panel,
   * nothing edits in place, and rows cannot be added or deleted.
   */
  lockReason?: string;
  runningTimerId?: string;
  showCapacityWarning: boolean;
  /** Open calendar suggestions per day. The Grid shows only their count. */
  suggestionCounts?: ReadonlyMap<string, number>;
  today: string;
  weekDates: string[];
}) {
  const [editing, setEditing] = useState<{
    cellId: string;
    initialText?: string;
  } | null>(null);
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [nameMenuRowKey, setNameMenuRowKey] = useState<string | null>(null);
  const nameMenuTriggerRef = useRef<HTMLDivElement>(null);
  const nameMenuRow = projection.gridRows.find(
    (row) => row.rowKey === nameMenuRowKey,
  );
  const [deleteRequest, setDeleteRequest] = useState<RowDeleteRequest | null>(
    null,
  );
  // Read from this render's projection, so the count includes what the side
  // panel saved as it closed.
  const rowToDelete = deleteRequest
    ? projection.gridRows.find((row) => row.rowKey === deleteRequest.rowKey)
    : undefined;
  const isConfirmingDelete = Boolean(rowToDelete?.entryIds.length);
  // The cell the delete row dialog gives focus to once a confirmed delete closes it.
  const focusAfterDeleteRef = useRef<string | null>(null);
  const cellButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const addRowPickerRef = useRef<HTMLDivElement>(null);
  // The cell to focus once the next render shows it, such as after an in-place edit.
  const pendingFocusRef = useRef<string | null>(null);
  // A single click on a cell that edits in place waits out the double-click delay.
  const pendingOpenRef = useRef<number | undefined>(undefined);
  const lastClickedCellRef = useRef<string | null>(null);

  useEffect(() => () => window.clearTimeout(pendingOpenRef.current), []);
  const entryActions = useTimeEntryActions({
    // The Grid handles Edit itself, so the panel knows which cell it came from.
    onEdit: () => undefined,
  });

  useEffect(() => {
    const cellId = pendingFocusRef.current;
    if (!cellId) return;
    pendingFocusRef.current = null;
    cellButtonsRef.current.get(cellId)?.focus();
  });

  // An empty row goes without asking. This runs once the request's render has
  // counted the row's entries.
  useEffect(() => {
    if (!deleteRequest || isConfirmingDelete) return;
    pendingFocusRef.current = getNeighborCellId(
      deleteRequest.rowKey,
      deleteRequest.dayIndex,
    );
    setDeleteRequest(null);
    onRemoveRow(deleteRequest.rowKey);
  });

  useEffect(() => {
    if (isAddingRow) {
      addRowPickerRef.current?.querySelector("button")?.focus();
    }
  }, [isAddingRow]);

  function describeCell(row: WeeklyGridRow, dayIndex: number): CellModel {
    const localDate = weekDates[dayIndex]!;
    const entries = row.dayEntries[dayIndex] ?? [];
    const hasRunning = row.runningLocalDate === localDate;
    return {
      cell: {
        rowKey: row.rowKey,
        localDate,
        projectId: row.projectId,
        taskId: row.taskId,
        projectName: row.projectName,
        taskName: row.taskName,
      },
      cellId: getCellId(row.rowKey, localDate),
      dayIndex,
      durationMs: row.dayTotalsMs[dayIndex] ?? 0,
      entries,
      hasRunning,
      count: entries.length + (hasRunning ? 1 : 0),
      canEditInPlace:
        !lockReason &&
        !hasRunning &&
        (entries.length === 1 ||
          (entries.length === 0 && row.acceptsNewEntries)),
    };
  }

  function getActionTarget(model: CellModel): TimeEntryActionTarget | null {
    if (model.count !== 1) return null;
    if (model.hasRunning) {
      return runningTimerId
        ? { kind: "running", timerId: runningTimerId }
        : null;
    }
    return { kind: "entry", entry: model.entries[0]! };
  }

  function openCell(model: CellModel) {
    if (model.count > 1) {
      onOpenCellEntries(model.cell);
    } else if (model.hasRunning && runningTimerId) {
      onOpen({ timerId: runningTimerId, cell: model.cell });
    } else {
      onOpen({ entryId: model.entries[0]?._id, cell: model.cell });
    }
  }

  /**
   * Opens the cell in the side panel, or edits it in place on a double-click.
   * Opening the panel narrows the Grid, so a double-click's second click would
   * land on another cell: the panel waits until a double-click is ruled out.
   * `clickCount` is the event's `detail`; keyboard clicks report 0.
   */
  function handleCellClick(model: CellModel, clickCount: number) {
    window.clearTimeout(pendingOpenRef.current);
    if (clickCount >= 2) {
      // The browser counts clicks by place and time, not by cell. A second click
      // that lands on another cell after a panel opened is ignored.
      if (lastClickedCellRef.current === model.cellId) beginEdit(model);
      return;
    }

    lastClickedCellRef.current = model.cellId;
    if (clickCount === 1 && model.canEditInPlace) {
      pendingOpenRef.current = window.setTimeout(
        () => openCell(model),
        DOUBLE_CLICK_DELAY_MS,
      );
    } else {
      openCell(model);
    }
  }

  /** Starts editing in place. Returns false when the cell can't edit now. */
  function beginEdit(model: CellModel, initialText?: string) {
    if (!model.canEditInPlace) return false;
    // The side panel would keep stale hours for this cell, so it closes first.
    const panelShowsCell =
      isSameWeekGridCell(activeCell, model.cell) ||
      model.entries.some((entry) => entry._id === activeEntryId);
    if (panelShowsCell && !onClosePanel()) return false;
    setEditing({ cellId: model.cellId, initialText });
    return true;
  }

  function endEdit(
    row: WeeklyGridRow,
    model: CellModel,
    text: string,
    end: CellEditEnd,
  ): string | null {
    const result = commitWeekGridCellText({
      text,
      entry: model.entries[0],
      row,
      localDate: model.cell.localDate,
    });
    if (result.kind === "invalid" && end !== "blur") {
      return result.error;
    }

    if (result.kind === "create") {
      localStore.saveManualTimeEntry(result.values);
    } else if (result.kind === "update") {
      localStore.updateTimesheetEntry(result.entryId, result.values);
    } else if (result.kind === "delete") {
      offerTimeEntryUndo(
        localStore.deleteTimesheetEntry(result.entryId),
        "Entry deleted",
      );
    }

    setEditing(null);
    if (end === "blur") return null;

    const nextIndex = model.dayIndex + end;
    const next =
      end !== 0 && nextIndex >= 0 && nextIndex < weekDates.length
        ? describeCell(row, nextIndex)
        : null;
    if (!next || !beginEdit(next)) {
      pendingFocusRef.current = (next ?? model).cellId;
    }
    return null;
  }

  function cancelEdit(model: CellModel) {
    setEditing(null);
    pendingFocusRef.current = model.cellId;
  }

  function runCellAction(
    row: WeeklyGridRow,
    model: CellModel,
    actionId: WeekGridCellActionId,
  ) {
    const target = getActionTarget(model);
    if (actionId === "delete-row") {
      requestDeleteRow(row, model.dayIndex);
    } else if (actionId === "add-entry") {
      onOpen({ cell: model.cell });
    } else if (actionId === "open-entries" || actionId === "edit") {
      openCell(model);
    } else if (target) {
      entryActions.runAction(target, actionId);
    }
  }

  function getCellActions(
    row: WeeklyGridRow,
    model: CellModel,
  ): ObjectAction<WeekGridCellActionId>[] {
    const target = getActionTarget(model);
    const addEntry = lockReason
      ? { ...ADD_ENTRY_ACTION, disabledReason: lockReason }
      : ADD_ENTRY_ACTION;
    const cellActions: ObjectAction<WeekGridCellActionId>[] =
      model.count > 1
        ? [addEntry, OPEN_ENTRIES_ACTION]
        : target
          ? [addEntry, ...entryActions.getActions(target)]
          : [addEntry];
    return [...cellActions, getDeleteRowAction(row, lockReason)];
  }

  function handleCellKeyDown(
    model: CellModel,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) {
    if (
      !model.canEditInPlace ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    ) {
      return;
    }
    // Enter edits in place instead of pressing the button; Space still opens the panel.
    if (event.key === "Enter" || /^[0-9]$/.test(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      beginEdit(model, event.key === "Enter" ? undefined : event.key);
    }
  }

  function addRow(selection: { projectId: string; taskId: string }) {
    if (!selection.projectId) return;
    const row = {
      projectId: selection.projectId,
      taskId: selection.taskId || undefined,
    };
    onAddRow(row);
    setIsAddingRow(false);
    pendingFocusRef.current = getCellId(
      getWeeklyGridAddedRowKey(row),
      weekDates[0]!,
    );
  }

  /** The same day's cell in the next row, or the previous row when it was last. */
  function getNeighborCellId(rowKey: string, dayIndex: number) {
    const rows = projection.gridRows;
    const index = rows.findIndex((candidate) => candidate.rowKey === rowKey);
    const neighbor = rows[index + 1] ?? rows[index - 1];
    return neighbor ? getCellId(neighbor.rowKey, weekDates[dayIndex]!) : null;
  }

  /**
   * Asks to delete the row. The side panel closes first when it shows the row:
   * closing saves its draft, which can add an entry to the row or move one out,
   * so the entries are counted on the next render. An invalid draft keeps the
   * panel open and cancels the delete.
   */
  function requestDeleteRow(row: WeeklyGridRow, dayIndex = 0) {
    if (row.holdsRunningEntry) return;
    const panelShowsRow =
      activeCell?.rowKey === row.rowKey ||
      (activeEntryId !== undefined && row.entryIds.includes(activeEntryId));
    if (panelShowsRow && !onClosePanel()) return;
    focusAfterDeleteRef.current = null;
    setDeleteRequest({ rowKey: row.rowKey, dayIndex });
  }

  function confirmDeleteRow(row: WeeklyGridRow, dayIndex: number) {
    if (row.holdsRunningEntry) return;
    setDeleteRequest(null);
    focusAfterDeleteRef.current = getNeighborCellId(row.rowKey, dayIndex);
    offerTimeEntryUndo(
      localStore.deleteTimesheetEntries(row.entryIds),
      "Row deleted",
    );
    onRemoveRow(row.rowKey);
  }

  /** Routes row-name right-clicks to one menu, outside the cells' menu trees. */
  function openRowNameMenu(rowKey: string, event: ReactMouseEvent) {
    if (leavesContextMenuToSystem(event.nativeEvent)) return;
    event.preventDefault();
    event.stopPropagation();
    setNameMenuRowKey(rowKey);
    nameMenuTriggerRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    );
  }

  function renderCell(row: WeeklyGridRow, dayIndex: number) {
    const model = describeCell(row, dayIndex);
    const dayLabel = formatWeekDay(model.cell.localDate, { weekday: "long" });
    const isEditing = editing?.cellId === model.cellId;
    const isSelected =
      isSameWeekGridCell(activeCell, model.cell) ||
      model.entries.some((entry) => entry._id === activeEntryId);
    const valueLabel =
      model.count === 0
        ? "no time"
        : model.count > 1
          ? `${formatClockDuration(model.durationMs)}, ${model.count} entries`
          : formatClockDuration(model.durationMs);

    return (
      <TableCell
        key={model.cell.localDate}
        className={cn(
          "weekly-grid-time-cell",
          new Date(`${model.cell.localDate}T12:00:00`).getDay() % 6 === 0 &&
            "is-weekend",
          model.cell.localDate === today && "is-today",
          isEditing && "is-editing",
        )}
      >
        {isEditing ? (
          <WeekGridCellInput
            label={`Hours for ${row.taskName} on ${dayLabel}`}
            initialText={editing.initialText}
            savedText={formatWeekGridCellText(model.entries[0])}
            onEnd={(text, end) => endEdit(row, model, text, end)}
            onCancel={() => cancelEdit(model)}
          />
        ) : (
          <ObjectContextMenu
            actions={getCellActions(row, model)}
            keys={CELL_ACTION_KEYS}
            onAction={(actionId) => runCellAction(row, model, actionId)}
            render={
              <button
                type="button"
                ref={(node) => {
                  if (node) cellButtonsRef.current.set(model.cellId, node);
                  else cellButtonsRef.current.delete(model.cellId);
                }}
                className={cn(
                  "weekly-grid-time-button",
                  model.count === 0 && "is-empty",
                  isSelected && "is-selected",
                )}
                // C continues the focused entry. Cells without exactly one saved entry match none.
                data-entry-id={
                  model.count === 1 && !model.hasRunning
                    ? model.entries[0]!._id
                    : ""
                }
                // A focused cell keeps the digits, so pinned tasks skip it (GRID_CELL_ATTRIBUTE).
                data-grid-cell=""
                data-focus-column={dayIndex}
                aria-label={`${row.taskName}, ${dayLabel}, ${valueLabel}`}
                onClick={(event) => handleCellClick(model, event.detail)}
                onKeyDown={(event) => {
                  handleCellKeyDown(model, event);
                  handleItemKeyDown(event, {
                    actions: getCellActions(row, model),
                    keys: CELL_ACTION_KEYS,
                    onAction: (actionId) => runCellAction(row, model, actionId),
                  });
                }}
              />
            }
          >
            {model.count === 0 ? (
              "—"
            ) : (
              <>
                {formatClockDuration(model.durationMs)}
                {model.count > 1 ? (
                  <span className="weekly-grid-cell-count">×{model.count}</span>
                ) : null}
              </>
            )}
          </ObjectContextMenu>
        )}
      </TableCell>
    );
  }

  return (
    <div className="weekly-grid-stack">
      <div className="weekly-grid-table-scroll">
        <Table
          className="weekly-grid-table"
          style={{
            minWidth: `calc(var(--weekly-grid-task-min-width) + ${weekDates.length} * var(--weekly-grid-day-width) + var(--weekly-grid-total-width))`,
          }}
        >
          <TableHeader>
            <TableRow>
              <TableHead className="weekly-grid-task-column">
                Project / task
              </TableHead>
              {projection.days.map((day) => (
                <TableHead
                  key={day.localDate}
                  className={cn(
                    "weekly-grid-day-column",
                    new Date(`${day.localDate}T12:00:00`).getDay() % 6 === 0 &&
                      "is-weekend",
                    day.localDate === today && "is-today",
                  )}
                >
                  <div className="weekly-grid-day-heading">
                    <span>
                      <span className="weekly-grid-weekday">
                        {formatWeekDay(day.localDate, { weekday: "short" })}
                      </span>
                      <span className="weekly-grid-day-number">
                        {formatWeekDay(day.localDate, { day: "numeric" })}
                      </span>
                    </span>
                    <span className="weekly-grid-day-total">
                      {suggestionCounts?.get(day.localDate) &&
                      onOpenSuggestions ? (
                        <button
                          type="button"
                          className="weekly-grid-suggestion-chip"
                          aria-label={`${suggestionCounts.get(day.localDate)} suggested meetings on ${formatWeekDay(day.localDate, { weekday: "long" })}`}
                          title="Suggested meetings"
                          onClick={() => onOpenSuggestions(day.localDate)}
                        >
                          <CalendarIcon aria-hidden="true" />
                          {suggestionCounts.get(day.localDate)}
                        </button>
                      ) : null}
                      <CapacityValue
                        capacityMs={day.capacityMs}
                        totalMs={day.totalMs}
                        label={formatWeekDay(day.localDate, {
                          weekday: "long",
                        })}
                        overCapacity={day.overCapacity}
                        showWarning={showCapacityWarning}
                      />
                    </span>
                  </div>
                </TableHead>
              ))}
              <TableHead className="weekly-grid-total-column">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody data-focus-scope>
            {projection.gridRows.map((row) => {
              const project = row.projectId
                ? projectsById.get(row.projectId)
                : undefined;
              return (
                <TableRow key={row.rowKey}>
                  {/* No keys: the row name can't take focus, so Shift+Backspace works on cells. */}
                  <TableCell
                    className="weekly-grid-task-cell"
                    onContextMenu={(event) =>
                      openRowNameMenu(row.rowKey, event)
                    }
                  >
                    <ProjectIcon
                      icon={project?.icon}
                      color={project?.color ?? "#3b82f6"}
                      className="weekly-project-mark"
                      fallback="dot"
                    />
                    <div
                      className="weekly-grid-task-name"
                      title={formatRowName(row)}
                    >
                      <span>{row.projectName}</span>
                      <strong>{row.taskName}</strong>
                    </div>
                  </TableCell>
                  {weekDates.map((_, dayIndex) => renderCell(row, dayIndex))}
                  <TableCell className="weekly-grid-total-cell">
                    {formatClockDuration(row.totalMs)}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="weekly-grid-add-row">
              <TableCell colSpan={weekDates.length + 2}>
                {isAddingRow ? (
                  <div
                    ref={addRowPickerRef}
                    className="weekly-grid-add-row-picker"
                    onKeyDown={(event) => {
                      // The picker's own popup renders in a portal and keeps its Escape.
                      if (
                        event.key === "Escape" &&
                        event.target instanceof Node &&
                        event.currentTarget.contains(event.target)
                      ) {
                        setIsAddingRow(false);
                      }
                    }}
                  >
                    <ProjectTaskPicker
                      projects={projects}
                      projectId=""
                      taskId=""
                      allowNoProject={false}
                      placeholder="Pick a project or task"
                      ariaLabel="Project or task for the new row"
                      onChange={addRow}
                    />
                    <Button
                      variant="ghost"

                      onClick={() => setIsAddingRow(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <DisabledReason label="Add row" reason={lockReason}>
                    <Button
                      variant="ghost"
                      disabled={lockReason !== undefined}
                      onClick={() => setIsAddingRow(true)}
                    >
                      <Plus data-icon="inline-start" /> Add row
                    </Button>
                  </DisabledReason>
                )}
              </TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow className="weekly-grid-footer-row">
              <TableCell className="weekly-grid-task-cell">Totals</TableCell>
              {projection.days.map((day) => (
                <TableCell
                  key={day.localDate}
                  className={cn(
                    "weekly-grid-time-cell",
                    new Date(`${day.localDate}T12:00:00`).getDay() % 6 === 0 &&
                      "is-weekend",
                  )}
                >
                  {formatClockDuration(day.totalMs)}
                </TableCell>
              ))}
              <TableCell className="weekly-grid-total-cell">
                {formatClockDuration(projection.totalMs)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {/* Keep this root outside the table so cell menus are not nested under it. */}
      <ObjectContextMenu
        actions={
          nameMenuRow ? [getDeleteRowAction(nameMenuRow, lockReason)] : []
        }
        onAction={() => {
          if (nameMenuRow) requestDeleteRow(nameMenuRow);
        }}
        render={<div hidden ref={nameMenuTriggerRef} />}
      />
      {entryActions.dialogs}
      <AlertDialog
        open={isConfirmingDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteRequest(null);
        }}
      >
        <AlertDialogContent
          // Cancel returns focus to the cell that asked; a delete moves it to a neighbor.
          finalFocus={() => {
            const cellId = focusAfterDeleteRef.current;
            return (cellId && cellButtonsRef.current.get(cellId)) || true;
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this row?</AlertDialogTitle>
            <AlertDialogDescription>
              {rowToDelete
                ? `Deleting ${formatRowName(rowToDelete)} also deletes its ${describeRowEntries(rowToDelete)} this week.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={rowToDelete?.holdsRunningEntry}
              onClick={() => {
                if (rowToDelete && deleteRequest) {
                  confirmDeleteRow(rowToDelete, deleteRequest.dayIndex);
                }
              }}
            >
              Delete row
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

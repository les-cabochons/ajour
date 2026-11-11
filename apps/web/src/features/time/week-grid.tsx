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
  RiFileCopyLine as CopyIcon,
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
import {
  markLockedActions,
  type ObjectAction,
  type TimeEntryActionId,
} from "@/domain/actions/object-actions";
import type { LocalProject, LocalTimesheetEntry } from "@/domain/local-state";
import { filterPastedHours, formatClockDuration } from "@/domain/time/duration";
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
  InPlaceHoursInput,
  writeInPlaceHours,
  type InPlaceHoursEnd,
} from "@/features/time/in-place-hours";
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
import { matchEntryClipboard } from "@/lib/entry-clipboard";
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

type CellEditEnd = InPlaceHoursEnd;

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

/** Characters that start hours on a focused cell, as in ".5", ":45" or "-1". */
const HOURS_START = /^[0-9.,:-]$/;

/**
 * Why a cell takes no hours typed or pasted on it, and what opens it instead.
 * Cells with several entries or the running entry change in the side panel
 * (council round 17); a submitted week says its lock.
 */
function getCellEditBlock(
  model: CellModel,
  lockReason: string | undefined,
): { message: string; actionLabel?: string } {
  if (lockReason) return { message: lockReason };
  if (model.hasRunning) {
    return {
      message:
        "The running entry is in this cell. Change its time in the panel.",
      actionLabel: "Open entry",
    };
  }
  if (model.count > 1) {
    return {
      message: `${model.count} entries share this cell. Change their hours in the panel.`,
      actionLabel: "Open entries",
    };
  }
  return { message: "This cell takes no new entries." };
}

/**
 * The Week Grid: one row per project and task, one cell per day.
 *
 * A click opens the cell in the side panel: a new entry for an empty cell, the
 * entry of a one-entry cell, or the list of a cell with several entries.
 * Double-click, Enter, a digit, ".", "," or ":" edits an empty or one-entry cell in place; see
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
  onCopyLastWeekRows,
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
  /**
   * Adds last week's rows to this empty week, without their hours. Given
   * only while the week has no row and last week had some.
   */
  onCopyLastWeekRows?: () => WeeklyGridAddedRow[];
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
    /** Set when pasted hours can't be saved, so the cell opens with why. */
    initialError?: string;
  } | null>(null);
  // The cell that says why it took no typed or pasted hours.
  const [blockedCellId, setBlockedCellId] = useState<string | null>(null);
  // Every rendered cell by id, for the clipboard listeners.
  const cellModelsRef = useRef(
    new Map<string, { row: WeeklyGridRow; model: CellModel }>(),
  );
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
  /** The cell still editing hours it couldn't save, after focus left it. */
  const invalidEditRef = useRef<string | null>(null);
  const lastClickedCellRef = useRef<string | null>(null);
  /** Hours pasted while the side panel showed the cell, written once it has closed. */
  const pendingPasteRef = useRef<{ cellId: string; text: string } | null>(null);

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

  // The panel saved as it closed: this render shows the cell with what it
  // saved, so the pasted hours write on top of it, not over a stale entry.
  useEffect(() => {
    const paste = pendingPasteRef.current;
    if (!paste) return;
    pendingPasteRef.current = null;
    const cell = cellModelsRef.current.get(paste.cellId);
    if (cell) writePastedHours(cell.row, cell.model, paste.text);
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
    if (returnsToInvalidEdit(model)) return;
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

  /**
   * While another cell holds hours it can't save, opening or editing this one
   * would drop them: focus goes back to that cell, to fix or Escape them
   * (Sol's review of #648).
   */
  function returnsToInvalidEdit(model: CellModel) {
    const held = invalidEditRef.current;
    if (!held || held === model.cellId || editing?.cellId !== held) {
      return false;
    }
    document
      .querySelector<HTMLInputElement>(".weekly-grid-cell-input")
      ?.focus();
    return true;
  }

  /** Starts editing in place. Returns false when the cell can't edit now. */
  function beginEdit(model: CellModel, initialText?: string) {
    if (!model.canEditInPlace) return false;
    if (returnsToInvalidEdit(model)) return false;
    // A click's panel still waiting on a double-click is dropped: typing
    // right after the click edits in place, and the panel opening after it
    // took focus and left a blank entry open (usability council U1).
    window.clearTimeout(pendingOpenRef.current);
    // The side panel would keep stale hours for this cell, so it closes first.
    if (panelShowsCell(model) && !onClosePanel()) return false;
    setEditing({ cellId: model.cellId, initialText });
    return true;
  }

  function panelShowsCell(model: CellModel) {
    return (
      isSameWeekGridCell(activeCell, model.cell) ||
      model.entries.some((entry) => entry._id === activeEntryId)
    );
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
    // Hours it can't save keep the cell editing with the message, also when
    // focus leaves it: the typed draft never disappears silently.
    if (result.kind === "invalid") {
      invalidEditRef.current = model.cellId;
      return result.error;
    }
    invalidEditRef.current = null;

    writeInPlaceHours(result, "grid_cell");

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
    invalidEditRef.current = null;
    setEditing(null);
    pendingFocusRef.current = model.cellId;
  }

  /**
   * Pastes hours on a focused cell as if they were typed there and saved:
   * through the duration parser, after `filterPastedHours`. Hours it can't
   * save open the cell with them and the message. A cell that takes no hours
   * says why instead. A side panel showing the cell saves and closes first, as
   * editing the cell does, so its draft never overwrites the pasted hours; the
   * paste then waits for the render that shows what the panel saved. A panel
   * draft that can't be saved blocks the paste.
   */
  function pasteOnCell(row: WeeklyGridRow, model: CellModel, pasted: string) {
    const text = filterPastedHours(pasted);
    if (!text) return;
    if (!model.canEditInPlace) {
      setBlockedCellId(model.cellId);
      return;
    }
    if (returnsToInvalidEdit(model)) return;
    if (panelShowsCell(model)) {
      if (!onClosePanel()) return;
      pendingPasteRef.current = { cellId: model.cellId, text };
      return;
    }
    writePastedHours(row, model, text);
  }

  function writePastedHours(
    row: WeeklyGridRow,
    model: CellModel,
    text: string,
  ) {
    const result = commitWeekGridCellText({
      text,
      entry: model.entries[0],
      row,
      localDate: model.cell.localDate,
    });
    if (result.kind === "invalid") {
      if (beginEdit(model, text)) {
        invalidEditRef.current = model.cellId;
        setEditing({
          cellId: model.cellId,
          initialText: text,
          initialError: result.error,
        });
      }
      return;
    }
    writeInPlaceHours(result, "grid_cell");
  }

  /** A cell's hours as the cell shows them, such as "2:47", or null when empty. */
  function copyCell(model: CellModel) {
    return model.count === 0 ? null : formatClockDuration(model.durationMs);
  }

  // The listeners read the latest render through a ref, so they attach once.
  const clipboardRef = useRef({ pasteOnCell, copyCell });
  clipboardRef.current = { pasteOnCell, copyCell };
  useEffect(() => {
    /** The focused cell of this Grid. */
    function focusedCell() {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const cellId = active.dataset.cellId;
      return cellId ? (cellModelsRef.current.get(cellId) ?? null) : null;
    }

    function copy(event: ClipboardEvent) {
      if (event.defaultPrevented) return;
      const focused = focusedCell();
      // Text selected on the page copies as text.
      if (!focused || window.getSelection()?.type === "Range") return;
      const text = clipboardRef.current.copyCell(focused.model);
      if (text === null) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    }

    function paste(event: ClipboardEvent) {
      if (event.defaultPrevented) return;
      const focused = focusedCell();
      if (!focused) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      // Copied entries paste as entries, by the Week's own paste.
      if (matchEntryClipboard(text)) return;
      event.preventDefault();
      clipboardRef.current.pasteOnCell(focused.row, focused.model, text);
    }

    document.addEventListener("copy", copy);
    document.addEventListener("paste", paste);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("paste", paste);
    };
  }, []);

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
    return markLockedActions(
      [...cellActions, getDeleteRowAction(row, lockReason)],
      lockReason,
    );
  }

  function handleCellKeyDown(
    model: CellModel,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (blockedCellId === model.cellId && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setBlockedCellId(null);
      return;
    }
    if (!model.canEditInPlace) {
      // Hours typed on a cell that can't take them say why, with the way to
      // open it, instead of doing nothing (usability testing, 2026-11-06).
      if (HOURS_START.test(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        setBlockedCellId(model.cellId);
      }
      return;
    }
    // Enter edits in place instead of pressing the button; Space still opens the
    // panel. A digit, or the ".", "," or ":" that starts ".5" or ":45", edits
    // in place with that character. So does "-": dropped, "-1" saved 1:00;
    // kept, the hours refuse it with their message.
    if (event.key === "Enter" || /^[0-9.,:-]$/.test(event.key)) {
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
    cellModelsRef.current.set(model.cellId, { row, model });
    const block =
      blockedCellId === model.cellId
        ? getCellEditBlock(model, lockReason)
        : null;
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
          (isEditing || block) && "is-editing",
        )}
      >
        {isEditing ? (
          <InPlaceHoursInput
            label={`Hours for ${row.taskName} on ${dayLabel}`}
            initialText={editing.initialText}
            initialError={editing.initialError}
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
                data-cell-id={model.cellId}
                data-focus-column={dayIndex}
                aria-label={`${row.taskName}, ${dayLabel}, ${valueLabel}`}
                // "×2" is a count, and the cell opens a list: say so on hover
                // without a tooltip component per cell (council round 17).
                title={
                  model.count > 1
                    ? `${model.count} entries. Click to review.`
                    : undefined
                }
                onClick={(event) => handleCellClick(model, event.detail)}
                onBlur={(event) => {
                  // The note's button keeps it; anywhere else drops it.
                  if (
                    block &&
                    !(
                      event.relatedTarget instanceof Element &&
                      event.relatedTarget.closest(".weekly-grid-cell-note")
                    )
                  ) {
                    setBlockedCellId(null);
                  }
                }}
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
        {block ? (
          <span role="status" className="weekly-grid-cell-note">
            {block.message}
            {block.actionLabel ? (
              <Button
                variant="link"
                size="xs"
                className="weekly-grid-cell-note-action"
                onClick={() => {
                  setBlockedCellId(null);
                  openCell(model);
                }}
              >
                {block.actionLabel}
              </Button>
            ) : null}
          </span>
        ) : null}
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
                Project · task
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
                        overCapacity={day.farOverCapacity}
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
                  <div className="weekly-grid-add-row-actions">
                    <DisabledReason label="Add row" reason={lockReason}>
                      <Button
                        variant="ghost"
                        // Regular weight, like "+ New entry" and "+ New task".
                        className="font-normal text-muted-foreground"
                        disabled={lockReason !== undefined}
                        onClick={() => setIsAddingRow(true)}
                      >
                        <Plus data-icon="inline-start" /> Add row
                      </Button>
                    </DisabledReason>
                    {onCopyLastWeekRows && !lockReason ? (
                      <Button
                        variant="ghost"
                        className="font-normal text-muted-foreground"
                        onClick={() => {
                          // The first row's first day takes the typing.
                          const [first] = onCopyLastWeekRows();
                          if (first) {
                            pendingFocusRef.current = getCellId(
                              getWeeklyGridAddedRowKey(first),
                              weekDates[0]!,
                            );
                          }
                        }}
                      >
                        <CopyIcon data-icon="inline-start" /> Copy last
                        week&apos;s rows
                      </Button>
                    ) : null}
                  </div>
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
                    day.totalMs === 0 && "is-zero",
                  )}
                >
                  {day.totalMs === 0 ? "–" : formatClockDuration(day.totalMs)}
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
          nameMenuRow
            ? markLockedActions(
                [getDeleteRowAction(nameMenuRow, lockReason)],
                lockReason,
              )
            : []
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

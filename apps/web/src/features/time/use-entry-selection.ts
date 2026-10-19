import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  formatEntryCount,
  getTimeEntrySelectionActions,
  TIME_ENTRY_SELECTION_ACTION_IDS,
  type ObjectAction,
  type TimeEntryActionId,
} from "@/domain/actions/object-actions";
import {
  getLocalProjectDisplayName,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import {
  EMPTY_ENTRY_SELECTION,
  extendEntrySelection,
  getPasteDate,
  getSelectionActionIds,
  keepShownEntries,
  selectAllEntries,
  selectEntryOnClick,
  selectEntryOnMenu,
  selectEntryOnPress,
  type EntryPasteTarget,
  type EntrySelection,
} from "@/domain/time/entry-selection";
import { isTimesheetEntryCommitted } from "@/domain/time/timesheet-commit";
import {
  formatToastDay,
  offerTimeEntryUndo,
  type useTimeEntryActions,
} from "@/features/time/time-entry-actions";
import {
  getEntryClipboard,
  isTextEditingTarget,
  matchEntryClipboard,
  setEntryClipboard,
  useEntryClipboard,
} from "@/lib/entry-clipboard";
import { FOCUS_ITEM_SELECTOR } from "@/lib/item-keys";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** The selection id of a focusable entry, from its `data-selection-id`. */
function getSelectionId(element: Element | null) {
  return element instanceof HTMLElement
    ? element.dataset.selectionId
    : undefined;
}

/**
 * Whether an entry action is a Delete that may apply to the selection: Delete from
 * a key or a menu, or the Delete key on the running entry, whose action is Discard.
 * Discard chosen from the running entry's menu stays its own.
 */
function isSelectionDelete(actionId: TimeEntryActionId, key?: object) {
  return actionId === "delete" || (actionId === "discard" && key !== undefined);
}

/**
 * Selection, copy, cut and paste of entries on the Day list and the Week Days
 * cards. See "Selecting, copying and pasting entries" in docs/agents/ux-spec.md.
 *
 * A click selects an entry, Cmd or Ctrl+click adds one, Shift+click selects a
 * range. A press on an unselected entry selects it at once, and opening an
 * entry's menu selects it when it is not selected. Cmd+A and the Edit menu's
 * Select All select every shown entry, Shift+Up and Shift+Down extend the
 * range, and plain arrows collapse it to the focused entry. Double click opens
 * the entry, and so does a tap on a touch screen. Copy, cut and paste listen to
 * the browser's clipboard events, so the keys and the desktop Edit menu both
 * work, and text fields keep their own clipboard.
 *
 * Each entry carries `data-selection-id` with its id in `orderedIds`, and the
 * list or the columns take `scopeRef`.
 */
export function useEntrySelection({
  resetKey,
  orderedIds,
  runningEntryId,
  pasteTarget,
  entryActions,
  onOpen,
}: {
  /**
   * The shown day or week, and the layout when it can change. Showing another one
   * clears the selection, so coming back does not bring it back.
   */
  resetKey: string;
  /** The shown entries in reading order, the running entry included. */
  orderedIds: readonly string[];
  /** The running entry's id in `orderedIds`. Copy and cut skip it. */
  runningEntryId?: string;
  /** Where Cmd+V and the Edit menu's Paste put entries. */
  pasteTarget: EntryPasteTarget;
  /** The view's entry actions, which run Duplicate and the date dialogs. */
  entryActions: Pick<ReturnType<typeof useTimeEntryActions>, "runOnEntries">;
  onOpen: (entryId: string) => void;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const clipboard = useEntryClipboard();
  const scopeRef = useRef<HTMLDivElement>(null);
  /** Set while Shift+arrow moves focus, so `handleFocus` keeps the new range. */
  const extendingRef = useRef(false);
  const [stored, setStored] = useState<{
    resetKey: string;
    selection: EntrySelection;
  }>({ resetKey, selection: EMPTY_ENTRY_SELECTION });
  if (stored.resetKey !== resetKey) {
    setStored({ resetKey, selection: EMPTY_ENTRY_SELECTION });
  }
  const shownIds = useMemo(() => new Set(orderedIds), [orderedIds]);
  const selection =
    stored.resetKey === resetKey
      ? keepShownEntries(stored.selection, shownIds)
      : EMPTY_ENTRY_SELECTION;
  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids]);
  const cutIds = useMemo(
    () =>
      new Set(
        clipboard?.mode === "cut"
          ? clipboard.entries.map((entry) => entry.entryId)
          : [],
      ),
    [clipboard],
  );

  function select(next: EntrySelection) {
    setStored({ resetKey, selection: next });
  }

  /** Selects the entries an action just put down, such as copies or a paste. */
  function selectLanded(entryIds: readonly string[]) {
    select({ ids: [...entryIds], anchorId: entryIds[0] ?? null });
  }

  /** The selected saved entries in reading order, without the running entry. */
  const selectedEntries = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const entriesById = new Map(
      state.timesheetEntries.map((entry) => [entry._id, entry]),
    );
    return orderedIds.flatMap((id) => {
      const entry = selectedIds.has(id) ? entriesById.get(id) : undefined;
      return entry && id !== runningEntryId ? [entry] : [];
    });
  }, [orderedIds, runningEntryId, selectedIds, state.timesheetEntries]);

  function getSelectedEntries() {
    return selectedEntries;
  }

  /**
   * The entries a drag that starts on `entryId` carries, in reading order: the
   * selected saved entries when the entry is one of them, else the entry alone.
   * A drag on the running entry carries only it.
   */
  function getDragIds(entryId: string): string[] {
    if (entryId === runningEntryId || !selectedIds.has(entryId)) {
      return [entryId];
    }

    const ids = selectedEntries.map((entry) => entry._id);
    return ids.includes(entryId) ? ids : [entryId];
  }

  /** The selection's actions, named with their counts. */
  const selectionActions = useMemo(
    () =>
      getTimeEntrySelectionActions({
        saved: selectedEntries.length,
        committed: selectedEntries.filter(isTimesheetEntryCommitted).length,
      }),
    [selectedEntries],
  );

  function describeForText(entry: LocalTimesheetEntry) {
    const project = projects.find((item) => item._id === entry.projectId);
    const task = project?.tasks.find((item) => item._id === entry.taskId);
    return [
      formatToastDay(entry.localDate),
      formatClockDuration(entry.durationMs),
      project ? getLocalProjectDisplayName(project) : "No project",
      task?.name ?? (entry.label || "No task"),
      entry.note,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  /** Pastes the clipboard's entries at `target`, with one Undo. */
  function paste(target: EntryPasteTarget) {
    const current = getEntryClipboard();
    if (!current) return;

    const { undoToken, entryIds } = localStore.relocateTimesheetEntries(
      current.entries.map(({ entryId, localDate }) => ({
        entryId,
        localDate: getPasteDate(localDate, target),
      })),
      current.mode,
    );
    if (current.mode === "cut") {
      setEntryClipboard(null);
    }
    // Pasted entries become the selection, where they are shown.
    selectLanded(entryIds);
    offerTimeEntryUndo(
      undoToken,
      `${current.mode === "cut" ? "Moved" : "Pasted"} ${formatEntryCount(current.entries.length)}`,
    );
  }

  // The listeners read the latest render through a ref, so they attach once.
  const latest = useRef({
    getSelectedEntries,
    describeForText,
    paste,
    pasteTarget,
    selectAll,
  });
  useEffect(() => {
    latest.current = {
      getSelectedEntries,
      describeForText,
      paste,
      pasteTarget,
      selectAll,
    };
  });

  useEffect(() => {
    function copyOrCut(event: ClipboardEvent) {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) return;
      // Text selected outside the entries, such as in a dialog, copies as text.
      const focusOnEntry = document.activeElement?.closest("[data-entry-id]");
      if (!focusOnEntry && window.getSelection()?.type === "Range") return;

      const entries = latest.current.getSelectedEntries();
      if (entries.length === 0) return;

      event.preventDefault();
      const text = entries.map(latest.current.describeForText).join("\n");
      event.clipboardData?.setData("text/plain", text);
      setEntryClipboard({
        mode: event.type === "cut" ? "cut" : "copy",
        entries: entries.map((entry) => ({
          entryId: entry._id,
          localDate: entry.localDate,
        })),
        text,
      });
    }

    function pasteFromClipboard(event: ClipboardEvent) {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) return;
      if (!matchEntryClipboard(event.clipboardData?.getData("text/plain"))) {
        return;
      }

      event.preventDefault();
      latest.current.paste(latest.current.pasteTarget);
    }

    /**
     * The Edit menu's Select All runs the browser's select-all command, which
     * fires `selectstart` on the page outside the entries. While an entry has
     * focus, it selects the entries instead of the page's text. A text
     * selection started with the pointer inside the entries is left alone.
     */
    function selectAllFromMenu(event: Event) {
      const scope = scopeRef.current;
      const active = document.activeElement;
      if (
        !scope ||
        !active ||
        !scope.contains(active) ||
        isTextEditingTarget(active) ||
        (event.target instanceof Node && scope.contains(event.target))
      ) {
        return;
      }

      event.preventDefault();
      latest.current.selectAll();
    }

    document.addEventListener("copy", copyOrCut);
    document.addEventListener("cut", copyOrCut);
    document.addEventListener("paste", pasteFromClipboard);
    document.addEventListener("selectstart", selectAllFromMenu);
    return () => {
      document.removeEventListener("copy", copyOrCut);
      document.removeEventListener("cut", copyOrCut);
      document.removeEventListener("paste", pasteFromClipboard);
      document.removeEventListener("selectstart", selectAllFromMenu);
    };
  }, []);

  /** Cmd+A and Select All: every shown entry. */
  function selectAll() {
    if (orderedIds.length > 0) {
      select(selectAllEntries(orderedIds));
    }
  }

  /** A click on an entry: selects it, or opens it on a touch screen. */
  function handleClick(entryId: string, event: ReactMouseEvent<HTMLElement>) {
    const pointerType =
      "pointerType" in event.nativeEvent
        ? (event.nativeEvent as PointerEvent).pointerType
        : "mouse";
    if (pointerType === "touch") {
      select({ ids: [entryId], anchorId: entryId });
      onOpen(entryId);
      return;
    }

    select(
      selectEntryOnClick(selection, orderedIds, entryId, {
        range: event.shiftKey,
        // Either key, so a mismatched user agent still toggles. Ctrl+click on
        // macOS is a right-click and never gets here.
        toggle: event.metaKey || event.ctrlKey,
      }),
    );
  }

  /**
   * A press on an entry, before any drag: an unselected entry is selected alone
   * at once, so the drag that may follow carries it only. A press on a selected
   * entry keeps the selection for the drag. Touch presses are left to the tap.
   */
  function handlePress(entryId: string, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const next = selectEntryOnPress(selection, entryId, {
      range: event.shiftKey,
      toggle: event.metaKey || event.ctrlKey,
    });
    if (next !== selection) select(next);
  }

  /**
   * Opening an entry's menu, by right-click, the menu key or Shift+F10, selects
   * the entry first when it is not selected, so the menu acts on the selection.
   */
  function handleMenu(entryId: string) {
    const next = selectEntryOnMenu(selection, entryId);
    if (next !== selection) select(next);
  }

  /**
   * Keyboard focus moves the selection, as arrows do in a file explorer. A click
   * also focuses the entry, and leaves the selection to `handleClick`.
   */
  function handleFocus(entryId: string, event: ReactFocusEvent<HTMLElement>) {
    if (
      !extendingRef.current &&
      event.target === event.currentTarget &&
      event.currentTarget.matches(":focus-visible") &&
      !selectedIds.has(entryId)
    ) {
      select({ ids: [entryId], anchorId: entryId });
    }
  }

  /** On the list or the columns: a press on empty space clears the selection. */
  function handleScopePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (
      event.button === 0 &&
      event.target instanceof Element &&
      !event.target.closest(`${FOCUS_ITEM_SELECTOR}, button, [role='menu']`) &&
      selection.ids.length > 0
    ) {
      select(EMPTY_ENTRY_SELECTION);
    }
  }

  /**
   * On the list or the columns, after the focused entry's own keys:
   *
   * - Escape clears the selection.
   * - Cmd or Ctrl+A selects every shown entry.
   * - Shift+Up and Shift+Down move focus in reading order and extend the range.
   * - A plain arrow that moved focus to another entry selects that entry alone.
   */
  function handleScopeKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Escape") {
      if (!event.defaultPrevented && selection.ids.length > 0) {
        select(EMPTY_ENTRY_SELECTION);
      }
      return;
    }

    const hasCommand = event.metaKey || event.ctrlKey;
    if (
      hasCommand &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "a"
    ) {
      if (event.defaultPrevented || isTextEditingTarget(event.target)) return;
      event.preventDefault();
      selectAll();
      return;
    }

    if (!ARROW_KEYS.has(event.key) || hasCommand || event.altKey) return;
    const fromId = getSelectionId(event.target as Element);
    if (fromId === undefined) return;

    if (event.shiftKey) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      // Shift+arrow at either end still keeps the page from scrolling.
      event.preventDefault();
      const extended = extendEntrySelection(
        selection,
        orderedIds,
        fromId,
        event.key === "ArrowUp" ? -1 : 1,
      );
      if (!extended) return;
      select(extended.selection);
      extendingRef.current = true;
      try {
        scopeRef.current
          ?.querySelector<HTMLElement>(
            `[data-selection-id="${CSS.escape(extended.focusId)}"]`,
          )
          ?.focus();
      } finally {
        extendingRef.current = false;
      }
      return;
    }

    // The entry's own handler has already moved focus for a plain arrow. At
    // the top or bottom of the list focus stays, and Up or Down still
    // collapses the selection to the focused entry.
    const focusedId = getSelectionId(document.activeElement);
    const isVertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    if (
      focusedId !== undefined &&
      (focusedId !== fromId || isVertical) &&
      (selection.ids.length !== 1 || selection.ids[0] !== focusedId)
    ) {
      select({ ids: [focusedId], anchorId: focusedId });
    }
  }

  /**
   * The actions the right-click menu of `entryId` lists: the selection's, named
   * with their counts, when the entry is part of a selection of two or more, and
   * `own`, the entry's own actions, otherwise. Opening the menu selects the
   * entry first (`handleMenu`), so a multiple selection always includes it.
   */
  function getMenuActions(
    entryId: string,
    own: ObjectAction<TimeEntryActionId>[],
  ): ObjectAction<TimeEntryActionId>[] {
    return selection.ids.length >= 2 && selectedIds.has(entryId)
      ? selectionActions
      : own;
  }

  /**
   * The actions the keys of `entryId` run. When the selection applies to the
   * entry (see `getSelectionActionIds`), Delete, M and Cmd+D act on the
   * selection, while Enter, C and S keep acting on the focused entry. The
   * running entry's Delete key deletes the selection instead of discarding.
   */
  function getKeyActions(
    entryId: string,
    own: ObjectAction<TimeEntryActionId>[],
  ): ObjectAction<TimeEntryActionId>[] {
    if (!getSelectionActionIds(selection, entryId)) return own;
    return [
      ...own.filter(
        (action) =>
          !TIME_ENTRY_SELECTION_ACTION_IDS.has(action.id) &&
          action.id !== "discard",
      ),
      ...selectionActions,
    ];
  }

  /**
   * Runs an action on `entryId` on the whole selection when it applies to it (see
   * `getSelectionActionIds`), with one Undo. `key` is set when a key ran the
   * action, not a menu. Returns false when the caller should run the entry's own
   * action instead.
   *
   * - Delete removes the selected saved entries. The running entry stays, as copy
   *   and cut skip it.
   * - Duplicate copies each selected saved entry to the end of its day, and
   *   Move to… and Duplicate to… ask for one day for all of them. The moved
   *   entries stay selected; the copies become the selection.
   * - Mark as not committed marks the selected committed entries.
   */
  function runSelectionAction(
    entryId: string,
    actionId: TimeEntryActionId,
    key?: object,
  ) {
    if (isSelectionDelete(actionId, key)) {
      if (!getSelectionActionIds(selection, entryId)) {
        return false;
      }

      const ids = getSelectedEntries().map((entry) => entry._id);
      if (ids.length > 0) {
        offerTimeEntryUndo(
          localStore.deleteTimesheetEntries(ids),
          `${formatEntryCount(ids.length)} deleted`,
        );
      }
      return true;
    }

    if (
      actionId === "duplicate" ||
      actionId === "duplicate-to" ||
      actionId === "move-to"
    ) {
      // A copy of the one selected entry becomes the selection too, so the
      // next Delete removes the copy, not the original.
      const isOnlySelected =
        actionId !== "move-to" &&
        selection.ids.length === 1 &&
        selection.ids[0] === entryId;
      if (!getSelectionActionIds(selection, entryId) && !isOnlySelected) {
        return false;
      }

      entryActions.runOnEntries(actionId, getSelectedEntries(), {
        onDone: selectLanded,
      });
      return true;
    }

    if (actionId === "mark-not-committed") {
      if (!getSelectionActionIds(selection, entryId)) {
        return false;
      }

      const ids = getSelectedEntries()
        .filter(isTimesheetEntryCommitted)
        .map((entry) => entry._id);
      offerTimeEntryUndo(
        localStore.markTimesheetEntriesNotCommitted(ids),
        `Marked ${formatEntryCount(ids.length)} as not committed`,
      );
      return true;
    }

    return false;
  }

  return {
    scopeRef,
    selectedIds,
    cutIds,
    canPaste: clipboard !== null,
    paste,
    handleClick,
    handlePress,
    handleMenu,
    handleFocus,
    handleScopePointerDown,
    handleScopeKeyDown,
    getMenuActions,
    getKeyActions,
    getDragIds,
    runSelectionAction,
  };
}

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
import type { TimeEntryActionId } from "@/domain/actions/object-actions";
import {
  getLocalProjectDisplayName,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import {
  EMPTY_ENTRY_SELECTION,
  getPasteDate,
  getSelectionActionIds,
  keepShownEntries,
  selectEntryOnClick,
  type EntryPasteTarget,
  type EntrySelection,
} from "@/domain/time/entry-selection";
import { isTimesheetEntryCommitted } from "@/domain/time/timesheet-commit";
import {
  formatToastDay,
  offerTimeEntryUndo,
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

function countEntries(count: number) {
  return count === 1 ? "1 entry" : `${count} entries`;
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
 * cards. See "Selecting, copying and pasting entries" in agents/ux-spec.md.
 *
 * A click selects an entry, Cmd or Ctrl+click adds one, Shift+click selects a
 * range. Double click opens the entry, and so does a tap on a touch screen.
 * Copy, cut and paste listen to the browser's clipboard events, so the keys and
 * the desktop Edit menu both work, and text fields keep their own clipboard.
 */
export function useEntrySelection({
  resetKey,
  orderedIds,
  runningEntryId,
  pasteTarget,
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
  onOpen: (entryId: string) => void;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const clipboard = useEntryClipboard();
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

  /** The selected saved entries in reading order, without the running entry. */
  function getSelectedEntries() {
    const entriesById = new Map(
      state.timesheetEntries.map((entry) => [entry._id, entry]),
    );
    return orderedIds.flatMap((id) => {
      const entry = selectedIds.has(id) ? entriesById.get(id) : undefined;
      return entry && id !== runningEntryId ? [entry] : [];
    });
  }

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

    const token = localStore.pasteTimesheetEntries(
      current.entries.map(({ entryId, localDate }) => ({
        entryId,
        localDate: getPasteDate(localDate, target),
      })),
      current.mode,
    );
    if (current.mode === "cut") {
      setEntryClipboard(null);
    }
    offerTimeEntryUndo(
      token,
      `${current.mode === "cut" ? "Moved" : "Pasted"} ${countEntries(current.entries.length)}`,
    );
  }

  // The listeners read the latest render through a ref, so they attach once.
  const latest = useRef({
    getSelectedEntries,
    describeForText,
    paste,
    pasteTarget,
  });
  useEffect(() => {
    latest.current = {
      getSelectedEntries,
      describeForText,
      paste,
      pasteTarget,
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

    document.addEventListener("copy", copyOrCut);
    document.addEventListener("cut", copyOrCut);
    document.addEventListener("paste", pasteFromClipboard);
    return () => {
      document.removeEventListener("copy", copyOrCut);
      document.removeEventListener("cut", copyOrCut);
      document.removeEventListener("paste", pasteFromClipboard);
    };
  }, []);

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
   * Keyboard focus moves the selection, as arrows do in a file explorer. A click
   * also focuses the entry, and leaves the selection to `handleClick`.
   */
  function handleFocus(entryId: string, event: ReactFocusEvent<HTMLElement>) {
    if (
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

  /** On the list or the columns: Escape clears the selection. */
  function handleScopeKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (
      event.key === "Escape" &&
      !event.defaultPrevented &&
      selection.ids.length > 0
    ) {
      select(EMPTY_ENTRY_SELECTION);
    }
  }

  /**
   * Runs an action on `entryId` on the whole selection when it applies to it (see
   * `getSelectionActionIds`), with one Undo. `key` is set when a key ran the
   * action, not a menu. Returns false when the caller should run the entry's own
   * action instead.
   *
   * - Delete removes the selected saved entries. The running entry stays, as copy
   *   and cut skip it.
   * - Mark as not committed, from a menu, marks the selected committed entries.
   */
  function runSelectionAction(
    entryId: string,
    actionId: TimeEntryActionId,
    key?: object,
  ) {
    if (isSelectionDelete(actionId, key)) {
      if (
        !getSelectionActionIds(selection, entryId, { fromKey: Boolean(key) })
      ) {
        return false;
      }

      const ids = getSelectedEntries().map((entry) => entry._id);
      if (ids.length > 0) {
        offerTimeEntryUndo(
          localStore.deleteTimesheetEntries(ids),
          `${countEntries(ids.length)} deleted`,
        );
      }
      return true;
    }

    if (actionId === "mark-not-committed") {
      if (!getSelectionActionIds(selection, entryId, { fromKey: false })) {
        return false;
      }

      const ids = getSelectedEntries()
        .filter(isTimesheetEntryCommitted)
        .map((entry) => entry._id);
      offerTimeEntryUndo(
        localStore.markTimesheetEntriesNotCommitted(ids),
        `Marked ${countEntries(ids.length)} as not committed`,
      );
      return true;
    }

    return false;
  }

  return {
    selectedIds,
    cutIds,
    canPaste: clipboard !== null,
    paste,
    handleClick,
    handleFocus,
    handleScopePointerDown,
    handleScopeKeyDown,
    runSelectionAction,
  };
}

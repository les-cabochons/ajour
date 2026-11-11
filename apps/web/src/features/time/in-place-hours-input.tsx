import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { filterPastedHours } from "@/domain/time/duration";
import type { WeekGridCellCommit } from "@/domain/time/week-grid-cell";
import { offerTimeEntryUndo } from "@/features/time/time-entry-actions";
import { localStore, runStoreCommandWith } from "@/lib/local-store";
import { cn } from "@/lib/utils";

/**
 * How an in-place edit ends. A number saves and moves that many days (Tab and
 * Shift+Tab move one day, Enter stays). `blur` saves a valid value and keeps the
 * saved hours otherwise.
 */
export type InPlaceHoursEnd = -1 | 0 | 1 | "blur";

/**
 * Writes what hours typed or pasted in place decided
 * (`commitWeekGridCellText`): a new entry, the entry's new hours, or its
 * deletion with the Undo toast. `host` names the surface on the entry's event.
 */
export function writeInPlaceHours(
  result: Exclude<WeekGridCellCommit, { kind: "invalid" }>,
  host: "grid_cell" | "days_card",
) {
  // Every write offers Undo, as the entry editor's saves do.
  if (result.kind === "create") {
    offerTimeEntryUndo(
      runStoreCommandWith("saveManualTimeEntry", [result.values], (unit) =>
        unit.set({ time_entry: { host } }),
      ),
      "Entry created",
    );
  } else if (result.kind === "update") {
    offerTimeEntryUndo(
      runStoreCommandWith(
        "updateTimesheetEntry",
        [result.entryId, result.values],
        (unit) => unit.set({ time_entry: { host } }),
      ),
      "Entry saved",
    );
  } else if (result.kind === "delete") {
    offerTimeEntryUndo(
      localStore.deleteTimesheetEntry(result.entryId),
      "Entry deleted",
    );
  }
}

/**
 * The hours input of a Week Grid cell or a Days card being edited in place.
 * Enter saves, Tab and Shift+Tab save and move a day, Escape cancels, and
 * leaving it saves a valid value. Pasted text keeps only what hours can hold
 * (`filterPastedHours`), as typing on the cell does.
 */
export function InPlaceHoursInput({
  label,
  initialText,
  initialError = null,
  savedText,
  onEnd,
  onCancel,
  className,
}: {
  label: string;
  /** Text typed to start editing, such as a digit. Without it, the saved hours are selected. */
  initialText?: string;
  /** The message hours pasted on the cell left, shown from the start. */
  initialError?: string | null;
  savedText: string;
  /** Saves the text. Returns an error to keep editing, or null when the edit ended. */
  onEnd: (text: string, end: InPlaceHoursEnd) => string | null;
  onCancel: () => void;
  className?: string;
}) {
  const [text, setText] = useState(initialText ?? savedText);
  const [error, setError] = useState<string | null>(initialError);
  const errorId = useId();
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

  function end(edit: Exclude<InPlaceHoursEnd, "blur">) {
    const nextError = onEnd(text, edit);
    setError(nextError);
    endedRef.current = nextError === null;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      // The card or cell around the input must not take Enter as its own.
      event.stopPropagation();
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

  function handlePaste(event: ReactClipboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    event.preventDefault();
    const pasted = filterPastedHours(event.clipboardData.getData("text/plain"));
    const start = input.selectionStart ?? input.value.length;
    const finish = input.selectionEnd ?? start;
    const next =
      input.value.slice(0, start) + pasted + input.value.slice(finish);
    setText(next);
    setError(null);
    const caret = start + pasted.length;
    requestAnimationFrame(() => input.setSelectionRange(caret, caret));
  }

  return (
    <>
      <input
        ref={inputRef}
        className={cn(
          "weekly-grid-cell-input",
          className,
          error && "is-invalid",
        )}
        value={text}
        // A text keyboard: a numeric keypad has no ":" or "h" for "1:30" or "1h30".
        inputMode="text"
        autoComplete="off"
        // The default size of 20 characters would widen the day column.
        size={1}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        // A press inside the input places the caret; it never drags the card.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onBlur={() => {
          if (!endedRef.current) {
            const nextError = onEnd(text, "blur");
            setError(nextError);
            endedRef.current = nextError === null;
          }
        }}
      />
      {/* Under the cell, as the entry editor shows it under Hours. */}
      {error ? (
        <span id={errorId} role="alert" className="weekly-grid-cell-error">
          {error}
        </span>
      ) : null}
    </>
  );
}

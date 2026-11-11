import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

/** The range a number field takes, and what it says when a value is outside. */
export interface NumberDraftRule {
  min?: number;
  max?: number;
  /** Only whole numbers. */
  integer?: boolean;
  /** Said under the field when the typed text is not a number it takes. */
  message: string;
}

export type NumberDraftRead =
  { ok: true; value: number } | { ok: false; error: string };

/**
 * Reads what was typed in a number field. Empty, partial or out-of-range
 * text is refused with the rule's message, never read as 0 or clamped.
 */
export function readNumberDraft(
  text: string,
  rule: NumberDraftRule,
): NumberDraftRead {
  const trimmed = text.trim().replace(",", ".");
  const value = trimmed === "" ? Number.NaN : Number(trimmed);
  if (
    !Number.isFinite(value) ||
    (rule.integer && !Number.isInteger(value)) ||
    (rule.min !== undefined && value < rule.min) ||
    (rule.max !== undefined && value > rule.max)
  ) {
    return { ok: false, error: rule.message };
  }
  return { ok: true, value };
}

/**
 * A number field's text, kept apart from the saved value so the field can be
 * empty or half-typed while the user types: nothing snaps back to 0 or adds
 * digits. Enter or leaving the field commits a valid value; an invalid one
 * keeps the typed text, shows `error` and saves nothing. Escape puts the
 * saved value back. With `live`, each valid keystroke commits too, for a
 * field whose effect shows beside it as the user types.
 */
export function useNumberDraft({
  value,
  rule,
  onCommit,
  live = false,
}: {
  value: number | undefined;
  rule: NumberDraftRule;
  onCommit: (value: number) => void;
  live?: boolean;
}) {
  const format = (next: number | undefined) =>
    next === undefined ? "" : String(next);
  const [text, setText] = useState(() => format(value));
  const [error, setError] = useState<string | null>(null);
  const focusedRef = useRef(false);

  // A change from elsewhere shows unless the user is typing in the field.
  useEffect(() => {
    if (!focusedRef.current) {
      setText(format(value));
      setError(null);
    }
  }, [value]);

  function commit() {
    const read = readNumberDraft(text, rule);
    if (!read.ok) {
      setError(read.error);
      return;
    }
    setError(null);
    setText(format(read.value));
    if (read.value !== value) onCommit(read.value);
  }

  return {
    error,
    inputProps: {
      value: text,
      inputMode: rule.integer ? ("numeric" as const) : ("decimal" as const),
      "aria-invalid": error ? true : undefined,
      onFocus: () => {
        focusedRef.current = true;
      },
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const next = event.target.value;
        setText(next);
        if (error) setError(null);
        if (live) {
          const read = readNumberDraft(next, rule);
          if (read.ok && read.value !== value) onCommit(read.value);
        }
      },
      onBlur: () => {
        focusedRef.current = false;
        commit();
      },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape" && text !== format(value)) {
          event.preventDefault();
          event.stopPropagation();
          setText(format(value));
          setError(null);
        }
      },
    },
  };
}

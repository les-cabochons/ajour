import {
  Children,
  Fragment,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/**
 * A number written into a sentence and typed in place: "5h remaining". The
 * number has a dashed underline, as a link does, so it reads as something
 * to click; hover tints it, focus draws the caret (forms council round 13).
 * At rest it reads as the figures elsewhere do ("8h", "2h30"); focused, it
 * shows what was typed. The word after it is its label.
 */
function InlineFigure({
  id,
  label,
  value,
  onChange,
  format,
  invalid = false,
  placeholder = "0h",
  trailing,
  onKeyDown,
  inputMode = "decimal",
  readOnly = false,
  describedBy,
}: {
  id: string;
  /** The word after the number, which names it: "remaining". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The number as figures show it, or null to show the typed text. */
  format?: (value: string) => string | null;
  invalid?: boolean;
  placeholder?: string;
  /** A control after the word, such as a reset. */
  trailing?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputMode?: ComponentProps<"input">["inputMode"];
  /** The number can be read and focused but not typed over. */
  readOnly?: boolean;
  /** The id of text that describes the number, such as why it is read-only. */
  describedBy?: string;
}) {
  const [focused, setFocused] = useState(false);
  const shown = focused || !format ? value : (format(value) ?? value);
  return (
    <span
      data-slot="inline-figure"
      data-invalid={invalid ? "true" : undefined}
      className="inline-figure"
    >
      <input
        id={id}
        className="inline-figure-input"
        inputMode={inputMode}
        autoComplete="off"
        placeholder={placeholder}
        value={shown}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        readOnly={readOnly}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <label htmlFor={id} className="inline-figure-label">
        {label}
      </label>
      {trailing}
    </span>
  );
}

/** Inline figures as one sentence, joined by middle dots. */
function InlineFigures({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  const parts = Children.toArray(children).filter(Boolean);
  return (
    <div
      role="group"
      data-slot="inline-figures"
      className={cn("inline-figures", className)}
      {...props}
    >
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span aria-hidden className="inline-figures-dot">
              ·
            </span>
          ) : null}
          {part}
        </Fragment>
      ))}
    </div>
  );
}

export { InlineFigure, InlineFigures };

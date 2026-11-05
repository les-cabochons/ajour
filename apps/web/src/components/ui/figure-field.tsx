import {
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/**
 * A figure you can edit: the label over the number, as `Figure` lays them,
 * with the number in a soft well that brightens on hover and takes a caret
 * on a click (forms council round 12). At rest the number reads as the
 * figures elsewhere do ("8h", "2h30"); focused, it shows what was typed.
 */
function FigureField({
  id,
  label,
  value,
  onChange,
  format,
  invalid = false,
  placeholder = "Add",
  trailing,
  onKeyDown,
  inputMode = "decimal",
  className,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** The number as figures show it, or null to show the typed text. */
  format?: (value: string) => string | null;
  invalid?: boolean;
  placeholder?: string;
  /** A control after the well, such as a reset. */
  trailing?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputMode?: ComponentProps<"input">["inputMode"];
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const shown = focused || !format ? value : (format(value) ?? value);
  return (
    <div
      data-slot="figure-field"
      data-invalid={invalid ? "true" : undefined}
      className={cn("figure-field", className)}
    >
      <label htmlFor={id} className="figure-field-label">
        {label}
      </label>
      <div className="figure-field-row">
        {/* The whole well takes the click, not only the text. */}
        <div
          className="figure-field-well"
          onMouseDown={(event) => {
            if (event.target === inputRef.current) return;
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <input
            ref={inputRef}
            id={id}
            className="figure-field-input"
            inputMode={inputMode}
            autoComplete="off"
            placeholder={placeholder}
            value={shown}
            aria-invalid={invalid}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {trailing}
      </div>
    </div>
  );
}

/** Editable figures side by side, as a `FigureRow`. */
function FigureFieldRow({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="figure-field-row"
      className={cn("figure-field-group", className)}
      {...props}
    />
  );
}

export { FigureField, FigureFieldRow };

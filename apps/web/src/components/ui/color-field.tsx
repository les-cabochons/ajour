import type { ReactNode } from "react";
import { useId, useState } from "react";
import { HEX_COLOR_ERROR, normalizeHexColor } from "@/domain/hex-color";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The project palette: twelve presets, the accent first. */
export const COLOR_PRESETS = [
  "#4f46e5",
  "#2563eb",
  "#0891b2",
  "#059669",
  "#65a30d",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#9333ea",
  "#64748b",
  "#334155",
];

/**
 * A color as a swatch button that opens a popover with the preset palette and
 * a hex input, in place of the browser's own color control. `onChange` gets
 * a "#rrggbb" value. The hex input takes "#fff" or "ff8800" too, and applies
 * on Enter, when it loses focus or when the popover closes; text that isn't a
 * color stays, with a sentence saying why, and changes nothing.
 */
export function ColorField({
  id,
  value,
  onChange,
  label = "Color",
  className,
  trailing,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  /** Drawn after the value, such as a picker chevron. */
  trailing?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  /** Applies the typed color. Returns false when it isn't one. */
  function applyDraft() {
    const color = normalizeHexColor(draft);
    if (!color) {
      setError(HEX_COLOR_ERROR);
      return false;
    }
    setError(null);
    setDraft(color);
    if (color !== value.toLowerCase()) onChange(color);
    return true;
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(value);
          setError(null);
        } else if (draft !== value) {
          // Closing applies a color typed but not yet entered.
          applyDraft();
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            size="lg"
            className={cn("color-field-trigger", className)}
            aria-label={`${label}: ${value}`}
          />
        }
      >
        <span
          aria-hidden="true"
          className="color-field-swatch"
          style={{ background: value }}
        />
        <span className="font-mono text-xs">{value}</span>
        {trailing}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="color-field-popover"
      >
        <div
          role="listbox"
          aria-label="Preset colors"
          className="color-field-grid"
        >
          {COLOR_PRESETS.map((preset) => {
            const selected = preset.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={preset}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={preset}
                className={cn("color-field-option", selected && "is-selected")}
                style={{ background: preset }}
                onClick={() => {
                  onChange(preset);
                  setOpen(false);
                }}
              />
            );
          })}
        </div>
        <Input
          aria-label="Hex color"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="font-mono"
          placeholder="#4f46e5"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onBlur={() => {
            if (draft !== value) applyDraft();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (applyDraft()) setOpen(false);
            }
          }}
        />
        {error ? (
          <p id={errorId} role="alert" className="field-error mt-1.5">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

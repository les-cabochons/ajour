import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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
 * a "#rrggbb" value.
 */
export function ColorField({
  id,
  value,
  onChange,
  label = "Color",
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
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
          className="font-mono"
          placeholder="#4f46e5"
          value={draft}
          onChange={(event) => {
            const next = event.target.value.trim();
            setDraft(next);
            if (HEX_COLOR.test(next)) onChange(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

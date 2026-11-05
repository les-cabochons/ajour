import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  /**
   * Disables the option and says why to screen readers, as menus do (rule 2
   * of the action model in docs/agents/ux-spec.md).
   */
  disabledReason?: string;
  /** A decorative icon shown before the label in the menu. See `iconValue`. */
  icon?: ReactNode;
}

export interface SelectOptionGroup<T extends string = string> {
  label: string;
  options: SelectOption<T>[];
}

// Base UI treats an empty value as "nothing chosen", so a labeled empty
// option travels under this name.
const EMPTY = "\u0000empty";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

/**
 * A choice among a few labeled options, in place of the browser's `<select>`:
 * a 28px (`sm`) or 32px trigger that shows the chosen label and opens a menu
 * of items, with optional groups. Name it with `label` (an `aria-label`) or
 * through a `<label htmlFor={id}>`. With `iconValue`, the trigger shows the
 * chosen option's icon alone, for a field too narrow for the labels. The
 * option's label names the icon for screen readers and shows in a tooltip.
 */
export function OptionSelect<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  groups,
  disabled,
  invalid,
  size = "sm",
  iconValue = false,
  iconLabel = false,
  emptyNamesField = false,
  prefix,
  className,
}: {
  id?: string;
  label?: string;
  value: T;
  onChange: (value: T) => void;
  options?: SelectOption<T>[];
  groups?: SelectOptionGroup<T>[];
  disabled?: boolean;
  invalid?: boolean;
  size?: "sm" | "default";
  /** Shows the chosen option's icon in the trigger instead of its label. */
  iconValue?: boolean;
  /** Shows the chosen option's icon before its label, as a composer chip does. */
  iconLabel?: boolean;
  /** Names the property in the trigger before its value: "State · Active". */
  prefix?: ReactNode;
  /**
   * With `iconLabel`, an empty value names the field in muted text, as an
   * empty composer chip does: "Priority", not "No priority" (forms council
   * round 19).
   */
  emptyNamesField?: boolean;
  className?: string;
}) {
  const all = [...(options ?? []), ...(groups ?? []).flatMap((g) => g.options)];
  const items = all.map((option) => ({
    value: encode(option.value),
    label: option.label,
  }));
  const renderItem = (option: SelectOption<T>) => (
    <SelectItem
      key={option.value}
      value={encode(option.value)}
      disabled={option.disabled || option.disabledReason !== undefined}
      aria-description={option.disabledReason}
    >
      {option.icon}
      {option.label}
    </SelectItem>
  );
  const chosen = all.find((option) => option.value === value);
  const trigger = (children: ReactNode) => (
    <SelectTrigger
      id={id}
      size={size}
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={cn("w-full", className)}
    >
      {children}
    </SelectTrigger>
  );

  return (
    <Select
      value={encode(value)}
      // The content mounts on open, so the trigger learns the labels here.
      items={items}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === null) return;
        const decoded = decode(String(next)) as T;
        if (decoded !== value) onChange(decoded);
      }}
    >
      {iconValue && chosen?.icon ? (
        // Not TooltipButton: its aria-label would replace the field's name.
        <Tooltip>
          <TooltipTrigger
            render={trigger(
              <SelectValue>
                <span role="img" aria-label={chosen.label} className="flex">
                  {chosen.icon}
                </span>
              </SelectValue>,
            )}
          />
          <TooltipContent>{chosen.label}</TooltipContent>
        </Tooltip>
      ) : iconLabel && chosen ? (
        trigger(
          <>
            {prefix}
            <SelectValue>
              {chosen.icon}
              {emptyNamesField && value === "" && label ? (
                <span data-placeholder="">{label}</span>
              ) : (
                chosen.label
              )}
            </SelectValue>
          </>,
        )
      ) : (
        trigger(
          <>
            {prefix}
            <SelectValue />
          </>,
        )
      )}
      <SelectContent>
        {options?.map(renderItem)}
        {groups?.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.options.map(renderItem)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

import { RiArrowDownSLine } from "@remixicon/react";

/**
 * The chevron that ends a property value which opens a menu, so every such
 * value says so at rest (council rounds 9 and 10).
 */
export function PickerChevron() {
  return (
    <RiArrowDownSLine
      aria-hidden
      className="ml-auto size-4 shrink-0 text-muted-foreground"
    />
  );
}

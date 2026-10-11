import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { RiCheckLine, RiSubtractLine } from "@remixicon/react";

import { cn } from "@/lib/utils";

function Checkbox({
  className,
  indicatorClassName,
  ...props
}: CheckboxPrimitive.Root.Props & {
  indicatorClassName?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[calc(var(--control-radius)*0.75)] border border-[var(--field-border)] bg-[var(--field-bg)] text-primary-foreground transition-[color,box-shadow,background-color,border-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 data-indeterminate:border-primary data-indeterminate:bg-primary data-checked:border-primary data-checked:bg-primary data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className={cn(
          "flex items-center justify-center [&_svg]:size-3",
          indicatorClassName,
        )}
      >
        {props.indeterminate ? <RiSubtractLine /> : <RiCheckLine />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };

import { RiLockLine as Lock } from "@remixicon/react";
import { Chip } from "@/components/ui/chip";

/** The lock of a submitted week, on the Commit page, the Week view and the entry editor. */
export function WeekLockChip() {
  return (
    <Chip>
      {/* Chip wraps its children in a text span, out of reach of its own
          direct-child svg sizing, so the icon sizes itself inline. */}
      <Lock aria-hidden className="mr-1 inline size-3 align-[-2px]" />
      Submitted
    </Chip>
  );
}

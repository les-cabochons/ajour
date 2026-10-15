import {
  createSharedTableDragPointerSession,
  type SharedTableDragEventSource,
  type SharedTableDragPointer,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";

interface CrossDayDragTarget {
  getBoundingClientRect: () => Pick<
    DOMRect,
    "bottom" | "left" | "right" | "top"
  >;
}

export function getCrossDayDragTarget(
  pointer: Pick<SharedTableDragPointer, "clientX" | "clientY">,
  targets: Map<string, CrossDayDragTarget>,
) {
  for (const [localDate, target] of targets) {
    const rect = target.getBoundingClientRect();
    if (
      pointer.clientX >= rect.left &&
      pointer.clientX <= rect.right &&
      pointer.clientY >= rect.top &&
      pointer.clientY <= rect.bottom
    ) {
      return localDate;
    }
  }

  return null;
}

/**
 * The shared pointer session, plus the weekday under the pointer. `onEnd`
 * gets the day the entry was dropped on, or null when the drag was cancelled
 * (pointer cancel or Escape) or ended outside every day.
 */
export function createCrossDayEntryDragPointerSession(options: {
  eventSource?: SharedTableDragEventSource;
  pointerId: number;
  pointerType: string;
  originX: number;
  originY: number;
  targets: Map<string, CrossDayDragTarget>;
  isDragging: () => boolean;
  onStart: (pointer: SharedTableDragPointer, targetDate: string | null) => void;
  onMove: (pointer: SharedTableDragPointer, targetDate: string | null) => void;
  onEnd: (targetDate: string | null, commit: boolean) => void;
  onPressEnd: (cancelled: boolean) => void;
}): SharedTableDragPointerSession {
  let latestTargetDate: string | null = null;

  return createSharedTableDragPointerSession({
    eventSource: options.eventSource,
    pointerId: options.pointerId,
    pointerType: options.pointerType,
    originX: options.originX,
    originY: options.originY,
    isDragging: options.isDragging,
    onStart: (pointer) => {
      latestTargetDate = getCrossDayDragTarget(pointer, options.targets);
      options.onStart(pointer, latestTargetDate);
    },
    onMove: (pointer) => {
      latestTargetDate = getCrossDayDragTarget(pointer, options.targets);
      options.onMove(pointer, latestTargetDate);
    },
    onEnd: (commit) => {
      options.onEnd(commit ? latestTargetDate : null, commit);
    },
    onPressEnd: options.onPressEnd,
  });
}

/**
 * Where the drop line shows while a card is dragged within its own day: above
 * the card it would land in front of, or below the last card. `targetIndex` is
 * the card's index in the day after the drop, as `getSharedTableDragTargetIndex`
 * gives it. Returns null when the card would land where it started.
 */
export function getSameDayDropLine(
  entryIds: readonly string[],
  draggedId: string,
  targetIndex: number,
): { entryId: string; edge: "before" | "after" } | null {
  if (entryIds.indexOf(draggedId) === targetIndex) return null;

  const others = entryIds.filter((entryId) => entryId !== draggedId);
  const before = others[targetIndex];
  if (before) return { entryId: before, edge: "before" };

  const last = others.at(-1);
  return last ? { entryId: last, edge: "after" } : null;
}

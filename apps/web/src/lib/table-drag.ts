const SHARED_TABLE_DRAG_MOUSE_TOLERANCE_PX = 4;
const SHARED_TABLE_DRAG_TOUCH_TOLERANCE_PX = 8;
export const SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS = 250;

export function getSharedTableDragTolerance(pointerType: string) {
  return pointerType === "touch"
    ? SHARED_TABLE_DRAG_TOUCH_TOLERANCE_PX
    : SHARED_TABLE_DRAG_MOUSE_TOLERANCE_PX;
}

type SharedTableDragMovement = {
  pointerType: string;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
};

export function shouldStartSharedTableDrag({
  pointerType,
  originX,
  originY,
  currentX,
  currentY,
}: SharedTableDragMovement) {
  return (
    Math.hypot(currentX - originX, currentY - originY) >
    getSharedTableDragTolerance(pointerType)
  );
}

export interface SharedTableDragPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
  eventType: string;
}

interface SharedTableDragEventSource {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
}

export interface SharedTableDragPointerSession {
  pointerId: number;
  dispose: () => void;
}

export function createSharedTableDragPointerSession(options: {
  eventSource?: SharedTableDragEventSource;
  pointerId: number;
  pointerType: string;
  originX: number;
  originY: number;
  isDragging: () => boolean;
  onStart: (pointer: SharedTableDragPointer) => void;
  onMove: (pointer: SharedTableDragPointer) => void;
  onEnd: (commit: boolean) => void;
  onPressEnd: (cancelled: boolean) => void;
}): SharedTableDragPointerSession {
  const eventSource = options.eventSource ?? window;
  let disposed = false;

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    eventSource.removeEventListener("pointermove", handlePointerMove);
    eventSource.removeEventListener("pointerup", handlePointerEnd);
    eventSource.removeEventListener("pointercancel", handlePointerEnd);
  };

  const handlePointerMove: EventListener = (event) => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerId !== options.pointerId) {
      return;
    }

    const pointer = toSharedPointer(pointerEvent);
    if (options.isDragging()) {
      pointerEvent.preventDefault();
      options.onMove(pointer);
      return;
    }

    if (
      shouldStartSharedTableDrag({
        pointerType: options.pointerType,
        originX: options.originX,
        originY: options.originY,
        currentX: pointer.clientX,
        currentY: pointer.clientY,
      })
    ) {
      pointerEvent.preventDefault();
      options.onStart(pointer);
    }
  };

  const handlePointerEnd: EventListener = (event) => {
    const pointerEvent = event as PointerEvent;
    if (pointerEvent.pointerId !== options.pointerId) {
      return;
    }

    const wasDragging = options.isDragging();
    dispose();

    if (wasDragging) {
      pointerEvent.preventDefault();
      options.onEnd(pointerEvent.type !== "pointercancel");
      return;
    }

    options.onPressEnd(pointerEvent.type === "pointercancel");
  };

  eventSource.addEventListener("pointermove", handlePointerMove);
  eventSource.addEventListener("pointerup", handlePointerEnd);
  eventSource.addEventListener("pointercancel", handlePointerEnd);

  return {
    pointerId: options.pointerId,
    dispose,
  };
}

function toSharedPointer(event: PointerEvent): SharedTableDragPointer {
  return {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    eventType: event.type,
  };
}

const activeDocumentDragClasses = new Map<string, number>();
const preexistingDocumentDragClasses = new Map<string, boolean>();
let previousBodyCursor: string | undefined;
let previousBodyUserSelect: string | undefined;

export function setSharedTableDragDocumentState(
  active: boolean,
  bodyClassName?: string,
) {
  const dragKey = bodyClassName ?? "__shared-table-drag__";

  if (active) {
    if (activeDocumentDragClasses.size === 0) {
      previousBodyCursor = document.body.style.cursor;
      previousBodyUserSelect = document.body.style.userSelect;
    }
    activeDocumentDragClasses.set(
      dragKey,
      (activeDocumentDragClasses.get(dragKey) ?? 0) + 1,
    );
    if (bodyClassName) {
      if (!preexistingDocumentDragClasses.has(dragKey)) {
        preexistingDocumentDragClasses.set(
          dragKey,
          document.body.classList.contains(bodyClassName),
        );
      }
      document.body.classList.add(bodyClassName);
    }
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    return;
  }

  const nextCount = Math.max(
    0,
    (activeDocumentDragClasses.get(dragKey) ?? 0) - 1,
  );
  if (nextCount > 0) {
    activeDocumentDragClasses.set(dragKey, nextCount);
  } else {
    activeDocumentDragClasses.delete(dragKey);
  }
  if (
    bodyClassName &&
    nextCount === 0 &&
    !preexistingDocumentDragClasses.get(dragKey)
  ) {
    document.body.classList.remove(bodyClassName);
  }
  if (nextCount === 0) {
    preexistingDocumentDragClasses.delete(dragKey);
  }
  if (activeDocumentDragClasses.size > 0) {
    return;
  }

  document.body.style.cursor = previousBodyCursor ?? "";
  document.body.style.userSelect = previousBodyUserSelect ?? "";
  previousBodyCursor = undefined;
  previousBodyUserSelect = undefined;
}

interface SharedTableDragRow {
  getBoundingClientRect: () => Pick<DOMRect, "top" | "height">;
}

export function getSharedTableDragTargetIndex(
  itemIds: string[],
  sourceItemId: string,
  pointerY: number,
  rowRefs: Map<string, SharedTableDragRow>,
) {
  let nextIndex = 0;

  for (const itemId of itemIds) {
    if (itemId === sourceItemId) {
      continue;
    }

    const row = rowRefs.get(itemId);
    if (!row) {
      continue;
    }

    const rect = row.getBoundingClientRect();
    if (pointerY >= rect.top + rect.height / 2) {
      nextIndex += 1;
    }
  }

  return nextIndex;
}

export function getSharedTableDragRowShift(options: {
  itemIndex: number;
  originIndex: number;
  targetIndex: number;
  rowHeight: number;
}) {
  const { itemIndex, originIndex, targetIndex, rowHeight } = options;

  if (
    originIndex < targetIndex &&
    itemIndex > originIndex &&
    itemIndex <= targetIndex
  ) {
    return -rowHeight;
  }

  if (
    originIndex > targetIndex &&
    itemIndex >= targetIndex &&
    itemIndex < originIndex
  ) {
    return rowHeight;
  }

  return 0;
}

export function getSharedTableDragOverlayTransform(options: {
  originLeft: number;
  minTop: number;
  pointerY: number;
  offsetY: number;
}) {
  const top = Math.max(options.minTop, options.pointerY - options.offsetY);
  return `translate3d(${Math.round(options.originLeft)}px, ${Math.round(top)}px, 0)`;
}

/**
 * Move up and Move down (Alt+Up and Alt+Down): the order after `itemId` moves
 * one place, and its new index. Returns null when the item is not in `itemIds`
 * or already at that edge. Callers commit `order` or `toIndex` with the same
 * persistence command as a drag.
 */
export function getSharedTableStepOrder(
  itemIds: readonly string[],
  itemId: string,
  step: -1 | 1,
) {
  const fromIndex = itemIds.indexOf(itemId);
  const toIndex = fromIndex + step;
  if (fromIndex === -1 || toIndex < 0 || toIndex >= itemIds.length) {
    return null;
  }

  const order = [...itemIds];
  order.splice(fromIndex, 1);
  order.splice(toIndex, 0, itemId);
  return { order, toIndex };
}

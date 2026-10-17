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

/**
 * Capture-phase listener options. An object rather than `true`: Node's
 * EventTarget, which the tests use, ignores a boolean in removeEventListener.
 */
const CAPTURE = { capture: true };

export interface SharedTableDragEventSource {
  addEventListener: (
    type: string,
    listener: EventListener,
    options?: { capture?: boolean },
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListener,
    options?: { capture?: boolean },
  ) => void;
}

export interface SharedTableDragPointerSession {
  pointerId: number;
  dispose: () => void;
}

/**
 * Follows one press from pointer down to its end. Moving past the tolerance
 * starts the drag (`onStart`), then `onMove` follows the pointer. The session
 * ends once:
 *
 * - pointer up after a drag calls `onEnd(true)`, so the caller commits;
 * - pointer cancel or Escape during a drag calls `onEnd(false)`, so the caller
 *   puts the item back. Escape stops there, so it does not also close the
 *   panel or dialog behind the drag;
 * - a press that never became a drag calls `onPressEnd`, with `cancelled` true
 *   for pointer cancel or Escape.
 *
 * After Escape, the click that the later release produces is swallowed, so
 * a cancelled press or drag never opens the row.
 *
 * `onScroll`, when given, runs on every scroll during a drag, anywhere on the
 * page, so a caller can measure its targets again while the pointer stays.
 */
export function createSharedTableDragPointerSession(options: {
  eventSource?: SharedTableDragEventSource;
  /** The element that took pointer capture on press. Escape releases it. */
  captureTarget?: Pick<Element, "hasPointerCapture" | "releasePointerCapture">;
  pointerId: number;
  pointerType: string;
  originX: number;
  originY: number;
  isDragging: () => boolean;
  onStart: (pointer: SharedTableDragPointer) => void;
  onMove: (pointer: SharedTableDragPointer) => void;
  onEnd: (commit: boolean) => void;
  onPressEnd: (cancelled: boolean) => void;
  onScroll?: () => void;
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
    eventSource.removeEventListener("keydown", handleKeyDown, CAPTURE);
    eventSource.removeEventListener("scroll", handleScroll, CAPTURE);
  };

  const handleScroll: EventListener = () => {
    if (options.isDragging()) {
      options.onScroll?.();
    }
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

  const handleKeyDown: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== "Escape") {
      return;
    }

    const wasDragging = options.isDragging();
    dispose();
    // The button is still down. Its release must not reach the row as a click.
    if (options.captureTarget?.hasPointerCapture(options.pointerId)) {
      options.captureTarget.releasePointerCapture(options.pointerId);
    }
    swallowReleaseClick(eventSource, options.pointerId);

    if (wasDragging) {
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      options.onEnd(false);
      return;
    }

    options.onPressEnd(true);
  };

  eventSource.addEventListener("pointermove", handlePointerMove);
  eventSource.addEventListener("pointerup", handlePointerEnd);
  eventSource.addEventListener("pointercancel", handlePointerEnd);
  // Capture runs before the listeners of panels, menus and dialogs.
  eventSource.addEventListener("keydown", handleKeyDown, CAPTURE);
  if (options.onScroll) {
    // Scroll does not bubble; capture hears every scrolling element.
    eventSource.addEventListener("scroll", handleScroll, CAPTURE);
  }

  return {
    pointerId: options.pointerId,
    dispose,
  };
}

/**
 * After Escape cancels a press or a drag, the button is still down. Waits for
 * that pointer's release and swallows the click it produces, so the cancelled
 * gesture never opens the row. It lives apart from the session, because
 * callers dispose the session as soon as Escape ends the drag.
 */
function swallowReleaseClick(
  eventSource: SharedTableDragEventSource,
  pointerId: number,
) {
  const handleRelease: EventListener = (event) => {
    if ((event as PointerEvent).pointerId !== pointerId) {
      return;
    }

    eventSource.removeEventListener("pointerup", handleRelease, CAPTURE);
    eventSource.removeEventListener("pointercancel", handleRelease, CAPTURE);
    // A cancelled pointer produces no click.
    if (event.type !== "pointerup") {
      return;
    }

    const handleClick: EventListener = (click) => {
      click.preventDefault();
      click.stopImmediatePropagation();
      stop();
    };
    const stop = () => {
      clearTimeout(timeoutId);
      eventSource.removeEventListener("click", handleClick, CAPTURE);
    };
    eventSource.addEventListener("click", handleClick, CAPTURE);
    // The browser sends the click in the same task as its pointerup, so a
    // click after this timeout belongs to a new gesture.
    const timeoutId = setTimeout(stop, 0);
  };

  eventSource.addEventListener("pointerup", handleRelease, CAPTURE);
  eventSource.addEventListener("pointercancel", handleRelease, CAPTURE);
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

/**
 * The vertical translation in a computed `transform`, such as the row shift
 * `translate3d(0, -40px, 0)`, which computes to `matrix(1, 0, 0, 1, 0, -40)`.
 */
function getComputedTranslateY(row: SharedTableDragRow) {
  if (typeof Element === "undefined" || !(row instanceof Element)) {
    return 0;
  }

  const match = /^matrix(3d)?\((.+)\)$/.exec(getComputedStyle(row).transform);
  if (!match) {
    return 0;
  }

  const values = match[2]!.split(",").map(Number);
  return (match[1] ? values[13] : values[5]) ?? 0;
}

/**
 * The index the dragged item would drop at: the number of other rows whose
 * middle is above the pointer. It measures each row where the layout puts it,
 * without the shift that makes room for the dragged item, so bringing the item
 * back over its own slot always gives its original index.
 */
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
    const layoutTop = rect.top - getComputedTranslateY(row);
    if (pointerY >= layoutTop + rect.height / 2) {
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
 * The order after a drop moves the item at `originIndex` to `targetIndex`.
 * Returns null when the item lands where it started, or `originIndex` is not
 * in `items`, so the caller commits nothing.
 */
export function getSharedTableDropOrder<T>(
  items: readonly T[],
  originIndex: number,
  targetIndex: number,
) {
  if (
    originIndex === targetIndex ||
    originIndex < 0 ||
    originIndex >= items.length
  ) {
    return null;
  }

  const order = [...items];
  const [item] = order.splice(originIndex, 1) as [T];
  order.splice(targetIndex, 0, item);
  return order;
}

/**
 * Where a dragged block of items would drop: the number of rows that stay, the
 * ones not in `movedIds`, whose middle is above the pointer. Like
 * `getSharedTableDragTargetIndex`, it measures rows where the layout puts them,
 * without their drag shift. `itemIds` lists the target's rows; the block may
 * come from elsewhere, such as another day.
 */
export function getSharedTableBlockDropIndex(
  itemIds: readonly string[],
  movedIds: ReadonlySet<string>,
  pointerY: number,
  rowRefs: Map<string, SharedTableDragRow>,
) {
  return getSharedTableDragTargetIndex(
    itemIds.filter((itemId) => !movedIds.has(itemId)),
    "",
    pointerY,
    rowRefs,
  );
}

/**
 * The order of a target's rows after a block drop: the rows that stay, with
 * `movedIds` inserted together, in their order, at `targetIndex` among them.
 * Moved ids from elsewhere join the target. Returns null when nothing changes,
 * so the caller commits nothing.
 */
export function getSharedTableBlockDropOrder(
  itemIds: readonly string[],
  movedIds: readonly string[],
  targetIndex: number,
) {
  const moved = new Set(movedIds);
  const staying = itemIds.filter((itemId) => !moved.has(itemId));
  const index = Math.max(0, Math.min(targetIndex, staying.length));
  const order = [
    ...staying.slice(0, index),
    ...movedIds,
    ...staying.slice(index),
  ];
  const unchanged =
    order.length === itemIds.length &&
    order.every((itemId, position) => itemId === itemIds[position]);
  return unchanged ? null : order;
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

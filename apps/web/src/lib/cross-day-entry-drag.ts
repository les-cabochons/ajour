import {
  createSharedTableDragPointerSession,
  type SharedTableDragPointer,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";

interface CrossDayDragTarget {
  getBoundingClientRect: () => Pick<DOMRect, "bottom" | "left" | "right" | "top">;
}

interface CrossDayDragEventSource {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
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

export function createCrossDayEntryDragPointerSession(options: {
  eventSource?: CrossDayDragEventSource;
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
  const eventSource = options.eventSource ?? window;
  let latestTargetDate: string | null = null;
  let disposed = false;

  const sharedSession = createSharedTableDragPointerSession({
    eventSource,
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
      dispose();
      options.onEnd(latestTargetDate, commit);
    },
    onPressEnd: (cancelled) => {
      dispose();
      options.onPressEnd(cancelled);
    },
  });

  const handleKeyDown: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== "Escape") {
      return;
    }

    const wasDragging = options.isDragging();
    dispose();
    if (wasDragging) {
      keyboardEvent.preventDefault();
      options.onEnd(null, false);
    } else {
      options.onPressEnd(true);
    }
  };

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    sharedSession.dispose();
    eventSource.removeEventListener("keydown", handleKeyDown);
  }

  eventSource.addEventListener("keydown", handleKeyDown);

  return {
    pointerId: options.pointerId,
    dispose,
  };
}

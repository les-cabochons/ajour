import { describe, expect, it, vi } from "vitest";
import {
  createSharedTableDragPointerSession,
  getSharedTableBlockDropIndex,
  getSharedTableBlockDropOrder,
  getSharedTableDragOverlayTransform,
  getSharedTableDragRowShift,
  getSharedTableDragTargetIndex,
  getSharedTableDropOrder,
  getSharedTableStepOrder,
  setSharedTableDragDocumentState,
} from "@/lib/table-drag";

describe("drag session scroll", () => {
  function session(isDragging: () => boolean) {
    const eventSource = new EventTarget();
    const onScroll = vi.fn();
    const pointerSession = createSharedTableDragPointerSession({
      eventSource,
      pointerId: 1,
      pointerType: "mouse",
      originX: 0,
      originY: 0,
      isDragging,
      onStart: vi.fn(),
      onMove: vi.fn(),
      onEnd: vi.fn(),
      onPressEnd: vi.fn(),
      onScroll,
    });
    return { eventSource, onScroll, pointerSession };
  }

  it("reports scrolls during a drag, and none after the session ends", () => {
    const { eventSource, onScroll, pointerSession } = session(() => true);

    eventSource.dispatchEvent(new Event("scroll"));
    expect(onScroll).toHaveBeenCalledTimes(1);

    pointerSession.dispose();
    eventSource.dispatchEvent(new Event("scroll"));
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it("ignores scrolls while the press has not become a drag", () => {
    const { eventSource, onScroll } = session(() => false);

    eventSource.dispatchEvent(new Event("scroll"));
    expect(onScroll).not.toHaveBeenCalled();
  });
});

describe("block drops", () => {
  // Rows 40px tall from the top: a 0–40, b 40–80, c 80–120, d 120–160.
  const rows = new Map(
    ["a", "b", "c", "d"].map((id, index) => [
      id,
      { getBoundingClientRect: () => ({ top: index * 40, height: 40 }) },
    ]),
  );

  it("counts the staying rows above the pointer", () => {
    const moved = new Set(["a", "c"]);
    // Below b's middle (60) and above d's (140): after b, before d.
    expect(
      getSharedTableBlockDropIndex(["a", "b", "c", "d"], moved, 100, rows),
    ).toBe(1);
    expect(
      getSharedTableBlockDropIndex(["a", "b", "c", "d"], moved, 10, rows),
    ).toBe(0);
    expect(
      getSharedTableBlockDropIndex(["a", "b", "c", "d"], moved, 150, rows),
    ).toBe(2);
  });

  it("puts the block together, in its order, at the index among the staying rows", () => {
    expect(
      getSharedTableBlockDropOrder(["a", "b", "c", "d"], ["a", "c"], 2),
    ).toEqual(["b", "d", "a", "c"]);
    expect(
      getSharedTableBlockDropOrder(["a", "b", "c", "d"], ["c", "a"], 0),
    ).toEqual(["c", "a", "b", "d"]);
  });

  it("adds a block from elsewhere and clamps the index", () => {
    expect(getSharedTableBlockDropOrder(["x", "y"], ["a"], 1)).toEqual([
      "x",
      "a",
      "y",
    ]);
    expect(getSharedTableBlockDropOrder(["x"], ["a"], 9)).toEqual(["x", "a"]);
  });

  it("returns null when the drop changes nothing", () => {
    expect(getSharedTableBlockDropOrder(["a", "b", "c"], ["b"], 1)).toBeNull();
    expect(
      getSharedTableBlockDropOrder(["a", "b", "c"], ["b", "c"], 1),
    ).toBeNull();
  });
});

describe("getSharedTableStepOrder", () => {
  const ids = ["a", "b", "c"];

  it("moves an item one place up or down and gives its new index", () => {
    expect(getSharedTableStepOrder(ids, "b", -1)).toEqual({
      order: ["b", "a", "c"],
      toIndex: 0,
    });
    expect(getSharedTableStepOrder(ids, "b", 1)).toEqual({
      order: ["a", "c", "b"],
      toIndex: 2,
    });
  });

  it("stops at the edges and ignores unknown items", () => {
    expect(getSharedTableStepOrder(ids, "a", -1)).toBeNull();
    expect(getSharedTableStepOrder(ids, "c", 1)).toBeNull();
    expect(getSharedTableStepOrder(ids, "z", 1)).toBeNull();
  });
});

describe("getSharedTableDropOrder", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves the dragged item to the drop index", () => {
    expect(getSharedTableDropOrder(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(getSharedTableDropOrder(ids, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("changes nothing when the item is dropped where it started", () => {
    expect(getSharedTableDropOrder(ids, 2, 2)).toBeNull();
  });

  it("changes nothing for an origin outside the list", () => {
    expect(getSharedTableDropOrder(ids, 4, 0)).toBeNull();
    expect(getSharedTableDropOrder(ids, -1, 0)).toBeNull();
  });
});

function dispatchEscape(target: EventTarget) {
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperty(event, "key", { value: "Escape" });
  const stopPropagation = vi.spyOn(event, "stopPropagation");
  target.dispatchEvent(event);
  return { event, stopPropagation };
}

function dispatchPointer(
  target: EventTarget,
  type: "pointermove" | "pointerup" | "pointercancel",
  values: {
    pointerId: number;
    clientX: number;
    clientY: number;
    shiftKey?: boolean;
  },
) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    clientX: { value: values.clientX },
    clientY: { value: values.clientY },
    shiftKey: { value: values.shiftKey ?? false },
  });
  target.dispatchEvent(event);
}

describe("shared table drag geometry", () => {
  it("calculates target indexes from row midpoints", () => {
    const rows = new Map([
      ["a", { getBoundingClientRect: () => ({ top: 0, height: 20 }) }],
      ["b", { getBoundingClientRect: () => ({ top: 20, height: 20 }) }],
      ["c", { getBoundingClientRect: () => ({ top: 40, height: 20 }) }],
    ]);

    expect(getSharedTableDragTargetIndex(["a", "b", "c"], "a", 45, rows)).toBe(
      1,
    );
    expect(getSharedTableDragTargetIndex(["a", "b", "c"], "c", 45, rows)).toBe(
      2,
    );
  });

  it("gives the original index back when the item returns over its own slot", () => {
    // "b" has shifted up 20px to make room for "a" dragged below it. Its
    // rectangle now sits in a's slot, but it still counts from its layout place.
    class ShiftedRow {
      constructor(
        readonly top: number,
        readonly transform: string,
      ) {}
      getBoundingClientRect() {
        return { top: this.top, height: 20 };
      }
    }
    vi.stubGlobal("Element", ShiftedRow);
    vi.stubGlobal("getComputedStyle", (row: ShiftedRow) => ({
      transform: row.transform,
    }));
    try {
      const rows = new Map([
        ["a", new ShiftedRow(0, "none")],
        ["b", new ShiftedRow(0, "matrix(1, 0, 0, 1, 0, -20)")],
        ["c", new ShiftedRow(40, "none")],
      ]);

      // The lower half of a's own slot.
      expect(
        getSharedTableDragTargetIndex(["a", "b", "c"], "a", 15, rows),
      ).toBe(0);
      expect(
        getSharedTableDragTargetIndex(["a", "b", "c"], "a", 31, rows),
      ).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("calculates sibling shifts and clamps the drag overlay", () => {
    expect(
      getSharedTableDragRowShift({
        itemIndex: 2,
        originIndex: 0,
        targetIndex: 2,
        rowHeight: 32,
      }),
    ).toBe(-32);
    expect(
      getSharedTableDragRowShift({
        itemIndex: 0,
        originIndex: 2,
        targetIndex: 0,
        rowHeight: 32,
      }),
    ).toBe(32);
    expect(
      getSharedTableDragOverlayTransform({
        originLeft: 10.4,
        minTop: 20,
        pointerY: 15,
        offsetY: 5,
      }),
    ).toBe("translate3d(10px, 20px, 0)");
  });
});

describe("shared table drag pointer session", () => {
  it("tells whether Shift was held at the release", () => {
    const eventSource = new EventTarget();
    let dragging = false;
    const onEnd = vi.fn();

    createSharedTableDragPointerSession({
      eventSource,
      pointerId: 7,
      pointerType: "mouse",
      originX: 10,
      originY: 10,
      isDragging: () => dragging,
      onStart: () => {
        dragging = true;
      },
      onMove: vi.fn(),
      onEnd,
      onPressEnd: vi.fn(),
    });
    dispatchPointer(eventSource, "pointermove", {
      pointerId: 7,
      clientX: 10,
      clientY: 30,
    });
    dispatchPointer(eventSource, "pointerup", {
      pointerId: 7,
      clientX: 10,
      clientY: 30,
      shiftKey: true,
    });

    expect(onEnd).toHaveBeenCalledExactlyOnceWith(true, { shiftKey: true });
  });

  it("starts after tolerance, forwards movement, and commits on pointer up", () => {
    const eventSource = new EventTarget();
    let dragging = false;
    const onStart = vi.fn(() => {
      dragging = true;
    });
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const onPressEnd = vi.fn();

    createSharedTableDragPointerSession({
      eventSource,
      pointerId: 7,
      pointerType: "mouse",
      originX: 10,
      originY: 10,
      isDragging: () => dragging,
      onStart,
      onMove,
      onEnd,
      onPressEnd,
    });

    dispatchPointer(eventSource, "pointermove", {
      pointerId: 7,
      clientX: 12,
      clientY: 12,
    });
    dispatchPointer(eventSource, "pointermove", {
      pointerId: 7,
      clientX: 20,
      clientY: 10,
    });
    dispatchPointer(eventSource, "pointermove", {
      pointerId: 7,
      clientX: 20,
      clientY: 30,
    });
    dispatchPointer(eventSource, "pointerup", {
      pointerId: 7,
      clientX: 20,
      clientY: 30,
    });

    expect(onStart).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledWith(true, { shiftKey: false });
    expect(onPressEnd).not.toHaveBeenCalled();

    dispatchPointer(eventSource, "pointermove", {
      pointerId: 7,
      clientX: 30,
      clientY: 40,
    });
    expect(onMove).toHaveBeenCalledOnce();
  });

  it("does not start a drag for a click and cancels without committing", () => {
    const clickSource = new EventTarget();
    const onPressEnd = vi.fn();
    const onEnd = vi.fn();

    createSharedTableDragPointerSession({
      eventSource: clickSource,
      pointerId: 1,
      pointerType: "mouse",
      originX: 0,
      originY: 0,
      isDragging: () => false,
      onStart: vi.fn(),
      onMove: vi.fn(),
      onEnd,
      onPressEnd,
    });
    dispatchPointer(clickSource, "pointerup", {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    });

    expect(onPressEnd).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();

    const cancelSource = new EventTarget();
    let dragging = false;
    const cancelEnd = vi.fn();
    createSharedTableDragPointerSession({
      eventSource: cancelSource,
      pointerId: 2,
      pointerType: "touch",
      originX: 0,
      originY: 0,
      isDragging: () => dragging,
      onStart: () => {
        dragging = true;
      },
      onMove: vi.fn(),
      onEnd: cancelEnd,
      onPressEnd: vi.fn(),
    });
    dispatchPointer(cancelSource, "pointermove", {
      pointerId: 2,
      clientX: 20,
      clientY: 0,
    });
    dispatchPointer(cancelSource, "pointercancel", {
      pointerId: 2,
      clientX: 20,
      clientY: 0,
    });

    expect(cancelEnd).toHaveBeenCalledWith(false);
  });

  it("cancels an active drag on Escape and keeps the key from reaching other handlers", () => {
    const eventSource = new EventTarget();
    let dragging = false;
    const onEnd = vi.fn();
    const onPressEnd = vi.fn();
    const onMove = vi.fn();

    createSharedTableDragPointerSession({
      eventSource,
      pointerId: 3,
      pointerType: "mouse",
      originX: 0,
      originY: 0,
      isDragging: () => dragging,
      onStart: () => {
        dragging = true;
      },
      onMove,
      onEnd,
      onPressEnd,
    });
    dispatchPointer(eventSource, "pointermove", {
      pointerId: 3,
      clientX: 0,
      clientY: 20,
    });

    const { event, stopPropagation } = dispatchEscape(eventSource);

    expect(onEnd).toHaveBeenCalledExactlyOnceWith(false);
    expect(event.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalled();
    expect(onPressEnd).not.toHaveBeenCalled();

    // The session is over: releasing the pointer later commits nothing.
    dispatchPointer(eventSource, "pointermove", {
      pointerId: 3,
      clientX: 0,
      clientY: 40,
    });
    dispatchPointer(eventSource, "pointerup", {
      pointerId: 3,
      clientX: 0,
      clientY: 40,
    });
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "a press below the threshold", moveY: 2 },
    { name: "an active drag", moveY: 20 },
  ])("swallows the release click after Escape cancels $name", ({ moveY }) => {
    vi.useFakeTimers();
    try {
      const eventSource = new EventTarget();
      const captureTarget = {
        hasPointerCapture: vi.fn(() => true),
        releasePointerCapture: vi.fn(),
      };
      let dragging = false;
      const onEnd = vi.fn();
      const onPressEnd = vi.fn();
      createSharedTableDragPointerSession({
        eventSource,
        captureTarget,
        pointerId: 5,
        pointerType: "mouse",
        originX: 0,
        originY: 0,
        isDragging: () => dragging,
        onStart: () => {
          dragging = true;
        },
        onMove: vi.fn(),
        onEnd,
        onPressEnd,
      });
      dispatchPointer(eventSource, "pointermove", {
        pointerId: 5,
        clientX: 0,
        clientY: moveY,
      });
      dispatchEscape(eventSource);
      expect(captureTarget.releasePointerCapture).toHaveBeenCalledWith(5);

      dispatchPointer(eventSource, "pointerup", {
        pointerId: 5,
        clientX: 0,
        clientY: moveY,
      });
      // Stands in for the row's own click handler, which opens the item. In
      // the browser the row sits below window, so the window capture
      // listener runs first; one EventTarget runs listeners in the order
      // they were added, so this one is added after the release.
      const openRow = vi.fn();
      eventSource.addEventListener("click", openRow);
      const click = new Event("click", { cancelable: true });
      eventSource.dispatchEvent(click);

      expect(openRow).not.toHaveBeenCalled();
      expect(click.defaultPrevented).toBe(true);
      expect(onEnd.mock.calls.length + onPressEnd.mock.calls.length).toBe(1);

      // Only that one click: the next gesture's click goes through.
      eventSource.dispatchEvent(new Event("click"));
      expect(openRow).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a later gesture's click through when the cancelled release produced none", () => {
    vi.useFakeTimers();
    try {
      const eventSource = new EventTarget();
      createSharedTableDragPointerSession({
        eventSource,
        pointerId: 6,
        pointerType: "mouse",
        originX: 0,
        originY: 0,
        isDragging: () => false,
        onStart: vi.fn(),
        onMove: vi.fn(),
        onEnd: vi.fn(),
        onPressEnd: vi.fn(),
      });
      dispatchEscape(eventSource);
      // Released away from the row: the browser sends no click.
      dispatchPointer(eventSource, "pointerup", {
        pointerId: 6,
        clientX: 0,
        clientY: 0,
      });
      vi.runAllTimers();

      const openRow = vi.fn();
      eventSource.addEventListener("click", openRow);
      eventSource.dispatchEvent(new Event("click"));
      expect(openRow).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a press that has not become a drag on Escape and lets the key through", () => {
    const eventSource = new EventTarget();
    const onEnd = vi.fn();
    const onPressEnd = vi.fn();

    createSharedTableDragPointerSession({
      eventSource,
      pointerId: 4,
      pointerType: "mouse",
      originX: 0,
      originY: 0,
      isDragging: () => false,
      onStart: vi.fn(),
      onMove: vi.fn(),
      onEnd,
      onPressEnd,
    });

    const { event, stopPropagation } = dispatchEscape(eventSource);

    expect(onPressEnd).toHaveBeenCalledExactlyOnceWith(true);
    expect(onEnd).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});

describe("shared table drag document state", () => {
  it("restores prior styles only after every active drag ends", () => {
    const classes = new Set<string>();
    const style = {
      cursor: "crosshair",
      userSelect: "text",
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: {
          style,
          classList: {
            add: (name: string) => classes.add(name),
            remove: (name: string) => classes.delete(name),
            contains: (name: string) => classes.has(name),
          },
        },
      },
    });

    setSharedTableDragDocumentState(true, "drag-a");
    setSharedTableDragDocumentState(true, "drag-b");
    setSharedTableDragDocumentState(false, "drag-a");

    expect(style).toEqual({ cursor: "grabbing", userSelect: "none" });
    expect(classes).toEqual(new Set(["drag-b"]));

    setSharedTableDragDocumentState(false, "drag-b");

    expect(style).toEqual({ cursor: "crosshair", userSelect: "text" });
    expect(classes.size).toBe(0);
  });

  it("balances overlapping drags with the same key and preserves old classes", () => {
    const classes = new Set(["drag"]);
    const style = { cursor: "crosshair", userSelect: "text" };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: {
          style,
          classList: {
            add: (name: string) => classes.add(name),
            remove: (name: string) => classes.delete(name),
            contains: (name: string) => classes.has(name),
          },
        },
      },
    });

    setSharedTableDragDocumentState(true, "drag");
    setSharedTableDragDocumentState(true, "drag");
    setSharedTableDragDocumentState(false, "drag");
    expect(style.userSelect).toBe("none");

    setSharedTableDragDocumentState(false, "drag");
    expect(style).toEqual({ cursor: "crosshair", userSelect: "text" });
    expect(classes.has("drag")).toBe(true);
  });
});

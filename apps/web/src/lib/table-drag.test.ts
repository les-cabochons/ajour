import { describe, expect, it, vi } from "vitest";
import {
  createSharedTableDragPointerSession,
  getSharedTableDragOverlayTransform,
  getSharedTableDragRowShift,
  getSharedTableDragTargetIndex,
  getSharedTableStepOrder,
  setSharedTableDragDocumentState,
} from "@/lib/table-drag";

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

function dispatchPointer(
  target: EventTarget,
  type: "pointermove" | "pointerup" | "pointercancel",
  values: {
    pointerId: number;
    clientX: number;
    clientY: number;
  },
) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: values.pointerId },
    clientX: { value: values.clientX },
    clientY: { value: values.clientY },
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
    expect(onEnd).toHaveBeenCalledWith(true);
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

import { describe, expect, it, vi } from "vitest";
import {
  createCrossDayEntryDragPointerSession,
  getCrossDayDragTarget,
} from "@/lib/cross-day-entry-drag";

describe("cross-day entry drag geometry", () => {
  const targets = new Map([
    [
      "2026-08-10",
      {
        getBoundingClientRect: () => ({ left: 0, right: 99, top: 0, bottom: 200 }),
      },
    ],
    [
      "2026-08-11",
      {
        getBoundingClientRect: () => ({ left: 100, right: 199, top: 0, bottom: 200 }),
      },
    ],
  ]);

  it("returns the weekday beneath the pointer", () => {
    expect(getCrossDayDragTarget({ clientX: 150, clientY: 100 }, targets)).toBe(
      "2026-08-11",
    );
  });

  it("returns no target outside the weekly surface", () => {
    expect(getCrossDayDragTarget({ clientX: 250, clientY: 100 }, targets)).toBeNull();
  });

  it("waits for the shared press threshold and cancels an active drag with Escape", () => {
    const listeners = new Map<string, EventListener>();
    const eventSource = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    };
    let dragging = false;
    const onStart = vi.fn(() => {
      dragging = true;
    });
    const onEnd = vi.fn();

    createCrossDayEntryDragPointerSession({
      eventSource,
      pointerId: 1,
      pointerType: "mouse",
      originX: 10,
      originY: 10,
      targets,
      isDragging: () => dragging,
      onStart,
      onMove: vi.fn(),
      onEnd,
      onPressEnd: vi.fn(),
    });

    listeners.get("pointermove")?.({
      pointerId: 1,
      clientX: 12,
      clientY: 10,
      type: "pointermove",
      preventDefault: vi.fn(),
    } as unknown as Event);
    expect(onStart).not.toHaveBeenCalled();

    listeners.get("pointermove")?.({
      pointerId: 1,
      clientX: 20,
      clientY: 10,
      type: "pointermove",
      preventDefault: vi.fn(),
    } as unknown as Event);
    expect(onStart).toHaveBeenCalledOnce();

    listeners.get("keydown")?.({
      key: "Escape",
      preventDefault: vi.fn(),
    } as unknown as Event);
    expect(onEnd).toHaveBeenCalledWith(null, false);
  });
});

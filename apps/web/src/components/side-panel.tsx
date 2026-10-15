import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  clampSidePanelWidth,
  setSidePanelWidth,
  useSidePanelWidth,
} from "@/lib/side-panel-width";
import { cn } from "@/lib/utils";

const KEYBOARD_STEP = 16;

/**
 * A panel docked on the right of a page. The page next to it stays visible and
 * clickable, so the panel never traps focus and ignores outside clicks. Its owner
 * decides what clicks on the page do, such as loading another object into it.
 *
 * `contentKey` names what the panel shows. When it changes, and when the panel
 * opens, the panel remembers the element focused outside it, usually the row or card
 * that was clicked. Closing the panel gives focus back to that element.
 *
 * Dragging the left edge resizes the panel. The width is saved per device in
 * `lib/side-panel-width.ts`, shared by every side panel, and published as the
 * `--side-panel-width` root variable so page layouts can make room for it.
 */
export function SidePanel({
  contentKey,
  className,
  children,
  ...props
}: ComponentProps<"aside"> & { contentKey: string }) {
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const width = useSidePanelWidth();

  // Layout effects run before the content's own effects can move focus inside.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !panelRef.current?.contains(active)
    ) {
      returnFocusRef.current = active;
    }
  }, [contentKey]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--side-panel-width",
      `${width}px`,
    );
  }, [width]);

  useEffect(
    () => () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) {
        target.focus();
      }
    },
    [],
  );

  return (
    <aside
      ref={panelRef}
      data-slot="side-panel"
      className={cn("side-panel", className)}
      {...props}
    >
      <SidePanelResizeHandle width={width} />
      <div className="side-panel-scroll">{children}</div>
    </aside>
  );
}

/**
 * The panel's left edge. Dragging left widens the panel. Arrow keys move it by
 * 16px and a double-click resets the default width.
 */
function SidePanelResizeHandle({ width }: { width: number }) {
  const rightRef = useRef(0);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    rightRef.current =
      event.currentTarget.parentElement?.getBoundingClientRect().right ?? 0;
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setSidePanelWidth(rightRef.current - event.clientX);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowLeft"
        ? KEYBOARD_STEP
        : event.key === "ArrowRight"
          ? -KEYBOARD_STEP
          : 0;
    if (step) {
      event.preventDefault();
      setSidePanelWidth(clampSidePanelWidth(width + step));
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      tabIndex={0}
      className="side-panel-resize-handle"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onDoubleClick={() => setSidePanelWidth(undefined)}
      onKeyDown={handleKeyDown}
    />
  );
}

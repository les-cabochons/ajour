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
  saveSidePanelWidths,
  setSidePanelWidth,
  useSidePanelWidth,
  type SidePanelWidthKey,
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
 * Dragging the left edge resizes the panel. Each page passes its own
 * `widthKey`, and the width is saved per device in `lib/side-panel-width.ts`.
 * The panel publishes it as `--side-panel-width` on its parent element, so the
 * page layout beside it can make room. The content scrolls in an inner
 * element; `contentClassName` styles it.
 */
export function SidePanel({
  contentKey,
  widthKey,
  className,
  contentClassName,
  children,
  ...props
}: ComponentProps<"aside"> & {
  contentKey: string;
  widthKey: SidePanelWidthKey;
  contentClassName?: string;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const width = useSidePanelWidth(widthKey);

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
    const parent = panelRef.current?.parentElement;
    parent?.style.setProperty("--side-panel-width", `${width}px`);
    return () => {
      parent?.style.removeProperty("--side-panel-width");
    };
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
      <SidePanelResizeHandle widthKey={widthKey} width={width} />
      <div className={cn("side-panel-scroll", contentClassName)}>
        {children}
      </div>
    </aside>
  );
}

/**
 * The panel's left edge. Dragging left widens the panel, up to half the page it
 * sits in. Arrow keys move it by 16px and a double-click resets the default
 * width. A drag saves the width once, when it ends.
 */
function SidePanelResizeHandle({
  widthKey,
  width,
}: {
  widthKey: SidePanelWidthKey;
  width: number;
}) {
  const rightRef = useRef(0);
  const availableRef = useRef(Infinity);

  /** The width of the page beside and under the panel. */
  function measureAvailable(handle: HTMLElement) {
    return (
      handle.parentElement?.parentElement?.getBoundingClientRect().width ??
      Infinity
    );
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    rightRef.current =
      event.currentTarget.parentElement?.getBoundingClientRect().right ?? 0;
    availableRef.current = measureAvailable(event.currentTarget);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setSidePanelWidth(
      widthKey,
      clampSidePanelWidth(
        rightRef.current - event.clientX,
        availableRef.current,
      ),
      { save: false },
    );
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
      setSidePanelWidth(
        widthKey,
        clampSidePanelWidth(
          width + step,
          measureAvailable(event.currentTarget),
        ),
      );
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
      onLostPointerCapture={saveSidePanelWidths}
      onDoubleClick={() => setSidePanelWidth(widthKey, undefined)}
      onKeyDown={handleKeyDown}
    />
  );
}

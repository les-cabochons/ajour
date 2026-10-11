import { useEffect, useLayoutEffect, useRef, type ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A panel docked on the right of a page. The page next to it stays visible and
 * clickable, so the panel never traps focus and ignores outside clicks. Its owner
 * decides what clicks on the page do, such as loading another object into it.
 *
 * `contentKey` names what the panel shows. When it changes, and when the panel
 * opens, the panel remembers the element focused outside it, usually the row or card
 * that was clicked. Closing the panel gives focus back to that element.
 */
export function SidePanel({
  contentKey,
  className,
  children,
  ...props
}: ComponentProps<"aside"> & { contentKey: string }) {
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

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
      {children}
    </aside>
  );
}

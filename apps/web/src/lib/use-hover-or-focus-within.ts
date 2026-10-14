import { useCallback, useState, type FocusEvent } from "react";

/**
 * Whether the pointer is over an element or focus is inside it, for controls
 * that only mount while they can be seen. Spread `props` on the element; the
 * CSS that shows the controls on `group-hover` and `group-focus-within` stays.
 */
export function useHoverOrFocusWithin() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const onPointerEnter = useCallback(() => setHovered(true), []);
  const onPointerLeave = useCallback(() => setHovered(false), []);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setFocused(false);
    }
  }, []);

  return {
    active: hovered || focused,
    props: { onPointerEnter, onPointerLeave, onFocus, onBlur },
  };
}

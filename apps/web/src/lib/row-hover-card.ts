import { useEffect, useMemo, useState, type RefObject } from "react";

/**
 * When a list's shared hover card opens, moves and closes, in milliseconds:
 * it opens once the pointer rests on a row, follows the pointer to another row
 * sooner once it shows, and waits for the pointer to cross over to it.
 */
export const ROW_HOVER_CARD_DELAYS = { open: 800, move: 150, close: 200 };

export interface RowHoverIntent<T> {
  /** The pointer is over the row `id`, or a part of it. */
  enterRow(id: string, target: T): void;
  /** The pointer left the rows, for the gaps between them or the card. */
  leaveRows(): void;
  enterCard(): void;
  leaveCard(): void;
  /** Closes the card. It opens again only after the pointer leaves the row. */
  dismiss(): void;
  /**
   * The shown row left the list or was replaced. Closes the card and forgets
   * the pointer, so resting on the row that replaced it opens the card again.
   */
  rowGone(): void;
  dispose(): void;
}

/**
 * The hover card's timing, apart from the DOM. `onChange` receives the row
 * whose card shows, or null when it closes.
 */
export function createRowHoverIntent<T>(
  onChange: (target: T | null) => void,
  delays = ROW_HOVER_CARD_DELAYS,
): RowHoverIntent<T> {
  let hoveredId: string | undefined;
  let shownId: string | undefined;
  let overCard = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule(callback: () => void, ms: number) {
    clearTimeout(timer);
    timer = setTimeout(callback, ms);
  }
  function hide() {
    if (shownId === undefined) return;
    shownId = undefined;
    onChange(null);
  }

  // React reports entering the card before the list sees the pointer leave,
  // so leaving the rows and the card checks where the pointer is, whatever
  // the order the two arrive in.
  return {
    enterRow(id, target) {
      if (id === hoveredId) return;
      hoveredId = id;
      if (id === shownId) {
        clearTimeout(timer);
        return;
      }
      schedule(
        () => {
          shownId = id;
          onChange(target);
        },
        shownId === undefined ? delays.open : delays.move,
      );
    },
    leaveRows() {
      hoveredId = undefined;
      if (shownId === undefined) clearTimeout(timer);
      else if (!overCard) schedule(hide, delays.close);
    },
    enterCard() {
      overCard = true;
      clearTimeout(timer);
    },
    leaveCard() {
      overCard = false;
      if (hoveredId === undefined) schedule(hide, delays.close);
    },
    dismiss() {
      clearTimeout(timer);
      overCard = false;
      hide();
    },
    rowGone() {
      clearTimeout(timer);
      hoveredId = undefined;
      // The card unmounts under the pointer without a pointer leave.
      overCard = false;
      hide();
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}

export interface RowHoverTarget {
  id: string;
  element: HTMLElement;
}

/**
 * One hover card for every row of a list, from listeners on the list itself:
 * the rows mount nothing for it. A row is an element in `container` that
 * matches `rowSelector`, and `readId` names it. Only a mouse opens the card,
 * and pressing, scrolling or leaving the window closes it.
 */
export function useRowHoverCard(
  container: RefObject<HTMLElement | null>,
  rowSelector: string,
  readId: (row: HTMLElement) => string | undefined,
) {
  const [shown, setShown] = useState<RowHoverTarget | null>(null);
  const intent = useMemo(
    () => createRowHoverIntent<RowHoverTarget>(setShown),
    [],
  );

  useEffect(() => {
    const list = container.current;
    if (!list) return;

    function onPointerOver(event: PointerEvent) {
      // A pressed button is a drag or a selection, not a look.
      if (event.pointerType !== "mouse" || event.buttons !== 0) return;
      const row =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(rowSelector)
          : null;
      const id = row && list!.contains(row) ? readId(row) : undefined;
      if (row && id) intent.enterRow(id, { id, element: row });
      else intent.leaveRows();
    }
    const leave = () => intent.leaveRows();
    const dismiss = () => intent.dismiss();

    list.addEventListener("pointerover", onPointerOver);
    list.addEventListener("pointerleave", leave);
    list.addEventListener("pointerdown", dismiss, true);
    list.addEventListener("contextmenu", dismiss, true);
    list.addEventListener("scroll", dismiss, { passive: true });
    window.addEventListener("blur", dismiss);
    return () => {
      list.removeEventListener("pointerover", onPointerOver);
      list.removeEventListener("pointerleave", leave);
      list.removeEventListener("pointerdown", dismiss, true);
      list.removeEventListener("contextmenu", dismiss, true);
      list.removeEventListener("scroll", dismiss);
      window.removeEventListener("blur", dismiss);
      intent.dispose();
    };
  }, [container, intent, readId, rowSelector]);

  return {
    shown,
    dismiss: intent.dismiss,
    rowGone: intent.rowGone,
    /** Spread on the card, so the pointer can cross over to it. */
    cardProps: {
      onPointerEnter: intent.enterCard,
      onPointerLeave: intent.leaveCard,
    },
  };
}

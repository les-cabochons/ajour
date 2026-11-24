import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import { connectorPath, stackCards } from "@/domain/deck/review-threads";
import type { ReviewNote } from "@/domain/deck/review-notes";
import { renderNoteCard } from "./review-notes";

/*
 * The gutter beside the diff, from 1,100px up: each review thread, draft
 * comment and the composer floats level with its line, joined to it by a connector, and cards that would
 * overlap stack, their connectors stepping down at an elbow. One read pass
 * measures every line and card, then one write pass moves them: the cost
 * follows the number of threads, not hunks. The cards are placed again
 * whenever the diff's column changes size, a card does, or a hunk draws the
 * mark after a thread's line. A thread on a hunk folded as viewed hides
 * with its line.
 */

/** Space between stacked cards. */
const GAP = 8;
/** How far above its line's middle a card's top sits, so the connector meets its header. */
const LIFT = 14;
/** How far out from the hunk's edge the connector turns. */
const ELBOW = 10;

/** A string as a CSS attribute value, in double quotes. */
const quoted = (value: string) =>
  `"${value.replace(/["\\]/g, (character) => `\\${character}`)}"`;

const nextFrame = (run: () => void) =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(run)
    : window.setTimeout(run, 16);
const cancelFrame = (frame: number) =>
  typeof cancelAnimationFrame === "function"
    ? cancelAnimationFrame(frame)
    : window.clearTimeout(frame);

export function ThreadGutter({
  notes,
  columnRef,
  hovered,
  scheduleRef,
}: {
  notes: readonly ReviewNote[];
  /** The diff's column, whose size changes move the lines. */
  columnRef: RefObject<HTMLElement | null>;
  /** The key of the note hovered. */
  hovered: string | undefined;
  /** Set to this gutter's `schedule`, for each line's mark to call once it's drawn. */
  scheduleRef: { current: (() => void) | undefined };
}) {
  const gutterRef = useRef<HTMLElement>(null);
  const connectorsRef = useRef<SVGSVGElement>(null);
  const byKey = useMemo(
    () => new Map(notes.map((note) => [note.key, note])),
    [notes],
  );

  const place = useCallback(() => {
    const gutter = gutterRef.current;
    // The grid holding the diff's column and the gutter: the space cards are
    // placed in. Its own ref isn't set yet when the gutter first places them.
    const grid = gutter?.parentElement;
    const connectors = connectorsRef.current;
    if (!grid || !gutter || !connectors) return;

    // Read pass: every line and card, before anything moves.
    const gridRect = grid.getBoundingClientRect();
    const toX = gutter.getBoundingClientRect().left - gridRect.left;
    const lineHeight =
      Number.parseFloat(
        getComputedStyle(grid).getPropertyValue("--diff-line-height"),
      ) || 20;
    const cards = [...gutter.querySelectorAll<HTMLElement>("[data-card]")];
    const measured = cards.flatMap((card) => {
      const entry = byKey.get(card.dataset.card ?? "");
      const box = entry
        ? grid.querySelector(`[data-hunk=${quoted(entry.hunkId)}]`)
        : null;
      if (!entry || !box) return [];
      const boxRect = box.getBoundingClientRect();
      const anchor = box.querySelector(
        `[data-thread-anchor=${quoted(entry.key)}]`,
      );
      // Drawn, the anchor sits right after the line; before, the line is
      // its row's height down the hunk's box, inside its 1px border.
      const y =
        anchor && anchor.getClientRects().length > 0
          ? anchor.getBoundingClientRect().top - gridRect.top - lineHeight / 2
          : boxRect.top -
            gridRect.top +
            1 +
            entry.row * lineHeight +
            lineHeight / 2;
      return [
        {
          key: entry.key,
          y,
          height: card.offsetHeight,
          fromX: boxRect.right - gridRect.left,
          card,
        },
      ];
    });

    // Write pass.
    const tops = new Map(
      stackCards(measured, { gap: GAP, lift: LIFT }).map((card) => [
        card.key,
        card.top,
      ]),
    );
    let bottom = 0;
    for (const item of measured) {
      const top = tops.get(item.key)!;
      bottom = Math.max(bottom, top + item.height);
      // An absolute card's top moves only the card.
      item.card.style.setProperty("top", `${top}px`);
      item.card.dataset.placed = "";
      connectors
        .querySelector(`[data-connector=${quoted(item.key)}]`)
        ?.setAttribute(
          "d",
          connectorPath({
            fromX: item.fromX,
            lineY: item.y,
            elbowX: item.fromX + ELBOW,
            cardY: top + LIFT,
            toX,
          }),
        );
    }
    // A card whose hunk is folded as viewed has no line to sit beside.
    const shown = new Set(measured.map((item) => item.card));
    for (const card of cards) {
      if (shown.has(card) || !("placed" in card.dataset)) continue;
      delete card.dataset.placed;
      connectors
        .querySelector(`[data-connector=${quoted(card.dataset.card ?? "")}]`)
        ?.removeAttribute("d");
    }
    gutter.style.setProperty("min-height", `${bottom}px`);
  }, [byKey]);

  const frame = useRef(0);
  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = nextFrame(() => {
      frame.current = 0;
      place();
    });
  }, [place]);
  useLayoutEffect(() => {
    scheduleRef.current = schedule;
    return () => {
      if (scheduleRef.current === schedule) scheduleRef.current = undefined;
    };
  }, [schedule, scheduleRef]);
  useEffect(
    () => () => {
      if (frame.current) cancelFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  // Placed before the first paint, then again as anything they follow resizes.
  useLayoutEffect(place, [place]);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(schedule);
    if (columnRef.current) observer.observe(columnRef.current);
    for (const card of gutterRef.current?.querySelectorAll("[data-card]") ?? [])
      observer.observe(card);
    return () => observer.disconnect();
  }, [columnRef, notes, schedule]);

  return (
    <>
      <aside
        ref={gutterRef}
        className="deck-gutter"
        aria-label="Review threads"
      >
        {notes.map((note) => (
          <div key={note.key} className="deck-gutter-card" data-card={note.key}>
            {renderNoteCard(note, hovered === note.key)}
          </div>
        ))}
      </aside>
      <svg ref={connectorsRef} className="deck-connectors" aria-hidden="true">
        {notes.map((note) => (
          <path
            key={note.key}
            data-connector={note.key}
            data-hot={hovered === note.key || undefined}
          />
        ))}
      </svg>
    </>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import {
  connectorPath,
  stackCards,
  type PlacedThread,
} from "@/domain/deck/review-threads";
import { ReviewThreadCard } from "./review-thread-card";

/*
 * The gutter beside the diff, from 1,100px up: each review thread floats
 * level with its line, joined to it by a connector, and cards that would
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
  placed,
  columnRef,
  hovered,
  onHover,
  scheduleRef,
}: {
  placed: readonly PlacedThread[];
  /** The diff's column, whose size changes move the lines. */
  columnRef: RefObject<HTMLElement | null>;
  hovered: string | undefined;
  onHover: (threadId: string | undefined) => void;
  /** Set to this gutter's `schedule`, for each line's mark to call once it's drawn. */
  scheduleRef: { current: (() => void) | undefined };
}) {
  const gutterRef = useRef<HTMLElement>(null);
  const connectorsRef = useRef<SVGSVGElement>(null);
  const byId = useMemo(
    () => new Map(placed.map((entry) => [entry.thread.id, entry])),
    [placed],
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
    // The hunks in the page, in one query: a huge pull request mounts only
    // those near the screen (#790), and a folded hunk has no box.
    const boxes = new Map<string, Element>();
    for (const box of grid.querySelectorAll("[data-hunk]")) {
      const id = box.getAttribute("data-hunk");
      if (id !== null) boxes.set(id, box);
    }
    const measured = cards.flatMap((card) => {
      const entry = byId.get(card.dataset.card ?? "");
      const box = entry ? boxes.get(entry.hunkId) : undefined;
      if (!entry || !box) return [];
      const boxRect = box.getBoundingClientRect();
      const anchor = box.querySelector(
        `[data-thread-anchor=${quoted(entry.thread.id)}]`,
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
          key: entry.thread.id,
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
      // An absolute card's top moves only the card. What stays put isn't
      // written again, so a placement that moves nothing costs no layout.
      if (item.card.style.top !== `${top}px`) {
        item.card.style.setProperty("top", `${top}px`);
      }
      if (!("placed" in item.card.dataset)) item.card.dataset.placed = "";
      const path = connectorPath({
        fromX: item.fromX,
        lineY: item.y,
        elbowX: item.fromX + ELBOW,
        cardY: top + LIFT,
        toX,
      });
      const connector = connectors.querySelector(
        `[data-connector=${quoted(item.key)}]`,
      );
      if (connector && connector.getAttribute("d") !== path) {
        connector.setAttribute("d", path);
      }
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
    if (gutter.style.minHeight !== `${bottom}px`) {
      gutter.style.setProperty("min-height", `${bottom}px`);
    }
  }, [byId]);

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
  }, [columnRef, placed, schedule]);

  return (
    <>
      <aside
        ref={gutterRef}
        className="deck-gutter"
        aria-label="Review threads"
      >
        {placed.map((entry) => (
          <div
            key={entry.thread.id}
            className="deck-gutter-card"
            data-card={entry.thread.id}
          >
            <ReviewThreadCard
              thread={entry.thread}
              hot={hovered === entry.thread.id}
              onHover={onHover}
            />
          </div>
        ))}
      </aside>
      <svg ref={connectorsRef} className="deck-connectors" aria-hidden="true">
        {placed.map((entry) => (
          <path
            key={entry.thread.id}
            data-connector={entry.thread.id}
            data-hot={hovered === entry.thread.id || undefined}
          />
        ))}
      </svg>
    </>
  );
}

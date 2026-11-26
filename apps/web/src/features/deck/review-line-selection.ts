import { useCallback, useSyncExternalStore } from "react";
import type { LinePoint, LineSelection } from "@/domain/deck/line-selection";

/*
 * The lines selected on Deck's review page (#793), and the line an
 * answer's citation went to, kept by the page rather than by its hunks.
 * One selection at a time, in one hunk: the hunks report what the diff
 * library picks, and each one hears only about its own lines, so a
 * selection moving draws the hunk it left and the one it reached, and no
 * other. A huge pull request's hunk scrolled away finds its lines as it
 * left them.
 */

/** What one hunk shows of the page's lines. */
export interface HunkLines {
  /** The lines selected in it, picked or still dragged. */
  selection?: LineSelection;
  /**
   * The selection is picked, not still dragged: the toolbar shows above it,
   * and E, C and A act on it.
   */
  settled: boolean;
  /** The line a citation went to, highlighted until the next selection. */
  cited?: LinePoint;
}

export class ReviewLineSelection {
  /** The lines picked last, which the toolbar acts on and a second tap extends. */
  #picked: LineSelection | undefined;
  /** The lines being dragged over, shown in place of the picked ones. */
  #dragged: LineSelection | undefined;
  #cited: { hunkId: string; point: LinePoint } | undefined;
  /** What each hunk last read, kept while it is the same. */
  readonly #views = new Map<string, HunkLines>();
  readonly #listeners = new Map<string, Set<() => void>>();

  subscribe(hunkId: string, listener: () => void): () => void {
    const listeners = this.#listeners.get(hunkId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(hunkId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(hunkId);
    };
  }

  /** What `hunkId` shows, or undefined while nothing is on its lines. */
  of(hunkId: string): HunkLines | undefined {
    return this.#views.get(hunkId);
  }

  /** The lines picked last, while no drag replaces them. */
  get picked(): LineSelection | undefined {
    return this.#picked;
  }

  /** The lines being dragged over, or none any more. */
  change(selection: LineSelection | undefined) {
    this.#write(this.#picked, selection, this.#cited);
  }

  /** The lines picked, or none. Picking lines ends a citation's highlight. */
  settle(selection: LineSelection | undefined) {
    this.#write(selection, undefined, undefined);
  }

  /** Nothing is selected any more. */
  clear() {
    if (this.#picked || this.#dragged)
      this.#write(undefined, undefined, this.#cited);
  }

  /** Highlights the line a citation went to, in place of any selection. */
  cite(hunkId: string, point: LinePoint) {
    this.#write(undefined, undefined, { hunkId, point });
  }

  #write(
    picked: LineSelection | undefined,
    dragged: LineSelection | undefined,
    cited: { hunkId: string; point: LinePoint } | undefined,
  ) {
    const touched = new Set(
      [this.#picked, this.#dragged, this.#cited, picked, dragged, cited]
        .map((entry) => entry?.hunkId)
        .filter((id): id is string => id !== undefined),
    );
    this.#picked = picked;
    this.#dragged = dragged;
    this.#cited = cited;
    const shown = dragged ?? picked;
    for (const hunkId of touched) {
      const before = this.#views.get(hunkId);
      const view: HunkLines = {
        settled: !dragged && shown?.hunkId === hunkId,
        ...(shown?.hunkId === hunkId ? { selection: shown } : {}),
        ...(cited?.hunkId === hunkId ? { cited: cited.point } : {}),
      };
      const same =
        before?.selection === view.selection &&
        before?.settled === view.settled &&
        before?.cited === view.cited;
      if (same) continue;
      if (view.selection || view.cited) this.#views.set(hunkId, view);
      else this.#views.delete(hunkId);
      this.#listeners.get(hunkId)?.forEach((listener) => listener());
    }
  }
}

const NOTHING = () => () => {};

/** What `hunkId` shows of the page's lines, drawn again as it changes. */
export function useHunkLines(
  store: ReviewLineSelection | undefined,
  hunkId: string,
): HunkLines | undefined {
  const subscribe = useCallback(
    (listener: () => void) =>
      store ? store.subscribe(hunkId, listener) : NOTHING(),
    [store, hunkId],
  );
  return useSyncExternalStore(subscribe, () => store?.of(hunkId));
}

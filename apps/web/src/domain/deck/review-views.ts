/*
 * Where Deck's review page shows Status, Threads and Chat. Each opens as a
 * peek above its launcher in the dock. Pin moves a view into the side
 * panel, as one of its tabs; pins add up, so all three pinned is a panel
 * with three tabs. Closing a tab unpins it, and the view peeks again.
 * Collapsing the panel keeps its pins: a pinned view's launcher opens the
 * panel again, on its tab. The views that aren't pinned still peek.
 */

export type DeckView = "status" | "threads" | "chat";

/** The views in the order the panel's tabs and the dock's launchers show them. */
export const DECK_VIEWS: readonly DeckView[] = ["status", "threads", "chat"];

/** What the device remembers: the pinned views, whether the panel is open, and its tab. */
export interface DeckPanelState {
  pins: readonly DeckView[];
  /** The panel shows while it has a pin and this is true; collapsing sets it false. */
  open: boolean;
  /** The pinned view the panel shows. */
  tab?: DeckView | undefined;
}

/** The panel, and the one view peeking, if any. */
export interface DeckViewsState extends DeckPanelState {
  peek?: DeckView | undefined;
}

export type DeckViewsCommand =
  /** A launcher: opens its view, or closes it when it already shows. */
  | { type: "toggle"; view: DeckView }
  /** Shows a view and leaves it open, such as Continue in chat. */
  | { type: "show"; view: DeckView }
  | { type: "pin"; view: DeckView }
  | { type: "unpin"; view: DeckView }
  /** Chooses one of the panel's tabs. */
  | { type: "tab"; view: DeckView }
  | { type: "collapse" }
  | { type: "close-peek" };

export const NO_DECK_PANEL: DeckPanelState = { pins: [], open: false };

const ordered = (views: Iterable<DeckView>) => {
  const set = new Set(views);
  return DECK_VIEWS.filter((view) => set.has(view));
};

/** The tab the panel shows, or undefined while it's collapsed or has no pin. */
export function panelTab(state: DeckPanelState): DeckView | undefined {
  if (!state.open || state.pins.length === 0) return undefined;
  return state.tab && state.pins.includes(state.tab)
    ? state.tab
    : state.pins[0];
}

/** Whether `view` shows now, in the panel or as the peek. */
export function viewShows(state: DeckViewsState, view: DeckView) {
  return panelTab(state) === view || state.peek === view;
}

function showPinned(state: DeckViewsState, view: DeckView): DeckViewsState {
  return { ...state, open: true, tab: view, peek: undefined };
}

export function deckViewsTransition(
  state: DeckViewsState,
  command: DeckViewsCommand,
): DeckViewsState {
  switch (command.type) {
    case "toggle":
    case "show": {
      const { view } = command;
      if (state.pins.includes(view)) {
        if (command.type === "toggle" && panelTab(state) === view)
          return { ...state, open: false };
        return showPinned(state, view);
      }
      if (command.type === "toggle" && state.peek === view)
        return { ...state, peek: undefined };
      return { ...state, peek: view };
    }
    case "pin":
      return showPinned(
        { ...state, pins: ordered([...state.pins, command.view]) },
        command.view,
      );
    case "unpin": {
      const pins = state.pins.filter((view) => view !== command.view);
      const tab =
        state.tab === command.view || !state.tab ? pins[0] : state.tab;
      return {
        ...state,
        pins,
        ...(tab ? { tab } : { tab: undefined }),
        open: pins.length > 0 && state.open,
      };
    }
    case "tab":
      return state.pins.includes(command.view)
        ? showPinned(state, command.view)
        : state;
    case "collapse":
      return { ...state, open: false };
    case "close-peek":
      return state.peek ? { ...state, peek: undefined } : state;
  }
}

/** Reads a stored panel state; anything it can't read gives no pins. */
export function parseDeckPanelState(value: unknown): DeckPanelState {
  if (!value || typeof value !== "object") return NO_DECK_PANEL;
  const record = value as Record<string, unknown>;
  const pins = Array.isArray(record.pins)
    ? ordered(
        record.pins.filter((view): view is DeckView =>
          (DECK_VIEWS as readonly unknown[]).includes(view),
        ),
      )
    : [];
  const tab =
    typeof record.tab === "string" && pins.includes(record.tab as DeckView)
      ? (record.tab as DeckView)
      : undefined;
  return {
    pins,
    open: pins.length > 0 && record.open === true,
    ...(tab ? { tab } : {}),
  };
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PinnedTaskSlot } from "@/domain/local-state";
import { isEntryEditorOpen } from "@/lib/entry-editor-presence";
import { withEventAttribution } from "@/lib/wide-events";
import {
  APP_SHORTCUTS,
  blocksDigitShortcuts,
  blocksSingleKeyShortcuts,
  getShortcutPlatform,
  isModifierPress,
  resolveShortcut,
  type ShortcutActionId,
  type ShortcutChord,
} from "@/lib/shortcuts";

/** How long the second key of a sequence such as "G then T" may wait. */
const SEQUENCE_TIMEOUT_MS = 1500;

/**
 * "page" handlers win over "app" handlers for the same action, so the Time page
 * can open its own side panel for N while the app shell handles N elsewhere.
 */
export type ShortcutHandlerLayer = "app" | "page";

/** What the key press carried beyond its action: the number key, for digit shortcuts. */
export interface ShortcutPress {
  digit?: PinnedTaskSlot;
}

type ShortcutHandler = (press: ShortcutPress) => void;

interface RegisteredHandler {
  layer: ShortcutHandlerLayer;
  run: ShortcutHandler;
}

class ShortcutHandlerRegistry {
  private readonly handlers = new Map<ShortcutActionId, RegisteredHandler[]>();

  register(id: ShortcutActionId, handler: RegisteredHandler) {
    const list = this.handlers.get(id) ?? [];
    this.handlers.set(id, [...list, handler]);
    return () => {
      this.handlers.set(
        id,
        (this.handlers.get(id) ?? []).filter((item) => item !== handler),
      );
    };
  }

  /** The newest page handler, else the newest app handler. */
  find(id: ShortcutActionId) {
    const newestFirst = [...(this.handlers.get(id) ?? [])].reverse();
    return (
      newestFirst.find((item) => item.layer === "page") ??
      newestFirst.find((item) => item.layer === "app")
    );
  }
}

const ShortcutContext = createContext<ShortcutHandlerRegistry | null>(null);

/** True between the two keys of a sequence such as "G then B". */
let sequencePending = false;

/**
 * Whether the app listener is waiting for the second key of a sequence. Focused
 * rows leave their keys alone then, so "G then B" goes to Backlog instead of
 * snoozing the focused backlog item.
 */
export function isShortcutSequencePending() {
  return sequencePending;
}

/**
 * Listens for every registered shortcut on the window and runs the handler that
 * `useShortcut` registered for it. Single keys stay quiet while focus is in a
 * text field, menu or dialog. Pinned task digits also stay quiet while an entry
 * editor is open or a Week Grid cell has focus. A shortcut with no mounted
 * handler does nothing and leaves the key event alone.
 */
export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new ShortcutHandlerRegistry());

  useEffect(() => {
    const platform = getShortcutPlatform();
    let prefix: readonly ShortcutChord[] = [];
    let prefixTimeoutId: number | undefined;

    function clearPrefix() {
      prefix = [];
      sequencePending = false;
      window.clearTimeout(prefixTimeoutId);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing) {
        return;
      }

      if (
        !isModifierPress(event, platform) &&
        blocksSingleKeyShortcuts(document.activeElement)
      ) {
        clearPrefix();
        return;
      }

      const resolution = resolveShortcut(
        APP_SHORTCUTS,
        prefix,
        event,
        platform,
      );
      clearPrefix();

      if (resolution.kind === "pending") {
        event.preventDefault();
        prefix = resolution.prefix;
        sequencePending = true;
        prefixTimeoutId = window.setTimeout(clearPrefix, SEQUENCE_TIMEOUT_MS);
        return;
      }

      if (resolution.kind === "action") {
        // Pinned task digits never replace a draft or a Grid cell's hours.
        if (
          resolution.digit !== undefined &&
          (isEntryEditorOpen() || blocksDigitShortcuts(document.activeElement))
        ) {
          return;
        }

        const handler = registry.find(resolution.shortcut.id);
        if (handler) {
          event.preventDefault();
          withEventAttribution({ surface: "shortcut" }, () =>
            handler.run({ digit: resolution.digit }),
          );
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(prefixTimeoutId);
    };
  }, [registry]);

  return (
    <ShortcutContext.Provider value={registry}>
      {children}
    </ShortcutContext.Provider>
  );
}

/**
 * Runs `handler` when the shortcut for `id` is pressed, while the calling
 * component is mounted. The latest `handler` always runs, so callers do not
 * need to memoize it.
 */
export function useShortcut(
  id: ShortcutActionId,
  handler: ShortcutHandler,
  layer: ShortcutHandlerLayer = "page",
) {
  const registry = useContext(ShortcutContext);
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(
    () =>
      registry?.register(id, {
        layer,
        run: (press) => handlerRef.current(press),
      }),
    [id, layer, registry],
  );
}

/**
 * Returns a function that runs the handler for an action as if its shortcut
 * were pressed, without the text-field guard. Menus use it, so a menu item
 * does what its key does. It does nothing when no handler is mounted, as for
 * Previous outside the Time page.
 */
export function useRunShortcut() {
  const registry = useContext(ShortcutContext);

  return useCallback(
    (id: ShortcutActionId) => registry?.find(id)?.run({}),
    [registry],
  );
}

/**
 * Runs shortcut actions without a key press, as the command palette does.
 * `isAvailable` is false when no mounted component handles the action, such as
 * "Day view" outside the Time page. The registry is not reactive: read it when
 * the caller renders, not in a memo that outlives page changes.
 */
export function useShortcutRunner() {
  const registry = useContext(ShortcutContext);

  return {
    isAvailable: (id: ShortcutActionId) => Boolean(registry?.find(id)),
    run: (id: ShortcutActionId) => registry?.find(id)?.run({}),
  };
}

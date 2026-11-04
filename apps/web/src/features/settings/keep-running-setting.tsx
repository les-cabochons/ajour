import { useCallback, useEffect, useReducer, useRef } from "react";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { showErrorToast } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";

/** How long main gets to answer a read or a save. */
const DEADLINE_MS = 5_000;
const DEADLINE_MESSAGE = "Ajour did not answer in time.";

type WindowSettings = { keepRunning: boolean };

/**
 * The switch is a state machine with one operation in flight at a time.
 *
 * - `loading`: the first read from main.
 * - `idle`: `confirmed` is what main last answered. The only state that takes
 *   a click.
 * - `saving`: shows the requested value until main answers.
 * - `reconciling`: a save failed or timed out, so the setting is read from main
 *   again. The switch shows `confirmed` meanwhile.
 *
 * `confirmed` changes only from an answer main gave.
 */
type State =
  | { phase: "loading"; confirmed: boolean }
  | { phase: "idle"; confirmed: boolean }
  | { phase: "saving"; confirmed: boolean; requested: boolean }
  | { phase: "reconciling"; confirmed: boolean };

type Action =
  | { type: "save"; requested: boolean }
  | { type: "answered"; keepRunning: boolean }
  | { type: "reconcile" }
  | { type: "unanswered" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "save":
      return state.phase === "idle"
        ? { ...state, phase: "saving", requested: action.requested }
        : state;
    case "answered":
      return { phase: "idle", confirmed: action.keepRunning };
    case "reconcile":
      return { phase: "reconciling", confirmed: state.confirmed };
    case "unanswered":
      return { phase: "idle", confirmed: state.confirmed };
  }
}

/**
 * Runs asynchronous operations one at a time, each with a deadline. An answer
 * that comes after its operation settled, or after `cancel`, is ignored. One
 * counter is enough because operations are serial.
 */
function useSerialOperation() {
  const current = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);

  const cancel = useCallback(() => {
    current.current += 1;
    clearTimeout(timer.current);
    busy.current = false;
  }, []);

  /** Returns false, and does nothing, while another operation runs. */
  const run = useCallback(
    <T,>(
      read: () => Promise<T>,
      onAnswer: (answer: T) => void,
      onFail: (error: unknown) => void,
    ): boolean => {
      if (busy.current) return false;
      busy.current = true;
      const id = ++current.current;
      const settle = (next: () => void) => {
        if (current.current !== id) return;
        clearTimeout(timer.current);
        busy.current = false;
        current.current += 1;
        next();
      };
      timer.current = setTimeout(
        () => settle(() => onFail(new Error(DEADLINE_MESSAGE))),
        DEADLINE_MS,
      );
      let request: Promise<T>;
      try {
        request = read();
      } catch (error) {
        request = Promise.reject(error);
      }
      request.then(
        (answer) => settle(() => onAnswer(answer)),
        (error: unknown) => settle(() => onFail(error)),
      );
      return true;
    },
    [],
  );

  return { run, cancel };
}

/**
 * Settings › General › "Keep Ajour running when the window closes" (#534).
 * Main stores it, since it needs it before the window exists. The browser
 * build has no window to keep, so the section is absent there.
 */
export function KeepRunningSetting() {
  const desktop = window.ajourDesktop;
  // Main's default until it answers.
  const [state, dispatch] = useReducer(reducer, {
    phase: "loading",
    confirmed: true,
  });
  const { run, cancel } = useSerialOperation();
  const supported = Boolean(
    desktop?.getWindowSettings && desktop.configureWindowSettings,
  );

  useEffect(() => {
    if (!supported) return;
    run(
      () => desktop!.getWindowSettings!(),
      (settings) =>
        dispatch({ type: "answered", keepRunning: settings.keepRunning }),
      () => dispatch({ type: "unanswered" }),
    );
    // Also runs on unmount: timers cleared, late answers ignored.
    return cancel;
  }, [desktop, supported, run, cancel]);

  if (!supported) return null;

  const where =
    desktop?.runtime?.platform === "darwin" ? "the menu bar" : "the tray icon";

  function reconcile() {
    dispatch({ type: "reconcile" });
    run(
      () => desktop!.getWindowSettings!(),
      (settings) =>
        dispatch({ type: "answered", keepRunning: settings.keepRunning }),
      () => dispatch({ type: "unanswered" }),
    );
  }

  function save(requested: boolean) {
    const started = run<WindowSettings>(
      () => desktop!.configureWindowSettings!({ keepRunning: requested }),
      (settings) =>
        dispatch({ type: "answered", keepRunning: settings.keepRunning }),
      (error) => {
        showErrorToast({
          title: "The setting was not saved.",
          description: error instanceof Error ? error.message : undefined,
        });
        // Main may still have applied it; read what it holds.
        reconcile();
      },
    );
    if (started) dispatch({ type: "save", requested });
  }

  const checked = state.phase === "saving" ? state.requested : state.confirmed;

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Desktop app</h2>
      <p className="settings-section-desc">
        What happens when you close the Ajour window.
      </p>
      <AppPanel>
        <SettingRow
          label="Keep Ajour running when the window closes"
          labelFor="keep-running"
          description={`The terminal and agents keep working while the window is closed. Quit Ajour from ${where}.`}
        >
          <Switch
            id="keep-running"
            checked={checked}
            disabled={state.phase !== "idle"}
            // A disabled switch shows the default cursor (ui-rules.md).
            className="data-disabled:cursor-default"
            onCheckedChange={save}
          />
        </SettingRow>
      </AppPanel>
    </section>
  );
}

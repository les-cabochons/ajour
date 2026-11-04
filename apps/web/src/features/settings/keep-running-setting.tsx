import { useCallback, useEffect, useReducer, useRef } from "react";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { showErrorToast } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";

/** How long main gets to answer a read or a save. */
const DEADLINE_MS = 5_000;
const DEADLINE_MESSAGE = "Ajour did not answer in time.";

type WindowSettings = { keepRunning: boolean };

/**
 * The switch is a state machine with one operation in flight at a time.
 *
 * - `loading`: a read from main, the first one or a Retry.
 * - `idle`: `confirmed` is what main last answered. The only state that takes
 *   a click.
 * - `saving`: shows the requested value until main answers.
 * - `reconciling`: a save failed or timed out, so the setting is read from main
 *   again. The switch shows `confirmed` meanwhile.
 * - `unavailable`: a read, or the read after a failed save, got no answer in
 *   time. Nothing is known about main's value, so the switch claims none. Only
 *   Retry leaves it.
 *
 * `idle` is reached only from an answer main gave, to a read or a save.
 */
type State =
  | { phase: "loading"; retried: boolean }
  | { phase: "idle"; confirmed: boolean }
  | { phase: "saving"; confirmed: boolean; requested: boolean }
  | { phase: "reconciling"; confirmed: boolean }
  | { phase: "unavailable" };

type Action =
  | { type: "save"; requested: boolean }
  | { type: "answered"; keepRunning: boolean }
  | { type: "reconcile" }
  | { type: "retry" }
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
      return state.phase === "saving"
        ? { phase: "reconciling", confirmed: state.confirmed }
        : state;
    case "retry":
      return state.phase === "unavailable"
        ? { phase: "loading", retried: true }
        : state;
    case "unanswered":
      return { phase: "unavailable" };
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
  const [state, dispatch] = useReducer(reducer, {
    phase: "loading",
    retried: false,
  });
  const { run, cancel } = useSerialOperation();
  const supported = Boolean(
    desktop?.getWindowSettings && desktop.configureWindowSettings,
  );

  /** Reads main's value. Only an answer leads to `idle`. */
  const read = useCallback(
    () =>
      run(
        () => desktop!.getWindowSettings!(),
        (settings) =>
          dispatch({ type: "answered", keepRunning: settings.keepRunning }),
        () => dispatch({ type: "unanswered" }),
      ),
    [desktop, run],
  );

  useEffect(() => {
    if (!supported) return;
    read();
    // Also runs on unmount: timers cleared, late answers ignored.
    return cancel;
  }, [supported, read, cancel]);

  if (!supported) return null;

  const where =
    desktop?.runtime?.platform === "darwin" ? "the menu bar" : "the tray icon";

  function retry() {
    if (read()) dispatch({ type: "retry" });
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
        dispatch({ type: "reconcile" });
        read();
      },
    );
    if (started) dispatch({ type: "save", requested });
  }

  // `unavailable` and a Retry read claim no value: the switch only looks off.
  const unanswered =
    state.phase === "unavailable" ||
    (state.phase === "loading" && state.retried);
  const checked =
    state.phase === "saving"
      ? state.requested
      : state.phase === "idle" || state.phase === "reconciling"
        ? state.confirmed
        : false;

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
          description={
            <>
              {`The terminal and agents keep working while the window is closed. Quit Ajour from ${where}.`}
              {unanswered ? (
                <span id="keep-running-status" className="block">
                  {"Ajour didn't answer."}
                </span>
              ) : null}
            </>
          }
        >
          {unanswered ? (
            <Button
              variant="outline"
              size="sm"
              disabled={state.phase !== "unavailable"}
              focusableWhenDisabled
              onClick={retry}
            >
              Retry
            </Button>
          ) : null}
          <Switch
            id="keep-running"
            checked={checked}
            disabled={state.phase !== "idle"}
            aria-describedby={unanswered ? "keep-running-status" : undefined}
            // A disabled switch shows the default cursor (ui-rules.md).
            className="data-disabled:cursor-default"
            onCheckedChange={save}
          />
        </SettingRow>
      </AppPanel>
    </section>
  );
}

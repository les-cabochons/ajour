const { triggerOf } = require("./main-events.cjs");

const CRASH_LIMIT = 3;
const CRASH_PERIOD_MS = 60_000;

/** A recovery dialog's answer, as an event records it. */
const ANSWERS = {
  "Try again": "try_again",
  Quit: "quit",
  Reload: "reload",
  Wait: "wait",
};

/**
 * Keeps the Ajour window usable when its page crashes, hangs or cannot load.
 * A crashed page loads again, except at the third crash within a minute,
 * which shows a dialog with Reload and Quit instead, so a page that keeps
 * crashing does not reload in a loop. A hung page gets Wait and Reload, and a failed load gets Try
 * again and Quit. Call `load` instead of `window.loadURL`.
 *
 * One recovery dialog shows at a time. A newer recovery closes the open one,
 * and an answer from a closed dialog is ignored.
 *
 * Each load emits `window.load`, each crash `process.gone` and each hang
 * `window.unresponsive`. A unit that leads to a dialog ends with its answer.
 */
function watchWindow(window, { url, dialog, quit, events, now = Date.now }) {
  let recentCrashes = [];
  let loadGeneration = 0;
  /** The open dialog: its kind, and the controller that closes it. */
  let openQuestion = null;
  /** Set while Reload from the not-responding dialog kills the page. */
  let killingHungPage = false;
  /** The open `window.unresponsive` unit, until the page responds, crashes or closes. */
  let hang = null;

  function closeOpenQuestion() {
    openQuestion?.controller.abort();
    openQuestion = null;
  }

  /**
   * Shows a recovery dialog in place of any open one. Resolves the chosen
   * button's label, or null when a newer recovery closed the dialog or the
   * window closed. Rejects when the dialog cannot show.
   */
  async function ask(kind, { buttons, ...options }) {
    closeOpenQuestion();
    const question = { kind, controller: new AbortController() };
    openQuestion = question;
    try {
      const { response } = await dialog.showMessageBox(window, {
        title: "Ajour",
        buttons,
        defaultId: 0,
        noLink: true,
        signal: question.controller.signal,
        ...options,
      });
      return openQuestion === question && !window.isDestroyed()
        ? buttons[response]
        : null;
    } finally {
      if (openQuestion === question) {
        openQuestion = null;
      }
    }
  }

  /**
   * Asks to retry or quit. Its first button runs `retry`. When the dialog
   * cannot show, Ajour quits rather than leave a blank window. `answered`
   * gets the answer as an event records it, before Ajour acts on it.
   */
  async function askToRetryOrQuit(options, retry, answered) {
    const [retryLabel, quitLabel] = options.buttons;
    let choice;
    let answer;
    try {
      choice = await ask("retry", { ...options, cancelId: 1 });
      answer = choice === null ? "replaced" : ANSWERS[choice];
    } catch {
      choice = quitLabel;
      answer = "dialog_failed";
    }
    answered(answer);
    if (choice === retryLabel) {
      retry();
    } else if (choice === quitLabel) {
      quit();
    }
  }

  /**
   * Loads the app. Never rejects: a failure offers Try again and Quit. Only
   * the latest load's failure counts, and an aborted load is not a failure,
   * since a newer navigation replaced it. `trigger` says why it loads.
   * Resolves the load's outcome: `ok`, `error` while its dialog shows, or
   * `cancelled`.
   */
  async function load(trigger = "launch") {
    loadGeneration += 1;
    const thisLoad = loadGeneration;
    const unit = events.start("window.load", {
      kind: "lifecycle",
      trigger: triggerOf(trigger),
      detached: true,
    });
    unit.set({ window: { trigger } });
    const startedAt = now();
    try {
      await window.loadURL(url);
      unit.set({ window: { load_ms: now() - startedAt } });
      unit.end();
      return "ok";
    } catch (error) {
      unit.set({ window: { load_ms: now() - startedAt } });
      if (window.isDestroyed()) {
        unit.end("cancelled", "window_closed");
        return "cancelled";
      }
      if (thisLoad !== loadGeneration) {
        unit.end("cancelled", "superseded");
        return "cancelled";
      }
      if (error?.code === "ERR_ABORTED") {
        unit.end("cancelled", "aborted");
        return "cancelled";
      }
      unit.fail(error);
      void askToRetryOrQuit(
        {
          type: "error",
          message: "Ajour could not load its window",
          detail: error?.message,
          buttons: ["Try again", "Quit"],
        },
        () => load("retry"),
        (answer) => {
          unit.set({ window: { answer } });
          unit.end();
        },
      );
      return "error";
    }
  }

  function askAfterRepeatedCrashes(answered) {
    void askToRetryOrQuit(
      {
        type: "error",
        message: "Ajour keeps crashing",
        detail: `The window crashed ${CRASH_LIMIT} times within ${CRASH_PERIOD_MS / 1000} seconds, so Ajour stopped reloading it.`,
        buttons: ["Reload", "Quit"],
      },
      () => {
        recentCrashes = [];
        void load("reload");
      },
      answered,
    );
  }

  /**
   * Ends the open hang: the page responded, or it is gone. Its dialog, still
   * open, is replaced.
   */
  function endHang(recovered) {
    if (!hang) return;
    if (openQuestion?.kind === "hang") {
      hang.set({ unresponsive: { answer: "replaced" } });
    }
    hang.set({ unresponsive: { recovered } });
    hang.end(recovered ? "ok" : "error");
    hang = null;
  }

  // Reload kills the hung renderer, as Electron documents for this event, and
  // the crash handler below loads the app in a fresh one.
  window.webContents.on("unresponsive", async () => {
    if (window.isDestroyed() || openQuestion?.kind === "hang") {
      return;
    }

    hang ??= events.start("window.unresponsive", {
      kind: "crash",
      trigger: "system",
      detached: true,
    });
    const unit = hang;
    let answer;
    const choice = await ask("hang", {
      type: "warning",
      message: "Ajour is not responding",
      detail:
        "Wait for it to recover, or reload the window. Reloading loses changes that are not saved yet.",
      buttons: ["Wait", "Reload"],
      cancelId: 0,
    }).catch(() => {
      answer = "dialog_failed";
      return "Wait";
    });
    answer ??= choice === null ? "replaced" : ANSWERS[choice];
    unit.set({ unresponsive: { answer } });
    if (choice === "Reload") {
      endHang(false);
      killingHungPage = true;
      window.webContents.forcefullyCrashRenderer();
    }
  });

  window.webContents.on("responsive", () => {
    endHang(true);
    if (openQuestion?.kind === "hang") {
      closeOpenQuestion();
    }
  });

  window.once?.("closed", () => endHang(false));

  window.webContents.on("render-process-gone", (_event, details) => {
    // The crash starts a new recovery: earlier dialogs and loads are outdated.
    endHang(false);
    closeOpenQuestion();
    loadGeneration += 1;
    const killedOnPurpose = killingHungPage;
    killingHungPage = false;
    const unit = events.start("process.gone", {
      kind: "crash",
      trigger: "system",
      detached: true,
    });
    unit.set({
      process: {
        type: "renderer",
        reason: details?.reason,
        exit_code: details?.exitCode,
      },
    });
    const gone = (action, outcome) => {
      unit.set({ recovery: { action } });
      if (outcome) unit.end(outcome);
    };
    const outcome =
      killedOnPurpose || details?.reason === "clean-exit" ? "ok" : "error";
    if (window.isDestroyed()) {
      gone("window_closed", outcome);
      return;
    }

    let repeated = false;
    if (!killedOnPurpose) {
      const time = now();
      recentCrashes = [
        ...recentCrashes.filter((crash) => time - crash < CRASH_PERIOD_MS),
        time,
      ];
      repeated = recentCrashes.length >= CRASH_LIMIT;
    }
    if (!repeated) {
      gone(killedOnPurpose ? "killed_on_purpose" : "reloaded", outcome);
    } else {
      gone("cap_reached");
    }

    // Navigating while Electron still reports the crash fails a Chromium check
    // that ends the main process, so the reload, or the dialog that may lead
    // to one, waits for the next task.
    setTimeout(() => {
      if (window.isDestroyed()) {
        unit.end(outcome);
        return;
      }
      if (repeated) {
        askAfterRepeatedCrashes((answer) => {
          unit.set({ recovery: { answer } });
          unit.end(outcome);
        });
      } else {
        void load("crash_reload");
      }
    }, 0);
  });

  return { load };
}

module.exports = {
  watchWindow,
};

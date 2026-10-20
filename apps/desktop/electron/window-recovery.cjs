const CRASH_LIMIT = 3;
const CRASH_PERIOD_MS = 60_000;

/**
 * Keeps the Ajour window usable when its page crashes, hangs or cannot load.
 * A crashed page loads again, up to the third crash within a minute; then a
 * dialog offers Reload and Quit, so a page that keeps crashing does not reload
 * in a loop. A hung page gets Wait and Reload, and a failed load gets Try
 * again and Quit. Call `load` instead of `window.loadURL`.
 *
 * These handlers are where the wide-events work (#308) emits `process.gone`,
 * `window.unresponsive` and the window load event.
 */
function watchWindow(window, { url, dialog, quit, now = Date.now }) {
  let recentCrashes = [];
  let latestLoad = 0;
  let hangQuestion = null;

  /**
   * Loads the app. Never rejects: a failure offers Try again and Quit. Only
   * the latest load's failure counts, and an aborted load is not a failure,
   * since a newer navigation replaced it.
   */
  async function load() {
    latestLoad += 1;
    const thisLoad = latestLoad;
    try {
      await window.loadURL(url);
    } catch (error) {
      if (
        window.isDestroyed() ||
        thisLoad !== latestLoad ||
        error?.code === "ERR_ABORTED"
      ) {
        return;
      }
      void askToRetryOrQuit(
        {
          type: "error",
          message: "Ajour could not load its window",
          detail: error?.message,
          buttons: ["Try again", "Quit"],
        },
        load,
      );
    }
  }

  /**
   * Shows a Retry-or-Quit dialog. Its first button runs `retry`. When the
   * dialog cannot show, Ajour quits rather than leave a blank window.
   */
  async function askToRetryOrQuit(options, retry) {
    let response;
    try {
      ({ response } = await dialog.showMessageBox(window, {
        title: "Ajour",
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        ...options,
      }));
    } catch {
      response = 1;
    }
    if (window.isDestroyed()) {
      return;
    }
    if (response === 0) {
      retry();
    } else {
      quit();
    }
  }

  function askAfterRepeatedCrashes() {
    void askToRetryOrQuit(
      {
        type: "error",
        message: "Ajour keeps crashing",
        detail:
          "The window crashed three times within a minute, so Ajour stopped reloading it.",
        buttons: ["Reload", "Quit"],
      },
      () => {
        recentCrashes = [];
        void load();
      },
    );
  }

  /** Closes the not-responding dialog, which answers Wait. */
  function closeHangQuestion() {
    hangQuestion?.abort();
    hangQuestion = null;
  }

  // Reload kills the hung renderer, as Electron documents for this event, and
  // the crash handler below loads the app in a fresh one.
  window.webContents.on("unresponsive", async () => {
    if (window.isDestroyed() || hangQuestion) {
      return;
    }

    const question = new AbortController();
    hangQuestion = question;
    let response = 0;
    try {
      ({ response } = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Ajour",
        message: "Ajour is not responding",
        detail:
          "Wait for it to recover, or reload the window. Reloading loses changes that are not saved yet.",
        buttons: ["Wait", "Reload"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        signal: question.signal,
      }));
    } catch {
      // Without the dialog, Ajour waits: the page may still recover.
    }
    if (hangQuestion === question) {
      hangQuestion = null;
    }
    if (response === 1 && !question.signal.aborted && !window.isDestroyed()) {
      window.webContents.forcefullyCrashRenderer();
    }
  });

  window.webContents.on("responsive", closeHangQuestion);

  window.webContents.on("render-process-gone", () => {
    closeHangQuestion();
    if (window.isDestroyed()) {
      return;
    }

    // The crash ends any load in progress, so its failure is not reported.
    latestLoad += 1;
    const time = now();
    recentCrashes = [
      ...recentCrashes.filter((crash) => time - crash < CRASH_PERIOD_MS),
      time,
    ];
    const repeated = recentCrashes.length >= CRASH_LIMIT;

    // Navigating while Electron still reports the crash fails a Chromium check
    // that ends the main process, so the reload, or the dialog that may lead
    // to one, waits for the next task.
    setTimeout(() => {
      if (window.isDestroyed()) {
        return;
      }
      if (repeated) {
        askAfterRepeatedCrashes();
      } else {
        void load();
      }
    }, 0);
  });

  return { load };
}

module.exports = {
  watchWindow,
};

const CRASH_LIMIT = 3;
const CRASH_PERIOD_MS = 60_000;

/**
 * Keeps the Ajour window usable when its page crashes, hangs or cannot load.
 * A crashed page loads again, up to the third crash within a minute; then a
 * dialog offers Reload and Quit, so a page that keeps crashing does not reload
 * in a loop. A hung page gets Wait and Reload, and a failed load gets Try
 * again and Quit. Call `load` instead of `window.loadURL`.
 *
 * One recovery dialog shows at a time. A newer recovery closes the open one,
 * and an answer from a closed dialog is ignored.
 */
function watchWindow(window, { url, dialog, quit, now = Date.now }) {
  let recentCrashes = [];
  let loadGeneration = 0;
  /** The open dialog: its kind, and the controller that closes it. */
  let openQuestion = null;
  /** Set while Reload from the not-responding dialog kills the page. */
  let killingHungPage = false;

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
   * cannot show, Ajour quits rather than leave a blank window.
   */
  async function askToRetryOrQuit(options, retry) {
    const [retryLabel, quitLabel] = options.buttons;
    let choice;
    try {
      choice = await ask("retry", { ...options, cancelId: 1 });
    } catch {
      choice = quitLabel;
    }
    if (choice === retryLabel) {
      retry();
    } else if (choice === quitLabel) {
      quit();
    }
  }

  /**
   * Loads the app. Never rejects: a failure offers Try again and Quit. Only
   * the latest load's failure counts, and an aborted load is not a failure,
   * since a newer navigation replaced it.
   */
  async function load() {
    loadGeneration += 1;
    const thisLoad = loadGeneration;
    try {
      await window.loadURL(url);
    } catch (error) {
      if (
        window.isDestroyed() ||
        thisLoad !== loadGeneration ||
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

  function askAfterRepeatedCrashes() {
    void askToRetryOrQuit(
      {
        type: "error",
        message: "Ajour keeps crashing",
        detail: `The window crashed ${CRASH_LIMIT} times within ${CRASH_PERIOD_MS / 1000} seconds, so Ajour stopped reloading it.`,
        buttons: ["Reload", "Quit"],
      },
      () => {
        recentCrashes = [];
        void load();
      },
    );
  }

  // Reload kills the hung renderer, as Electron documents for this event, and
  // the crash handler below loads the app in a fresh one.
  window.webContents.on("unresponsive", async () => {
    if (window.isDestroyed() || openQuestion?.kind === "hang") {
      return;
    }

    const choice = await ask("hang", {
      type: "warning",
      message: "Ajour is not responding",
      detail:
        "Wait for it to recover, or reload the window. Reloading loses changes that are not saved yet.",
      buttons: ["Wait", "Reload"],
      cancelId: 0,
    }).catch(() => "Wait");
    if (choice === "Reload") {
      killingHungPage = true;
      window.webContents.forcefullyCrashRenderer();
    }
  });

  window.webContents.on("responsive", () => {
    if (openQuestion?.kind === "hang") {
      closeOpenQuestion();
    }
  });

  window.webContents.on("render-process-gone", () => {
    // The crash starts a new recovery: earlier dialogs and loads are outdated.
    closeOpenQuestion();
    loadGeneration += 1;
    const killedOnPurpose = killingHungPage;
    killingHungPage = false;
    if (window.isDestroyed()) {
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

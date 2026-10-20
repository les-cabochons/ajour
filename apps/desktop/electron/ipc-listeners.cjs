/**
 * Registers the main process's `ipcMain.on` listeners so none can throw into
 * the main process. A throw in a plain `ipcMain.on` listener is an uncaught
 * exception there; `ipcMain.handle` handlers need no wrapper, since Electron
 * turns their throws into rejected invokes.
 *
 * The catch blocks are where the wide-events work (#308) emits the failure.
 */
function createIpcListeners(ipcMain) {
  return {
    /** A one-way message from the renderer. A failure is dropped. */
    onMessage(channel, listener) {
      ipcMain.on(channel, (event, ...args) => {
        try {
          listener(event, ...args);
        } catch {
          // The renderer expects no answer.
        }
      });
    },

    /**
     * A `sendSync` request: the renderer waits for `answer`'s value. A failure
     * answers null, because a request left unanswered blocks the renderer.
     */
    answerSync(channel, answer) {
      ipcMain.on(channel, (event, ...args) => {
        let value;
        try {
          value = answer(event, ...args);
        } catch {
          value = null;
        }
        event.returnValue = value;
      });
    },
  };
}

module.exports = {
  createIpcListeners,
};

const { IPC_CHANNELS } = require("./ipc-channels.cjs");

/**
 * @typedef {typeof IPC_CHANNELS} IpcChannels
 * @typedef {(event: any, ...args: any[]) => any} IpcListener
 */
/**
 * The channels the table registers with `mode`, so `just typecheck` refuses a
 * channel it lacks or one registered another way.
 * @template {string} Mode
 * @typedef {{ [Channel in keyof IpcChannels]: IpcChannels[Channel]["mode"] extends Mode ? Channel : never }[keyof IpcChannels]} ChannelOf
 */

const REFUSED_SENDER = "refused_sender";

/**
 * The error a channel throws for a message from a window other than the
 * active one. The wrapper records it as `refused`, not as a failure.
 */
function refusedSender(message) {
  return Object.assign(new Error(message), { code: REFUSED_SENDER });
}

/**
 * The `{ traceparent }` a renderer may pass as a call's last argument, so the
 * call's event joins the renderer's trace. Anything else is an argument.
 */
function traceCarrierOf(args) {
  const last = args[args.length - 1];
  if (
    typeof last !== "object" ||
    last === null ||
    Object.getPrototypeOf(last) !== Object.prototype
  ) {
    return undefined;
  }
  const keys = Object.keys(last);
  return keys.length === 1 &&
    keys[0] === "traceparent" &&
    typeof last.traceparent === "string"
    ? last.traceparent
    : undefined;
}

/**
 * Registers every IPC channel of the main process: `handle` for `invoke`,
 * `onMessage` for one-way messages and `answerSync` for `sendSync` requests.
 * Each call emits one wide event, named from the channel table
 * (ipc-channels.cjs), with the channel, its mode and whether the sender was
 * accepted. The listener adds its own fields through `events.current()`.
 * Nothing registers with `ipcMain` directly.
 *
 * None can throw into the main process: a throw in a plain `ipcMain.on`
 * listener would be an uncaught exception there. A failed one-way message
 * is dropped, a failed `sendSync` answers null, because a request left
 * unanswered blocks the renderer, and a failed `invoke` rejects in the
 * renderer.
 */
function createIpcListeners(ipcMain, { events }) {
  function channelEntry(channel, mode) {
    const entry = IPC_CHANNELS[channel];
    if (!entry) {
      throw new Error(
        `IPC channel ${channel} has no entry in the channel table.`,
      );
    }
    if (entry.mode !== mode) {
      throw new Error(
        `IPC channel ${channel} is a ${entry.mode} channel, not ${mode}.`,
      );
    }
    return entry;
  }

  /** Runs one call as its channel's unit of work. Throws what the listener throws. */
  function call(channel, entry, listener, event, args) {
    const traceparent = traceCarrierOf(args);
    const listenerArgs = traceparent === undefined ? args : args.slice(0, -1);
    return events.run(
      entry.event,
      {
        kind: "ipc",
        trigger: entry.mode === "sync" ? "boot" : "user",
        ...(traceparent === undefined ? {} : { parent: traceparent }),
      },
      (unit) => {
        unit.set({
          ipc: { channel, mode: entry.mode, sender_accepted: true },
        });
        const refused = (error) => {
          if (error?.code === REFUSED_SENDER) {
            unit.set({ ipc: { sender_accepted: false } });
            unit.refuse("foreign_sender");
          }
          throw error;
        };
        let result;
        try {
          result = listener(event, ...listenerArgs);
        } catch (error) {
          refused(error);
        }
        return result && typeof result.then === "function"
          ? result.then(undefined, refused)
          : result;
      },
    );
  }

  return {
    /**
     * An `invoke` request: the renderer gets the listener's promise.
     * @param {ChannelOf<"invoke">} channel
     * @param {IpcListener} listener
     */
    handle(channel, listener) {
      const entry = channelEntry(channel, "invoke");
      ipcMain.handle(channel, (event, ...args) =>
        call(channel, entry, listener, event, args),
      );
    },

    /**
     * A one-way message from the renderer. A failure is dropped.
     * @param {ChannelOf<"message">} channel
     * @param {IpcListener} listener
     */
    onMessage(channel, listener) {
      const entry = channelEntry(channel, "message");
      ipcMain.on(channel, (event, ...args) => {
        try {
          const result = call(channel, entry, listener, event, args);
          if (result && typeof result.then === "function") {
            result.then(undefined, () => {});
          }
        } catch {
          // The renderer expects no answer.
        }
      });
    },

    /**
     * A `sendSync` request: the renderer waits for `answer`'s value. A failure
     * answers null.
     * @param {ChannelOf<"sync">} channel
     * @param {IpcListener} answer
     */
    answerSync(channel, answer) {
      const entry = channelEntry(channel, "sync");
      ipcMain.on(channel, (event, ...args) => {
        let value;
        try {
          value = call(channel, entry, answer, event, args);
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
  refusedSender,
};

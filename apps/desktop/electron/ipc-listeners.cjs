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

/** The one channel that may record only its failures (`record: "failures"`). */
const FORWARD_WIDE_EVENTS_CHANNEL = "ajour:forward-wide-events";

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

/** The scheme of a plugin's own origin (plugin-renderer-policy.cjs). */
const PLUGIN_ORIGIN_PREFIX = "ajour-plugin:";

/**
 * Whether the sender is a page of the window: not a frame at a plugin's
 * origin, and in the window's session. A plugin's hidden page lives in a
 * session of its own, so either test alone refuses it; a destroyed or
 * unknown frame has no plugin origin and is judged by session.
 */
function isWindowSender(event, windowSession) {
  const frame = event?.senderFrame;
  if (
    String(frame?.origin ?? "").startsWith(PLUGIN_ORIGIN_PREFIX) ||
    String(frame?.url ?? "").startsWith(PLUGIN_ORIGIN_PREFIX)
  ) {
    return false;
  }
  return event?.sender?.session === windowSession();
}

/**
 * Registers every IPC channel of the main process: `handle` for `invoke`,
 * `onMessage` for one-way messages and `answerSync` for `sendSync` requests.
 * Each call emits one wide event, named from the channel table
 * (ipc-channels.cjs), with the channel, its mode and whether the sender was
 * accepted. The listener adds its own fields through `events.current()`.
 * Nothing registers with `ipcMain` directly.
 *
 * Every channel but the plugin renderer's refuses a sender that is not a page
 * of the window (`isWindowSender`). `windowSession` is required, and making
 * the listeners without it throws: a caller that forgot it would otherwise
 * let every page through (#434). A refused `sendSync` answers null without
 * running the listener.
 *
 * The channel that forwards the renderer's events (`record: "failures"`)
 * emits its event only for a refused sender or a failed call: each batch it
 * takes emitting one would put a line in the log file for every batch
 * forwarded. Main counts the batches on `logs.sweep` instead (#440).
 *
 * None can throw into the main process: a throw in a plain `ipcMain.on`
 * listener would be an uncaught exception there. A failed one-way message
 * is dropped, a failed `sendSync` answers null, because a request left
 * unanswered blocks the renderer, and a failed `invoke` rejects in the
 * renderer.
 *
 * @param {any} ipcMain
 * @param {{ events: any, windowSession: () => unknown }} options
 */
function createIpcListeners(ipcMain, { events, windowSession }) {
  if (typeof windowSession !== "function") {
    throw new TypeError(
      "createIpcListeners needs windowSession, the window's session, to check each sender.",
    );
  }
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
    // Recording only failures hides a channel's successful calls from the
    // log: only the channel that forwards the renderer's events may.
    if (
      entry.record !== undefined &&
      (entry.record !== "failures" || channel !== FORWARD_WIDE_EVENTS_CHANNEL)
    ) {
      throw new Error(
        `IPC channel ${channel} may not set record: only ${FORWARD_WIDE_EVENTS_CHANNEL} records just its failures.`,
      );
    }
    return entry;
  }

  /** Throws the refusal when the sender may not use the channel. */
  function checkSender(entry, event) {
    if (
      entry.sender !== "plugin-renderer" &&
      !isWindowSender(event, windowSession)
    ) {
      throw refusedSender("Only the Ajour window can use this channel.");
    }
  }

  /**
   * One call of a channel that records only its failures (`record:
   * "failures"`): it runs with no unit, and emits its channel's event only
   * when the sender is refused or the listener fails. Throws what the
   * listener throws.
   */
  function callRecordingFailures(channel, entry, listener, event, args, init) {
    const failed = (error) => {
      const unit = events.start(entry.event, init);
      const refusal = error?.code === REFUSED_SENDER;
      unit.set({
        ipc: { channel, mode: entry.mode, sender_accepted: !refusal },
      });
      if (refusal) unit.refuse("foreign_sender");
      else unit.fail(error);
      unit.end();
      throw error;
    };
    let result;
    try {
      checkSender(entry, event);
      result = listener(event, ...args);
    } catch (error) {
      failed(error);
    }
    return result && typeof result.then === "function"
      ? result.then(undefined, failed)
      : result;
  }

  /** Runs one call as its channel's unit of work. Throws what the listener throws. */
  function call(channel, entry, listener, event, args) {
    const traceparent = traceCarrierOf(args);
    const listenerArgs = traceparent === undefined ? args : args.slice(0, -1);
    const init = {
      kind: "ipc",
      trigger: entry.mode === "sync" ? "boot" : "user",
      ...(traceparent === undefined ? {} : { parent: traceparent }),
    };
    if (entry.record === "failures") {
      return callRecordingFailures(
        channel,
        entry,
        listener,
        event,
        listenerArgs,
        init,
      );
    }
    return events.run(entry.event, init, (unit) => {
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
        checkSender(entry, event);
        result = listener(event, ...listenerArgs);
      } catch (error) {
        refused(error);
      }
      return result && typeof result.then === "function"
        ? result.then(undefined, refused)
        : result;
    });
  }

  return {
    /**
     * An `invoke` request: the renderer gets the listener's promise. A
     * failure always reaches it as an `Error`: Electron sends the page
     * `String(error)`, and the preload strips one leading type name from it,
     * so a thrown string must not supply its own.
     * @param {ChannelOf<"invoke">} channel
     * @param {IpcListener} listener
     */
    handle(channel, listener) {
      const entry = channelEntry(channel, "invoke");
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          return await call(channel, entry, listener, event, args);
        } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
        }
      });
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
  FORWARD_WIDE_EVENTS_CHANNEL,
  createIpcListeners,
  refusedSender,
};

// @ts-check
// Checked by `just typecheck` and never run: a registration names a channel
// of the table (electron/ipc-channels.cjs) and registers it the table's way.
const { createIpcListeners } = require("./electron/ipc-listeners.cjs");

const ipc = createIpcListeners(/** @type {any} */ ({}), {
  events: /** @type {any} */ ({}),
  windowSession: () => undefined,
});

ipc.handle("ajour:get-update-state", () => null);
ipc.onMessage("ajour:run-menu-item", () => {});
ipc.answerSync("ajour:get-app-menu", () => null);

// @ts-expect-error A channel the table lacks.
ipc.handle("ajour:not-a-channel", () => null);
// @ts-expect-error A sync channel registered as invoke.
ipc.handle("ajour:get-app-menu", () => null);
// @ts-expect-error An invoke channel registered as a message.
ipc.onMessage("ajour:get-update-state", () => {});
// @ts-expect-error A message channel answered synchronously.
ipc.answerSync("ajour:run-menu-item", () => null);

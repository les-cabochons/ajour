import { WINDOW_TOKEN_HEADER } from "../window-token.ts";

/**
 * The window token the tests start the API with. The tests call `/api` as
 * Ajour's window does, so they send it on every request.
 */
export const TEST_WINDOW_TOKEN = "test-window-token";

/** The headers a window request carries: its Host and the window token. */
export const windowRequestHeaders = {
  host: "127.0.0.1",
  [WINDOW_TOKEN_HEADER]: TEST_WINDOW_TOKEN,
};

/** The window token header alone, for a client that sets its own Host. */
export const windowTokenHeader = {
  [WINDOW_TOKEN_HEADER]: TEST_WINDOW_TOKEN,
};

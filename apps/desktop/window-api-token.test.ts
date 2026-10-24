import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { WINDOW_TOKEN_HEADER as API_HEADER } from "../api/src/window-token.ts";

const require = createRequire(import.meta.url);
const { WINDOW_TOKEN_HEADER, addWindowApiToken, createWindowApiToken } =
  require("./electron/window-api-token.cjs") as {
    WINDOW_TOKEN_HEADER: string;
    createWindowApiToken: () => string;
    addWindowApiToken: (
      session: FakeSession,
      options: { apiOrigin: string; token: string },
    ) => void;
  };

type Headers = Record<string, string>;
type Listener = (
  details: { url: string; requestHeaders: Headers },
  callback: (response: { requestHeaders: Headers }) => void,
) => void;

interface FakeSession {
  webRequest: {
    onBeforeSendHeaders: (
      filter: { urls: string[] },
      listener: Listener,
    ) => void;
  };
}

const API_ORIGIN = "http://127.0.0.1:8787";
const TOKEN = "launch-token";

/** A window session that records the hook main installs on it. */
function windowSession() {
  let filter: { urls: string[] } | undefined;
  let listener: Listener | undefined;
  const session: FakeSession = {
    webRequest: {
      onBeforeSendHeaders(givenFilter, givenListener) {
        filter = givenFilter;
        listener = givenListener;
      },
    },
  };
  addWindowApiToken(session, { apiOrigin: API_ORIGIN, token: TOKEN });
  return {
    filter: () => filter,
    /** The headers the session sends for a request the window makes. */
    send(url: string, requestHeaders: Headers = {}) {
      let sent: Headers | undefined;
      listener!({ url, requestHeaders }, (response) => {
        sent = response.requestHeaders;
      });
      return sent!;
    },
  };
}

describe("the window token main adds to the window's requests", () => {
  it("asks the session only for the local API's /api requests", () => {
    expect(windowSession().filter()).toEqual({
      urls: ["http://127.0.0.1:8787/api/*"],
    });
  });

  it.each([
    "http://127.0.0.1:8787/api/plugins",
    "http://127.0.0.1:8787/api/mcp/bridge",
  ])("adds the token to %s", (url) => {
    const sent = windowSession().send(url, { Accept: "text/event-stream" });

    expect(sent).toEqual({
      Accept: "text/event-stream",
      [WINDOW_TOKEN_HEADER]: TOKEN,
    });
  });

  it.each([
    "http://127.0.0.1:8787/mcp/ajour",
    "http://127.0.0.1:8787/apikeys",
    "http://127.0.0.1:5173/api/plugins",
    "http://localhost:8787/api/plugins",
    "https://example.com/api/plugins",
  ])("adds no token to %s", (url) => {
    expect(windowSession().send(url, { Accept: "*/*" })).toEqual({
      Accept: "*/*",
    });
  });

  it("replaces a token the page set itself", () => {
    const sent = windowSession().send("http://127.0.0.1:8787/api/plugins", {
      "x-ajour-window-token": "page-guess",
    });

    expect(sent).toEqual({ [WINDOW_TOKEN_HEADER]: TOKEN });
  });

  it("uses the header the local API reads", () => {
    expect(WINDOW_TOKEN_HEADER.toLowerCase()).toBe(API_HEADER);
  });

  it("makes a new random token at each launch", () => {
    const first = createWindowApiToken();
    const second = createWindowApiToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
  });
});

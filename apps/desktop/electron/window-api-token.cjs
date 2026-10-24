const { randomBytes } = require("node:crypto");

/**
 * The header the local API reads the window token from. It matches
 * WINDOW_TOKEN_HEADER in apps/api/src/window-token.ts. Main is CommonJS and
 * the API is TypeScript that the packaged app copies, so they can't share a
 * module; window-api-token.test.ts pins that the two agree.
 */
const WINDOW_TOKEN_HEADER = "X-Ajour-Window-Token";

/** A new token for this launch: 32 random bytes, kept in main's memory only. */
function createWindowApiToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Adds the window token to every request the window's session sends to the
 * local API's `/api` routes, the MCP bridge's EventSource included. Main adds
 * it on the way out, so page JavaScript never sees it. A request elsewhere,
 * such as `/mcp`, gets none, and a token the page set itself is dropped.
 */
function addWindowApiToken(session, { apiOrigin, token }) {
  if (!token) throw new Error("The window token can't be empty.");
  const origin = new URL(apiOrigin).origin;
  session.webRequest.onBeforeSendHeaders(
    { urls: [`${origin}/api/*`] },
    (details, callback) => {
      const requestHeaders = withoutWindowToken(details.requestHeaders);
      if (isApiRequest(details.url, origin)) {
        requestHeaders[WINDOW_TOKEN_HEADER] = token;
      }
      callback({ requestHeaders });
    },
  );
}

function isApiRequest(url, origin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function withoutWindowToken(headers) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(
      ([name]) => name.toLowerCase() !== WINDOW_TOKEN_HEADER.toLowerCase(),
    ),
  );
}

module.exports = {
  WINDOW_TOKEN_HEADER,
  addWindowApiToken,
  createWindowApiToken,
};

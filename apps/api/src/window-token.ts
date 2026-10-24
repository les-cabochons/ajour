import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The header that carries the window token. Electron main adds it to the
 * window's requests through `webRequest`, and vite's dev proxy adds it in the
 * browser, so page JavaScript never sees the token.
 */
export const WINDOW_TOKEN_HEADER = "x-ajour-window-token";

/** A new token for one launch: 32 random bytes, kept in memory only. */
export function createWindowToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Whether a request's header holds the window token, compared in constant
 * time. Both sides are hashed first, so a guess of another length takes the
 * same time as one of the right length.
 */
export function holdsWindowToken(
  header: string | string[] | undefined,
  windowToken: string,
) {
  if (typeof header !== "string" || header.length === 0) return false;
  return timingSafeEqual(digestOf(header), digestOf(windowToken));
}

function digestOf(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

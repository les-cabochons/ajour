// Copied by scripts/generate-contract.mjs from packages/shared/plugin-request-rules.ts.
// Do not edit: change the shared file, then run `pnpm generate`.

/*
 * The request rules of plugin API 4 that both Ajour's broker and the SDK's
 * fake apply: which request paths an endpoint pattern matches, and which
 * headers a plugin may never set. This file imports nothing, because the
 * SDK's `generate-contract.mjs` copies it into `lib/request-rules.ts`, and
 * the SDK's tests fail while that copy is stale.
 */

/** One literal path segment: RFC 3986 path characters, without wildcards or `;`. */
const LITERAL_SEGMENT = /^[A-Za-z0-9\-._~!$&'()+,=:@%]+$/;

/**
 * What a server might read a segment as and climb or split on: `.` and `..`
 * with or without trailing dots or spaces, a slash or backslash, `;` path
 * parameters, and control characters.
 */
function isUnsafeDecodedSegment(text: string) {
  // NFKC folds look-alikes such as the fullwidth full stop (U+FF0E) and the
  // one dot leader (U+2024) into the dots, slashes and `;` they stand for.
  const decoded = text.normalize("NFKC");
  return (
    /^[.\s]+$/.test(decoded) ||
    /[/\\;]/.test(decoded) ||
    /[\u0000-\u001f\u007f]/.test(decoded)
  );
}

function decodedSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * A segment that means itself: once decoded, and decoded again for a server
 * that decodes twice, it is not `.` or `..` and hides no slash, backslash,
 * `;` or control character, and it holds no `%` still, which a third decode
 * could turn into one. A literal `%` therefore can't be declared or requested.
 */
function isLiteralSegment(segment: string) {
  if (!LITERAL_SEGMENT.test(segment)) return false;
  const once = decodedSegment(segment);
  if (once === undefined || isUnsafeDecodedSegment(once)) return false;
  const twice = decodedSegment(once) ?? once;
  return !twice.includes("%") && !isUnsafeDecodedSegment(twice);
}

function pathSegments(path: string): string[] | undefined {
  if (path === "/") return [];
  if (!path.startsWith("/")) return undefined;
  return path.slice(1).split("/");
}

/**
 * An endpoint pattern: a path relative to its host, where `*` matches one
 * segment and `**`, last, matches the rest, nothing included.
 */
export function isEndpointPattern(pattern: string) {
  const segments = pathSegments(pattern);
  return (
    segments !== undefined &&
    segments.every((segment, index) =>
      segment === "**"
        ? index === segments.length - 1
        : segment === "*" || isLiteralSegment(segment),
    )
  );
}

/**
 * Whether a request path matches an endpoint pattern. Segments compare
 * exactly, case included. A path with an empty segment, or one that isn't
 * literal (see `isLiteralSegment`), matches nothing.
 */
export function endpointPatternMatches(pattern: string, path: string) {
  const patternParts = pathSegments(pattern);
  const pathParts = pathSegments(path);
  if (!patternParts || !pathParts) return false;
  if (!pathParts.every(isLiteralSegment)) return false;
  for (const [index, part] of patternParts.entries()) {
    if (part === "**") return true;
    const actual = pathParts[index];
    if (actual === undefined) return false;
    if (part !== "*" && part !== actual) return false;
  }
  return patternParts.length === pathParts.length;
}

/**
 * Request headers a plugin may never set, whatever its manifest lists:
 * credentials, the host, headers that change the method a server runs or
 * rewrite its path or host, the client address, and the hop-by-hop and
 * framing headers that belong to the connection, not the plugin.
 */
export const DENIED_REQUEST_HEADERS: readonly string[] = [
  "authorization",
  "cookie",
  "host",
  "forwarded",
  "x-http-method-override",
  "x-http-method",
  "x-method-override",
  "x-original-url",
  "x-rewrite-url",
  "x-original-host",
  "x-host",
  "x-real-ip",
  "content-length",
  "transfer-encoding",
  "connection",
  "te",
  "upgrade",
  "keep-alive",
  "trailer",
  "expect",
];
export const DENIED_REQUEST_HEADER_PREFIXES: readonly string[] = [
  "proxy-",
  "x-forwarded-",
];

/**
 * Whether a plugin may not set the header: the fixed denylist and the
 * headers the auth scheme sets, lowercase, always win over the manifest.
 */
export function isDeniedHeaderName(
  name: string,
  authHeaders: readonly string[],
) {
  const header = name.toLowerCase();
  return (
    DENIED_REQUEST_HEADERS.includes(header) ||
    DENIED_REQUEST_HEADER_PREFIXES.some((prefix) =>
      header.startsWith(prefix),
    ) ||
    authHeaders.includes(header)
  );
}

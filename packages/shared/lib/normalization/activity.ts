import type {
  CaptureSettings,
  NormalizedActivityContext,
  TitleMode,
} from "../types/domain";

const HIGH_ENTROPY_SEGMENT = /^[0-9a-f]{6,}$|^\d{3,}$|^[A-Za-z0-9_-]{16,}$/;

function safeUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function normalizeTitle(title: string, mode: TitleMode): string {
  if (mode === "off") {
    return "";
  }

  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s+[|\-]\s+.*$/, "")
    .slice(0, 180);
}

function sanitizePathSegments(
  pathname: string,
  maxPathSegments: number,
): string[] {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, maxPathSegments)
    .map((segment) => {
      const lower = segment.toLowerCase();
      return HIGH_ENTROPY_SEGMENT.test(lower) ? ":id" : lower;
    });
}

function buildPathname(tokens: string[]): string {
  if (tokens.length === 0) {
    return "/";
  }
  return `/${tokens.join("/")}`;
}

function makeFingerprint(
  domain: string,
  pathname: string,
  title: string,
): string {
  return [domain, pathname, title].filter(Boolean).join("|");
}

export interface NormalizeOptions {
  capture: CaptureSettings;
}

export function normalizeActivityContext(
  input: { url: string; title: string; domain?: string; pathname?: string },
  options: NormalizeOptions,
): NormalizedActivityContext {
  const parsed = safeUrl(input.url);
  const rawDomain = input.domain ?? parsed?.hostname ?? "unknown";
  const domain = normalizeDomain(rawDomain);
  const isBlocked = options.capture.blockedDomains.includes(domain);
  const isSensitive = options.capture.sensitiveDomains.includes(domain);

  if (isBlocked) {
    return {
      domain,
      pathname: "/blocked",
      url: domain,
      title: "",
      pathTokens: [],
      fingerprint: makeFingerprint(domain, "/blocked", ""),
      titleTokens: [],
    };
  }

  const rawPathname = input.pathname ?? parsed?.pathname ?? "/";
  const pathTokens =
    options.capture.urlMode === "domain_only" || isSensitive
      ? []
      : sanitizePathSegments(rawPathname, options.capture.maxPathSegments);
  const pathname = buildPathname(pathTokens);
  const title = normalizeTitle(input.title, options.capture.titleMode);

  return {
    domain,
    pathname,
    url:
      options.capture.urlMode === "domain_only" || isSensitive
        ? domain
        : `${domain}${pathname}`,
    title,
    pathTokens,
    fingerprint: makeFingerprint(domain, pathname, title),
    titleTokens: title.split(" ").filter(Boolean),
  };
}

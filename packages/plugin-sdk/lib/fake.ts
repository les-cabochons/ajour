import type { PluginHttpMethod, PluginManifest } from "./contract.js";
import type {
  Ajour,
  AjourHttpRequest,
  AjourLogFields,
  AjourLogLevel,
  AjourPublicFetchInit,
  AjourQueryValue,
  AjourRequestError,
  AjourRequestErrorCode,
  AjourResponse,
} from "./runtime.js";
import { endpointPatternMatches, isDeniedHeaderName } from "./request-rules.js";

/** An answer a route gives. `json` is sent as the body, with its content type. */
export interface FakeResponseInit {
  status?: number;
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  json?: unknown;
}

/** A request as the fake received it. Header names are lowercase. */
export interface RecordedHttpRequest {
  connectionId: string;
  host?: string;
  method: PluginHttpMethod;
  path: string;
  query?: Readonly<
    Record<string, AjourQueryValue | readonly AjourQueryValue[]>
  >;
  headers: Record<string, string>;
  body?: string | Uint8Array | ArrayBuffer;
  /** The body decoded as UTF-8, for assertions. */
  bodyText?: string;
}

export interface RecordedPublicRequest {
  url: string;
  method: "GET" | "HEAD";
  headers: Record<string, string>;
}

export type FakeResponder<Request> =
  | FakeResponseInit
  | ((request: Request) => FakeResponseInit | Promise<FakeResponseInit>);

export interface FakeHttpRoute {
  /** Answers only this connection. Absent: every connection. */
  connectionId?: string;
  /** Answers only this derived host. Absent: the base address. */
  host?: string;
  method: PluginHttpMethod;
  /** A path pattern, as in the manifest: `*` is one segment, `**` the rest. */
  path: string;
  respond: FakeResponder<RecordedHttpRequest>;
}

export interface FakePublicRoute {
  /** The whole URL, query included. */
  url: string;
  method?: "GET" | "HEAD";
  respond: FakeResponder<RecordedPublicRequest>;
}

export interface FakeAjourOptions {
  routes?: readonly FakeHttpRoute[];
  publicRoutes?: readonly FakePublicRoute[];
  /**
   * The plugin's manifest. With it, the fake refuses what Ajour's broker
   * would: an endpoint, derived host, header or public host the manifest
   * doesn't declare.
   */
  manifest?: PluginManifest;
  /**
   * The access choices each connection turned on, by connection id. A choice
   * marked `always` is on for every connection, and every other choice is
   * off until listed here. With a manifest, an endpoint behind a choice
   * that is off is refused, as the broker refuses it.
   */
  access?: Readonly<Record<string, readonly string[]>>;
}

export interface FakeLogLine {
  level: AjourLogLevel;
  message: string;
  fields?: AjourLogFields;
}

/** An `ajour` that answers from fixtures and records every call. */
export interface FakeAjour extends Ajour {
  readonly requests: RecordedHttpRequest[];
  readonly publicRequests: RecordedPublicRequest[];
  readonly logs: FakeLogLine[];
}

/**
 * Whether a request path matches a path pattern, as Ajour's broker decides
 * it: `*` matches one segment, `**` the rest, and a path with an empty, `.`
 * or `..` segment, a `;`, a control character, or an encoded slash, matches
 * nothing.
 */
export function routeMatches(pattern: string, path: string) {
  return endpointPatternMatches(pattern, path);
}

function requestError(
  code: AjourRequestErrorCode,
  message: string,
): AjourRequestError {
  return Object.assign(new Error(message), {
    name: "AjourRequestError" as const,
    code,
  });
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function lowercaseHeaders(headers: Readonly<Record<string, string>> = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function decodeBody(body: string | Uint8Array | ArrayBuffer | undefined) {
  if (body === undefined) return undefined;
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

function response(init: FakeResponseInit): AjourResponse {
  const headers = lowercaseHeaders(init.headers);
  let text = decodeBody(init.body) ?? "";
  if (init.json !== undefined) {
    text = JSON.stringify(init.json);
    headers["content-type"] ??= "application/json";
  }
  const status = init.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/** Waits for the responder, unless the signal fires first. */
async function answer<Request>(
  responder: FakeResponder<Request>,
  request: Request,
  signal: AbortSignal | undefined,
) {
  if (signal?.aborted) throw abortError(signal);
  const init = typeof responder === "function" ? responder(request) : responder;
  if (!signal) return response(await init);
  return await new Promise<AjourResponse>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(init).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(response(value));
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function authHeaders(manifest: PluginManifest) {
  const auth = manifest.network?.auth;
  if (!auth) return [];
  if (auth.scheme === "headerTemplate") return [auth.header.toLowerCase()];
  return auth.scheme === "secretAddress" ? [] : ["authorization"];
}

/** What the broker would refuse about the request, if anything. */
function refusal(
  manifest: PluginManifest,
  request: AjourHttpRequest,
  turnedOn: readonly string[],
) {
  const network = manifest.network;
  const where = request.host ? `host "${request.host}"` : "the base address";
  const describe = `${request.method} ${request.path}`;
  if (network?.auth?.scheme === "secretAddress") {
    if (request.host || request.method !== "GET" || request.path !== "") {
      return "A secret address takes only a GET with an empty path.";
    }
  } else {
    const endpoints = request.host
      ? network?.derivedHosts?.find((host) => host.id === request.host)
          ?.endpoints
      : network?.endpoints;
    if (request.host && endpoints === undefined) {
      return `The manifest derives no host "${request.host}".`;
    }
    const matching = (endpoints ?? []).filter(
      (endpoint) =>
        endpoint.method === request.method &&
        endpointPatternMatches(endpoint.path, request.path),
    );
    if (matching.length === 0) {
      return `The manifest allows no ${describe} on ${where}.`;
    }
    const on = new Set([
      ...turnedOn,
      ...(manifest.connectionAccess ?? [])
        .filter((choice) => choice.always)
        .map((choice) => choice.id),
    ]);
    const open = matching.find(
      (endpoint) => endpoint.access === undefined || on.has(endpoint.access),
    );
    if (!open) {
      return `Connection ${request.connectionId} hasn't turned on the access choice "${matching[0]!.access}".`;
    }
  }
  const listed = new Set(
    (network?.requestHeaders ?? []).map((header) => header.toLowerCase()),
  );
  const denied = authHeaders(manifest);
  for (const name of Object.keys(request.headers ?? {})) {
    const header = name.toLowerCase();
    if (isDeniedHeaderName(header, denied)) {
      return `A plugin may not set the ${name} header.`;
    }
    if (!listed.has(header)) {
      return `The manifest doesn't list the ${name} header.`;
    }
  }
  return undefined;
}

function publicRefusal(manifest: PluginManifest, url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${url} is not an address.`;
  }
  if (parsed.protocol !== "https:") {
    return "ajour.publicFetch reaches https addresses only.";
  }
  if (!(manifest.network?.publicHosts ?? []).includes(parsed.hostname)) {
    return `The manifest declares no public host ${parsed.hostname}.`;
  }
  return undefined;
}

/**
 * An `ajour` for plugin tests: `http` and `publicFetch` answer from route
 * fixtures instead of the network, and every call is recorded. Install it as
 * the global the plugin reads, such as with `vi.stubGlobal("ajour", fake)`.
 */
export function createFakeAjour(options: FakeAjourOptions = {}): FakeAjour {
  const requests: RecordedHttpRequest[] = [];
  const publicRequests: RecordedPublicRequest[] = [];
  const logs: FakeLogLine[] = [];
  const { manifest } = options;

  return {
    requests,
    publicRequests,
    logs,

    async http(request) {
      const recorded: RecordedHttpRequest = {
        connectionId: request.connectionId,
        ...(request.host !== undefined ? { host: request.host } : {}),
        method: request.method,
        path: request.path,
        ...(request.query !== undefined ? { query: request.query } : {}),
        headers: lowercaseHeaders(request.headers),
        ...(request.body !== undefined
          ? { body: request.body, bodyText: decodeBody(request.body) }
          : {}),
      };
      requests.push(recorded);
      if (request.signal?.aborted) throw abortError(request.signal);
      const refused =
        manifest &&
        refusal(
          manifest,
          request,
          options.access?.[request.connectionId] ?? [],
        );
      if (refused) throw requestError("refused", refused);
      const route = (options.routes ?? []).find(
        (candidate) =>
          (candidate.connectionId === undefined ||
            candidate.connectionId === request.connectionId) &&
          candidate.host === request.host &&
          candidate.method === request.method &&
          (candidate.path === request.path ||
            routeMatches(candidate.path, request.path)),
      );
      if (!route) {
        const where = request.host ? ` host "${request.host}" of` : "";
        throw new Error(
          `No fake route answers ${request.method} ${request.path} on${where} connection ${request.connectionId}.`,
        );
      }
      return await answer(route.respond, recorded, request.signal);
    },

    async publicFetch(url: string, init: AjourPublicFetchInit = {}) {
      const recorded: RecordedPublicRequest = {
        url,
        method: init.method ?? "GET",
        headers: lowercaseHeaders(init.headers),
      };
      publicRequests.push(recorded);
      if (init.signal?.aborted) throw abortError(init.signal);
      const refused = manifest && publicRefusal(manifest, url);
      if (refused) throw requestError("refused", refused);
      const route = (options.publicRoutes ?? []).find(
        (candidate) =>
          candidate.url === url &&
          (candidate.method ?? "GET") === recorded.method,
      );
      if (!route) {
        throw new Error(
          `No fake public route answers ${recorded.method} ${url}.`,
        );
      }
      return await answer(route.respond, recorded, init.signal);
    },

    log(level, message, fields) {
      logs.push({ level, message, ...(fields ? { fields } : {}) });
    },
  };
}

/**
 * The credential broker: the only way an API 4 plugin reaches the network,
 * decided in The plugin security model (#229), API 4 (#219), the spec #381
 * and ADR 0010. A plugin names one of its own connections, a method, a path
 * relative to the connection's address, a query, headers and a body. It
 * never names a URL or carries a credential. The broker:
 *
 * - resolves the connection among the calling plugin's own connections only,
 *   so another plugin's id and an unknown one give the same error;
 * - checks the admitted manifest's endpoint allowlist, its request headers
 *   (the fixed denylist always wins), and the connection's access choices;
 * - builds the URL from the address the user saved, never above its path;
 * - attaches the credential from the vault;
 * - refuses private addresses unless the connection is on-premises, before
 *   the request and, where the transport can tell, for the address that
 *   answered;
 * - follows same-origin redirects with the credential, up to 3, and hands a
 *   cross-origin one back; a secret address follows https redirects to any
 *   host and never gives its final address away;
 * - removes every secret, in its common changed forms, from the answer;
 * - caps request and response size, rate, concurrency and time;
 * - emits a `plugin.request` event per request, with no header, body or
 *   query, and records the last request and blocked attempts for Access
 *   review.
 *
 * `CredentialBroker` is the in-process implementation of the port. The
 * transport and the resolver are injected: Electron's `net.request` on a
 * dedicated session in the desktop app (`apps/desktop/electron/
 * broker-transport.cjs`), fakes in tests. Without a transport, as in the
 * standalone API, every request is refused: plugins need the desktop app.
 */

import {
  authSchemeHeaders,
  deriveHostAddress,
  endpointPatternMatches,
  isDeniedRequestHeader,
  pluginHttpMethods,
  type PluginApi4Manifest,
  type PluginAuth,
  type PluginEndpoint,
  type PluginHttpMethod,
} from "../../../packages/shared/plugin-api-4.ts";
import type { PluginFieldValues } from "../../../packages/shared/plugins.ts";
import type { AjourCatalog } from "../../../packages/wide-events/catalog.ts";
import type { Unit } from "../../../packages/wide-events/index.ts";
import type { ApiEvents } from "./events.ts";
import {
  isAddressLiteral,
  isPrivateAddress,
  unbracketed,
} from "./broker-addresses.ts";
import { SECRET_MARK, SecretScrubber, secretForms } from "./broker-scrub.ts";

// The port.

export type BrokerQueryValue = string | number | boolean;

/** A request one plugin operation sends through one of its connections. */
export interface BrokerHttpRequest {
  connectionId: string;
  /** A derived host's id, such as `vssps`. Absent for the base address. */
  host?: string;
  method: PluginHttpMethod;
  /** Relative to the connection's address. Empty for a secret address. */
  path: string;
  query?: Readonly<
    Record<string, BrokerQueryValue | readonly BrokerQueryValue[]>
  >;
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array | ArrayBuffer;
  signal?: AbortSignal;
}

export interface BrokerPublicFetchInit {
  method?: "GET" | "HEAD";
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

/**
 * An answer, read whole. Header names are lowercase. It never holds the
 * address that answered: a plugin learns only the status, the headers the
 * broker lets through and the body.
 */
export interface BrokerResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

/**
 * Why the broker didn't answer, as `ajour.http` rejects: `refused` when the
 * manifest, the connection or its access doesn't allow the request, `limit`
 * when it is too large or too frequent, `timeout`, or `network` when the
 * service couldn't be reached.
 */
export type BrokerErrorCode = "refused" | "limit" | "timeout" | "network";

/** What a refused, limited or failed request says, for its event. */
export type BrokerReason =
  | "invalid_request"
  | "connection_not_found"
  | "secret_unavailable"
  | "system_off"
  | "plugin_off"
  | "capability_off"
  | "not_allowed"
  | "header_refused"
  | "access_off"
  | "invalid_address"
  | "private_address"
  | "redirect_refused"
  | "no_transport"
  | "request_too_large"
  | "response_too_large"
  | "rate_limited"
  | "too_many_queued"
  | "operation_ended"
  | "timeout"
  | "network";

/** How `ajour.http` and `ajour.publicFetch` reject, apart from an abort. */
export class BrokerRequestError extends Error {
  override readonly name = "AjourRequestError";
  readonly code: BrokerErrorCode;
  readonly reason: BrokerReason;

  constructor(code: BrokerErrorCode, reason: BrokerReason, message: string) {
    super(message);
    this.code = code;
    this.reason = reason;
  }
}

/**
 * A connection the broker sends with: its values with the secrets the vault
 * holds, read for this request only.
 */
export interface BrokerConnection {
  id: string;
  /** The config, secrets included. */
  values: PluginFieldValues;
  /** The connection's secret values, to scrub from what comes back. */
  secrets: readonly string[];
  /** The user marked it on-premises, so private addresses are allowed. */
  onPremises: boolean;
  /** The access choices the connection turned on. */
  access: readonly string[];
}

/** What the broker knows of the operation a request comes from. */
export interface BrokerCaller {
  /** The plugin, from the runtime that ran it: never from the plugin. */
  pluginId: string;
  /** The manifest of the package the operation runs. */
  manifest: PluginApi4Manifest;
  /** The plugin method the operation runs, such as `syncConnection`. */
  method: string;
  /** The operation's span, so each request event is its child. */
  traceparent?: string;
  /**
   * A connection being validated before it is saved, under an id of its own
   * that only this operation can use. It is never stored.
   */
  pending?: BrokerConnection;
}

/** Where the broker finds a plugin's saved connections, and whether they may run. */
export interface BrokerConnectionSource {
  /**
   * The plugin's own connection, with its secrets, or undefined when the
   * plugin has none with this id. Throws `BrokerRequestError` when it can't
   * be used now, such as while its secrets can't be read.
   */
  connection(
    pluginId: string,
    connectionId: string,
    manifest: PluginApi4Manifest,
  ): Promise<BrokerConnection | undefined>;
  /**
   * Why the operation may no longer reach the network, such as its plugin
   * or capability turned off since it started, or undefined.
   */
  operationRefusal?(
    pluginId: string,
    method: string,
  ): Promise<
    | {
        reason: "system_off" | "plugin_off" | "capability_off";
        message: string;
      }
    | undefined
  >;
}

/** The records Access review reads: the last request and blocked attempts. */
export interface BrokerActivity {
  /** `connectionId` is absent for a public fetch or a connection not saved yet. */
  recordRequest(
    pluginId: string,
    connectionId: string | undefined,
    at: number,
  ): Promise<void>;
  recordBlocked(
    pluginId: string,
    connectionId: string | undefined,
    at: number,
  ): Promise<void>;
}

/** One HTTP exchange, as the transport sends it. It never follows a redirect. */
export interface BrokerTransportRequest {
  url: string;
  method: PluginHttpMethod;
  /** Lowercase names. */
  headers: Record<string, string>;
  body?: Uint8Array;
  signal: AbortSignal;
  /** The transport stops reading past this and throws `response_too_large`. */
  maxResponseBytes: number;
}

export interface BrokerTransportResponse {
  status: number;
  /** Lowercase names; repeated headers joined with ", ". */
  headers: Record<string, string>;
  body: Uint8Array;
  /** The address that answered, when the transport can tell. */
  remoteAddress?: string;
}

/**
 * Sends one exchange. Rejects with an error whose `code` is
 * `response_too_large` past the limit, and with any other error when the
 * service can't be reached.
 */
export interface BrokerTransport {
  send(request: BrokerTransportRequest): Promise<BrokerTransportResponse>;
}

/** Resolves a host the way the transport will. */
export interface BrokerResolver {
  /**
   * Every address the host resolves to. `proxied` says the request goes
   * through a proxy, which connects for it: then the addresses may be
   * empty, and the address that answers is the proxy's.
   */
  resolve(
    hostname: string,
    url: string,
  ): Promise<{
    addresses: readonly string[];
    proxied?: boolean;
  }>;
}

export interface BrokerLimits {
  /** The largest request body. */
  requestBodyBytes: number;
  /** The largest response body, as the runtime's result bound. */
  responseBodyBytes: number;
  /** How long one request may take, redirects included. */
  timeoutMs: number;
  /** A plugin's requests in flight at once. */
  concurrentPerPlugin: number;
  /** A plugin's requests waiting for a slot. More are refused. */
  queuedPerPlugin: number;
  /** A plugin's sustained requests per second. */
  ratePerSecond: number;
  /** The requests a plugin may send at once before the rate applies. */
  rateBurst: number;
  /** The redirects followed for one request. */
  redirects: number;
}

/**
 * The broker's limits. A response is capped at 8 MB, the bound of a plugin
 * operation's result (`MAX_PLUGIN_RESULT_BYTES`), and a request at 4 MB. A
 * request ends after 20 s, inside the 30 s an operation may take, so the
 * plugin can still answer with the timeout.
 */
export const BROKER_LIMITS: Readonly<BrokerLimits> = {
  requestBodyBytes: 4 * 1024 * 1024,
  responseBodyBytes: 8 * 1024 * 1024,
  timeoutMs: 20_000,
  concurrentPerPlugin: 6,
  queuedPerPlugin: 64,
  ratePerSecond: 10,
  rateBurst: 60,
  redirects: 3,
};

/** The broker as one plugin operation reaches it. */
export interface OperationBroker {
  http(request: BrokerHttpRequest): Promise<BrokerResponse>;
  publicFetch(
    url: string,
    init?: BrokerPublicFetchInit,
  ): Promise<BrokerResponse>;
  /**
   * Ends the operation's access: requests in flight are aborted and later
   * ones refused. The host calls it once the operation settled.
   */
  close(): void;
}

/** The message-shaped port the runtimes call: the in-process broker implements it. */
export interface CredentialBrokerPort {
  /** The broker for one operation of `caller`. */
  forOperation(caller: BrokerCaller): OperationBroker;
}

export interface CredentialBrokerOptions {
  connections: BrokerConnectionSource;
  /** Absent outside the desktop app: every request is refused. */
  transport?: BrokerTransport;
  /** Absent: hosts are resolved with Node's `dns.lookup`. */
  resolver?: BrokerResolver;
  activity?: BrokerActivity;
  events?: ApiEvents;
  limits?: Partial<BrokerLimits>;
  now?: () => number;
}

// The implementation.

/** The headers never handed back to a plugin. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "www-authenticate",
  "proxy-authenticate",
  "authentication-info",
  "proxy-authentication-info",
  // The transport hands the body back decoded and whole.
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

/** Headers that would name a secret address's final address. */
const ADDRESS_HEADERS = new Set([
  "location",
  "content-location",
  "link",
  "refresh",
]);

/**
 * The refusals Access review counts as blocked attempts: the plugin asked
 * for something its access doesn't allow. A paused connection, a plugin
 * turned off or a limit isn't one.
 */
const BLOCKING_REASONS: ReadonlySet<BrokerReason> = new Set([
  "invalid_request",
  "connection_not_found",
  "not_allowed",
  "header_refused",
  "access_off",
  "private_address",
  "redirect_refused",
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const NOT_FOUND_MESSAGE = "This plugin has no connection with that id.";
const NO_TRANSPORT_MESSAGE =
  "Plugins reach the network only in the Ajour desktop app.";

type HostKind = "base" | "derived" | "secret_address" | "public";

/** Where a request goes, once the policy allowed it. */
interface Target {
  url: URL;
  hostKind: HostKind;
  /** The path every request and same-origin redirect must stay under. */
  basePath: string;
  pathTemplate?: string;
  /** Headers the broker attaches, lowercase. */
  authHeaders: Record<string, string>;
  /** Values built from the secret that a service may echo, such as Basic's. */
  credentials: string[];
  secretAddress: boolean;
}

function refused(reason: BrokerReason, message: string) {
  return new BrokerRequestError("refused", reason, message);
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function bodyBytes(body: BrokerHttpRequest["body"]): Uint8Array | undefined {
  if (body === undefined) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  return undefined;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/** A header value a request may carry: no line break or NUL. */
function isHeaderValue(value: unknown): value is string {
  return typeof value === "string" && !/[\r\n\0]/.test(value);
}

/** The base address without a trailing slash, query or fragment. */
function parseBaseAddress(value: unknown, onPremises: boolean): URL {
  const text = stringValue(value)?.trim();
  let url: URL;
  try {
    url = new URL(text ?? "");
  } catch {
    throw refused(
      "invalid_address",
      "The connection's address isn't an address. Check it in the connection's settings.",
    );
  }
  if (url.username || url.password) {
    throw refused(
      "invalid_address",
      "The connection's address can't hold a user name or password.",
    );
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && onPremises)) {
    throw refused(
      "invalid_address",
      onPremises
        ? "The connection's address must start with https:// or http://."
        : "The connection's address must start with https://. Only an on-premises connection may use http://.",
    );
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

/** Whether `path` is `basePath` or below it. */
function isUnder(path: string, basePath: string) {
  return (
    basePath === "" || path === basePath || path.startsWith(`${basePath}/`)
  );
}

function appendQuery(url: URL, query: BrokerHttpRequest["query"]) {
  if (query === undefined) return;
  if (typeof query !== "object" || query === null) {
    throw refused("invalid_request", "A query is an object of values.");
  }
  for (const [key, raw] of Object.entries(query)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const text = stringValue(value);
      if (text === undefined) {
        throw refused(
          "invalid_request",
          "A query value is a string, a number or a boolean.",
        );
      }
      url.searchParams.append(key, text);
    }
  }
}

function base64(text: string) {
  return Buffer.from(text, "utf8").toString("base64");
}

/** The secret field's value as text, or a refusal when it is missing. */
function secretValue(connection: BrokerConnection, field: string): string {
  const value = stringValue(connection.values[field]);
  if (value === undefined || value.length === 0) {
    throw refused(
      "secret_unavailable",
      "This connection has no saved credential. Enter it in the connection's settings.",
    );
  }
  return value;
}

/** The headers the auth scheme attaches, and the values a service may echo. */
function authOf(
  auth: PluginAuth | undefined,
  connection: BrokerConnection,
): { headers: Record<string, string>; credentials: string[] } {
  switch (auth?.scheme) {
    case undefined:
    case "secretAddress":
      return { headers: {}, credentials: [] };
    case "bearer": {
      const secret = secretValue(connection, auth.secretField);
      return {
        headers: { authorization: `Bearer ${secret}` },
        credentials: [],
      };
    }
    case "basic": {
      const user = stringValue(connection.values[auth.userField]) ?? "";
      const pair = `${user}:${secretValue(connection, auth.secretField)}`;
      return {
        headers: { authorization: `Basic ${base64(pair)}` },
        credentials: [pair],
      };
    }
    case "patBasic": {
      const pair = `:${secretValue(connection, auth.secretField)}`;
      return {
        headers: { authorization: `Basic ${base64(pair)}` },
        credentials: [pair],
      };
    }
    case "headerTemplate": {
      const secret = secretValue(connection, auth.secretField);
      // A function, so a `$&` in the secret stays as it is.
      const value = auth.template.replace("{secret}", () => secret);
      return {
        headers: { [auth.header.toLowerCase()]: value },
        credentials: [value],
      };
    }
    default:
      throw refused(
        "not_allowed",
        "This version of Ajour doesn't support the plugin's auth scheme.",
      );
  }
}

/** The endpoint of `endpoints` that allows the request, or a refusal. */
function matchEndpoint(
  endpoints: readonly PluginEndpoint[],
  manifest: PluginApi4Manifest,
  connection: BrokerConnection,
  method: PluginHttpMethod,
  path: string,
  where: string,
): PluginEndpoint {
  const matching = endpoints.filter(
    (endpoint) =>
      endpoint.method === method && endpointPatternMatches(endpoint.path, path),
  );
  if (matching.length === 0) {
    throw refused(
      "not_allowed",
      `The plugin's manifest allows no ${method} request to that path on ${where}.`,
    );
  }
  const on = new Set([
    ...connection.access,
    ...manifest.connectionAccess
      .filter((choice) => choice.always)
      .map((choice) => choice.id),
  ]);
  const open = matching.find(
    (endpoint) => endpoint.access === undefined || on.has(endpoint.access),
  );
  if (!open) {
    const choice = manifest.connectionAccess.find(
      (candidate) => candidate.id === matching[0]!.access,
    );
    throw refused(
      "access_off",
      `This connection's access doesn't include "${choice?.label ?? matching[0]!.access}". Turn it on in the connection's settings.`,
    );
  }
  return open;
}

/** Where a plugin's request goes, by the manifest and the connection. */
function targetOf(
  manifest: PluginApi4Manifest,
  connection: BrokerConnection,
  request: BrokerHttpRequest,
): Target {
  const network = manifest.network;
  const auth = network?.auth;
  if (auth?.scheme === "secretAddress") {
    if (
      request.host !== undefined ||
      request.method !== "GET" ||
      request.path !== "" ||
      request.query !== undefined
    ) {
      throw refused(
        "not_allowed",
        "A secret address takes only a GET with an empty path and no query.",
      );
    }
    const text = secretValue(connection, auth.secretField).trim();
    let url: URL;
    try {
      url = new URL(text.replace(/^webcals?:\/\//i, "https://"));
    } catch {
      throw refused(
        "invalid_address",
        "The connection's secret address isn't an address. Enter it again in the connection's settings.",
      );
    }
    if (url.protocol !== "https:") {
      throw refused(
        "invalid_address",
        "The connection's secret address must start with https:// or webcal://.",
      );
    }
    url.hash = "";
    return {
      url,
      hostKind: "secret_address",
      basePath: "",
      authHeaders: {},
      credentials: [],
      secretAddress: true,
    };
  }

  if (!network?.baseAddress) {
    throw refused(
      "not_allowed",
      "The plugin's manifest declares no address its connections reach.",
    );
  }
  if (typeof request.path !== "string" || !request.path.startsWith("/")) {
    throw refused(
      "not_allowed",
      "A request path is relative to the connection's address and starts with /.",
    );
  }
  const base = parseBaseAddress(
    connection.values[network.baseAddress.field],
    connection.onPremises,
  );
  let address = base;
  let hostKind: HostKind = "base";
  let endpoints = network.endpoints;
  let where = "the connection's address";
  if (request.host !== undefined) {
    const derived = network.derivedHosts.find(
      (candidate) => candidate.id === request.host,
    );
    if (!derived) {
      throw refused(
        "not_allowed",
        "The plugin's manifest derives no host with that id.",
      );
    }
    const derivedAddress = deriveHostAddress(derived, base.href);
    if (!derivedAddress) {
      throw refused(
        "not_allowed",
        `The plugin's ${derived.label ?? derived.id} host doesn't apply to this connection's address.`,
      );
    }
    address = new URL(derivedAddress);
    hostKind = "derived";
    endpoints = derived.endpoints;
    where = `its ${derived.id} host`;
  }
  const endpoint = matchEndpoint(
    endpoints,
    manifest,
    connection,
    request.method,
    request.path,
    where,
  );
  const basePath = address.pathname.replace(/\/+$/, "");
  const url = new URL(address.origin);
  url.pathname = `${basePath}${request.path}`;
  // The path is made of literal segments, so the URL keeps it as it is,
  // under the base path. Anything else is refused rather than sent.
  if (
    url.pathname !== `${basePath}${request.path}` ||
    !isUnder(url.pathname, basePath)
  ) {
    throw refused(
      "not_allowed",
      "The request path climbs above the connection's address.",
    );
  }
  appendQuery(url, request.query);
  const { headers, credentials } = authOf(network.auth, connection);
  return {
    url,
    hostKind,
    basePath,
    pathTemplate: endpoint.path,
    authHeaders: headers,
    credentials,
    secretAddress: false,
  };
}

/** The headers a plugin set, checked against the manifest, lowercase. */
function requestHeaders(
  manifest: PluginApi4Manifest,
  headers: BrokerHttpRequest["headers"],
  auth: PluginAuth | undefined,
): Record<string, string> {
  if (headers === undefined) return {};
  if (typeof headers !== "object" || headers === null) {
    throw refused("invalid_request", "Headers are an object of strings.");
  }
  const listed = new Set(
    (manifest.network?.requestHeaders ?? []).map((name) => name.toLowerCase()),
  );
  const checked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const header = name.toLowerCase();
    if (isDeniedRequestHeader(header, auth)) {
      throw refused(
        "header_refused",
        `A plugin may not set the ${name} header.`,
      );
    }
    if (!listed.has(header)) {
      throw refused(
        "header_refused",
        `The plugin's manifest doesn't list the ${name} header.`,
      );
    }
    if (!isHeaderValue(value)) {
      throw refused("invalid_request", `The ${name} header's value isn't one.`);
    }
    checked[header] = value;
  }
  return checked;
}

/** A plugin's rate: a token bucket. */
class RateBucket {
  private readonly limits: BrokerLimits;
  private tokens: number;
  private updatedAt: number;

  constructor(limits: BrokerLimits, now: number) {
    this.limits = limits;
    this.tokens = limits.rateBurst;
    this.updatedAt = now;
  }

  take(now: number) {
    this.tokens = Math.min(
      this.limits.rateBurst,
      this.tokens + ((now - this.updatedAt) / 1000) * this.limits.ratePerSecond,
    );
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** A plugin's requests in flight, and those waiting for a slot. */
class Slots {
  private readonly limits: BrokerLimits;
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(limits: BrokerLimits) {
    this.limits = limits;
  }

  async acquire(signal: AbortSignal): Promise<() => void> {
    if (this.running >= this.limits.concurrentPerPlugin) {
      if (this.waiting.length >= this.limits.queuedPerPlugin) {
        throw new BrokerRequestError(
          "limit",
          "too_many_queued",
          "The plugin sent too many requests at once.",
        );
      }
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = this.waiting.indexOf(wake);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(abortError(signal));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        this.waiting.push(wake);
      });
    } else if (signal.aborted) {
      throw abortError(signal);
    }
    this.running += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running -= 1;
      this.waiting.shift()?.();
    };
  }
}

/** The response headers a plugin may read: no cookie, challenge or echoed secret. */
function responseHeaders(
  headers: Record<string, string>,
  scrubber: SecretScrubber,
  secretAddress: boolean,
) {
  const kept: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(name)) continue;
    if (secretAddress && ADDRESS_HEADERS.has(name)) continue;
    if (scrubber.holdsSecret(value) || scrubber.holdsSecret(name)) continue;
    kept[name] = value;
  }
  return kept;
}

/** How the broker sends one plugin request, with what it has learned. */
interface Exchange {
  pluginId: string;
  connectionId?: string;
  hostKind?: HostKind;
  pathTemplate?: string;
  redirects: number;
  status?: number;
  requestBytes: number;
  responseBytes: number;
  onPremises: boolean;
  pending: boolean;
}

export class CredentialBroker implements CredentialBrokerPort {
  private readonly options: CredentialBrokerOptions;
  private readonly limits: BrokerLimits;
  private readonly now: () => number;
  private readonly rates = new Map<string, RateBucket>();
  private readonly slots = new Map<string, Slots>();

  constructor(options: CredentialBrokerOptions) {
    this.options = options;
    this.limits = { ...BROKER_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
  }

  forOperation(caller: BrokerCaller): OperationBroker {
    const ended = new AbortController();
    return {
      http: (request) => this.request(caller, request, ended.signal),
      publicFetch: (url, init) =>
        this.publicFetch(caller, url, init, ended.signal),
      close: () =>
        ended.abort(
          refused(
            "operation_ended",
            "The plugin operation that sent this request has ended.",
          ),
        ),
    };
  }

  private slotsOf(pluginId: string) {
    let slots = this.slots.get(pluginId);
    if (!slots) {
      slots = new Slots(this.limits);
      this.slots.set(pluginId, slots);
    }
    return slots;
  }

  private takeRate(pluginId: string) {
    let bucket = this.rates.get(pluginId);
    if (!bucket) {
      bucket = new RateBucket(this.limits, this.now());
      this.rates.set(pluginId, bucket);
    }
    if (!bucket.take(this.now())) {
      throw new BrokerRequestError(
        "limit",
        "rate_limited",
        "The plugin sent too many requests. Try again in a moment.",
      );
    }
  }

  /**
   * Runs one request: its event, its limits, its slot and its records, with
   * `send` doing the policy and the exchanges.
   */
  private async run(
    caller: BrokerCaller,
    exchange: Exchange,
    method: string,
    signals: (AbortSignal | undefined)[],
    body: Uint8Array | undefined,
    send: (signal: AbortSignal, exchange: Exchange) => Promise<BrokerResponse>,
  ): Promise<BrokerResponse> {
    const unit = this.options.events?.start("plugin.request", {
      kind: "job",
      trigger: "system",
      detached: true,
      ...(caller.traceparent ? { parent: caller.traceparent } : {}),
    });
    const timeout = new AbortController();
    const timer = setTimeout(
      () =>
        timeout.abort(
          new BrokerRequestError(
            "timeout",
            "timeout",
            "The service took too long to answer.",
          ),
        ),
      this.limits.timeoutMs,
    );
    const signal = AbortSignal.any(
      [timeout.signal, ...signals].filter(
        (candidate): candidate is AbortSignal => candidate !== undefined,
      ),
    );
    let release: (() => void) | undefined;
    let failure: unknown;
    const queuedAt = this.now();
    try {
      if (signal.aborted) throw abortError(signal);
      if (body && body.byteLength > this.limits.requestBodyBytes) {
        throw new BrokerRequestError(
          "limit",
          "request_too_large",
          `A request body may hold up to ${this.limits.requestBodyBytes / (1024 * 1024)} MB.`,
        );
      }
      this.takeRate(caller.pluginId);
      release = await this.slotsOf(caller.pluginId).acquire(signal);
      unit?.set({ broker: { queued_ms: this.now() - queuedAt } });
      if (!this.options.transport) {
        throw refused("no_transport", NO_TRANSPORT_MESSAGE);
      }
      const refusal = await this.options.connections.operationRefusal?.(
        caller.pluginId,
        caller.method,
      );
      if (refusal) throw refused(refusal.reason, refusal.message);
      const response = await send(signal, exchange);
      exchange.status = response.status;
      exchange.responseBytes = response.body.byteLength;
      return response;
    } catch (error) {
      failure = error;
      throw this.settleError(error, signal);
    } finally {
      clearTimeout(timer);
      release?.();
      await this.finish(unit, exchange, method, failure, signal);
    }
  }

  /** What a request rejects with: a broker error, the abort, or a network failure. */
  private settleError(error: unknown, signal: AbortSignal): unknown {
    if (error instanceof BrokerRequestError) return error;
    if (signal.aborted) {
      const reason = signal.reason;
      return reason instanceof BrokerRequestError ? reason : abortError(signal);
    }
    if (
      (error as { code?: unknown } | undefined)?.code === "response_too_large"
    ) {
      return new BrokerRequestError(
        "limit",
        "response_too_large",
        `The service's answer is larger than ${this.limits.responseBodyBytes / (1024 * 1024)} MB.`,
      );
    }
    // The transport's own message can name the address, so it stays out.
    return new BrokerRequestError(
      "network",
      "network",
      "The service couldn't be reached.",
    );
  }

  /** Emits the request's event, and records it for Access review. */
  private async finish(
    unit: Unit<AjourCatalog, "plugin.request"> | undefined,
    exchange: Exchange,
    method: string,
    failure: unknown,
    signal: AbortSignal,
  ) {
    const at = this.now();
    const error =
      failure === undefined ? undefined : this.settleError(failure, signal);
    const blocked =
      error instanceof BrokerRequestError && BLOCKING_REASONS.has(error.reason);
    this.emit(unit, exchange, method, error);
    const activity = this.options.activity;
    if (!activity) return;
    try {
      await (blocked
        ? activity.recordBlocked(exchange.pluginId, exchange.connectionId, at)
        : activity.recordRequest(exchange.pluginId, exchange.connectionId, at));
    } catch {
      // Access review's records never fail a request.
    }
  }

  private emit(
    unit: Unit<AjourCatalog, "plugin.request"> | undefined,
    exchange: Exchange,
    method: string,
    error: unknown,
  ) {
    if (!unit) return;
    unit.set({
      plugin: { id: exchange.pluginId },
      ...(exchange.connectionId
        ? { connection: { id: exchange.connectionId } }
        : {}),
      broker: {
        method: (pluginHttpMethods as readonly string[]).includes(method)
          ? (method as PluginHttpMethod)
          : "other",
        ...(exchange.hostKind ? { host_kind: exchange.hostKind } : {}),
        ...(exchange.pathTemplate
          ? { path_template: exchange.pathTemplate }
          : {}),
        ...(exchange.status !== undefined
          ? { status_code: exchange.status }
          : {}),
        redirects: exchange.redirects,
        request_bytes: exchange.requestBytes,
        response_bytes: exchange.responseBytes,
        on_premises: exchange.onPremises,
        pending: exchange.pending,
      },
    });
    if (error instanceof BrokerRequestError) {
      if (error.code === "timeout")
        unit.fail(error, { outcome: "timeout", reason: "timeout" });
      else if (error.code === "network")
        unit.fail(error, { reason: "network" });
      else if (error.reason === "operation_ended")
        unit.cancel("operation_ended");
      else unit.refuse(error.reason);
    } else if (error !== undefined) {
      unit.cancel("aborted");
    }
    unit.end();
  }

  private async request(
    caller: BrokerCaller,
    request: BrokerHttpRequest,
    ended: AbortSignal,
  ): Promise<BrokerResponse> {
    const body = bodyBytes(request?.body);
    const exchange: Exchange = {
      pluginId: caller.pluginId,
      redirects: 0,
      requestBytes: body?.byteLength ?? 0,
      responseBytes: 0,
      onPremises: false,
      pending: false,
    };
    return await this.run(
      caller,
      exchange,
      String(request?.method),
      [request?.signal, ended],
      body,
      async (signal) => {
        if (
          typeof request !== "object" ||
          request === null ||
          typeof request.connectionId !== "string" ||
          !(pluginHttpMethods as readonly string[]).includes(request.method)
        ) {
          throw refused(
            "invalid_request",
            "A request names a connection and a method.",
          );
        }
        if (request.body !== undefined && body === undefined) {
          throw refused("invalid_request", "A body is a string or bytes.");
        }
        const connection = await this.connectionOf(
          caller,
          request.connectionId,
        );
        exchange.connectionId =
          caller.pending?.id === connection.id ? undefined : connection.id;
        exchange.pending = caller.pending?.id === connection.id;
        exchange.onPremises = connection.onPremises;
        const auth = caller.manifest.network?.auth;
        const target = targetOf(caller.manifest, connection, request);
        exchange.hostKind = target.hostKind;
        exchange.pathTemplate = target.pathTemplate;
        const headers = requestHeaders(caller.manifest, request.headers, auth);
        // Already refused above; the auth scheme's own header, too.
        for (const name of authSchemeHeaders(auth)) delete headers[name];
        return await this.exchange(
          {
            target,
            method: request.method,
            headers,
            body,
            onPremises: connection.onPremises,
            secrets: connection.secrets,
          },
          signal,
          exchange,
        );
      },
    );
  }

  /** The caller's own connection: the pending one, or one it saved. */
  private async connectionOf(
    caller: BrokerCaller,
    connectionId: string,
  ): Promise<BrokerConnection> {
    if (caller.pending && caller.pending.id === connectionId)
      return caller.pending;
    const connection = await this.options.connections.connection(
      caller.pluginId,
      connectionId,
      caller.manifest,
    );
    if (!connection) throw refused("connection_not_found", NOT_FOUND_MESSAGE);
    return connection;
  }

  /** Refuses an address the connection may not reach. */
  private async checkAddress(url: URL, onPremises: boolean) {
    if (onPremises) return { proxied: false };
    const hostname = unbracketed(url.hostname);
    if (isAddressLiteral(url.hostname)) {
      if (isPrivateAddress(hostname)) throw this.privateAddress();
      return { proxied: false };
    }
    const resolver = this.options.resolver ?? nodeResolver;
    let resolved: { addresses: readonly string[]; proxied?: boolean };
    try {
      resolved = await resolver.resolve(hostname, url.href);
    } catch {
      throw new BrokerRequestError(
        "network",
        "network",
        "The service's address couldn't be found.",
      );
    }
    if (resolved.addresses.some(isPrivateAddress)) throw this.privateAddress();
    if (resolved.addresses.length === 0 && !resolved.proxied) {
      throw new BrokerRequestError(
        "network",
        "network",
        "The service's address couldn't be found.",
      );
    }
    return { proxied: resolved.proxied === true };
  }

  private privateAddress() {
    return refused(
      "private_address",
      "The service's address is on this computer or a private network. Mark the connection as on-premises to reach it.",
    );
  }

  /** Sends the request and follows what the rules let it follow. */
  private async exchange(
    plan: {
      target: Target;
      method: PluginHttpMethod;
      headers: Record<string, string>;
      body: Uint8Array | undefined;
      onPremises: boolean;
      /** The connection's secret values, scrubbed from the answer. */
      secrets: readonly string[];
    },
    signal: AbortSignal,
    exchange: Exchange,
  ): Promise<BrokerResponse> {
    const transport = this.options.transport!;
    const { target } = plan;
    /**
     * The addresses a secret address redirected to: they often carry a
     * signed token of their own, so they are scrubbed like the secret.
     */
    const visited: string[] = [];
    let url = target.url;
    let method = plan.method;
    let body = plan.body;
    const origin = url.origin;
    for (;;) {
      const { proxied } = await this.checkAddress(url, plan.onPremises);
      if (signal.aborted) throw abortError(signal);
      const response = await transport.send({
        url: url.href,
        method,
        headers: {
          ...plan.headers,
          ...(url.origin === origin ? target.authHeaders : {}),
        },
        ...(body !== undefined ? { body } : {}),
        signal,
        maxResponseBytes: this.limits.responseBodyBytes,
      });
      if (
        !plan.onPremises &&
        !proxied &&
        response.remoteAddress !== undefined &&
        isPrivateAddress(response.remoteAddress)
      ) {
        // The name pointed elsewhere when it was checked: drop the answer.
        throw this.privateAddress();
      }
      if (response.body.byteLength > this.limits.responseBodyBytes) {
        throw Object.assign(new Error("too large"), {
          code: "response_too_large",
        });
      }
      const location = response.headers.location;
      if (REDIRECT_STATUSES.has(response.status) && location !== undefined) {
        let next: URL | undefined;
        try {
          next = new URL(location, url);
        } catch {
          next = undefined;
        }
        const follow = target.secretAddress
          ? next?.protocol === "https:"
          : next !== undefined &&
            next.origin === origin &&
            isUnder(next.pathname, target.basePath);
        if (follow && exchange.redirects < this.limits.redirects) {
          exchange.redirects += 1;
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) &&
              method === "POST")
          ) {
            method = method === "HEAD" ? "HEAD" : "GET";
            body = undefined;
          }
          next!.hash = "";
          url = next!;
          if (target.secretAddress) visited.push(url.href);
          continue;
        }
        if (target.secretAddress) {
          // Handing the 3xx back would give the address away.
          throw refused(
            "redirect_refused",
            follow
              ? "The connection's secret address redirected more than 3 times."
              : "The connection's secret address redirected to an address that isn't https.",
          );
        }
      }
      const scrubber = new SecretScrubber(
        secretForms([...plan.secrets, ...visited], target.credentials),
      );
      return {
        status: response.status,
        headers: responseHeaders(
          response.headers,
          scrubber,
          target.secretAddress,
        ),
        body: scrubber.empty ? response.body : scrubber.bytes(response.body),
      };
    }
  }

  private async publicFetch(
    caller: BrokerCaller,
    rawUrl: string,
    init: BrokerPublicFetchInit = {},
    ended: AbortSignal,
  ): Promise<BrokerResponse> {
    const method = init?.method ?? "GET";
    const exchange: Exchange = {
      pluginId: caller.pluginId,
      hostKind: "public",
      redirects: 0,
      requestBytes: 0,
      responseBytes: 0,
      onPremises: false,
      pending: false,
    };
    return await this.run(
      caller,
      exchange,
      String(method),
      [init?.signal, ended],
      undefined,
      async (signal) => {
        if (method !== "GET" && method !== "HEAD") {
          throw refused(
            "invalid_request",
            "ajour.publicFetch sends GET or HEAD only.",
          );
        }
        let url: URL;
        try {
          url = new URL(String(rawUrl));
        } catch {
          throw refused(
            "invalid_request",
            "ajour.publicFetch takes an absolute https address.",
          );
        }
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port
        ) {
          throw refused(
            "not_allowed",
            "ajour.publicFetch reaches https addresses on their default port, without a user name.",
          );
        }
        const publicHosts = caller.manifest.network?.publicHosts ?? [];
        if (!publicHosts.includes(url.hostname)) {
          throw refused(
            "not_allowed",
            "The plugin's manifest declares no public host by that name.",
          );
        }
        url.hash = "";
        const headers = requestHeaders(
          caller.manifest,
          init?.headers,
          undefined,
        );
        return await this.exchange(
          {
            target: {
              url,
              hostKind: "public",
              basePath: "",
              authHeaders: {},
              credentials: [],
              secretAddress: false,
            },
            method,
            headers,
            body: undefined,
            onPremises: false,
            secrets: [],
          },
          signal,
          exchange,
        );
      },
    );
  }
}

/** Node's resolver, every address of the host. The desktop app passes its session's. */
const nodeResolver: BrokerResolver = {
  async resolve(hostname) {
    const { lookup } = await import("node:dns/promises");
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return { addresses: answers.map((answer) => answer.address) };
  },
};

export { SECRET_MARK };

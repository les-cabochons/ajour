/**
 * The credential broker's port: what a plugin operation sends through it,
 * what it answers and rejects with, and what the broker is given to send
 * with (`credential-broker.ts`). The runtimes call `CredentialBrokerPort`,
 * in process or over IPC, and the in-process `CredentialBroker` implements
 * it.
 */

import type {
  PluginApi4Manifest,
  PluginHttpMethod,
} from "../../../packages/shared/plugin-api-4.ts";
import type { PluginFieldValues } from "../../../packages/shared/plugins.ts";
import type {
  AjourCatalog,
  ReasonOf,
} from "../../../packages/wide-events/catalog.ts";
import type { ApiEvents } from "./events.ts";

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

/**
 * What a refused, limited or failed request says, for its event: the
 * `plugin.request` event's reasons, but `aborted`, which is the plugin's.
 */
export type BrokerReason = Exclude<
  ReasonOf<AjourCatalog, "plugin.request">,
  "aborted"
>;

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
        reason:
          "system_off" | "plugin_off" | "needs_consent" | "capability_off";
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
  /**
   * The addresses the broker checked for the URL's host, which the
   * transport connects to and no other, whatever the name resolves to by
   * then: the Host header, TLS's server name and the certificate check stay
   * on the name. Only an https URL is pinned, as only an on-premises
   * connection, which nothing pins, may use http. Absent when nothing is
   * pinned: on-premises, through a system proxy, or for an address literal,
   * which can't rebind.
   */
  connectTo?: readonly string[];
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
  /**
   * The address that answered, when the transport can tell. A pinned
   * exchange may leave it out: it went to one of `connectTo`.
   */
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
   * empty, and the address that answers is the proxy's. `proxyAddresses`,
   * when the resolver knows them, are the proxies' own: an answer from any
   * other address, as when a PAC file falls back to `DIRECT`, is judged as
   * an unproxied one.
   */
  resolve(
    hostname: string,
    url: string,
  ): Promise<{
    addresses: readonly string[];
    proxied?: boolean;
    proxyAddresses?: readonly string[];
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
